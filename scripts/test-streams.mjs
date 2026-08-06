const baseUrl = process.env.TEST_BASE_URL || 'http://localhost:5173';
const timeoutMs = Number(process.env.TEST_TIMEOUT || 8_000);
const concurrency = Number(process.env.TEST_CONCURRENCY || 10);
const sampleSize = Number(process.env.TEST_SAMPLE_SIZE || 3);
const requestedLimit = Number(process.env.TEST_LIMIT || 0);

function withTimeout(timeout = timeoutMs) {
  return AbortSignal.timeout(timeout);
}

async function readJson(path) {
  const response = await fetch(`${baseUrl}${path}`, { signal: withTimeout(20_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
  return payload;
}

async function readFirstChunk(response) {
  if (!response.body) throw new Error('响应没有媒体数据');
  const reader = response.body.getReader();
  try {
    const { value, done } = await reader.read();
    if (done || !value?.length) throw new Error('响应没有媒体数据');
    return value;
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function probeHls(path, depth = 0) {
  if (depth > 3) throw new Error('HLS 清单嵌套过深');
  const response = await fetch(`${baseUrl}${path}`, { signal: withTimeout() });
  if (!response.ok) throw new Error(`HLS HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('mpegurl')) {
    await readFirstChunk(response);
    return;
  }

  const manifest = await response.text();
  if (!manifest.trimStart().startsWith('#EXTM3U')) throw new Error('HLS 清单格式无效');
  const mediaPath = manifest.split(/\r?\n/).find((line) => line.trim() && !line.startsWith('#'));
  if (!mediaPath) throw new Error('HLS 清单中没有媒体地址');
  if (!mediaPath.startsWith('/api/stream/')) throw new Error('HLS 媒体地址未被同源重写');
  await probeHls(mediaPath, depth + 1);
}

async function probeChannel(channel) {
  if (channel.streamType === 'hls') {
    await probeHls(channel.stream);
    return;
  }

  const response = await fetch(`${baseUrl}${channel.stream}`, {
    headers: { Range: 'bytes=0-65535' },
    signal: withTimeout(),
  });
  if (!response.ok && response.status !== 206) throw new Error(`媒体 HTTP ${response.status}`);
  const chunk = await readFirstChunk(response);
  if (channel.streamType === 'flv') {
    const signature = String.fromCharCode(...chunk.slice(0, 3));
    if (signature !== 'FLV') throw new Error('FLV 文件头无效');
  }
}

async function mapConcurrent(items, worker, size) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, run));
  return results;
}

const { data: allPlatforms } = await readJson('/api/platforms');
const platforms = requestedLimit > 0 ? allPlatforms.slice(0, requestedLimit) : allPlatforms;
const typeCounts = { hls: 0, flv: 0, native: 0 };
let totalChannels = 0;

const catalogResults = await mapConcurrent(platforms, async (platform) => {
  try {
    const { data } = await readJson(`/api/channels/${platform.id}`);
    totalChannels += data.length;
    for (const channel of data) typeCounts[channel.streamType] = (typeCounts[channel.streamType] || 0) + 1;
    return { platform, channels: data };
  } catch (error) {
    return { platform, channels: [], catalogError: error.message };
  }
}, concurrency);

let completed = 0;
const probeResults = await mapConcurrent(catalogResults, async (item) => {
  if (item.catalogError) return { ...item, ok: false, error: item.catalogError };
  if (!item.channels.length) return { ...item, ok: false, error: '平台没有返回频道' };

  const attempts = [];
  const successes = [];
  for (const channel of item.channels.slice(0, sampleSize)) {
    try {
      await probeChannel(channel);
      successes.push({ channel: channel.title, type: channel.streamType });
    } catch (error) {
      attempts.push(`${channel.title}: ${error.message}`);
    }
  }
  completed += 1;
  if (completed % 10 === 0) process.stdout.write(`已完成 ${completed}/${platforms.length}\n`);
  return {
    ...item,
    ok: successes.length > 0,
    successes,
    error: successes.length ? '' : attempts.join('；'),
    attempts,
  };
}, concurrency);

const passed = probeResults.filter((item) => item.ok);
const failed = probeResults.filter((item) => !item.ok);
const passedTypes = passed.reduce((counts, item) => {
  for (const success of item.successes) counts[success.type] = (counts[success.type] || 0) + 1;
  return counts;
}, {});
const testedChannels = probeResults.reduce((sum, item) => sum + (item.successes?.length || 0) + (item.attempts?.length || 0), 0);
const failedChannelSamples = probeResults.reduce((sum, item) => sum + (item.attempts?.length || 0), 0);

console.log('\n直播源测试结果');
console.log(JSON.stringify({
  platforms: platforms.length,
  totalChannels,
  typeCounts,
  playablePlatforms: passed.length,
  failedPlatforms: failed.length,
  testedChannels,
  failedChannelSamples,
  passedTypes,
}, null, 2));

if (failed.length) {
  console.log('\n未通过的平台');
  for (const item of failed) console.log(`- ${item.platform.title}: ${item.error}`);
}

const sampleFailures = probeResults.filter((item) => item.attempts?.length);
if (sampleFailures.length) {
  console.log('\n未通过的频道样本');
  for (const item of sampleFailures) {
    for (const attempt of item.attempts) console.log(`- ${item.platform.title} / ${attempt}`);
  }
}

if (process.argv.includes('--strict') && failed.length) process.exitCode = 1;
