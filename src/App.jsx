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
  Trash2,
  X,
} from 'lucide-react';

const LivePlayer = lazy(() => import('./LivePlayer.jsx'));

const storageKeys = {
  favorites: 'akina-live:favorites',
  platform: 'akina-live:platform',
};

// 从 localStorage 读取收藏列表，支持旧版 string[] 和新版 channel[] 对象兼容
function readFavorites() {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKeys.favorites) || '[]');
    const map = new Map();
    if (Array.isArray(raw)) {
      raw.forEach((item) => {
        if (typeof item === 'string') {
          map.set(item, { id: item, title: '未命名收藏', stream: '', image: '' });
        } else if (item && item.id) {
          map.set(item.id, {
            id: item.id,
            title: item.title || '收藏频道',
            image: item.image || '',
            stream: item.stream || '',
            streamType: item.streamType || '',
            platformId: item.platformId || '',
            platformTitle: item.platformTitle || '',
          });
        }
      });
    }
    return map;
  } catch {
    return new Map();
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
  const displayTitle = channel.title || '未知频道';
  return (
    <article className={`channel-card ${selected ? 'is-playing' : ''}`}>
      <button className="channel-cover" type="button" onClick={onPlay} aria-label={`播放 ${displayTitle}`}>
        <ImageWithFallback src={channel.image} alt={displayTitle} className="channel-image" />
        <span className="live-badge"><i />直播</span>
        <span className="play-button"><Play fill="currentColor" aria-hidden="true" /></span>
      </button>
      <div className="channel-meta">
        <div className="channel-info-wrapper">
          <button className="channel-title" type="button" onClick={onPlay} title={displayTitle}>
            {displayTitle}
          </button>
          {channel.platformTitle && (
            <span className="channel-platform-tag">{channel.platformTitle}</span>
          )}
        </div>
        <button
          className={`icon-button favorite-button ${favorite ? 'is-active' : ''}`}
          type="button"
          onClick={onFavorite}
          aria-label={favorite ? `取消收藏 ${displayTitle}` : `收藏 ${displayTitle}`}
          title={favorite ? '取消收藏' : '收藏'}
        >
          <Heart fill={favorite ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

// “我的收藏”侧边抽屉组件
function FavoritesDrawer({ open, onClose, favorites, onPlayChannel, onRemoveFavorite, onClearAll }) {
  const [filterQuery, setFilterQuery] = useState('');

  if (!open) return null;

  const favoriteList = Array.from(favorites.values());
  const keyword = filterQuery.trim().toLowerCase();
  const filteredList = favoriteList.filter((item) => {
    if (!keyword) return true;
    const titleMatch = item.title ? item.title.toLowerCase().includes(keyword) : false;
    const platformMatch = item.platformTitle ? item.platformTitle.toLowerCase().includes(keyword) : false;
    return titleMatch || platformMatch;
  });

  return (
    <div className="favorites-drawer-overlay" role="dialog" aria-modal="true" aria-label="我的收藏列表">
      <button className="drawer-backdrop" type="button" onClick={onClose} aria-label="关闭我的收藏" />
      <div className="favorites-drawer-panel">
        <div className="drawer-header">
          <div className="drawer-header-title">
            <Heart className="heart-icon" fill="currentColor" aria-hidden="true" />
            <span>我的收藏</span>
            <span className="drawer-count-badge">{favorites.size}</span>
          </div>
          <div className="drawer-header-actions">
            {favorites.size > 0 && (
              <button
                type="button"
                className="clear-all-btn"
                onClick={onClearAll}
                title="清空收藏"
              >
                <Trash2 size={15} />
                <span>清空</span>
              </button>
            )}
            <button className="icon-button" type="button" onClick={onClose} aria-label="关闭" title="关闭">
              <X aria-hidden="true" />
            </button>
          </div>
        </div>

        {favorites.size > 0 && (
          <div className="drawer-search-bar">
            <Search size={16} aria-hidden="true" />
            <input
              type="search"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="在收藏中搜索..."
            />
            {filterQuery && (
              <button type="button" onClick={() => setFilterQuery('')} title="清空搜索">
                <X size={14} />
              </button>
            )}
          </div>
        )}

        <div className="drawer-body">
          {favoriteList.length === 0 ? (
            <div className="empty-favorites">
              <Heart className="empty-heart-icon" aria-hidden="true" />
              <h3>暂无收藏的直播</h3>
              <p>在直播卡片或播放器右下角点击爱心图标，即可随时收藏您喜爱的直播频道。</p>
            </div>
          ) : filteredList.length === 0 ? (
            <div className="empty-favorites">
              <Search aria-hidden="true" />
              <h3>未找到匹配的收藏</h3>
            </div>
          ) : (
            <div className="favorites-items-list">
              {filteredList.map((item) => {
                const itemTitle = item.title || '收藏频道';
                return (
                  <div className="favorite-item-card" key={item.id}>
                    <button
                      className="fav-item-cover"
                      type="button"
                      onClick={() => onPlayChannel(item)}
                      title={`播放 ${itemTitle}`}
                    >
                      <ImageWithFallback src={item.image} alt={itemTitle} className="fav-item-img" />
                      <span className="fav-play-overlay"><Play fill="currentColor" size={16} /></span>
                    </button>
                    <div className="fav-item-info">
                      <button
                        type="button"
                        className="fav-item-title"
                        onClick={() => onPlayChannel(item)}
                        title={itemTitle}
                      >
                        {itemTitle}
                      </button>
                      <span className="fav-platform-tag">{item.platformTitle || '直播频道'}</span>
                    </div>
                    <div className="fav-item-actions">
                      <button
                        type="button"
                        className="fav-action-btn play-btn"
                        onClick={() => onPlayChannel(item)}
                        title="立即播放"
                      >
                        <Play size={14} fill="currentColor" />
                      </button>
                      <button
                        type="button"
                        className="fav-action-btn delete-btn"
                        onClick={() => onRemoveFavorite(item.id)}
                        title="取消收藏"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
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
  const [favoritesDrawerOpen, setFavoritesDrawerOpen] = useState(false);
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

  // 加载当前平台的频道数据，并注入平台信息
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
        const enriched = (data || []).map((item) => ({
          ...item,
          platformId: selectedPlatform.id,
          platformTitle: selectedPlatform.title,
        }));
        setChannels(enriched);
        setSelectedChannel(enriched[0] || null);
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

  // 关键：当 channels 加载完成时，自动用最新的 channel 信息合并补全旧的收藏数据（解决旧数据没有 title/stream/image 的问题）
  useEffect(() => {
    if (!channels || channels.length === 0) return;
    setFavorites((currentMap) => {
      let hasUpdate = false;
      const nextMap = new Map(currentMap);
      channels.forEach((ch) => {
        if (nextMap.has(ch.id)) {
          const existing = nextMap.get(ch.id);
          // 如果信息缺失或标题未命名，使用最新拉取的频道数据更新
          if (!existing.title || existing.title === '未命名收藏' || existing.title === '收藏频道' || !existing.stream) {
            nextMap.set(ch.id, {
              ...ch,
              platformId: selectedPlatform?.id || existing.platformId || '',
              platformTitle: selectedPlatform?.title || existing.platformTitle || '',
            });
            hasUpdate = true;
          }
        }
      });
      return hasUpdate ? nextMap : currentMap;
    });
  }, [channels, selectedPlatform]);

  // 持久化保存收藏项（完整 JSON 格式）
  useEffect(() => {
    const items = Array.from(favorites.values());
    localStorage.setItem(storageKeys.favorites, JSON.stringify(items));
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
    if (!mobileMenuOpen && !favoritesDrawerOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setMobileMenuOpen(false);
        setFavoritesDrawerOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mobileMenuOpen, favoritesDrawerOpen]);

  // 修复与强化搜索过滤逻辑
  const filteredChannels = useMemo(() => {
    const keyword = query.trim().toLowerCase();

    // 如果处于"收藏"视图，展示全局所有已收藏的频道
    if (view === 'favorites') {
      const allFavs = Array.from(favorites.values());
      return allFavs.filter((channel) => {
        if (!keyword) return true;
        const titleMatch = channel.title ? channel.title.toLowerCase().includes(keyword) : false;
        const platformMatch = channel.platformTitle ? channel.platformTitle.toLowerCase().includes(keyword) : false;
        return titleMatch || platformMatch;
      });
    }

    // 默认展示当前平台的频道，进行频道名称模糊匹配
    return channels.filter((channel) => {
      if (!keyword) return true;
      return channel.title ? channel.title.toLowerCase().includes(keyword) : false;
    });
  }, [channels, favorites, query, view]);

  // “接着看”列表同步响应搜索筛选
  const upNext = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!selectedChannel || channels.length < 2) return [];
    return channels.filter((channel) => {
      const isNotCurrent = channel.id !== selectedChannel.id;
      const matchesQuery = !keyword || (channel.title && channel.title.toLowerCase().includes(keyword));
      return isNotCurrent && matchesQuery;
    });
  }, [channels, selectedChannel, query]);

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

  // 播放收藏面板中的频道
  const playFavoriteChannel = (favChannel) => {
    // 1. 如果有对应 platformId 且不等于当前平台，自动联动切换平台（这也会触发后端注册该平台的流 token）
    if (favChannel.platformId && selectedPlatform?.id !== favChannel.platformId) {
      const targetPlatform = platforms.find((p) => p.id === favChannel.platformId);
      if (targetPlatform) {
        setSelectedPlatform(targetPlatform);
      }
    }

    // 2. 播放该频道
    setSelectedChannel(favChannel);
    setUserClosedMini(false);
    setFavoritesDrawerOpen(false);
    if (favChannel.title) {
      setNotice(`正在播放：${favChannel.title}`);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const isMiniActive = isPlayerOutView && Boolean(selectedChannel) && !userClosedMini;

  // 切换收藏状态，自动补充完整频道及平台元数据
  const toggleFavorite = (channel, targetPlatform = null) => {
    if (!channel || !channel.id) return;
    setFavorites((current) => {
      const next = new Map(current);
      if (next.has(channel.id)) {
        next.delete(channel.id);
        setNotice(`已取消收藏：${channel.title || '频道'}`);
      } else {
        const plat = targetPlatform || selectedPlatform || {};
        next.set(channel.id, {
          id: channel.id,
          title: channel.title || '未命名频道',
          image: channel.image || '',
          stream: channel.stream || '',
          streamType: channel.streamType || '',
          platformId: plat.id || channel.platformId || '',
          platformTitle: plat.title || channel.platformTitle || '直播',
        });
        setNotice(`已添加收藏：${channel.title || '频道'}`);
      }
      return next;
    });
  };

  const removeFavorite = (channelId) => {
    setFavorites((current) => {
      const next = new Map(current);
      const target = next.get(channelId);
      next.delete(channelId);
      if (target?.title) setNotice(`已取消收藏：${target.title}`);
      return next;
    });
  };

  const clearAllFavorites = () => {
    if (window.confirm('确定要清空所有收藏的直播频道吗？')) {
      setFavorites(new Map());
      setNotice('已清空全部收藏');
    }
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

          {/* 搜索框：支持模糊匹配搜索频道 */}
          <label className="search-box">
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索直播频道名称..."
              aria-label="搜索当前平台频道"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="清空搜索" title="清空">
                <X aria-hidden="true" />
              </button>
            )}
          </label>

          {/* 我的收藏快捷入口按钮 */}
          <button
            className="topbar-favorites-btn"
            type="button"
            onClick={() => setFavoritesDrawerOpen(true)}
            title="查看我的收藏列表"
          >
            <Heart className="heart-icon" fill={favorites.size > 0 ? 'currentColor' : 'none'} aria-hidden="true" />
            <span className="btn-text">我的收藏</span>
            {favorites.size > 0 && (
              <span className="favorites-badge">{favorites.size}</span>
            )}
          </button>

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
                          onClick={() => toggleFavorite(selectedChannel)}
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
                    <span>{upNext.length} 个频道</span>
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
                    <h2 id="channel-heading">
                      {view === 'favorites' ? '我的收藏' : '直播频道'}
                      {query && <span className="search-query-badge">搜: "{query}"</span>}
                    </h2>
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
                    >
                      收藏 ({favorites.size})
                    </button>
                  </div>
                </div>

                {channelLoading && view !== 'favorites' ? (
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
                        onFavorite={() => toggleFavorite(channel)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    {view === 'favorites' ? <Heart aria-hidden="true" /> : <Search aria-hidden="true" />}
                    <h3>
                      {view === 'favorites'
                        ? (query ? '收藏中没有找到匹配频道' : '还没有收藏频道')
                        : '没有找到相关频道'}
                    </h3>
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

      {/* 我的收藏侧边抽屉 */}
      <FavoritesDrawer
        open={favoritesDrawerOpen}
        onClose={() => setFavoritesDrawerOpen(false)}
        favorites={favorites}
        onPlayChannel={playFavoriteChannel}
        onRemoveFavorite={removeFavorite}
        onClearAll={clearAllFavorites}
      />

      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

export default App;
