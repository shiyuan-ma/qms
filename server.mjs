import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import express from 'express';
import net from 'node:net';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const app = express();
const port = Number(process.env.PORT || 5173);
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const upstreamIndex = 'http://api.hclyz.com:81/mf/json.txt';
const upstreamRoot = new URL('./', upstreamIndex);
const registry = new Map();
const cache = new Map();
const streamHealth = new Map();
const cacheTtl = 20_000;
const cacheStaleTtl = 5 * 60_000;
const streamBlockTtl = 20 * 1000;

class UpstreamResponseError extends Error {
  constructor(status, label) {
    super(`${label} upstream responded with ${status}`);
    this.name = 'UpstreamResponseError';
    this.status = status;
  }
}

app.disable('x-powered-by');

function tokenFor(url, kind, metadata = {}) {
  const token = crypto.createHash('sha256').update(`${kind}:${url}`).digest('base64url').slice(0, 24);
  registry.set(token, { url, kind, touchedAt: Date.now(), ...metadata });
  return token;
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const parts = address.split('.').map(Number);
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || parts[0] === 0;
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
  }
  return true;
}

const dnsCache = new Map();
const dnsTtl = 5 * 60 * 1000;

async function resolveDns(hostname) {
  const cached = dnsCache.get(hostname);
  if (cached && Date.now() - cached.timestamp < dnsTtl) {
    return cached.addresses;
  }
  const addresses = await dns.lookup(hostname, { all: true });
  dnsCache.set(hostname, { addresses, timestamp: Date.now() });
  return addresses;
}

async function assertPublicUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Unsupported upstream protocol');
  }
  if (parsed.hostname === 'localhost') {
    throw new Error('Local upstream hosts are blocked');
  }
  if (net.isIP(parsed.hostname)) {
    if (isPrivateIp(parsed.hostname)) throw new Error('Private upstream hosts are blocked');
    return parsed;
  }
  const addresses = await resolveDns(parsed.hostname);
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new Error('Private upstream hosts are blocked');
  }
  return parsed;
}

async function upstreamFetch(rawUrl, options = {}) {
  const { headerTimeout = 15_000, signal, retries = 2, ...fetchOptions } = options;
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const timeoutSignal = AbortSignal.timeout(headerTimeout);
      let currentUrl = rawUrl;
      let response;
      for (let redirectCount = 0; redirectCount <= 4; redirectCount += 1) {
        await assertPublicUrl(currentUrl);
        response = await fetch(currentUrl, {
          ...fetchOptions,
          signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
          redirect: 'manual',
          headers: {
            'Accept': '*/*',
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36',
            'Connection': 'keep-alive',
            ...options.headers,
          },
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        if (!location || redirectCount === 4) throw new Error('Too many upstream redirects');
        currentUrl = new URL(location, currentUrl).toString();
      }
      if (response && [502, 503, 504].includes(response.status) && attempt < retries && (!signal || !signal.aborted)) {
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
        continue;
      }
      return response;
    } catch (err) {
      if (signal?.aborted) throw err;
      attempt += 1;
      if (attempt > retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  throw new Error('Upstream fetch failed after retries');
}

async function readJson(url) {
  const cached = cache.get(url);
  const now = Date.now();
  if (cached && now - cached.createdAt < cacheTtl) return cached.value;
  try {
    const response = await upstreamFetch(url, { headers: { Accept: 'application/json,text/plain,*/*' } });
    if (!response.ok) throw new UpstreamResponseError(response.status, 'Catalog');
    const value = JSON.parse(await response.text());
    cache.set(url, { value, createdAt: Date.now() });
    return value;
  } catch (error) {
    if (cached && now - cached.createdAt < cacheStaleTtl) return cached.value;
    throw error;
  }
}

function getRegistryEntry(token) {
  const entry = registry.get(token);
  if (entry) entry.touchedAt = Date.now();
  return entry;
}

function cleanText(value, fallback = '') {
  const raw = String(value ?? '').trim();
  try {
    return decodeURIComponent(raw.replace(/%(?![0-9a-f]{2})/gi, '%25')) || fallback;
  } catch {
    return raw || fallback;
  }
}

function detectStreamType(url) {
  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith('.m3u8')) return 'hls';
  if (pathname.endsWith('.flv')) return 'flv';
  return 'native';
}

function imageContentType(response, rawUrl) {
  const upstreamType = response.headers.get('content-type') || '';
  if (upstreamType.toLowerCase().startsWith('image/')) return upstreamType;
  const pathname = new URL(rawUrl).pathname.toLowerCase();
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.gif')) return 'image/gif';
  if (pathname.endsWith('.avif')) return 'image/avif';
  if (pathname.endsWith('.svg')) return 'image/svg+xml';
  return 'image/jpeg';
}

function isSupportedStream(url) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function isStreamBlocked(token) {
  const health = streamHealth.get(token);
  if (!health) return false;
  if (health.blockedUntil > Date.now()) return true;
  streamHealth.delete(token);
  return false;
}

function markStreamFailure(token) {
  const health = streamHealth.get(token) || { failures: 0, blockedUntil: 0 };
  health.failures += 1;
  // 连续失败 3 次才触发 20 秒短期防护，防误封
  if (health.failures >= 3) {
    health.blockedUntil = Date.now() + streamBlockTtl;
  }
  streamHealth.set(token, health);
}

function markStreamSuccess(token) {
  streamHealth.delete(token);
}

function rewriteManifest(text, baseUrl, rootToken) {
  const registerStream = (reference) => {
    const absolute = new URL(reference, baseUrl).toString();
    return `/api/stream/${tokenFor(absolute, 'stream', { rootToken })}`;
  };

  return text.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (!trimmed.startsWith('#')) return registerStream(trimmed);
    return line.replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${registerStream(uri)}"`);
  }).join('\n');
}

function sendProxyError(res, error, label) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) {
    res.destroy(error);
    return;
  }
  const status = error instanceof UpstreamResponseError
    ? error.status
    : error?.name === 'AbortError' ? 504 : 502;
  res.status(status).json({ message: `${label}暂时不可用` });
}

function pipeResponseBody(body, res) {
  const stream = Readable.fromWeb(body);
  stream.on('error', (error) => res.destroy(error));
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}

app.get('/api/platforms', async (_req, res) => {
  try {
    const payload = await readJson(upstreamIndex);
    const platforms = (Array.isArray(payload?.pingtai) ? payload.pingtai : [])
      .filter((item) => cleanText(item.title) !== '卫视直播')
      .filter((item) => (Number.parseInt(item.Number, 10) || 0) > 0);
    res.set('Cache-Control', 'public, max-age=20, stale-while-revalidate=60');
    res.json({
      updatedAt: new Date().toISOString(),
      data: platforms.map((item, index) => {
        const sourceUrl = new URL(String(item.address || ''), upstreamRoot).toString();
        const imageUrl = String(item.xinimg || '').trim();
        return {
          id: tokenFor(sourceUrl, 'source'),
          title: cleanText(item.title, `平台 ${index + 1}`),
          count: Number.parseInt(item.Number, 10) || 0,
          image: imageUrl ? `/api/image/${tokenFor(imageUrl, 'image')}` : '',
        };
      }),
    });
  } catch (error) {
    sendProxyError(res, error, '平台数据');
  }
});

app.get(['/healthz', '/api/health'], (_req, res) => {
  res.json({
    status: 'ok',
    cacheEntries: cache.size,
    registeredStreams: registry.size,
    blockedStreams: streamHealth.size,
  });
});

app.get('/api/channels/:sourceId', async (req, res) => {
  const entry = getRegistryEntry(req.params.sourceId);
  if (!entry || entry.kind !== 'source') {
    res.status(404).json({ message: '平台不存在或数据已刷新' });
    return;
  }
  try {
    const payload = await readJson(entry.url);
    const channels = (Array.isArray(payload?.zhubo) ? payload.zhubo : [])
      .filter((item) => isSupportedStream(String(item.address || '').trim()));
    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=45');
    res.json({
      data: channels.map((item, index) => {
        const streamUrl = String(item.address || '').trim();
        const imageUrl = String(item.img || '').trim();
        const streamToken = tokenFor(streamUrl, 'stream');
        return {
          id: streamToken,
          title: cleanText(item.title, `频道 ${index + 1}`),
          image: imageUrl ? `/api/image/${tokenFor(imageUrl, 'image')}` : '',
          stream: `/api/stream/${streamToken}`,
          streamType: detectStreamType(streamUrl),
        };
      }).filter((channel) => !isStreamBlocked(channel.id)),
    });
  } catch (error) {
    sendProxyError(res, error, '频道数据');
  }
});

app.get('/api/image/:token', async (req, res) => {
  const entry = getRegistryEntry(req.params.token);
  if (!entry || entry.kind !== 'image') {
    res.status(404).end();
    return;
  }
  try {
    const response = await upstreamFetch(entry.url, {
      headers: { Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' },
    });
    if (!response.ok) throw new UpstreamResponseError(response.status, 'Image');
    if (!response.body) throw new Error('Image upstream returned no body');
    res.status(response.status);
    res.set('Content-Type', imageContentType(response, entry.url));
    res.set('Cache-Control', 'public, max-age=21600, stale-while-revalidate=86400');
    for (const header of ['content-length', 'etag', 'last-modified']) {
      const value = response.headers.get(header);
      if (value) res.set(header, value);
    }
    pipeResponseBody(response.body, res);
  } catch (error) {
    sendProxyError(res, error, '图片');
  }
});

app.get('/api/stream/:token', async (req, res) => {
  const entry = getRegistryEntry(req.params.token);
  if (!entry || entry.kind !== 'stream') {
    res.status(404).json({ message: '直播地址已失效，请刷新频道列表' });
    return;
  }
  if (isStreamBlocked(req.params.token) || (entry.rootToken && isStreamBlocked(entry.rootToken))) {
    res.set('Retry-After', String(Math.ceil(streamBlockTtl / 1000)));
    res.status(503).json({ message: '该直播信号暂时离线' });
    return;
  }

  const requestController = new AbortController();
  try {
    res.on('close', () => requestController.abort());
    const parsed = new URL(entry.url);
    const headers = {
      Accept: req.get('Accept') || '*/*',
      Referer: `${parsed.protocol}//${parsed.host}/`,
    };
    if (req.get('Range')) headers.Range = req.get('Range');
    const response = await upstreamFetch(entry.url, {
      headers,
      headerTimeout: 20_000,
      signal: requestController.signal,
    });
    if (!response.ok) throw new UpstreamResponseError(response.status, 'Stream');
    if (!response.body) throw new Error('Stream upstream returned no body');

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const finalUrl = response.url || entry.url;
    const isManifest = contentType.includes('mpegurl') || new URL(finalUrl).pathname.toLowerCase().endsWith('.m3u8');

    res.status(response.status);
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Content-Type', isManifest ? 'application/vnd.apple.mpegurl' : contentType);
    res.set('Cache-Control', isManifest ? 'no-store' : 'public, max-age=3');
    for (const header of ['accept-ranges', 'content-length', 'content-range']) {
      const value = response.headers.get(header);
      if (value && !isManifest) res.set(header, value);
    }

    if (isManifest) {
      const manifest = await response.text();
      if (!manifest.trimStart().startsWith('#EXTM3U')) throw new Error('Invalid HLS manifest');
      markStreamSuccess(req.params.token);
      res.send(rewriteManifest(manifest, finalUrl, entry.rootToken || req.params.token));
      return;
    }
    markStreamSuccess(req.params.token);
    pipeResponseBody(response.body, res);
  } catch (error) {
    if (requestController.signal.aborted && (req.aborted || res.destroyed || res.writableEnded)) return;
    if (
      !entry.rootToken
      && error instanceof UpstreamResponseError
      && [401, 403, 404, 410].includes(error.status)
    ) {
      markStreamFailure(req.params.token);
    }
    sendProxyError(res, error, '直播信号');
  }
});

setInterval(() => {
  const oldest = Date.now() - 12 * 60 * 60 * 1000;
  for (const [token, value] of registry) {
    if (value.touchedAt < oldest) registry.delete(token);
  }
  for (const [token, value] of streamHealth) {
    if (value.blockedUntil <= Date.now()) streamHealth.delete(token);
  }
}, 60 * 60 * 1000).unref();

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(rootDir, 'dist'), { maxAge: '1h' }));
  app.get('*splat', (_req, res) => res.sendFile(path.join(rootDir, 'dist', 'index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', () => {
  console.log(`秋名山直播已启动：http://localhost:${port}`);
});
