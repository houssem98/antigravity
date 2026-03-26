/**
 * CryptoBERT Sentiment Classifier
 *
 * Wraps HuggingFace Text-Embeddings-Inference (TEI) running ElKulako/cryptobert.
 * Model: BERTweet-base post-trained on 3.2M crypto social media posts.
 * Labels: Bearish (0) | Neutral (1) | Bullish (2)
 *
 * TEI endpoint: POST /classify
 *   body:    { "inputs": "text" }   or   { "inputs": ["t1", "t2", ...] }
 *   returns: [{"label":"Bullish","score":0.94}, ...] per input
 *
 * Graceful degradation: if TEI is unreachable, falls back to keyword heuristics.
 */

export type Sentiment = 'bullish' | 'bearish' | 'neutral';

export interface SentimentResult {
  sentiment: Sentiment;
  score: number;          // 0–1 confidence of the top label
  model: 'cryptobert' | 'keyword';
}

interface TEIClassLabel { label: string; score: number }

// ─── Health tracking — avoid hammering a down container ─────────────────────
let _healthy: boolean | null = null;  // null = unknown (first check pending)
let _nextCheck = 0;
const RETRY_AFTER_MS = 30_000;       // wait 30s before probing again after failure

function getCryptoBertUrl(): string {
  return process.env.CRYPTOBERT_URL ?? 'http://localhost:8082';
}

async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${getCryptoBertUrl()}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function isHealthy(): Promise<boolean> {
  if (_healthy === true) return true;
  if (Date.now() < _nextCheck) return false;

  _healthy = await checkHealth();
  if (!_healthy) {
    _nextCheck = Date.now() + RETRY_AFTER_MS;
    console.warn('[cryptobert] TEI container unreachable — using keyword fallback');
  } else {
    console.log('[cryptobert] TEI container is healthy');
  }
  return _healthy;
}

// Mark healthy proactively so we don't block first request
setInterval(async () => {
  _healthy = await checkHealth();
  if (_healthy) _nextCheck = 0;
}, 60_000);

// ─── Label normalizer ────────────────────────────────────────────────────────
function normalizeLabel(label: string): Sentiment {
  const l = label.toLowerCase();
  if (l.includes('bull') || l === 'positive' || l === '2') return 'bullish';
  if (l.includes('bear') || l === 'negative' || l === '0') return 'bearish';
  return 'neutral';
}

// ─── Keyword fallback ────────────────────────────────────────────────────────
const BULL_KW = ['bull', 'moon', 'buy', 'long', 'pump', 'ath', 'hodl', 'hold',
  'breakout', 'surge', 'rally', 'gains', '🚀', '📈', 'accumulate', 'bottom',
  'opportunity', 'strong', 'undervalued', 'support', 'all-time high', 'dip'];
const BEAR_KW = ['bear', 'sell', 'short', 'dump', 'crash', 'drop', 'bearish',
  'correction', 'fud', 'fear', 'overvalued', 'bubble', 'collapse', '📉',
  'loss', 'scam', 'rug', 'dead', 'rekt', 'panic', 'red'];

function keywordSentiment(text: string): SentimentResult {
  const lower = text.toLowerCase();
  let bull = 0, bear = 0;
  for (const w of BULL_KW) if (lower.includes(w)) bull++;
  for (const w of BEAR_KW) if (lower.includes(w)) bear++;
  if (bull > bear && bull > 0) return { sentiment: 'bullish', score: 0.6, model: 'keyword' };
  if (bear > bull && bear > 0) return { sentiment: 'bearish', score: 0.6, model: 'keyword' };
  return { sentiment: 'neutral', score: 0.5, model: 'keyword' };
}

// ─── Main exported function ──────────────────────────────────────────────────

/**
 * Classify a batch of texts using CryptoBERT.
 * Returns one SentimentResult per input (label + confidence score + model source).
 * Falls back to keyword heuristics if CryptoBERT container is unavailable.
 *
 * @param texts - array of texts to classify (max 64 per batch)
 */
export async function classifyBatch(texts: string[]): Promise<SentimentResult[]> {
  if (!texts.length) return [];

  // Sanitize + truncate — strip null bytes and control chars that break JSON parsing
  const sanitize = (t: string) =>
    t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ')  // control chars except \n \t
     .replace(/\\/g, ' ')                                   // lone backslashes → space
     .replace(/[\uD800-\uDFFF]/g, '')                       // lone surrogates (invalid Unicode)
     .trim()
     .slice(0, 400);                                        // stay well under 128 token limit

  const truncated = texts.map(sanitize);

  if (!(await isHealthy())) {
    return truncated.map(keywordSentiment);
  }

  try {
    const res = await fetch(`${getCryptoBertUrl()}/classify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: truncated }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(`/classify returned ${res.status}: ${msg.slice(0, 100)}`);
    }

    const raw = await res.json() as TEIClassLabel[][] | TEIClassLabel[];

    // Our FastAPI returns array-of-arrays always
    const results: TEIClassLabel[][] = Array.isArray(raw[0])
      ? raw as TEIClassLabel[][]
      : [raw as TEIClassLabel[]];

    return results.map(labelList => {
      const top = labelList.reduce((best, cur) => cur.score > best.score ? cur : best);
      return {
        sentiment: normalizeLabel(top.label),
        score: Math.round(top.score * 1000) / 1000,   // 3 decimal places
        model: 'cryptobert' as const,
      };
    });

  } catch (err: any) {
    console.warn(`[cryptobert] classify failed (${err.message}) — using keyword fallback`);
    _healthy = false;
    _nextCheck = Date.now() + RETRY_AFTER_MS;
    return truncated.map(keywordSentiment);
  }
}

/**
 * Classify a single text. Convenience wrapper.
 */
export async function classifyOne(text: string): Promise<SentimentResult> {
  const [result] = await classifyBatch([text]);
  return result;
}

/**
 * Warm up CryptoBERT by sending a dummy request.
 * First request causes the model to load — subsequent requests are fast.
 * Call this during server startup.
 */
export async function warmUpCryptoBert(): Promise<void> {
  console.log('[cryptobert] Warming up model...');
  const start = Date.now();
  try {
    await classifyBatch(['Bitcoin is showing strong bullish momentum with rising volume.']);
    console.log(`[cryptobert] Warm-up complete in ${Date.now() - start}ms`);
  } catch (err: any) {
    console.warn('[cryptobert] Warm-up failed (will retry on first real request):', err.message);
  }
}
