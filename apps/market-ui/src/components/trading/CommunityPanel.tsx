import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Search, RefreshCw, ExternalLink, TrendingUp, TrendingDown, Minus, Zap, AlertCircle, Youtube, PlayCircle, Volume2, VolumeX, Maximize2 } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Influencer {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
  followers: number;
  verified: boolean;
  tier?: 'mega' | 'macro' | 'mid';
  tweet: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentScore: number;                          // 0–1 confidence from CryptoBERT
  sentimentModel: 'cryptobert' | 'keyword';
  likes: number;
  replies: number;
  retweets: number;
  views: number;
  postedAt: string;
  postUrl: string;
  thumbnailUrl?: string;
  coinMentions: string[];
  impact: number;
  source: 'reddit' | 'youtube' | 'twitter' | 'linkedin';
}

type FilterTab = 'all' | 'bullish' | 'bearish' | 'neutral' | 'reddit' | 'youtube' | 'twitter' | 'linkedin';
interface CommunityPanelProps { currentAsset: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────
function hashColor(str: string): [string, string] {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
  const hue = Math.abs(h) % 360;
  return [`hsl(${hue},65%,42%)`, `hsl(${(hue + 40) % 360},75%,32%)`];
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (isNaN(diff) || diff < 0) return 'now';
  if (diff < 60)    return `${Math.floor(diff)}s`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function ImpactBadge({ score }: { score: number }) {
  const color = score >= 85 ? '#00C853' : score >= 65 ? '#F7931A' : '#5A6478';
  return (
    <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md"
      style={{ background: `${color}18`, border: `1px solid ${color}40` }}>
      <Zap className="w-2.5 h-2.5" style={{ color }} />
      <span className="text-[10px] font-bold" style={{ color }}>{score}</span>
    </div>
  );
}

function TierBadge({ tier }: { tier?: 'mega' | 'macro' | 'mid' }) {
  if (!tier || tier === 'mid') return null;
  const cfg = {
    mega:  { label: 'MEGA',  color: '#FFD700', bg: '#FFD70018' },
    macro: { label: 'MACRO', color: '#C0C0C0', bg: '#C0C0C018' },
  }[tier];
  return (
    <span className="text-[8px] font-black px-1 py-0.5 rounded"
      style={{ color: cfg.color, background: cfg.bg, letterSpacing: '0.5px' }}>
      {cfg.label}
    </span>
  );
}

function SentimentPill({
  sentiment, score, model,
}: { sentiment: Influencer['sentiment']; score: number; model: Influencer['sentimentModel'] }) {
  const cfg = {
    bullish: { label: '▲ Bullish', bg: '#00C85318', color: '#00C853', border: '#00C85340', bar: '#00C853' },
    bearish: { label: '▼ Bearish', bg: '#FF3D3D18', color: '#FF3D3D', border: '#FF3D3D40', bar: '#FF3D3D' },
    neutral: { label: '— Neutral', bg: '#5A647818', color: '#8A92A6', border: '#5A647840', bar: '#5A6478' },
  }[sentiment];
  const pct = Math.round(score * 100);
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1">
        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md"
          style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
          {cfg.label}
        </span>
        {/* Confidence score */}
        <span className="text-[10px] font-semibold" style={{ color: cfg.color }}>
          {pct}%
        </span>
        {/* CryptoBERT badge */}
        {model === 'cryptobert' && (
          <span className="text-[8px] font-bold px-1 py-0.5 rounded"
            style={{ background: '#2962FF18', color: '#2962FF', border: '1px solid #2962FF30' }}>
            🤖 AI
          </span>
        )}
      </div>
      {/* Mini confidence bar */}
      <div className="h-[2px] rounded-full w-full" style={{ background: '#1B2236' }}>
        <div className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: cfg.bar, opacity: 0.7 }} />
      </div>
    </div>
  );
}

function CoinTag({ symbol }: { symbol: string }) {
  const colors: Record<string, string> = {
    BTC: '#F7931A', ETH: '#627EEA', SOL: '#9945FF', BNB: '#F3BA2F',
    XRP: '#00AAE4', ADA: '#0033AD', DOGE: '#C2A633', LINK: '#2A5ADA',
    MATIC: '#8247E5', AVAX: '#E84142', DOT: '#E6007A', SHIB: '#FFA409',
    AAPL: '#555', NVDA: '#76B900', TSLA: '#CC0000',
  };
  const color = colors[symbol] ?? '#2962FF';
  return (
    <span className="inline-flex items-center text-[9px] font-bold px-1 py-0.5 rounded"
      style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}>
      ${symbol}
    </span>
  );
}

function SourceIcon({ source }: { source: Influencer['source'] }) {
  if (source === 'youtube') return (
    <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-bold"
      style={{ background: '#FF000018', color: '#FF0000', border: '1px solid #FF000030' }}>
      <Youtube className="w-2.5 h-2.5" /> YT
    </span>
  );
  if (source === 'twitter') return (
    <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-bold"
      style={{ background: '#1DA1F218', color: '#1DA1F2', border: '1px solid #1DA1F230' }}>
      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
      X
    </span>
  );
  if (source === 'linkedin') return (
    <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-bold"
      style={{ background: '#0A66C218', color: '#0A66C2', border: '1px solid #0A66C230' }}>
      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
      </svg>
      LI
    </span>
  );
  return (
    <span className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded font-bold"
      style={{ background: '#FF450018', color: '#FF4500', border: '1px solid #FF450030' }}>
      <span className="text-[8px]">●</span> Reddit
    </span>
  );
}

function extractYouTubeId(url: string): string | null {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
    /[?&]v=([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) { const m = url.match(re); if (m) return m[1]; }
  return null;
}

// ── YouTube IFrame API singleton loader & shared state ───────────────────────
const videoPositions = new Map<string, number>();      // videoId → last currentTime (s)
let userHasInteracted = false;
if (typeof window !== 'undefined' && !(window as any).__agYtGestureBound) {
  const mark = () => { userHasInteracted = true; };
  ['click', 'keydown', 'touchend', 'pointerup'].forEach(ev =>
    window.addEventListener(ev, mark, { capture: true, passive: true })
  );
  (window as any).__agYtGestureBound = true;
}

let ytApiPromise: Promise<any> | null = null;
function loadYouTubeApi(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  const w = window as any;
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<any>(resolve => {
    const prev = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => { prev?.(); resolve(w.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    document.head.appendChild(s);
  });
  return ytApiPromise;
}

function YouTubeHoverEmbed({ videoId, thumbnailUrl, title }: { videoId: string; thumbnailUrl?: string; title: string }) {
  // 'idle' = thumbnail only. 'active' = iframe mounted (playing OR paused — iframe persists).
  const [mode, setMode]     = React.useState<'idle' | 'active'>('idle');
  const [muted, setMuted]   = React.useState(!userHasInteracted);
  const [paused, setPaused] = React.useState(false);
  const [ready, setReady]   = React.useState(false);

  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const mountRef   = React.useRef<HTMLDivElement>(null);
  const playerRef  = React.useRef<any>(null);
  const startTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef    = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const userPausedRef = React.useRef(false); // respect user's explicit pause

  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const captureTime = () => {
    try {
      const t = playerRef.current?.getCurrentTime?.();
      if (typeof t === 'number' && t > 0) videoPositions.set(videoId, t);
    } catch { /* not ready */ }
  };

  const destroyPlayer = () => {
    captureTime();
    stopPolling();
    try { playerRef.current?.destroy?.(); } catch { /* ignore */ }
    playerRef.current = null;
    setReady(false);
  };

  // Create player once when entering 'active'; it stays alive through hover cycles.
  React.useEffect(() => {
    if (mode !== 'active' || !mountRef.current || playerRef.current) return;
    let cancelled = false;
    const resumeAt = Math.max(0, Math.floor(videoPositions.get(videoId) ?? 0));

    // YT.Player replaces the target element with an iframe. If we pass a React-owned
    // ref div, React will reconcile it away on the next re-render, killing the player.
    // Create a dedicated inner child that React doesn't own, and hand THAT to the API.
    const inner = document.createElement('div');
    inner.style.width = '100%';
    inner.style.height = '100%';
    mountRef.current.appendChild(inner);

    loadYouTubeApi().then(YT => {
      if (cancelled || !mountRef.current) return;
      playerRef.current = new YT.Player(inner, {
        width:  '100%',
        height: '100%',
        videoId,
        playerVars: {
          autoplay: 1,
          mute: userHasInteracted ? 0 : 1,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          start: resumeAt,
        },
        events: {
          onReady: (e: any) => {
            try {
              if (userHasInteracted) { e.target.unMute(); e.target.setVolume(80); setMuted(false); }
              else setMuted(true);
              if (resumeAt > 0) e.target.seekTo(resumeAt, true);
              e.target.playVideo();
            } catch { /* ignore */ }
            // Force iframe to fill the container — YT sometimes leaves inline 640×360 attributes.
            const frame = e.target.getIframe?.() as HTMLIFrameElement | undefined;
            if (frame) {
              frame.style.width = '100%';
              frame.style.height = '100%';
              frame.style.display = 'block';
              frame.setAttribute('width', '100%');
              frame.setAttribute('height', '100%');
            }
            setReady(true);
            stopPolling();
            pollRef.current = setInterval(captureTime, 500);
          },
          onStateChange: (e: any) => {
            // YT states: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
            const st = e.data;
            if (st === 1) { setPaused(false); userPausedRef.current = false; }
            if (st === 2) setPaused(true);
            if (st === 0) { captureTime(); }
          },
        },
      });
    });

    return () => { cancelled = true; /* iframe lives on; destroyed only on unmount / scroll-out */ };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, videoId]);

  // Tear down iframe only when the component unmounts or scrolls far out of view.
  React.useEffect(() => () => destroyPlayer(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // IntersectionObserver: pause when card leaves viewport; destroy only when very far away.
  React.useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      const e = entries[0];
      if (!e) return;
      if (!e.isIntersecting) {
        // off-screen → pause but keep iframe alive (cheap) until we confirm it's way off.
        captureTime();
        try { playerRef.current?.pauseVideo?.(); } catch { /* ignore */ }
      }
    }, { threshold: 0, rootMargin: '0px 0px 0px 0px' });
    io.observe(el);
    return () => io.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearTimers = () => { if (startTimer.current) { clearTimeout(startTimer.current); startTimer.current = null; } };

  // Click-to-activate: idle → active (plays from saved position). After that, a hover-back
  // resumes playback from the paused frame unless the user explicitly paused.
  const onWrapperClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // don't let the card's link handler open YouTube in a new tab
    if (mode === 'idle') { setMode('active'); return; }
    if (ready && paused && !userPausedRef.current) {
      try { playerRef.current?.playVideo?.(); } catch { /* ignore */ }
    }
  };

  const onEnter = () => {
    // Hover alone never starts playback — user must click first.
    if (mode !== 'active' || !ready) return;
    if (userPausedRef.current) return; // respect explicit pause
    if (paused) { try { playerRef.current?.playVideo?.(); } catch { /* ignore */ } }
  };

  const onLeave = (e: React.MouseEvent) => {
    if (mode !== 'active') return;
    const rect = wrapperRef.current?.getBoundingClientRect();
    const inside = !!rect && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (inside) return; // iframe focus swap, not a real leave
    captureTime();
    // Pause but KEEP the iframe mounted — no reload feel.
    try { playerRef.current?.pauseVideo?.(); } catch { /* ignore */ }
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const p = playerRef.current;
    if (!p) return;
    try {
      if (muted) { p.unMute(); p.setVolume(80); setMuted(false); userHasInteracted = true; }
      else       { p.mute();                     setMuted(true);  }
    } catch { /* ignore */ }
  };

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const p = playerRef.current;
    if (!p) return;
    try {
      if (paused) { p.playVideo(); userPausedRef.current = false; }
      else        { p.pauseVideo(); userPausedRef.current = true; }
    } catch { /* ignore */ }
  };

  const openFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    const iframe = mountRef.current?.querySelector('iframe');
    (iframe as HTMLIFrameElement | null)?.requestFullscreen?.();
  };

  React.useEffect(() => {
    const onHide = () => captureTime();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saved = videoPositions.get(videoId);

  return (
    <div
      ref={wrapperRef}
      className="block mb-2.5 rounded-lg overflow-hidden relative group bg-black"
      style={{ aspectRatio: '16 / 9' }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={onWrapperClick}
    >
      {/* Thumbnail always rendered as a base layer; iframe mounts above when active.
          Keeping the thumbnail behind the iframe avoids a flash-of-empty-black if the
          iframe is slow to paint. */}
      {thumbnailUrl && (
        <img src={thumbnailUrl} alt={title}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ objectFit: 'cover' }} />
      )}

      {/* YT.Player mount target. Once attached, iframe persists — no remounts, no reload feel.
          The [&_iframe]:w-full etc. selectors force any child iframe (YT uses default 640x360
          attributes) to fill this container regardless of its inline width/height. */}
      <div ref={mountRef}
        className="absolute inset-0 w-full h-full transition-opacity duration-200 [&>*]:w-full [&>*]:h-full [&_iframe]:w-full [&_iframe]:h-full [&_iframe]:block"
        style={{ opacity: mode === 'active' ? 1 : 0, pointerEvents: mode === 'active' ? 'auto' : 'none' }}
      />

      {/* Idle overlay (play button + resume chip) */}
      {mode === 'idle' && (
        <>
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center"
              style={{ background: '#FF0000ee', boxShadow: '0 4px 24px #FF000055' }}>
              <PlayCircle className="w-8 h-8 text-white" />
            </div>
          </div>
          {saved && saved > 1 ? (
            <div className="absolute bottom-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wider"
              style={{ background: '#000000cc', color: '#fff', letterSpacing: '0.08em' }}>
              RESUME @ {Math.floor(saved / 60)}:{String(Math.floor(saved % 60)).padStart(2, '0')}
            </div>
          ) : (
            <div className="absolute bottom-1.5 right-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wider"
              style={{ background: '#FF000022', color: '#FF3B3B', border: '1px solid #FF000040', letterSpacing: '0.08em' }}>
              CLICK TO PLAY
            </div>
          )}
        </>
      )}

      {/* Active overlay controls */}
      {mode === 'active' && (
        <>
          {/* While the iframe is still loading, keep the thumbnail + red play so there's no black flash. */}
          {!ready && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center pointer-events-none">
              <RefreshCw className="w-6 h-6 text-white animate-spin" />
            </div>
          )}
          <div className="absolute top-1.5 right-1.5 flex items-center gap-1 z-10">
            <button onClick={togglePlay} title={paused ? 'Play' : 'Pause'}
              className="w-6 h-6 rounded-full flex items-center justify-center backdrop-blur-sm transition"
              style={{ background: '#000000cc', color: '#fff', border: '1px solid #ffffff22' }}>
              {paused ? <PlayCircle className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
            </button>
            <button onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}
              className="w-6 h-6 rounded-full flex items-center justify-center backdrop-blur-sm transition"
              style={{ background: '#000000cc', color: '#fff', border: '1px solid #ffffff22' }}>
              {muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
            </button>
            <button onClick={openFullscreen} title="Fullscreen"
              className="w-6 h-6 rounded-full flex items-center justify-center backdrop-blur-sm transition"
              style={{ background: '#000000cc', color: '#fff', border: '1px solid #ffffff22' }}>
              <Maximize2 className="w-3 h-3" />
            </button>
          </div>
          {muted && !userHasInteracted && (
            <div className="absolute bottom-1.5 left-1.5 pointer-events-none">
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded tracking-wider"
                style={{ background: '#000000aa', color: '#fff', letterSpacing: '0.08em' }}>
                <VolumeX className="w-2.5 h-2.5 inline -mt-0.5 mr-0.5" /> CLICK ONCE FOR SOUND
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Avatar({ name, avatarUrl, colors, size = 36 }:
  { name: string; avatarUrl: string; colors: [string, string]; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '??';
  if (avatarUrl && !failed) {
    return (
      <img src={avatarUrl} alt={name} width={size} height={size}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
        onError={() => setFailed(true)} />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.34, fontWeight: 800, color: 'white', letterSpacing: '-0.5px',
    }}>{initials}</div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export const CommunityPanel: React.FC<CommunityPanelProps> = ({ currentAsset }) => {
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [status, setStatus]         = useState<'idle' | 'loading' | 'live' | 'error'>('idle');
  const [source, setSource]         = useState('');
  const [errorMsg, setErrorMsg]     = useState('');
  const [lastFetched, setLastFetched] = useState(0);
  const [filter, setFilter]         = useState<FilterTab>('all');
  const [search, setSearch]         = useState('');
  const [trackInput, setTrackInput] = useState('');
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [trending, setTrending]     = useState<{ coin: string; count: number }[]>([]);
  const [page, setPage]             = useState(1);
  const [hasMore, setHasMore]       = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [poolCounts, setPoolCounts] = useState<{ reddit: number; youtube: number; twitter: number; linkedin: number }>({ reddit: 0, youtube: 0, twitter: 0, linkedin: 0 });
  const [poolTotal, setPoolTotal]   = useState(0);
  const feedRef    = React.useRef<HTMLDivElement>(null);
  const sentinelRef = React.useRef<HTMLDivElement>(null);
  const passWheel  = (e: React.WheelEvent) => {
    if (feedRef.current) feedRef.current.scrollTop += e.deltaY;
  };

  const mapPost = (p: any): Influencer => ({
    id: p.id, handle: p.handle, name: p.name || p.handle,
    avatarUrl: p.avatarUrl ?? '', followers: p.followers ?? 0,
    verified: !!p.verified, tier: p.tier,
    tweet: p.tweet, sentiment: p.sentiment as Influencer['sentiment'],
    sentimentScore: p.sentimentScore ?? 0.6,
    sentimentModel: (p.sentimentModel ?? 'keyword') as Influencer['sentimentModel'],
    likes: p.likes ?? 0, replies: p.replies ?? 0, retweets: p.retweets ?? 0,
    views: p.views ?? 0,
    postedAt: p.postedAt ?? new Date().toISOString(),
    postUrl: p.postUrl ?? '#',
    thumbnailUrl: p.thumbnailUrl,
    coinMentions: p.coinMentions ?? [],
    impact: p.impact ?? 50,
    source: (p.source ?? 'reddit') as Influencer['source'],
  });

  const fetchData = useCallback(async (asset: string, force = false) => {
    if (!force && Date.now() - lastFetched < 60_000) return;
    setStatus('loading'); setErrorMsg('');
    try {
      const res  = await fetch(`/api/social/influencers/${asset}?page=1&limit=20`, { signal: AbortSignal.timeout(18_000) });
      const json = await res.json() as { posts?: any[]; pagination?: any; source?: string; sources?: any; error?: string };
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      if (!json.posts?.length) throw new Error('No posts returned');

      setInfluencers(json.posts.map(mapPost));
      setSource(json.source ?? '');
      setPage(1);
      setHasMore(json.pagination?.hasMore ?? false);
      setPoolTotal(json.pagination?.total ?? json.posts.length);
      if (json.sources) setPoolCounts({
        reddit:   json.sources.reddit   ?? 0,
        youtube:  json.sources.youtube  ?? 0,
        twitter:  json.sources.twitter  ?? 0,
        linkedin: json.sources.linkedin ?? 0,
      });
      setStatus('live');
      setLastFetched(Date.now());
    } catch (err: any) {
      setStatus('error'); setErrorMsg(err?.message ?? 'Failed to load');
    }
  }, [lastFetched]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = page + 1;
      const res = await fetch(`/api/social/influencers/${currentAsset}?page=${nextPage}&limit=20`, { signal: AbortSignal.timeout(18_000) });
      const json = await res.json() as { posts?: any[]; pagination?: any; error?: string };
      if (!res.ok || json.error || !json.posts?.length) return;
      setInfluencers(prev => [...prev, ...json.posts!.map(mapPost)]);
      setPage(nextPage);
      setHasMore(json.pagination?.hasMore ?? false);
    } catch { /* silent */ } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, page, currentAsset]);

  // Infinite scroll — trigger loadMore when sentinel enters view
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) loadMore();
    }, { threshold: 0.1 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  // Fetch trending coins
  const fetchTrending = useCallback(async () => {
    try {
      const res = await fetch('/api/social/trending');
      const j   = await res.json() as { trending?: { coin: string; count: number }[] };
      setTrending(j.trending ?? []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    setInfluencers([]); setStatus('idle'); setLastFetched(0);
    setFilter('all'); setSearch(''); setExpanded(null);
    setPage(1); setHasMore(false); setLoadingMore(false);
    fetchData(currentAsset, true);
    fetchTrending();
  }, [currentAsset]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = influencers;
    if (filter === 'bullish' || filter === 'bearish' || filter === 'neutral')
      list = list.filter(i => i.sentiment === filter);
    if (filter === 'reddit' || filter === 'youtube' || filter === 'twitter' || filter === 'linkedin')
      list = list.filter(i => i.source === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i =>
        i.name.toLowerCase().includes(q) ||
        i.handle.toLowerCase().includes(q) ||
        i.tweet.toLowerCase().includes(q) ||
        i.coinMentions.some(c => c.toLowerCase().includes(q))
      );
    }
    return list;
  }, [influencers, filter, search]);

  const bullCount   = influencers.filter(i => i.sentiment === 'bullish').length;
  const bearCount   = influencers.filter(i => i.sentiment === 'bearish').length;
  // Prefer full-pool counts from server; fall back to loaded-set counts if not yet fetched.
  const redditN     = poolCounts.reddit   || influencers.filter(i => i.source === 'reddit').length;
  const youtubeN    = poolCounts.youtube  || influencers.filter(i => i.source === 'youtube').length;
  const twitterN    = poolCounts.twitter  || influencers.filter(i => i.source === 'twitter').length;
  const linkedinN   = poolCounts.linkedin || influencers.filter(i => i.source === 'linkedin').length;
  const ytUnavailable = status === 'live' && poolCounts.youtube === 0 && influencers.length > 0;
  const cryptobertN = influencers.filter(i => i.sentimentModel === 'cryptobert').length;
  const total       = influencers.length || 1;
  const bullPct     = Math.round((bullCount / total) * 100);
  const bearPct     = Math.round((bearCount / total) * 100);
  const avgImpact   = Math.round(influencers.reduce((s, i) => s + i.impact, 0) / total);
  const avgConfidence = Math.round(
    influencers.reduce((s, i) => s + (i.sentimentScore ?? 0.6), 0) / total * 100
  );

  const TABS: { id: FilterTab; label: string }[] = [
    { id: 'all',      label: 'All' },
    { id: 'bullish',  label: '🟢 Bull' },
    { id: 'bearish',  label: '🔴 Bear' },
    { id: 'reddit',   label: '🔶 Reddit' },
    { id: 'youtube',  label: '▶ YT' },
    ...(twitterN  > 0 ? [{ id: 'twitter'  as FilterTab, label: '𝕏 X' }]  : []),
    ...(linkedinN > 0 ? [{ id: 'linkedin' as FilterTab, label: '💼 LI' }] : []),
  ];

  return (
    <div className="w-[360px] shrink-0 flex flex-col h-full overflow-hidden"
      style={{ background: '#0B0E14', borderLeft: '1px solid #1B2236' }}>

      {/* ── HEADER BLOCK ── */}
      <div className="shrink-0" style={{ borderBottom: '1px solid #1B2236', background: 'linear-gradient(180deg,#0D1117 0%,#0B0E14 100%)' }}>

        {/* Title row */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg,#F7931A22,#F7931A08)', border: '1px solid #F7931A30' }}>
              <Zap className="w-4 h-4" style={{ color: '#F7931A' }} />
            </div>
            <div>
              <div className="text-[14px] font-bold text-white leading-tight tracking-tight">Social Intelligence</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`w-1.5 h-1.5 rounded-full ${
                  status === 'live'    ? 'bg-[#00C853] animate-pulse' :
                  status === 'loading' ? 'bg-[#F7931A] animate-pulse' :
                  status === 'error'   ? 'bg-[#FF3D3D]' : 'bg-[#5A6478]'
                }`} />
                <span className="text-[10px] font-medium" style={{ color: '#5A6478' }}>
                  {status === 'loading' && 'Fetching live community data…'}
                  {status === 'live'    && <>{influencers.length} posts · <span style={{ color: '#00C853' }}>Live</span> · <span style={{ color: '#FF4500' }}>{redditN}r</span>{youtubeN > 0 && <> + <span style={{ color: '#FF0000' }}>{youtubeN}yt</span></>}{twitterN > 0 && <> + <span style={{ color: '#1DA1F2' }}>{twitterN}x</span></>}{linkedinN > 0 && <> + <span style={{ color: '#0A66C2' }}>{linkedinN}li</span></>}</>}
                  {status === 'error'   && <span style={{ color: '#FF3D3D' }}>Error</span>}
                  {status === 'idle'    && currentAsset}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {status === 'live' && (
              <div className="px-2.5 py-1 rounded-lg text-[11px] font-bold tracking-wide"
                style={{
                  background: bullPct >= 60 ? '#00C85315' : bearPct >= 60 ? '#FF3D3D15' : '#ffffff08',
                  color:  bullPct >= 60 ? '#00C853' : bearPct >= 60 ? '#FF3D3D' : '#8A92A6',
                  border: `1px solid ${bullPct >= 60 ? '#00C85335' : bearPct >= 60 ? '#FF3D3D35' : '#ffffff15'}`,
                }}>
                {bullPct >= 60 ? '▲ Bullish' : bearPct >= 60 ? '▼ Bearish' : '— Mixed'}
              </div>
            )}
            <button onClick={() => fetchData(currentAsset, true)} disabled={status === 'loading'}
              className="p-1.5 rounded-lg transition-all"
              style={{ color: '#5A6478', background: '#0E1320', border: '1px solid #1B2236' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2962FF40'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1B2236'; (e.currentTarget as HTMLElement).style.color = '#5A6478'; }}>
              <RefreshCw className={`w-3.5 h-3.5 ${status === 'loading' ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Trending row */}
        {trending.length > 0 && (
          <div className="flex items-center gap-1.5 px-4 pb-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
            <span className="text-[9px] font-black shrink-0 tracking-widest" style={{ color: '#3D4A5C' }}>TRENDING</span>
            {trending.slice(0, 6).map(({ coin, count }) => (
              <button key={coin} onClick={() => setSearch(coin)}
                className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-lg transition-all"
                style={{ background: '#0E1320', color: '#C4CDD8', border: '1px solid #1B2236' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2962FF50'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1B2236'; (e.currentTarget as HTMLElement).style.color = '#C4CDD8'; }}>
                <span style={{ color: '#2962FF' }}>$</span>{coin}
                <span className="ml-1 text-[9px]" style={{ color: '#5A6478' }}>{count}</span>
              </button>
            ))}
          </div>
        )}

        {/* Sentiment cards + bar */}
        {status === 'live' && influencers.length > 0 && (
          <div className="px-4 pb-3">
            {/* 3 stat cards */}
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { label: 'Bullish',    value: `${bullPct}%`,     sub: `${bullCount} posts`, color: '#00C853', glow: '#00C85320', border: '#00C85330' },
                { label: 'Bearish',    value: `${bearPct}%`,     sub: `${bearCount} posts`, color: '#FF3D3D', glow: '#FF3D3D20', border: '#FF3D3D30' },
                { label: 'AI Conf.',   value: `${avgConfidence}%`, sub: `${cryptobertN} AI-scored`, color: '#2962FF', glow: '#2962FF20', border: '#2962FF30' },
              ].map(({ label, value, sub, color, glow, border }) => (
                <div key={label} className="rounded-xl px-2 py-2.5 text-center flex flex-col items-center"
                  style={{ background: `linear-gradient(160deg,${glow},#0E1320)`, border: `1px solid ${border}` }}>
                  <div className="text-[20px] font-black leading-none mb-0.5" style={{ color }}>{value}</div>
                  <div className="text-[10px] font-semibold" style={{ color: '#8A92A6' }}>{label}</div>
                  <div className="text-[9px] mt-0.5" style={{ color: '#5A6478' }}>{sub}</div>
                </div>
              ))}
            </div>

            {/* Split bull/bear bar */}
            <div className="rounded-lg overflow-hidden mb-2" style={{ height: 6, background: '#1B2236' }}>
              <div className="h-full flex">
                <div style={{ width: `${bullPct}%`, background: 'linear-gradient(90deg,#00C853,#0BBF76)', transition: 'width 0.6s ease' }} />
                <div style={{ width: `${bearPct}%`, background: 'linear-gradient(90deg,#FF3D3D,#CC2222)', transition: 'width 0.6s ease' }} />
              </div>
            </div>

            {/* Source breakdown */}
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: '#00C853' }}>
                <TrendingUp className="w-3 h-3" />{bullPct}% bull
              </span>
              <span className="flex items-center gap-2 text-[10px]" style={{ color: '#5A6478' }}>
                {redditN > 0 && (
                  <span className="flex items-center gap-0.5">
                    <span style={{ color: '#FF4500', fontSize: 10 }}>●</span>
                    <span className="font-semibold text-white">{redditN}</span> r
                  </span>
                )}
                {youtubeN > 0 ? (
                  <span className="flex items-center gap-0.5">
                    <Youtube className="w-2.5 h-2.5" style={{ color: '#FF0000' }} />
                    <span className="font-semibold text-white">{youtubeN}</span>
                  </span>
                ) : ytUnavailable && (
                  <span className="flex items-center gap-0.5" title="YouTube RSS pool empty this cycle">
                    <Youtube className="w-2.5 h-2.5" style={{ color: '#5A6478' }} />
                    <span className="text-[9px] italic" style={{ color: '#5A6478' }}>feed idle</span>
                  </span>
                )}
                {twitterN > 0 && (
                  <span className="flex items-center gap-0.5" style={{ color: '#1DA1F2' }}>
                    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                    <span className="font-semibold text-white">{twitterN}</span>
                  </span>
                )}
                {linkedinN > 0 && (
                  <span className="flex items-center gap-0.5" style={{ color: '#0A66C2' }}>
                    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                    <span className="font-semibold text-white">{linkedinN}</span>
                  </span>
                )}
              </span>
              <span className="flex items-center gap-1 text-[10px] font-semibold" style={{ color: '#FF3D3D' }}>
                {bearPct}% bear <TrendingDown className="w-3 h-3" />
              </span>
            </div>

            {/* CryptoBERT attribution */}
            {cryptobertN > 0 && (
              <div className="flex items-center justify-center gap-1.5 mt-2 py-1.5 rounded-lg"
                style={{ background: '#2962FF0A', border: '1px solid #2962FF20' }}>
                <span className="text-[9px]" style={{ color: '#5A6478' }}>Sentiment powered by</span>
                <span className="text-[9px] font-bold" style={{ color: '#2962FF' }}>🤖 CryptoBERT</span>
                <span className="text-[9px]" style={{ color: '#5A6478' }}>·</span>
                <span className="text-[9px]" style={{ color: '#5A6478' }}>3.2M crypto posts trained</span>
                <span className="text-[9px]" style={{ color: '#5A6478' }}>·</span>
                <span className="text-[9px] font-semibold" style={{ color: '#2962FF' }}>{avgConfidence}% avg confidence</span>
              </div>
            )}
          </div>
        )}

        {/* Track input */}
        <div className="px-4 pb-2.5" onWheel={passWheel}>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all"
            style={{ background: '#0A0D13', border: '1px solid #1B2236' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#2962FF40')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#1B2236')}>
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#3D4A5C' }}>
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            <input type="text" placeholder="Track @handle or paste X URL…"
              value={trackInput} onChange={e => setTrackInput(e.target.value)}
              onKeyDown={e => { if (e.key !== 'Enter' || !trackInput.trim()) return; setTrackInput(''); }}
              className="flex-1 bg-transparent text-[12px] focus:outline-none text-white placeholder:text-[#3D4A5C]" />
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1 px-3 pb-2.5 overflow-x-auto" style={{ scrollbarWidth: 'none' }} onWheel={passWheel}>
          {([
            { id: 'all',      label: 'All',    dot: null },
            { id: 'bullish',  label: 'Bull',   dot: '#00C853' },
            { id: 'bearish',  label: 'Bear',   dot: '#FF3D3D' },
            { id: 'reddit',   label: 'Reddit', dot: '#FF4500' },
            { id: 'youtube',  label: 'YT',     dot: '#FF0000' },
            ...(twitterN  > 0 ? [{ id: 'twitter',  label: '𝕏', dot: '#1DA1F2' }] : []),
            ...(linkedinN > 0 ? [{ id: 'linkedin', label: 'LI', dot: '#0A66C2' }] : []),
          ] as { id: FilterTab; label: string; dot: string | null }[]).map(t => (
            <button key={t.id} onClick={() => setFilter(t.id as FilterTab)}
              className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all"
              style={{
                color: filter === t.id ? '#FFF' : '#5A6478',
                background: filter === t.id ? '#2962FF20' : 'transparent',
                border: filter === t.id ? '1px solid #2962FF40' : '1px solid transparent',
              }}>
              {t.dot && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: t.dot }} />}
              {t.label}
            </button>
          ))}
          <div className="ml-auto shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg"
            style={{ background: '#0A0D13', border: '1px solid #1B2236' }}>
            <Search className="w-3 h-3 shrink-0" style={{ color: '#3D4A5C' }} />
            <input type="text" placeholder="Search…" value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-16 bg-transparent text-[11px] focus:outline-none text-white placeholder:text-[#3D4A5C]" />
          </div>
        </div>
      </div>

      {/* ── FEED ── */}
      <div ref={feedRef} className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>

        {/* Loading */}
        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <RefreshCw className="w-8 h-8 animate-spin" style={{ color: '#2962FF' }} />
            <div className="text-center">
              <p className="text-[13px] font-semibold text-white">Fetching live community data</p>
              <p className="text-[11px] mt-1" style={{ color: '#5A6478' }}>
                Reddit &amp; YouTube for {currentAsset}…
              </p>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="flex flex-col items-center justify-center py-16 gap-4 px-6 text-center">
            <AlertCircle className="w-8 h-8" style={{ color: '#FF3D3D' }} />
            <div>
              <p className="text-[13px] font-semibold text-white mb-1">Could not load live data</p>
              <p className="text-[11px]" style={{ color: '#5A6478' }}>{errorMsg}</p>
              <p className="text-[11px] mt-2" style={{ color: '#5A6478' }}>Make sure market-server is running on port 3002.</p>
            </div>
            <button onClick={() => fetchData(currentAsset, true)}
              className="px-4 py-1.5 rounded-lg text-[12px] font-bold"
              style={{ background: '#2962FF', color: '#fff' }}>Retry</button>
          </div>
        )}

        {/* Empty */}
        {status === 'live' && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-center px-6">
            <p className="text-[12px]" style={{ color: '#5A6478' }}>No posts match this filter.</p>
            <button onClick={() => { setFilter('all'); setSearch(''); }}
              className="text-[12px] font-bold" style={{ color: '#2962FF' }}>Reset filters</button>
          </div>
        )}

        {/* Posts */}
        {filtered.map(inf => {
          const sentColor = inf.sentiment === 'bullish' ? '#00C853' : inf.sentiment === 'bearish' ? '#FF3D3D' : '#5A6478';
          const colors    = hashColor(inf.handle);
          const isExp     = expanded === inf.id;
          const preview   = isExp ? inf.tweet : inf.tweet.slice(0, 200) + (inf.tweet.length > 200 ? '…' : '');

          return (
            <div key={inf.id}
              role="link" tabIndex={0}
              onClick={() => window.open(inf.postUrl, '_blank', 'noopener,noreferrer')}
              onKeyDown={e => { if (e.key === 'Enter') window.open(inf.postUrl, '_blank', 'noopener,noreferrer'); }}
              className="block px-4 py-3 transition-colors cursor-pointer"
              style={{ borderBottom: '1px solid #1B2236' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#0E1320')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>

              {/* YouTube inline player — hover to play in-place */}
              {inf.source === 'youtube' && (() => {
                const vid = extractYouTubeId(inf.postUrl);
                if (!vid) return null;
                return <YouTubeHoverEmbed videoId={vid} thumbnailUrl={inf.thumbnailUrl} title={inf.name} />;
              })()}

              {/* TOP ROW */}
              <div className="flex items-start gap-2.5 mb-2">
                <div className="relative shrink-0">
                  <div style={{ borderRadius: '50%', border: `2px solid ${sentColor}`, padding: 1 }}>
                    <Avatar name={inf.name} avatarUrl={inf.avatarUrl} colors={colors} size={34} />
                  </div>
                  <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center"
                    style={{ borderColor: '#0B0E14', backgroundColor: sentColor }}>
                    {inf.sentiment === 'bullish' ? <TrendingUp className="w-2 h-2 text-white" /> :
                     inf.sentiment === 'bearish' ? <TrendingDown className="w-2 h-2 text-white" /> :
                     <Minus className="w-2 h-2 text-white" />}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    <a href={inf.postUrl} target="_blank" rel="noopener noreferrer"
                      className="text-[13px] font-bold text-white hover:underline leading-tight"
                      onClick={e => e.stopPropagation()}>
                      {inf.name}
                    </a>
                    {inf.verified && (
                      <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24"
                        fill={inf.source === 'youtube' ? '#FF0000' : '#1D9BF0'}>
                        <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.67.88-3.33 2.19c-1.4-.46-2.91-.2-3.92.81s-1.26 2.52-.8 3.91c-1.31.67-2.2 1.91-2.2 3.34s.89 2.67 2.2 3.34c-.46 1.39-.21 2.9.8 3.91s2.52 1.26 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.45 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z" />
                      </svg>
                    )}
                    <TierBadge tier={inf.tier} />
                    <ImpactBadge score={inf.impact} />
                  </div>
                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                    <span className="text-[10px]" style={{ color: '#5A6478' }}>u/{inf.handle}</span>
                    {inf.followers > 0 && (
                      <><span style={{ color: '#1B2236' }}>·</span>
                      <span className="text-[10px]" style={{ color: '#5A6478' }}>{fmtNum(inf.followers)} followers</span></>
                    )}
                    <span style={{ color: '#1B2236' }}>·</span>
                    <span className="text-[10px]" style={{ color: '#5A6478' }}>{timeAgo(inf.postedAt)}</span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <SourceIcon source={inf.source} />
                </div>
              </div>

              {/* Sentiment + coin tags */}
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <SentimentPill
                  sentiment={inf.sentiment}
                  score={inf.sentimentScore ?? 0.6}
                  model={inf.sentimentModel ?? 'keyword'}
                />
                {inf.coinMentions.slice(0, 4).map(c => <CoinTag key={c} symbol={c} />)}
              </div>

              {/* Post text */}
              <p className="text-[12px] leading-[1.65] text-white" style={{ opacity: 0.9 }}>
                {preview}
                {inf.tweet.length > 200 && (
                  <button onClick={() => setExpanded(isExp ? null : inf.id)}
                    className="ml-1 font-bold" style={{ color: '#2962FF' }}>
                    {isExp ? 'Less' : 'More'}
                  </button>
                )}
              </p>

              {/* Engagement */}
              <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                {inf.likes > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px]">❤</span>
                    <span className="text-[11px] font-semibold" style={{ color: '#FF3D3D' }}>{fmtNum(inf.likes)}</span>
                  </div>
                )}
                {inf.views > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px]">👁</span>
                    <span className="text-[11px] font-semibold" style={{ color: '#5A6478' }}>{fmtNum(inf.views)}</span>
                  </div>
                )}
                {inf.replies > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-[11px]">💬</span>
                    <span className="text-[11px] font-semibold" style={{ color: '#5A6478' }}>{fmtNum(inf.replies)}</span>
                  </div>
                )}
                <a href={inf.postUrl} target="_blank" rel="noopener noreferrer"
                  className="ml-auto flex items-center gap-1 text-[11px] transition-colors"
                  style={{ color: '#5A6478' }}
                  onMouseEnter={e => (e.currentTarget.style.color = inf.source === 'youtube' ? '#FF0000' : inf.source === 'twitter' ? '#1DA1F2' : inf.source === 'linkedin' ? '#0A66C2' : '#FF4500')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#5A6478')}
                  onClick={e => e.stopPropagation()}>
                  {inf.source === 'youtube'  ? <><Youtube className="w-3 h-3" /> Watch</>
                  : inf.source === 'twitter'  ? <><svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg> View on X</>
                  : inf.source === 'linkedin' ? <><svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg> LinkedIn</>
                  : <><span className="text-[10px]">●</span> Reddit</>}
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          );
        })}

        {/* Infinite scroll sentinel */}
        {status === 'live' && (
          <div ref={sentinelRef} className="px-4 py-5 flex flex-col items-center gap-2">
            {loadingMore && (
              <RefreshCw className="w-4 h-4 animate-spin" style={{ color: '#2962FF' }} />
            )}
            {!hasMore && influencers.length > 0 && (
              <p className="text-[10px]" style={{ color: '#5A6478' }}>
                All {influencers.length} posts loaded · Impact = engagement × reach × recency
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
