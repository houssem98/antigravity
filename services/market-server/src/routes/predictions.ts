import { Router, Request, Response } from 'express';

const router = Router();

// ── Price bracket config per asset ──────────────────────────────────────────
const BRACKETS: Record<string, { prices: string[]; label: string }> = {
  BTC:  { label: 'Bitcoin',  prices: ['$50,000','$60,000','$70,000','$80,000','$90,000','$100,000+'] },
  ETH:  { label: 'Ethereum', prices: ['$1,000','$1,500','$2,000','$2,500','$3,000','$3,500+'] },
  SOL:  { label: 'Solana',   prices: ['$60','$80','$100','$120','$150','$180+'] },
  XRP:  { label: 'XRP',      prices: ['$0.50','$1.00','$1.50','$2.00','$2.50','$3.00+'] },
  BNB:  { label: 'BNB',      prices: ['$300','$350','$400','$450','$500','$600+'] },
  DOGE: { label: 'Dogecoin', prices: ['$0.08','$0.10','$0.15','$0.20','$0.25','$0.30+'] },
  ADA:  { label: 'Cardano',  prices: ['$0.20','$0.30','$0.40','$0.50','$0.60','$0.80+'] },
  AVAX: { label: 'Avalanche',prices: ['$10','$15','$20','$25','$30','$40+'] },
  LINK: { label: 'Chainlink',prices: ['$8','$10','$12','$14','$16','$20+'] },
  DOT:  { label: 'Polkadot', prices: ['$3','$4','$5','$6','$8','$10+'] },
  SHIB: { label: 'Shiba Inu',prices: ['$0.000008','$0.000010','$0.000012','$0.000015','$0.000020','$0.000025+'] },
  LTC:  { label: 'Litecoin', prices: ['$60','$70','$80','$90','$100','$120+'] },
  UNI:  { label: 'Uniswap',  prices: ['$5','$6','$8','$10','$12','$15+'] },
  ATOM: { label: 'Cosmos',   prices: ['$3','$4','$5','$6','$8','$10+'] },
};

// In-memory store: votes[asset][priceIndex] = count
// Seeded with some starter votes to look alive on first load
const votes: Record<string, number[]> = {};
const voterIds: Record<string, Set<string>> = {}; // track unique voters per asset

function initAsset(asset: string) {
  if (!votes[asset]) {
    const brackets = BRACKETS[asset] ?? BRACKETS.BTC;
    // Seed with random starter votes so it doesn't look empty
    votes[asset] = brackets.prices.map(() => Math.floor(Math.random() * 40) + 5);
    voterIds[asset] = new Set();
  }
}

function getMonth() {
  return new Date().toLocaleString('en-US', { month: 'long' });
}

// GET /api/predictions/:asset
router.get('/:asset', (req: Request, res: Response) => {
  const asset = req.params.asset.toUpperCase();
  initAsset(asset);
  const brackets = BRACKETS[asset] ?? BRACKETS.BTC;
  const totalVotes = votes[asset].reduce((a, b) => a + b, 0);

  res.json({
    asset,
    label: brackets.label,
    month: getMonth(),
    totalVotes,
    predictions: brackets.prices.map((price, i) => ({
      price,
      votes: votes[asset][i],
      pct: totalVotes > 0 ? Math.round((votes[asset][i] / totalVotes) * 1000) / 10 : 0,
    })),
  });
});

// POST /api/predictions/:asset/vote  { priceIndex: number, voterId: string }
router.post('/:asset/vote', (req: Request, res: Response) => {
  const asset = req.params.asset.toUpperCase();
  const { priceIndex, voterId } = req.body as { priceIndex: number; voterId: string };

  initAsset(asset);
  const brackets = BRACKETS[asset] ?? BRACKETS.BTC;

  if (typeof priceIndex !== 'number' || priceIndex < 0 || priceIndex >= brackets.prices.length) {
    return res.status(400).json({ error: 'Invalid priceIndex' });
  }
  if (!voterId || typeof voterId !== 'string') {
    return res.status(400).json({ error: 'voterId required' });
  }

  // One vote per voter per asset
  if (voterIds[asset].has(voterId)) {
    return res.status(409).json({ error: 'already_voted', message: 'You already voted for this asset.' });
  }

  voterIds[asset].add(voterId);
  votes[asset][priceIndex]++;

  const totalVotes = votes[asset].reduce((a, b) => a + b, 0);
  res.json({
    asset,
    label: brackets.label,
    month: getMonth(),
    totalVotes,
    predictions: brackets.prices.map((price, i) => ({
      price,
      votes: votes[asset][i],
      pct: Math.round((votes[asset][i] / totalVotes) * 1000) / 10,
    })),
  });
});

export { router as predictionsRouter };
