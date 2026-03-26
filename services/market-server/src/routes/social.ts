/**
 * Social Feed Route — v4
 *
 * Sources (all free):
 *   Reddit    → JSON API, hot + top/week + new across 3-4 subreddits
 *   YouTube   → RSS feeds from 20 curated crypto/finance channels
 *   Twitter/X → Tavily web search (site:x.com) — real tweet snippets
 *   LinkedIn  → Tavily web search (site:linkedin.com) — professional posts
 *
 * Pagination:
 *   GET /api/social/influencers/:asset?page=1&limit=20
 *   Server builds a pool of 120+ posts, serves in pages of 20.
 *   Infinite scroll: client requests page=2,3,4… until pool exhausted.
 *
 * Sentiment: CryptoBERT (ElKulako/cryptobert) → keyword fallback
 */

import { Router, Request, Response } from 'express';
import { classifyBatch, warmUpCryptoBert } from '../services/cryptobert.js';

const router = Router();

const TAVILY_KEY = process.env.TAVILY_API_KEY ?? '';

// ─── Cache ────────────────────────────────────────────────────────────────────
interface CacheEntry { data: unknown; expiresAt: number }
const CACHE = new Map<string, CacheEntry>();
const cacheGet = <T>(key: string): T | null => {
  const e = CACHE.get(key);
  if (!e || Date.now() > e.expiresAt) { CACHE.delete(key); return null; }
  return e.data as T;
};
const cacheSet = (key: string, data: unknown, ttlMs = 5 * 60_000) =>
  CACHE.set(key, { data, expiresAt: Date.now() + ttlMs });

// ─── Coin mention detection ───────────────────────────────────────────────────
const CASHTAG_RE = /\$([A-Z]{2,10})\b/g;
const CASHTAG_IGNORE = new Set(['USD','CEO','IPO','ETF','THE','FOR','GET','NOW','ALL','NEW','TOP','OUT']);

const COIN_NAMES: Record<string, string[]> = {
  BTC: ['bitcoin'], ETH: ['ethereum'], SOL: ['solana'], BNB: ['binance'], XRP: ['ripple'],
  ADA: ['cardano'], DOGE: ['dogecoin'], DOT: ['polkadot'], AVAX: ['avalanche'],
  LINK: ['chainlink'], MATIC: ['polygon'], SHIB: ['shiba'], LTC: ['litecoin'],
  UNI: ['uniswap'], ATOM: ['cosmos'], AAPL: ['apple'], MSFT: ['microsoft'],
  GOOGL: ['google', 'alphabet'], NVDA: ['nvidia'], TSLA: ['tesla'],
};
const COIN_ALIASES: Record<string, string[]> = {
  BTC: ['sats', 'satoshi', '₿', 'btc'], ETH: ['ether', 'eth'],
  DOGE: ['doge'], SOL: ['sol'], ADA: ['ada'], SHIB: ['shib'],
};

function detectCoinMentions(text: string): string[] {
  const found = new Set<string>();
  const lower = text.toLowerCase();
  for (const m of text.matchAll(CASHTAG_RE)) {
    const sym = m[1];
    if (!CASHTAG_IGNORE.has(sym) && COIN_NAMES[sym]) found.add(sym);
  }
  for (const [sym, names] of Object.entries(COIN_NAMES))
    if (names.some(n => lower.includes(n))) found.add(sym);
  for (const [sym, aliases] of Object.entries(COIN_ALIASES))
    if (aliases.some(a => lower.includes(a))) found.add(sym);
  return [...found].slice(0, 5);
}

// ─── Impact score ─────────────────────────────────────────────────────────────
function calcImpact(engagement: number, views: number, hoursAgo: number): number {
  const eng     = Math.min(40, Math.log10(Math.max(engagement, 1)) * 9);
  const reach   = views > 0 ? Math.min(30, Math.log10(Math.max(views, 1)) * 5) : 0;
  const recency = Math.max(0, 30 - hoursAgo * 1.2);
  return Math.min(99, Math.round(eng + reach + recency));
}

// ─── Keyword sentiment (fallback) ─────────────────────────────────────────────
const BULL_KW = ['bull', 'moon', 'buy', 'long', 'pump', 'ath', 'hodl', 'hold',
  'breakout', 'surge', 'rally', 'gains', '🚀', '📈', 'accumulate', 'bottom',
  'opportunity', 'strong', 'undervalued', 'support', 'all-time high', 'dip'];
const BEAR_KW = ['bear', 'sell', 'short', 'dump', 'crash', 'drop', 'bearish',
  'correction', 'fud', 'fear', 'overvalued', 'bubble', 'collapse', '📉',
  'loss', 'scam', 'rug', 'dead', 'rekt', 'panic', 'red'];

function detectSentiment(text: string): 'bullish' | 'bearish' | 'neutral' {
  const lower = text.toLowerCase();
  let bull = 0, bear = 0;
  for (const w of BULL_KW) if (lower.includes(w)) bull++;
  for (const w of BEAR_KW) if (lower.includes(w)) bear++;
  if (bull > bear && bull > 0) return 'bullish';
  if (bear > bull && bear > 0) return 'bearish';
  return 'neutral';
}

// ─── Influencer metadata ──────────────────────────────────────────────────────
type InfluencerTier = 'mega' | 'macro' | 'mid';
const INFLUENCER_META: Record<string, { name: string; tier: InfluencerTier; focus: string; followers: number }> = {
  VitalikButerin: { name: 'Vitalik Buterin',  tier: 'mega',  focus: 'Ethereum/Tech',     followers: 5_800_000 },
  saylor:         { name: 'Michael Saylor',    tier: 'mega',  focus: 'Bitcoin',           followers: 3_600_000 },
  APompliano:     { name: 'Anthony Pompliano', tier: 'mega',  focus: 'Bitcoin/General',   followers: 1_800_000 },
  punk6529:       { name: 'Punk6529',          tier: 'macro', focus: 'NFTs/Web3',         followers: 950_000 },
  cobie:          { name: 'Cobie',             tier: 'macro', focus: 'Trading/Analysis',  followers: 800_000 },
  LynAldenContact:{ name: 'Lyn Alden',         tier: 'macro', focus: 'Macro/Bitcoin',     followers: 800_000 },
  HsakaTrades:    { name: 'Hsaka',             tier: 'macro', focus: 'Trading',           followers: 606_000 },
  scottmelker:    { name: 'Scott Melker',      tier: 'macro', focus: 'Trading/Analysis',  followers: 550_000 },
  Pentosh1:       { name: 'Pentoshi',          tier: 'macro', focus: 'Trading/On-chain',  followers: 480_000 },
  haydenzadams:   { name: 'Hayden Adams',      tier: 'macro', focus: 'DeFi/Uniswap',     followers: 420_000 },
  CryptoHayes:    { name: 'Arthur Hayes',      tier: 'macro', focus: 'Trading/Macro',     followers: 300_000 },
  zachxbt:        { name: 'ZachXBT',           tier: 'macro', focus: 'Investigations',    followers: 250_000 },
  lookonchain:    { name: 'Lookonchain',        tier: 'macro', focus: 'On-chain Analytics',followers: 200_000 },
  RaoulGMI:       { name: 'Raoul Pal',         tier: 'macro', focus: 'Macro/Crypto',      followers: 1_050_000 },
  CathieDWood:    { name: 'Cathie Wood',        tier: 'mega',  focus: 'Institutional/ARK', followers: 1_400_000 },
};

// ─── Output shape ─────────────────────────────────────────────────────────────
export interface SocialPost {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string;
  followers: number;
  verified: boolean;
  tier?: InfluencerTier;
  tweet: string;
  sentiment: 'bullish' | 'bearish' | 'neutral';
  sentimentScore: number;
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

// ─── Reddit ───────────────────────────────────────────────────────────────────
const CRYPTO_SUBS: Record<string, string[]> = {
  BTC:  ['Bitcoin', 'CryptoCurrency', 'BitcoinMarkets', 'btc'],
  ETH:  ['ethereum', 'CryptoCurrency', 'ethtrader', 'ethfinance'],
  SOL:  ['solana', 'CryptoCurrency', 'SolanaNFT'],
  BNB:  ['binance', 'CryptoCurrency', 'BNBchainArmy'],
  XRP:  ['Ripple', 'CryptoCurrency', 'XRP_Community'],
  ADA:  ['cardano', 'CryptoCurrency', 'CardanoStaking'],
  DOGE: ['dogecoin', 'CryptoCurrency', 'dogemarket'],
  DOT:  ['Polkadot', 'CryptoCurrency'],
  AVAX: ['Avax', 'CryptoCurrency', 'avalanche'],
  LINK: ['Chainlink', 'CryptoCurrency'],
  MATIC:['0xPolygon', 'CryptoCurrency', 'polygonnetwork'],
  SHIB: ['SHIBArmy', 'CryptoCurrency', 'SHIBToken'],
  LTC:  ['litecoin', 'CryptoCurrency'],
  UNI:  ['UniSwap', 'CryptoCurrency', 'DeFi'],
  ATOM: ['cosmosnetwork', 'CryptoCurrency'],
};
const STOCK_SUBS: Record<string, string[]> = {
  AAPL: ['AAPL', 'stocks', 'wallstreetbets'],
  MSFT: ['MSFT', 'stocks', 'investing'],
  GOOGL:['googl', 'stocks', 'wallstreetbets'],
  NVDA: ['NVDA', 'stocks', 'wallstreetbets'],
  TSLA: ['TeslaInvestorsClub', 'stocks', 'wallstreetbets'],
  AMZN: ['AMZN', 'stocks', 'investing'],
  META: ['stocks', 'wallstreetbets', 'investing'],
  NFLX: ['stocks', 'wallstreetbets', 'investing'],
  AMD:  ['AMD_Stock', 'stocks', 'wallstreetbets'],
  SPY:  ['stocks', 'investing', 'options'],
  QQQ:  ['stocks', 'investing', 'options'],
  INTC: ['stocks', 'investing'],
  BA:   ['stocks', 'investing'],
  DIS:  ['stocks', 'investing'],
  V:    ['stocks', 'investing'],
};

const RH = { 'User-Agent': 'AntigravityMarkets/3.0 (market intelligence platform)' };

async function fetchSubredditSort(sub: string, sort: 'hot'|'top'|'new', limit = 25, t = 'week'): Promise<any[]> {
  const qs  = sort === 'top' ? `?sort=top&t=${t}&limit=${limit}` : `?limit=${limit}`;
  const res = await fetch(`https://www.reddit.com/r/${sub}/${sort}.json${qs}`, {
    headers: RH, signal: AbortSignal.timeout(9_000),
  });
  if (!res.ok) return [];
  const j = await res.json() as any;
  return (j.data?.children ?? []).map((c: any) => c.data);
}

async function searchReddit(q: string, subs: string, limit = 25): Promise<any[]> {
  const url = `https://www.reddit.com/r/${subs}/search.json?q=${encodeURIComponent(q)}&sort=hot&t=week&limit=${limit}&restrict_sr=1`;
  const res = await fetch(url, { headers: RH, signal: AbortSignal.timeout(9_000) });
  if (!res.ok) return [];
  const j = await res.json() as any;
  return (j.data?.children ?? []).map((c: any) => c.data);
}

function mapRedditPost(p: any): SocialPost | null {
  if (!p.author || p.author === '[deleted]') return null;
  const text = [p.title, p.selftext].filter(Boolean).join(' ').trim();
  if (text.length < 10) return null;
  const hoursAgo = (Date.now() - p.created_utc * 1000) / 3_600_000;
  const score    = p.score ?? p.ups ?? 0;
  const comments = p.num_comments ?? 0;
  const meta     = INFLUENCER_META[p.author];
  return {
    id: `r_${p.id}`, handle: p.author, name: meta?.name ?? p.author, avatarUrl: '',
    followers: meta?.followers ?? 0, verified: p.distinguished === 'moderator', tier: meta?.tier,
    tweet: p.title + (p.selftext ? '\n\n' + p.selftext.slice(0, 300) : ''),
    sentiment: detectSentiment(text), sentimentScore: 0.6, sentimentModel: 'keyword',
    likes: score, replies: comments, retweets: 0, views: 0,
    postedAt: new Date(p.created_utc * 1000).toISOString(),
    postUrl: `https://reddit.com${p.permalink}`,
    coinMentions: detectCoinMentions(text),
    impact: calcImpact(score + comments * 2, 0, hoursAgo), source: 'reddit',
  };
}

async function fetchRedditPosts(asset: string): Promise<SocialPost[]> {
  const subs = (CRYPTO_SUBS[asset] ?? STOCK_SUBS[asset]) as string[] | undefined;

  // 4 parallel fetches: hot + top + new from primary, search in secondary subreddits
  const jobs: Promise<any[]>[] = [];
  if (subs) {
    jobs.push(fetchSubredditSort(subs[0], 'hot', 30));
    jobs.push(fetchSubredditSort(subs[0], 'top', 25, 'week'));
    jobs.push(fetchSubredditSort(subs[0], 'new', 20));
    if (subs[1]) jobs.push(searchReddit(asset, subs.slice(1).join('+'), 30));
    if (subs[2]) jobs.push(fetchSubredditSort(subs[2], 'hot', 20));
  } else {
    jobs.push(searchReddit(asset, 'CryptoCurrency+stocks+investing', 30));
    jobs.push(searchReddit(asset, 'wallstreetbets+options', 20));
  }

  const settled = await Promise.allSettled(jobs);
  const raw: any[] = [];
  for (const r of settled) if (r.status === 'fulfilled') raw.push(...r.value);

  const seen = new Set<string>();
  return raw.flatMap(p => {
    if (!p?.id || seen.has(p.id)) return [];
    seen.add(p.id);
    const m = mapRedditPost(p);
    return m ? [m] : [];
  });
}

// ─── YouTube RSS ──────────────────────────────────────────────────────────────
const YT_CHANNELS = [
  // Mega crypto
  { name: 'Coin Bureau',       id: 'UCqK_GSMbpiV8spgD3ZGloSw', handle: 'coinbureau',      followers: 2_700_000 },
  { name: 'Altcoin Daily',     id: 'UCbLhGKVY-bJPcawebgtNfbw', handle: 'altcoindaily',    followers: 1_700_000 },
  { name: 'Discover Crypto',   id: 'UCZjctekVi3uyFqPnsiAJ5yg', handle: 'discovercrypto',  followers: 1_400_000 },
  { name: 'Crypto Banter',     id: 'UCN9Nj4tjXbVTLYWN0EKly_Q', handle: 'cryptobanter',    followers: 1_180_000 },
  { name: 'Lark Davis',        id: 'UCl2oCaw8hdR_kbqyqd2klIA', handle: 'larkdavis',       followers: 640_000 },
  { name: 'InvestAnswers',     id: 'UCnMn36GT_H0X-PRlR-OMwAA', handle: 'investanswers',   followers: 460_000 },
  { name: 'Benjamin Cowen',    id: 'UCRvqjQPSeaWn-uEx-w0XOIg', handle: 'BenjaminCowen',   followers: 788_000 },
  { name: 'Bankless',          id: 'UCAl9Ld79qaZxp9JzEOwd3aA', handle: 'bankless',        followers: 276_000 },
  { name: 'Unchained',         id: 'UCWiiMnsnw5Isc2hjAh9wMzg', handle: 'unchainedcrypto', followers: 210_000 },
  { name: 'CryptoZombie',      id: 'UCHop-jpf-huVT1IYw79ymPw', handle: 'cryptozombie',    followers: 550_000 },
  { name: 'Dapp University',   id: 'UCY0xL8V6NZMr6DA2QFwnm1Q', handle: 'dappuniversity',  followers: 230_000 },
  { name: 'Real Vision Crypto',id: 'UCMEMZCJsO7PkBBMCBCdktmQ', handle: 'realvisioncrypto',followers: 190_000 },
  // Finance / macro
  { name: 'Andrei Jikh',       id: 'UCGy7SkBjcIAgTEs5XfNjABA', handle: 'andreijikh',      followers: 3_200_000 },
  { name: 'Graham Stephan',    id: 'UCV6KDgJskWaEckne5aPA0aQ', handle: 'grahamstephan',   followers: 4_600_000 },
  { name: 'Meet Kevin',        id: 'UCUvvj5kwkjCKqGroXHfrMKg', handle: 'meetkevin',       followers: 2_100_000 },
  { name: 'Mark Moss',         id: 'UCMIe3Kia09JFAnFjLdKY-LA', handle: 'markmoss',        followers: 680_000 },
  { name: 'Whiteboard Finance',id: 'UCL8w_A8p8P1HozZp8WbR2dg', handle: 'whiteboardfinance',followers: 1_050_000 },
  { name: 'Patrick Boyle',     id: 'UCASM3-oAaman1-dSg4mUEWg', handle: 'patrickboyle',    followers: 960_000 },
  { name: 'Kitco News',        id: 'UCvgUjfQGSBmm0-8sVRKiRjg', handle: 'kitconews',       followers: 860_000 },
  { name: 'BlockchainBrad',    id: 'UCQ52UjSpFcJF1sKF1-43yVg', handle: 'blockchainbrad',  followers: 270_000 },
];

let ytPool: SocialPost[] = [];
let ytPoolExpiry = 0;

function parseYTRSS(xml: string, ch: typeof YT_CHANNELS[0]): SocialPost[] {
  const posts: SocialPost[] = [];
  for (const entry of xml.split('<entry>').slice(1)) {
    try {
      const videoId   = entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1];
      const titleRaw  = entry.match(/<title>(.*?)<\/title>/)?.[1] ?? '';
      const title     = titleRaw.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/<!\[CDATA\[(.*?)\]\]>/s,'$1').trim();
      const published = entry.match(/<published>(.*?)<\/published>/)?.[1] ?? new Date().toISOString();
      const thumb     = entry.match(/<media:thumbnail url="(.*?)"/)?.[1];
      const desc      = (entry.match(/<media:description>([\s\S]*?)<\/media:description>/)?.[1] ?? '').slice(0, 400);
      const views     = parseInt(entry.match(/<media:statistics views="(\d+)"/)?.[1] ?? '0', 10);
      if (!videoId || !title) continue;
      const text     = `${title} ${desc}`;
      const hoursAgo = (Date.now() - new Date(published).getTime()) / 3_600_000;
      posts.push({
        id: `yt_${videoId}`, handle: ch.handle, name: ch.name, avatarUrl: '',
        followers: ch.followers, verified: true,
        tier: ch.followers >= 1_000_000 ? 'mega' : ch.followers >= 500_000 ? 'macro' : 'mid',
        tweet: title + (desc ? '\n\n' + desc.slice(0, 200) : ''),
        sentiment: detectSentiment(text), sentimentScore: 0.6, sentimentModel: 'keyword',
        likes: 0, replies: 0, retweets: 0, views,
        postedAt: published, postUrl: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnailUrl: thumb, coinMentions: detectCoinMentions(text),
        impact: calcImpact(Math.floor(views / 50), views, hoursAgo), source: 'youtube',
      });
    } catch { /* skip malformed */ }
  }
  return posts;
}

async function refreshYouTubePool() {
  const results = await Promise.allSettled(
    YT_CHANNELS.map(async ch => {
      const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`,
        { signal: AbortSignal.timeout(9_000) });
      if (!res.ok) throw new Error(`${ch.name}: ${res.status}`);
      return parseYTRSS(await res.text(), ch);
    })
  );
  const posts: SocialPost[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') posts.push(...r.value);
    else console.warn('[social] YT channel failed:', (r.reason as Error).message);
  }
  ytPool       = posts.sort((a, b) => b.impact - a.impact);
  ytPoolExpiry = Date.now() + 15 * 60_000;
  console.log(`[social] YouTube pool: ${ytPool.length} videos from ${YT_CHANNELS.length} channels`);
}

async function getYouTubeForAsset(asset: string): Promise<SocialPost[]> {
  if (Date.now() > ytPoolExpiry) await refreshYouTubePool();
  const names = COIN_NAMES[asset] ?? [];
  // Return ALL matching videos, not just a slice
  return ytPool.filter(p =>
    p.coinMentions.includes(asset) ||
    names.some(n => p.tweet.toLowerCase().includes(n)) ||
    p.tweet.toUpperCase().includes(asset)
  );
}

// ─── Twitter/X via Nitter RSS (free, no API key) ──────────────────────────────
// Tries multiple public Nitter instances in sequence until one responds.
const NITTER_INSTANCES = [
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.1d4.us',
  'https://nitter.nl',
  'https://nitter.mint.lgbt',
];

const NITTER_UA = 'Mozilla/5.0 (compatible; AntigravityMarkets/1.0)';

async function fetchNitterXml(query: string): Promise<string> {
  for (const inst of NITTER_INSTANCES) {
    try {
      const url = `${inst}/search/rss?q=${encodeURIComponent(query)}&f=tweets`;
      const res = await fetch(url, {
        headers: { 'User-Agent': NITTER_UA },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) {
        const text = await res.text();
        if (text.includes('<item>')) return text;
      }
    } catch { continue; }
  }
  return '';
}

function decodeHTML(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
          .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
}

function parseNitterRSS(xml: string): SocialPost[] {
  const posts: SocialPost[] = [];
  for (const item of xml.split('<item>').slice(1)) {
    try {
      const extract = (re: RegExp) => decodeHTML(
        (item.match(re)?.[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').trim()
      );
      const title   = extract(/<title>([\s\S]*?)<\/title>/);
      const desc    = extract(/<description>([\s\S]*?)<\/description>/);
      const link    = (item.match(/<link>(https?:\/\/[^\s<]+)/)?.[1] ?? '').trim();
      const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? '';
      const creator = (decodeHTML(
        item.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g,'').trim() ?? ''
      ) || link.match(/\/([^/]+)\/status\//)?.[1]) ?? 'unknown';

      const text = (title + ' ' + desc).replace(/\s+/g, ' ').trim().slice(0, 500);
      if (text.length < 15) continue;

      const xUrl     = link.replace(/https:\/\/nitter\.[^/]+/, 'https://x.com');
      const hoursAgo = pubDate ? (Date.now() - new Date(pubDate).getTime()) / 3_600_000 : 1;
      const meta     = INFLUENCER_META[creator];

      posts.push({
        id:             `tw_${creator}_${link.split('/').pop()?.slice(-8) ?? Math.random().toString(36).slice(2,10)}`,
        handle:         creator,
        name:           meta?.name ?? `@${creator}`,
        avatarUrl:      '',
        followers:      meta?.followers ?? 0,
        verified:       !!meta,
        tier:           meta?.tier,
        tweet:          text,
        sentiment:      detectSentiment(text), sentimentScore: 0.6, sentimentModel: 'keyword',
        likes:          0, replies: 0, retweets: 0, views: 0,
        postedAt:       new Date(pubDate || Date.now()).toISOString(),
        postUrl:        xUrl || link,
        coinMentions:   detectCoinMentions(text),
        impact:         calcImpact(15, 0, Math.max(0, hoursAgo)),
        source:         'twitter',
      });
    } catch { continue; }
  }
  return posts;
}

async function fetchTwitterViaNitter(asset: string): Promise<SocialPost[]> {
  const coinName = (COIN_NAMES[asset] ?? [])[0] ?? asset.toLowerCase();
  const query    = `$${asset} OR #${coinName.replace(/\s/g,'')} lang:en`;
  const xml      = await fetchNitterXml(query);
  if (!xml) {
    console.warn('[social] All Nitter instances unreachable for', asset);
    return [];
  }
  const posts = parseNitterRSS(xml);
  console.log(`[social] Nitter Twitter: ${posts.length} tweets for ${asset}`);
  return posts;
}

// ─── LinkedIn-style: professional finance news RSS ────────────────────────────
// LinkedIn has no public API. We instead pull from professional finance/crypto
// news RSS feeds — the same type of content analysts share on LinkedIn.
const FINANCE_NEWS_FEEDS = [
  // Crypto professional
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',           name: 'CoinDesk',       handle: 'coindesk',       followers: 850_000 },
  { url: 'https://decrypt.co/feed',                                   name: 'Decrypt',        handle: 'decryptmedia',   followers: 320_000 },
  { url: 'https://cryptoslate.com/feed/',                             name: 'CryptoSlate',    handle: 'cryptoslate',    followers: 280_000 },
  { url: 'https://cointelegraph.com/rss',                             name: 'CoinTelegraph',  handle: 'cointelegraph',  followers: 1_200_000 },
  // Professional finance
  { url: 'https://feeds.reuters.com/reuters/businessNews',            name: 'Reuters Business', handle: 'Reuters',      followers: 2_000_000 },
  { url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',            name: 'WSJ Markets',    handle: 'WSJMarkets',     followers: 1_800_000 },
  { url: 'https://www.ft.com/rss/home',                              name: 'Financial Times', handle: 'FinancialTimes', followers: 2_400_000 },
];

function parseNewsRSS(xml: string, feed: typeof FINANCE_NEWS_FEEDS[0], asset: string): SocialPost[] {
  const items = xml.split(/<item>|<entry>/).slice(1);
  const posts: SocialPost[] = [];
  const coinName = (COIN_NAMES[asset] ?? [])[0] ?? '';

  for (const item of items) {
    try {
      const extract = (re: RegExp) =>
        (item.match(re)?.[1] ?? '').replace(/<!\[CDATA\[|\]\]>/g,'').replace(/<[^>]+>/g,' ').trim();

      const title  = decodeHTML(extract(/<title>([\s\S]*?)<\/title>/));
      const desc   = decodeHTML(extract(/<description>([\s\S]*?)<\/description>/) ||
                                extract(/<summary[^>]*>([\s\S]*?)<\/summary>/));
      const link   = item.match(/<link>(https?:\/\/[^\s<]+)/)?.[1]?.trim() ??
                     item.match(/<link[^>]+href="(https?:\/\/[^"]+)"/)?.[1]?.trim() ?? '';
      const pubRaw = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ??
                     item.match(/<published>(.*?)<\/published>/)?.[1] ?? '';

      if (!title) continue;

      // Filter: only include if asset is mentioned
      const text = (title + ' ' + desc).toLowerCase();
      const mentionsAsset =
        text.includes(asset.toLowerCase()) ||
        text.includes(`$${asset.toLowerCase()}`) ||
        (coinName && text.includes(coinName));
      if (!mentionsAsset) continue;

      const fullText = (title + (desc ? '\n\n' + desc.slice(0, 300) : '')).trim().slice(0, 500);
      const hoursAgo = pubRaw ? (Date.now() - new Date(pubRaw).getTime()) / 3_600_000 : 1;

      posts.push({
        id:           `li_${feed.handle}_${link.split('/').pop()?.slice(-10) ?? Math.random().toString(36).slice(2,10)}`,
        handle:       feed.handle,
        name:         feed.name,
        avatarUrl:    '',
        followers:    feed.followers,
        verified:     true,
        tier:         feed.followers >= 1_000_000 ? 'mega' : feed.followers >= 500_000 ? 'macro' : 'mid',
        tweet:        fullText,
        sentiment:    detectSentiment(fullText), sentimentScore: 0.6, sentimentModel: 'keyword',
        likes:        0, replies: 0, retweets: 0, views: 0,
        postedAt:     new Date(pubRaw || Date.now()).toISOString(),
        postUrl:      link,
        coinMentions: detectCoinMentions(fullText),
        impact:       calcImpact(Math.floor(feed.followers / 10_000), 0, Math.max(0, hoursAgo)),
        source:       'linkedin',
      });
    } catch { continue; }
  }
  return posts;
}

async function fetchProfessionalNews(asset: string): Promise<SocialPost[]> {
  const results = await Promise.allSettled(
    FINANCE_NEWS_FEEDS.map(async feed => {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': 'AntigravityMarkets/1.0 (rss reader)' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) throw new Error(`${feed.name}: ${res.status}`);
      return parseNewsRSS(await res.text(), feed, asset);
    })
  );
  const posts: SocialPost[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') posts.push(...r.value);
    else console.warn('[social] News RSS failed:', (r.reason as Error).message);
  }
  console.log(`[social] Professional news (LinkedIn): ${posts.length} articles for ${asset}`);
  return posts;
}

// ─── Aggregate sentiment ──────────────────────────────────────────────────────
function aggregateSentiment(posts: SocialPost[]) {
  const total   = posts.length || 1;
  const bullish = posts.filter(p => p.sentiment === 'bullish').length;
  const bearish = posts.filter(p => p.sentiment === 'bearish').length;
  const neutral = total - bullish - bearish;
  const avgImpact = Math.round(posts.reduce((s, p) => s + p.impact, 0) / total);
  const topCoins  = (() => {
    const freq: Record<string, number> = {};
    for (const p of posts) for (const c of p.coinMentions) freq[c] = (freq[c] ?? 0) + 1;
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([c]) => c);
  })();
  return {
    total, bullish, bearish, neutral,
    bullishPct: Math.round((bullish / total) * 100),
    bearishPct: Math.round((bearish / total) * 100),
    avgImpact, topCoins,
  };
}

// ─── Main pool builder ────────────────────────────────────────────────────────
async function buildPool(asset: string): Promise<SocialPost[]> {
  const [reddit, youtube, twitter, linkedin] = await Promise.allSettled([
    fetchRedditPosts(asset),
    getYouTubeForAsset(asset),
    fetchTwitterViaNitter(asset),
    fetchProfessionalNews(asset),
  ]);

  const all: SocialPost[] = [];
  if (reddit.status   === 'fulfilled') all.push(...reddit.value);
  if (youtube.status  === 'fulfilled') all.push(...youtube.value);
  if (twitter.status  === 'fulfilled') all.push(...twitter.value);
  if (linkedin.status === 'fulfilled') all.push(...linkedin.value);

  if (!all.length) throw new Error('No posts from any source');

  // Deduplicate
  const seen = new Set<string>();
  const deduped = all.filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; });

  // CryptoBERT batch classify — all posts in one shot
  try {
    const texts   = deduped.map(p => p.tweet.slice(0, 400));
    const results = await classifyBatch(texts);
    for (let i = 0; i < deduped.length; i++) {
      deduped[i].sentiment      = results[i].sentiment;
      deduped[i].sentimentScore = results[i].score;
      deduped[i].sentimentModel = results[i].model;
    }
  } catch (err: any) {
    console.warn('[social] CryptoBERT failed:', err.message);
  }

  const sorted = deduped.sort((a, b) => b.impact - a.impact);

  console.log(`[social] Pool for ${asset}: Reddit=${reddit.status==='fulfilled'?reddit.value.length:0} YT=${youtube.status==='fulfilled'?youtube.value.length:0} Twitter=${twitter.status==='fulfilled'?twitter.value.length:0} LinkedIn=${linkedin.status==='fulfilled'?linkedin.value.length:0} → ${sorted.length} total`);

  return sorted;
}

// ─── Background warm-up ───────────────────────────────────────────────────────
const POPULAR_ASSETS = ['BTC', 'ETH', 'SOL', 'DOGE', 'NVDA', 'TSLA'];

async function proactiveRefresh() {
  for (const asset of POPULAR_ASSETS) {
    try {
      const posts     = await buildPool(asset);
      const sentiment = aggregateSentiment(posts);
      cacheSet(`pool:${asset}`, posts, 6 * 60_000);
      cacheSet(`posts:${asset}`, { posts: posts.slice(0, 20), sentiment, source: 'all', asset }, 6 * 60_000);
    } catch (e: any) {
      console.warn(`[social] Proactive refresh failed for ${asset}:`, e.message);
    }
    await new Promise(r => setTimeout(r, 3_000));
  }
}

setTimeout(() => {
  refreshYouTubePool().catch(() => {});
  warmUpCryptoBert().catch(() => {});
  setTimeout(() => proactiveRefresh().catch(() => {}), 15_000);
}, 10_000);

setInterval(() => proactiveRefresh().catch(() => {}), 6 * 60_000);

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/social/influencers/:asset?page=1&limit=20
 * Infinite scroll: page=1 returns first 20, page=2 next 20, etc.
 * Pool of 100+ posts cached for 6 min; refetched when exhausted.
 */
router.get('/influencers/:asset', async (req: Request, res: Response) => {
  const asset  = String(req.params.asset).toUpperCase();
  const page   = Math.max(1, parseInt(String(req.query.page  ?? '1'), 10));
  const limit  = Math.min(50, Math.max(5, parseInt(String(req.query.limit ?? '20'), 10)));
  const offset = (page - 1) * limit;

  try {
    // Get or build the full pool
    let pool = cacheGet<SocialPost[]>(`pool:${asset}`);
    if (!pool) {
      pool = await buildPool(asset);
      cacheSet(`pool:${asset}`, pool, 6 * 60_000);
    }

    const slice     = pool.slice(offset, offset + limit);
    const hasMore   = offset + limit < pool.length;
    const sentiment = aggregateSentiment(pool);

    const counts = {
      reddit: pool.filter(p => p.source === 'reddit').length,
      youtube: pool.filter(p => p.source === 'youtube').length,
      twitter: pool.filter(p => p.source === 'twitter').length,
      linkedin: pool.filter(p => p.source === 'linkedin').length,
    };

    res.json({
      posts: slice,
      sentiment,
      pagination: { page, limit, offset, total: pool.length, hasMore },
      sources: counts,
      asset,
      cachedUntil: new Date(Date.now() + 6 * 60_000).toISOString(),
    });
  } catch (err: any) {
    console.error(`[social] Failed for ${asset}:`, err.message);
    res.status(502).json({ error: `Social data unavailable: ${err.message}`, posts: [], asset });
  }
});

/** GET /api/social/sentiment/:asset */
router.get('/sentiment/:asset', async (req: Request, res: Response) => {
  const asset = String(req.params.asset).toUpperCase();
  const pool  = cacheGet<SocialPost[]>(`pool:${asset}`);
  if (pool) return res.json({ asset, ...aggregateSentiment(pool) });
  try {
    const posts = await buildPool(asset);
    cacheSet(`pool:${asset}`, posts, 6 * 60_000);
    res.json({ asset, ...aggregateSentiment(posts) });
  } catch { res.status(502).json({ error: 'Sentiment unavailable' }); }
});

/** GET /api/social/trending */
router.get('/trending', (_req: Request, res: Response) => {
  const freq: Record<string, number> = {};
  for (const [key, entry] of CACHE.entries()) {
    if (!key.startsWith('pool:') || Date.now() > (entry as CacheEntry).expiresAt) continue;
    const pool = (entry as CacheEntry).data as SocialPost[];
    for (const p of pool) for (const c of p.coinMentions) freq[c] = (freq[c] ?? 0) + 1;
  }
  const trending = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([coin, count]) => ({ coin, count }));
  res.json({ trending, updatedAt: new Date().toISOString() });
});

export { router as socialRouter };
