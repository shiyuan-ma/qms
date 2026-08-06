import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronRight,
  Heart,
  Maximize2,
  Menu,
  Mountain,
  Play,
  Radio,
  RefreshCw,
  Search,
  Share2,
  X,
} from 'lucide-react';

const LivePlayer = lazy(() => import('./LivePlayer.jsx'));

const storageKeys = {
  favorites: 'akina-live:favorites',
  platform: 'akina-live:platform',
};

function readFavorites() {
  try {
    return new Set(JSON.parse(localStorage.getItem(storageKeys.favorites) || '[]'));
  } catch {
    return new Set();
  }
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { signal });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || '请求失败');
  return payload;
}

function ImageWithFallback({ src, alt, className = '' }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={`${className} image-fallback`} aria-label={alt}>
        <Radio aria-hidden="true" />
      </div>
    );
  }
  return <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

function PlatformList({ platforms, selectedId, onSelect, loading }) {
  if (loading) {
    return (
      <div className="platform-skeleton" aria-label="正在加载平台">
        {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
      </div>
    );
  }

  return (
    <div className="platform-list">
      {platforms.map((platform) => (
        <button
          className={`platform-item ${selectedId === platform.id ? 'is-active' : ''}`}
          key={platform.id}
          type="button"
          onClick={() => onSelect(platform)}
          aria-current={selectedId === platform.id ? 'page' : undefined}
        >
          <ImageWithFallback src={platform.image} alt="" className="platform-logo" />
          <span className="platform-name">{platform.title}</span>
          <span className="platform-count">{platform.count}</span>
          <ChevronRight className="platform-chevron" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function ChannelCard({ channel, selected, favorite, onPlay, onFavorite }) {
  return (
    <article className={`channel-card ${selected ? 'is-playing' : ''}`}>
      <button className="channel-cover" type="button" onClick={onPlay} aria-label={`播放 ${channel.title}`}>
        <ImageWithFallback src={channel.image} alt={channel.title} className="channel-image" />
        <span className="live-badge"><i />直播</span>
        <span className="play-button"><Play fill="currentColor" aria-hidden="true" /></span>
      </button>
      <div className="channel-meta">
        <button className="channel-title" type="button" onClick={onPlay}>{channel.title}</button>
        <button
          className={`icon-button favorite-button ${favorite ? 'is-active' : ''}`}
          type="button"
          onClick={onFavorite}
          aria-label={favorite ? `取消收藏 ${channel.title}` : `收藏 ${channel.title}`}
          title={favorite ? '取消收藏' : '收藏'}
        >
          <Heart fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

function App() {
  const [platforms, setPlatforms] = useState([]);
  const [selectedPlatform, setSelectedPlatform] = useState(null);
  const [channels, setChannels] = useState([]);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [platformLoading, setPlatformLoading] = useState(true);
  const [channelLoading, setChannelLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [view, setView] = useState('all');
  const [favorites, setFavorites] = useState(readFavorites);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [isPlayerOutView, setIsPlayerOutView] = useState(false);
  const [userClosedMini, setUserClosedMini] = useState(false);
  const playerAnchorRef = useRef(null);
  const playerFrameRef = useRef(null);
  const livePlayerRef = useRef(null);
  const upNextListRef = useRef(null);
  const platformRequestRef = useRef(0);
  const channelRequestRef = useRef(0);

  const loadPlatforms = useCallback(() => {
    const controller = new AbortController();
    const requestId = platformRequestRef.current + 1;
    platformRequestRef.current = requestId;
    setPlatformLoading(true);
    setError('');
    fetchJson('/api/platforms', controller.signal)
      .then(({ data }) => {
        if (requestId !== platformRequestRef.current) return;
        setPlatforms(data);
        const saved = localStorage.getItem(storageKeys.platform);
        const initial = data.find((item) => item.id === saved)
          || data.find((item) => item.title === '卫视直播')
          || data[0]
          || null;
        setSelectedPlatform(initial);
      })
      .catch((fetchError) => {
        if (requestId === platformRequestRef.current && fetchError.name !== 'AbortError') {
          setError(fetchError.message || '平台加载失败');
        }
      })
      .finally(() => {
        if (requestId === platformRequestRef.current) setPlatformLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(loadPlatforms, [loadPlatforms]);

  useEffect(() => {
    if (!selectedPlatform) return undefined;
    const controller = new AbortController();
    const requestId = channelRequestRef.current + 1;
    channelRequestRef.current = requestId;
    setChannelLoading(true);
    setError('');
    setChannels([]);
    setSelectedChannel(null);
    localStorage.setItem(storageKeys.platform, selectedPlatform.id);
    fetchJson(`/api/channels/${selectedPlatform.id}`, controller.signal)
      .then(({ data }) => {
        if (requestId !== channelRequestRef.current) return;
        setChannels(data);
        setSelectedChannel(data[0] || null);
      })
      .catch((fetchError) => {
        if (requestId === channelRequestRef.current && fetchError.name !== 'AbortError') {
          setError(fetchError.message || '频道加载失败');
        }
      })
      .finally(() => {
        if (requestId === channelRequestRef.current) setChannelLoading(false);
      });
    return () => controller.abort();
  }, [selectedPlatform]);

  useEffect(() => {
    localStorage.setItem(storageKeys.favorites, JSON.stringify([...favorites]));
  }, [favorites]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 2200);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const frame = playerFrameRef.current;
    const stage = frame?.closest('.watch-stage');
    if (!frame || !stage) return undefined;

    const syncPlayerHeight = () => {
      stage.style.setProperty('--player-height', `${frame.getBoundingClientRect().height}px`);
    };
    const observer = new ResizeObserver(syncPlayerHeight);
    observer.observe(frame);
    syncPlayerHeight();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const anchor = playerAnchorRef.current;
    if (!anchor) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsPlayerOutView(!entry.isIntersecting);
        if (entry.isIntersecting) {
          setUserClosedMini(false);
        }
      },
      {
        rootMargin: '-58px 0px 0px 0px',
        threshold: 0,
      }
    );
    observer.observe(anchor);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (upNextListRef.current) upNextListRef.current.scrollTop = 0;
  }, [selectedPlatform]);

  useEffect(() => {
    if (!mobileMenuOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setMobileMenuOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileMenuOpen]);

  const filteredChannels = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN');
    return channels.filter((channel) => {
      const matchesView = view === 'all' || favorites.has(channel.id);
      const matchesQuery = !keyword || channel.title.toLocaleLowerCase('zh-CN').includes(keyword);
      return matchesView && matchesQuery;
    });
  }, [channels, favorites, query, view]);

  const upNext = useMemo(() => {
    if (!selectedChannel || channels.length < 2) return [];
    return channels.filter((channel) => channel.id !== selectedChannel.id);
  }, [channels, selectedChannel]);

  const selectPlatform = (platform) => {
    setSelectedPlatform(platform);
    setQuery('');
    setView('all');
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const playChannel = (channel) => {
    setSelectedChannel(channel);
    setUserClosedMini(false);
  };

  const isMiniActive = isPlayerOutView && Boolean(selectedChannel) && !userClosedMini;

  const toggleFavorite = (channelId) => {
    setFavorites((current) => {
      const next = new Set(current);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
  };

  const shareChannel = async () => {
    if (!selectedChannel) return;
    const shareData = { title: `${selectedChannel.title} - 秋名山直播`, url: window.location.href };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(window.location.href);
        setNotice('链接已复制');
      }
    } catch (shareError) {
      if (shareError.name !== 'AbortError') setNotice('暂时无法分享');
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button
            className="icon-button menu-button"
            type="button"
            aria-label="打开平台列表"
            title="平台列表"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu aria-hidden="true" />
          </button>
          <a className="brand" href="/" aria-label="秋名山直播首页">
            <span className="brand-mark"><Mountain aria-hidden="true" /></span>
            <span>秋名山直播</span>
          </a>
          <label className="search-box">
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索当前平台"
              aria-label="搜索当前平台频道"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="清空搜索" title="清空">
                <X aria-hidden="true" />
              </button>
            )}
          </label>
          <div className="topbar-status"><i />直播信号</div>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar" aria-label="直播平台">
          <div className="sidebar-heading">
            <span>全部平台</span>
            <b>{platforms.length}</b>
          </div>
          <PlatformList
            platforms={platforms}
            selectedId={selectedPlatform?.id}
            onSelect={selectPlatform}
            loading={platformLoading}
          />
        </aside>

        <main className="main-content">
          {error && !selectedChannel ? (
            <section className="error-state">
              <Radio aria-hidden="true" />
              <h1>信号暂时不可用</h1>
              <p>{error}</p>
              <button className="primary-button" type="button" onClick={loadPlatforms}>
                <RefreshCw aria-hidden="true" />重新加载
              </button>
            </section>
          ) : (
            <>
              <section className="watch-stage" aria-label="直播播放器">
                <div className="player-column">
                  <div className="player-stage-anchor" ref={playerAnchorRef}>
                    {isMiniActive && (
                      <div className="player-frame-skeleton">
                        <Radio aria-hidden="true" />
                        <span>直播悬浮窗口播放中</span>
                      </div>
                    )}
                    <div className={`player-frame ${isMiniActive ? 'is-mini-floating' : ''}`} ref={playerFrameRef}>
                      {selectedChannel ? (
                        <Suspense fallback={(
                          <div className="player-placeholder">
                            <span className="loading-spinner" />
                            <span>正在载入播放器</span>
                          </div>
                        )}>
                          <LivePlayer ref={livePlayerRef} key={selectedChannel.id} channel={selectedChannel} />
                          {isMiniActive && (
                            <div className="mini-player-overlay">
                              <span className="mini-title">{selectedChannel.title}</span>
                              <div className="mini-actions">
                                <button
                                  type="button"
                                  className="mini-btn"
                                  onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                                  title="回到顶部大窗"
                                >
                                  <Maximize2 size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="mini-btn"
                                  onClick={() => setUserClosedMini(true)}
                                  title="关闭悬浮窗口"
                                >
                                  <X size={13} />
                                </button>
                              </div>
                            </div>
                          )}
                        </Suspense>
                      ) : (
                        <div className="player-placeholder">
                          <span className="loading-spinner" />
                          <span>{channelLoading ? '正在获取直播信号' : '选择一个频道开始观看'}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="now-playing">
                    <div>
                      <div className="eyebrow"><i />正在直播</div>
                      <h1>{selectedChannel?.title || selectedPlatform?.title || '秋名山直播'}</h1>
                      <p>{selectedPlatform?.title || '直播平台'}</p>
                    </div>
                    {selectedChannel && (
                      <div className="now-actions">
                        <button
                          className={`icon-button action-button ${favorites.has(selectedChannel.id) ? 'is-active' : ''}`}
                          type="button"
                          onClick={() => toggleFavorite(selectedChannel.id)}
                          aria-label={favorites.has(selectedChannel.id) ? '取消收藏当前频道' : '收藏当前频道'}
                          title={favorites.has(selectedChannel.id) ? '取消收藏' : '收藏'}
                        >
                          <Heart fill={favorites.has(selectedChannel.id) ? 'currentColor' : 'none'} aria-hidden="true" />
                        </button>
                        <button
                          className="icon-button action-button"
                          type="button"
                          onClick={() => livePlayerRef.current?.reconnect()}
                          aria-label="重新连接当前频道"
                          title="重新连接"
                        >
                          <RefreshCw aria-hidden="true" />
                        </button>
                        <button
                          className="icon-button action-button"
                          type="button"
                          onClick={shareChannel}
                          aria-label="分享当前频道"
                          title="分享"
                        >
                          <Share2 aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <aside className="up-next" aria-label="接着看">
                  <div className="section-title-row">
                    <h2>接着看</h2>
                    <span>{channels.length} 个频道</span>
                  </div>
                  <div className="up-next-list" ref={upNextListRef} tabIndex="0" aria-label="可滚动频道列表">
                    {upNext.map((channel) => (
                      <button key={channel.id} type="button" onClick={() => playChannel(channel)}>
                        <ImageWithFallback src={channel.image} alt="" className="up-next-image" />
                        <span>
                          <b>{channel.title}</b>
                          <small><i />直播中</small>
                        </span>
                        <Play fill="currentColor" aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </aside>
              </section>

              <section className="channel-section" aria-labelledby="channel-heading">
                <div className="channel-heading-row">
                  <div>
                    <p>{selectedPlatform?.title || '直播平台'}</p>
                    <h2 id="channel-heading">直播频道</h2>
                  </div>
                  <div className="view-tabs" role="tablist" aria-label="频道筛选">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={view === 'all'}
                      className={view === 'all' ? 'is-active' : ''}
                      onClick={() => setView('all')}
                    >全部</button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={view === 'favorites'}
                      className={view === 'favorites' ? 'is-active' : ''}
                      onClick={() => setView('favorites')}
                    >收藏</button>
                  </div>
                </div>

                {channelLoading ? (
                  <div className="channel-grid channel-grid-loading" aria-label="正在加载频道">
                    {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
                  </div>
                ) : filteredChannels.length ? (
                  <div className="channel-grid">
                    {filteredChannels.map((channel) => (
                      <ChannelCard
                        key={channel.id}
                        channel={channel}
                        selected={selectedChannel?.id === channel.id}
                        favorite={favorites.has(channel.id)}
                        onPlay={() => playChannel(channel)}
                        onFavorite={() => toggleFavorite(channel.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    {view === 'favorites' ? <Heart aria-hidden="true" /> : <Search aria-hidden="true" />}
                    <h3>{view === 'favorites' ? '还没有收藏频道' : '没有找到相关频道'}</h3>
                  </div>
                )}
              </section>
            </>
          )}
        </main>
      </div>

      {mobileMenuOpen && (
        <div className="mobile-drawer" role="dialog" aria-modal="true" aria-label="选择直播平台">
          <button className="drawer-backdrop" type="button" onClick={() => setMobileMenuOpen(false)} aria-label="关闭平台列表" />
          <div className="drawer-panel">
            <div className="drawer-heading">
              <strong>全部平台</strong>
              <button className="icon-button" type="button" onClick={() => setMobileMenuOpen(false)} aria-label="关闭" title="关闭">
                <X aria-hidden="true" />
              </button>
            </div>
            <PlatformList
              platforms={platforms}
              selectedId={selectedPlatform?.id}
              onSelect={selectPlatform}
              loading={platformLoading}
            />
          </div>
        </div>
      )}

      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

export default App;
