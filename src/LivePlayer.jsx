import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

const LivePlayer = forwardRef(function LivePlayer({ channel }, ref) {
  const containerRef = useRef(null);
  const artRef = useRef(null);
  const engineRef = useRef(null);
  const manualReconnectRef = useRef(null);
  const retryRef = useRef({ count: 0, timer: null, waitingTimer: null });
  const [state, setState] = useState('connecting');

  useImperativeHandle(ref, () => ({
    reconnect: () => manualReconnectRef.current?.(),
  }), []);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let disposed = false;
    let resumeWhenVisible = false;
    let resumeAfterBuffer = true;
    let reconnecting = false;

    const clearTimers = () => {
      clearTimeout(retryRef.current.timer);
      clearTimeout(retryRef.current.waitingTimer);
      retryRef.current.timer = null;
      retryRef.current.waitingTimer = null;
    };

    const destroyEngine = () => {
      const engine = engineRef.current;
      engineRef.current = null;
      if (!engine) return;
      try {
        if (engine instanceof Hls) engine.destroy();
        else {
          engine.pause?.();
          engine.unload?.();
          engine.detachMediaElement?.();
          engine.destroy?.();
        }
      } catch {
        // The stream may already have released its media source.
      }
    };

    const scheduleReconnect = () => {
      if (disposed || retryRef.current.timer) return;
      if (retryRef.current.count >= 4) {
        setState('failed');
        return;
      }
      clearTimeout(retryRef.current.waitingTimer);
      retryRef.current.waitingTimer = null;
      resumeAfterBuffer = resumeAfterBuffer || Boolean(artRef.current && !artRef.current.video.paused);
      reconnecting = true;
      setState('reconnecting');
      const delay = Math.min(12_000, 1_500 * (2 ** retryRef.current.count));
      retryRef.current.count += 1;
      retryRef.current.timer = setTimeout(() => {
        retryRef.current.timer = null;
        if (!disposed && artRef.current) {
          artRef.current.switchUrl(channel.stream);
          if (resumeAfterBuffer) artRef.current.play().catch(scheduleReconnect);
        }
      }, delay);
    };

    const beginBuffering = () => {
      if (disposed || !artRef.current) return;
      resumeAfterBuffer = resumeAfterBuffer || !artRef.current.video.paused;
      setState('buffering');
      clearTimeout(retryRef.current.waitingTimer);
      retryRef.current.waitingTimer = setTimeout(scheduleReconnect, 8_000);
    };

    const attachHls = (video, url) => {
      destroyEngine();
      if (!Hls.isSupported()) {
        if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url;
        else setState('unsupported');
        return;
      }
      const hls = new Hls({
        lowLatencyMode: false,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 8,
        maxLiveSyncPlaybackRate: 1.2,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferHole: 0.5,
        maxSeekHole: 2,
        highBufferWatchdogPeriod: 2,
        nudgeMaxRetry: 5,
        manifestLoadingTimeOut: 10_000,
        manifestLoadingMaxRetry: 3,
        levelLoadingTimeOut: 10_000,
        levelLoadingMaxRetry: 4,
        fragLoadingTimeOut: 20_000,
        fragLoadingMaxRetry: 6,
        enableWorker: true,
      });
      engineRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        if (data.levels && data.levels.length > 0) {
          let maxBitrateIndex = 0;
          let maxBitrate = 0;
          data.levels.forEach((level, idx) => {
            if (level.bitrate > maxBitrate) {
              maxBitrate = level.bitrate;
              maxBitrateIndex = idx;
            }
          });
          // 默认直接选中最高码率（原画/最高分辨率）
          hls.currentLevel = maxBitrateIndex;

          if (data.levels.length > 1 && artRef.current) {
            const sorted = data.levels.map((level, idx) => {
              const res = level.height ? `${level.height}P` : `画质 ${idx + 1}`;
              const isMax = idx === maxBitrateIndex;
              return {
                idx,
                bitrate: level.bitrate,
                label: isMax ? `原画 (${res})` : res,
                isMax,
              };
            }).sort((a, b) => b.bitrate - a.bitrate);

            const selector = [
              { html: '自动 (ABR)', level: -1 },
              ...sorted.map((item) => ({
                default: item.isMax,
                html: item.label,
                level: item.idx,
              })),
            ];

            artRef.current.controls.add({
              name: 'quality',
              position: 'right',
              index: 10,
              html: selector.find((s) => s.default)?.html || '画质',
              selector,
              onSelect: (item) => {
                hls.currentLevel = item.level;
                return item.html;
              },
            });
          }
        }
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) {
          if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) beginBuffering();
          if (data.details === Hls.ErrorDetails.BUFFER_NUDGE_ON_STALL) beginBuffering();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          beginBuffering();
          hls.recoverMediaError();
          return;
        }
        scheduleReconnect();
      });
    };

    const attachFlv = (video, url) => {
      destroyEngine();
      if (!mpegts.getFeatureList().mseLivePlayback) {
        setState('unsupported');
        return;
      }
      const absoluteUrl = new URL(url, window.location.href).href;
      const player = mpegts.createPlayer({ type: 'flv', isLive: true, url: absoluteUrl }, {
        enableWorker: true,
        enableStashBuffer: true,
        stashInitialSize: 128 * 1024,
        lazyLoad: false,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 3,
        liveBufferLatencyMinRemain: 0.8,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 30,
        autoCleanupMinBackwardDuration: 10,
      });
      engineRef.current = player;
      player.attachMediaElement(video);
      player.load();
      player.on(mpegts.Events.ERROR, scheduleReconnect);
    };

    const art = new Artplayer({
      container: containerRef.current,
      url: channel.stream,
      type: channel.streamType === 'hls' ? 'm3u8' : channel.streamType === 'flv' ? 'flv' : '',
      customType: {
        m3u8: attachHls,
        flv: attachFlv,
      },
      autoplay: true,
      volume: 0.72,
      isLive: true,
      muted: false,
      pip: true,
      setting: true,
      playbackRate: false,
      aspectRatio: true,
      screenshot: true,
      fullscreen: true,
      fullscreenWeb: true,
      airplay: true,
      hotkey: true,
      mutex: true,
      backdrop: true,
      theme: '#ef3f4a',
      lang: 'zh-cn',
      moreVideoAttr: {
        playsInline: true,
        crossOrigin: 'anonymous',
      },
    });
    artRef.current = art;
    manualReconnectRef.current = () => {
      clearTimers();
      retryRef.current.count = 0;
      reconnecting = true;
      resumeAfterBuffer = true;
      setState('reconnecting');
      art.switchUrl(channel.stream);
      art.play().catch(scheduleReconnect);
    };

    art.on('ready', () => {
      setState('ready');
      art.play().catch(() => {
        art.muted = true;
        art.play().catch(() => {});
      });
    });
    art.on('video:play', () => {
      resumeAfterBuffer = true;
    });
    art.on('video:playing', () => {
      clearTimers();
      retryRef.current.count = 0;
      reconnecting = false;
      resumeAfterBuffer = true;
      setState('playing');
    });
    art.on('video:pause', () => {
      if (reconnecting) return;
      resumeAfterBuffer = false;
      clearTimeout(retryRef.current.waitingTimer);
      retryRef.current.waitingTimer = null;
      if (art.video.readyState >= 2) setState('ready');
    });
    art.on('video:waiting', beginBuffering);
    art.on('video:stalled', beginBuffering);
    art.on('video:canplay', () => {
      clearTimeout(retryRef.current.waitingTimer);
      retryRef.current.waitingTimer = null;
      if (resumeAfterBuffer && art.video.paused) {
        setState('buffering');
        art.play().catch((err) => {
          // 若有声自动播放被浏览器拦截，回退为静音自动播放，防止引发误重连
          art.muted = true;
          art.play().catch(scheduleReconnect);
        });
      } else if (!art.video.paused) {
        setState('playing');
      } else {
        setState('ready');
      }
    });

    const enableSoundOnGesture = () => {
      if (artRef.current && artRef.current.muted) {
        artRef.current.muted = false;
      }
    };
    window.addEventListener('click', enableSoundOnGesture, { capture: true });
    art.on('video:ended', scheduleReconnect);
    art.on('video:error', scheduleReconnect);

    const handleVisibility = () => {
      if (document.hidden) {
        resumeWhenVisible = resumeAfterBuffer || !art.video.paused;
        return;
      }
      if (resumeWhenVisible) {
        resumeAfterBuffer = true;
        art.play().catch(scheduleReconnect);
      }
      resumeWhenVisible = false;
    };
    const handleOnline = () => {
      retryRef.current.count = 0;
      scheduleReconnect();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);

    return () => {
      disposed = true;
      clearTimers();
      window.removeEventListener('click', enableSoundOnGesture, { capture: true });
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
      destroyEngine();
      art.destroy(false);
      artRef.current = null;
      manualReconnectRef.current = null;
    };
  }, [channel]);

  return (
    <div className="player-wrap">
      <div ref={containerRef} className="artplayer-container" />
      {['connecting', 'reconnecting', 'buffering', 'unsupported', 'failed'].includes(state) && (
        <div className={`player-status player-status-${state}`} aria-live="polite">
          {!['unsupported', 'failed'].includes(state) && <span className="loading-spinner" />}
          <span>{state === 'connecting' && '正在连接直播信号'}</span>
          <span>{state === 'reconnecting' && '信号波动，正在重新连接'}</span>
          <span>{state === 'buffering' && '正在缓冲'}</span>
          <span>{state === 'unsupported' && '当前浏览器不支持此直播格式'}</span>
          <span>{state === 'failed' && '当前频道暂时离线'}</span>
        </div>
      )}
    </div>
  );
});

export default LivePlayer;
