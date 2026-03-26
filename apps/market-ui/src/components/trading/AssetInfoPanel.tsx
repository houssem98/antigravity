import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { isCryptoAsset, CRYPTO_ASSETS, STOCK_ASSETS } from '../../constants/tradingAssets';
import {
  Info, Star, Globe, FileText, Copy, Check, ChevronDown, ChevronRight,
  Edit2, Unlock, CheckCircle2, ExternalLink, Play, ArrowLeftRight, Shield,
} from 'lucide-react';

// ── Polymarket + Kalshi price predictions per asset ──
const POLYMARKET_DATA: Record<string, { month: string; url: string; kalshiUrl: string; predictions: Array<{ price: string; pct: number }> }> = {
  BTC: { month: 'March', url: 'https://polymarket.com/markets?_q=bitcoin+price+march', kalshiUrl: 'https://kalshi.com/markets/?search=bitcoin+price', predictions: [
    { price: '$90,000.00', pct: 1.0 },
    { price: '$85,000.00', pct: 3.5 },
    { price: '$80,000.00', pct: 16.5 },
    { price: '$65,000.00', pct: 35.7 },
    { price: '$60,000.00', pct: 10.5 },
    { price: '$55,000.00', pct: 3.5 },
  ]},
  ETH: { month: 'March', url: 'https://polymarket.com/markets?_q=ethereum+price+march', kalshiUrl: 'https://kalshi.com/markets/?search=ethereum+price', predictions: [
    { price: '$3,500.00', pct: 2.0 },
    { price: '$3,000.00', pct: 8.5 },
    { price: '$2,500.00', pct: 22.3 },
    { price: '$2,000.00', pct: 38.1 },
    { price: '$1,500.00', pct: 14.2 },
    { price: '$1,200.00', pct: 4.8 },
  ]},
  BNB: { month: 'March', url: 'https://polymarket.com/markets?_q=bnb+price+march', kalshiUrl: 'https://kalshi.com/markets/?search=bnb+price', predictions: [
    { price: '$600.00', pct: 3.2 },
    { price: '$500.00', pct: 18.7 },
    { price: '$450.00', pct: 31.4 },
    { price: '$400.00', pct: 22.6 },
    { price: '$350.00', pct: 9.1 },
  ]},
  SOL: { month: 'March', url: 'https://polymarket.com/markets?_q=solana+price+march', kalshiUrl: 'https://kalshi.com/markets/?search=solana+price', predictions: [
    { price: '$180.00', pct: 4.5 },
    { price: '$150.00', pct: 19.2 },
    { price: '$120.00', pct: 33.8 },
    { price: '$100.00', pct: 21.5 },
    { price: '$80.00', pct: 8.3 },
  ]},
  XRP: { month: 'March', url: 'https://polymarket.com/markets?_q=xrp+price+march', kalshiUrl: 'https://kalshi.com/markets/?search=xrp+price', predictions: [
    { price: '$3.00', pct: 5.1 },
    { price: '$2.50', pct: 17.4 },
    { price: '$2.00', pct: 29.6 },
    { price: '$1.50', pct: 24.8 },
    { price: '$1.00', pct: 11.2 },
  ]},
  DOGE: { month: 'March', url: 'https://polymarket.com/markets?_q=dogecoin+price+march', kalshiUrl: 'https://kalshi.com/markets/?search=dogecoin+price', predictions: [
    { price: '$0.25', pct: 6.3 },
    { price: '$0.20', pct: 21.5 },
    { price: '$0.15', pct: 34.7 },
    { price: '$0.10', pct: 18.9 },
    { price: '$0.08', pct: 7.4 },
  ]},
  ADA: { month: 'March', url: 'https://polymarket.com/markets?_q=cardano+price+march', kalshiUrl: 'https://kalshi.com/markets/?search=cardano+price', predictions: [
    { price: '$0.80', pct: 4.2 },
    { price: '$0.60', pct: 16.8 },
    { price: '$0.50', pct: 28.4 },
    { price: '$0.40', pct: 22.1 },
    { price: '$0.30', pct: 10.6 },
  ]},
  DOT: { month: 'March', url: 'https://polymarket.com/markets?_q=polkadot+price+march', kalshiUrl: 'https://kalshi.com/markets/?search=polkadot+price', predictions: [
    { price: '$8.00', pct: 2.1 },
    { price: '$6.00', pct: 12.4 },
    { price: '$5.00', pct: 29.8 },
    { price: '$4.00', pct: 31.2 },
    { price: '$3.00', pct: 14.6 },
  ]},
  AVAX: { month: 'March', url: 'https://polymarket.com/markets?_q=avalanche+price+march', kalshiUrl: 'https://kalshi.com/markets/?search=avalanche+price', predictions: [
    { price: '$30.00', pct: 3.4 },
    { price: '$25.00', pct: 14.8 },
    { price: '$20.00', pct: 32.1 },
    { price: '$15.00', pct: 26.7 },
    { price: '$12.00', pct: 9.8 },
  ]},
  LINK: { month: 'March', url: 'https://polymarket.com/markets?_q=chainlink+price+march', kalshiUrl: 'https://kalshi.com/markets/?search=chainlink+price', predictions: [
    { price: '$20.00', pct: 2.8 },
    { price: '$16.00', pct: 11.4 },
    { price: '$14.00', pct: 27.6 },
    { price: '$12.00', pct: 33.2 },
    { price: '$10.00', pct: 15.4 },
  ]},
  MATIC: { month: 'March', url: 'https://polymarket.com/markets?_q=polygon+price+march', kalshiUrl: 'https://kalshi.com/markets/?search=polygon+price', predictions: [
    { price: '$0.40', pct: 3.6 },
    { price: '$0.30', pct: 18.2 },
    { price: '$0.25', pct: 32.4 },
    { price: '$0.20', pct: 24.8 },
    { price: '$0.15', pct: 10.2 },
  ]},
  SHIB: { month: 'March', url: 'https://polymarket.com/markets?_q=shiba+inu+price+march', kalshiUrl: 'https://kalshi.com/markets/?search=shiba+inu+price', predictions: [
    { price: '$0.00002', pct: 4.1 },
    { price: '$0.000015', pct: 19.6 },
    { price: '$0.000012', pct: 34.2 },
    { price: '$0.000010', pct: 22.8 },
    { price: '$0.000008', pct: 8.4 },
  ]},
  LTC: { month: 'March', url: 'https://polymarket.com/markets?_q=litecoin+price+march', kalshiUrl: 'https://kalshi.com/markets/?search=litecoin+price', predictions: [
    { price: '$120.00', pct: 3.2 },
    { price: '$100.00', pct: 16.8 },
    { price: '$90.00', pct: 31.4 },
    { price: '$80.00', pct: 24.6 },
    { price: '$70.00', pct: 11.2 },
  ]},
  UNI: { month: 'March', url: 'https://polymarket.com/markets?_q=uniswap+price+march', kalshiUrl: 'https://kalshi.com/markets/?search=uniswap+price', predictions: [
    { price: '$12.00', pct: 2.4 },
    { price: '$10.00', pct: 14.6 },
    { price: '$8.00', pct: 31.8 },
    { price: '$6.00', pct: 28.4 },
    { price: '$5.00', pct: 12.6 },
  ]},
  ATOM: { month: 'March', url: 'https://polymarket.com/markets?_q=cosmos+price+march', kalshiUrl: 'https://kalshi.com/markets/?search=cosmos+price', predictions: [
    { price: '$8.00', pct: 2.8 },
    { price: '$6.00', pct: 13.4 },
    { price: '$5.00', pct: 29.6 },
    { price: '$4.00', pct: 32.1 },
    { price: '$3.00', pct: 14.8 },
  ]},
};

// ── Per-asset metadata (real links, tags, ATH/ATL, socials, contracts, explorers, wallets) ──
const ASSET_META: Record<string, {
  website: string; websiteLabel: string;
  whitepaper: string; whitepaperLabel: string;
  explorer: string; explorerLabel: string;
  socials: { twitter?: string; reddit?: string; github?: string; discord?: string; telegram?: string };
  contracts: Array<{ address: string; chain: string; chainColor: string; auditUrl?: string; scanUrl?: string }>;
  explorers: Array<{ label: string; url: string }>;
  wallets: Array<{ label: string; url: string; color: string; abbr: string }>;
  tags: string[];
  ath: { price: string; rawPrice: number; date: string; ago: string };
  atl: { price: string; rawPrice: number; date: string; ago: string };
  range7d: { low: string; high: string };
  videoUrl: string;
  ucid: number;
  rating: number;
  rank: number;
}> = {
  BTC: {
    website: 'https://bitcoin.org', websiteLabel: 'bitcoin.org',
    whitepaper: 'https://bitcoin.org/bitcoin.pdf', whitepaperLabel: 'Whitepaper',
    explorer: 'https://blockstream.info', explorerLabel: 'blockstream.info',
    socials: {
      twitter: 'https://twitter.com/bitcoin',
      reddit: 'https://reddit.com/r/bitcoin',
      github: 'https://github.com/bitcoin/bitcoin',
    },
    contracts: [
      { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', chain: 'ETH', chainColor: '#627EEA', auditUrl: 'https://etherscan.io/token/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', scanUrl: 'https://tokensniffer.com' },
    ],
    explorers: [
      { label: 'Blockstream', url: 'https://blockstream.info' },
      { label: 'Blockchain.com', url: 'https://www.blockchain.com/explorer' },
      { label: 'Mempool.space', url: 'https://mempool.space' },
    ],
    wallets: [
      { label: 'MetaMask', url: 'https://metamask.io', color: '#E88B2E', abbr: 'M' },
      { label: 'Trust Wallet', url: 'https://trustwallet.com', color: '#3375BB', abbr: 'T' },
      { label: 'Ledger', url: 'https://ledger.com', color: '#1D1D1B', abbr: 'L' },
      { label: 'Coinbase Wallet', url: 'https://wallet.coinbase.com', color: '#0052FF', abbr: 'C' },
    ],
    tags: ['Layer 1', 'PoW', 'Store of Value', 'Mineable', 'BRC-20'],
    ath: { price: '$126,080', rawPrice: 126080, date: 'Oct 06, 2025', ago: '6 months' },
    atl: { price: '$67.81', rawPrice: 67.81, date: 'Jul 06, 2013', ago: 'over 12 years' },
    range7d: { low: '$69,298.88', high: '$75,632.41' },
    videoUrl: 'https://www.youtube.com/results?search_query=bitcoin+explained+2024',
    ucid: 1,
    rating: 4.8,
    rank: 1,
  },
  ETH: {
    website: 'https://ethereum.org', websiteLabel: 'ethereum.org',
    whitepaper: 'https://ethereum.org/en/whitepaper/', whitepaperLabel: 'Whitepaper',
    explorer: 'https://etherscan.io', explorerLabel: 'etherscan.io',
    socials: {
      twitter: 'https://twitter.com/ethereum',
      reddit: 'https://reddit.com/r/ethereum',
      github: 'https://github.com/ethereum/ethereum-org-website',
      discord: 'https://discord.com/invite/CetY6Y4',
    },
    contracts: [
      { address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', chain: 'BNB', chainColor: '#F0B90B', auditUrl: 'https://bscscan.com/token/0x2170Ed0880ac9A755fd29B2688956BD959F933F8', scanUrl: 'https://tokensniffer.com' },
      { address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', chain: 'POL', chainColor: '#8247E5', auditUrl: 'https://polygonscan.com/token/0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', scanUrl: 'https://tokensniffer.com' },
    ],
    explorers: [
      { label: 'Etherscan', url: 'https://etherscan.io' },
      { label: 'Ethplorer', url: 'https://ethplorer.io' },
      { label: 'Blockscout', url: 'https://eth.blockscout.com' },
    ],
    wallets: [
      { label: 'MetaMask', url: 'https://metamask.io', color: '#E88B2E', abbr: 'M' },
      { label: 'Trust Wallet', url: 'https://trustwallet.com', color: '#3375BB', abbr: 'T' },
      { label: 'Ledger', url: 'https://ledger.com', color: '#1D1D1B', abbr: 'L' },
      { label: 'Coinbase Wallet', url: 'https://wallet.coinbase.com', color: '#0052FF', abbr: 'C' },
    ],
    tags: ['Layer 1', 'PoS', 'Smart Contracts', 'DeFi', 'NFT'],
    ath: { price: '$4,878', rawPrice: 4878, date: 'Nov 10, 2021', ago: 'over 3 years' },
    atl: { price: '$0.432', rawPrice: 0.432, date: 'Oct 21, 2015', ago: 'over 9 years' },
    range7d: { low: '$1,428.30', high: '$1,612.80' },
    videoUrl: 'https://www.youtube.com/results?search_query=ethereum+explained+2024',
    ucid: 1027,
    rating: 4.5,
    rank: 2,
  },
  BNB: {
    website: 'https://www.bnbchain.org', websiteLabel: 'bnbchain.org',
    whitepaper: 'https://github.com/bnb-chain/whitepaper', whitepaperLabel: 'Whitepaper',
    explorer: 'https://bscscan.com', explorerLabel: 'bscscan.com',
    socials: {
      twitter: 'https://twitter.com/BNBCHAIN',
      reddit: 'https://reddit.com/r/bnbchainofficial',
      github: 'https://github.com/bnb-chain',
      discord: 'https://discord.gg/bnbchain',
      telegram: 'https://t.me/BNBchaincommunity',
    },
    contracts: [
      { address: '0xB8c77482e45F1F44dE1745F52C74426C631bDD52', chain: 'ETH', chainColor: '#627EEA', auditUrl: 'https://etherscan.io/token/0xB8c77482e45F1F44dE1745F52C74426C631bDD52', scanUrl: 'https://tokensniffer.com' },
    ],
    explorers: [
      { label: 'BscScan', url: 'https://bscscan.com' },
      { label: 'Nodereal', url: 'https://bsctrace.com' },
    ],
    wallets: [
      { label: 'MetaMask', url: 'https://metamask.io', color: '#E88B2E', abbr: 'M' },
      { label: 'Trust Wallet', url: 'https://trustwallet.com', color: '#3375BB', abbr: 'T' },
      { label: 'Ledger', url: 'https://ledger.com', color: '#1D1D1B', abbr: 'L' },
      { label: 'Coinbase Wallet', url: 'https://wallet.coinbase.com', color: '#0052FF', abbr: 'C' },
    ],
    tags: ['Layer 1', 'CEX Token', 'BEP-20', 'DeFi'],
    ath: { price: '$686', rawPrice: 686, date: 'May 10, 2021', ago: 'almost 4 years' },
    atl: { price: '$0.0398', rawPrice: 0.0398, date: 'Oct 19, 2017', ago: 'over 7 years' },
    range7d: { low: '$534.20', high: '$621.40' },
    videoUrl: 'https://www.youtube.com/results?search_query=bnb+binance+coin+explained',
    ucid: 1839,
    rating: 4.1,
    rank: 4,
  },
  SOL: {
    website: 'https://solana.com', websiteLabel: 'solana.com',
    whitepaper: 'https://solana.com/solana-whitepaper.pdf', whitepaperLabel: 'Whitepaper',
    explorer: 'https://explorer.solana.com', explorerLabel: 'explorer.solana.com',
    socials: {
      twitter: 'https://twitter.com/solana',
      reddit: 'https://reddit.com/r/solana',
      github: 'https://github.com/solana-labs/solana',
      discord: 'https://discord.com/invite/solana',
      telegram: 'https://t.me/solanaio',
    },
    contracts: [
      { address: '0x570A5D26f7765Ecb712C0924E4De545B89fD43dF', chain: 'BNB', chainColor: '#F0B90B', auditUrl: 'https://bscscan.com/token/0x570A5D26f7765Ecb712C0924E4De545B89fD43dF', scanUrl: 'https://tokensniffer.com' },
    ],
    explorers: [
      { label: 'Solana Explorer', url: 'https://explorer.solana.com' },
      { label: 'Solscan', url: 'https://solscan.io' },
      { label: 'SolanaFM', url: 'https://solana.fm' },
    ],
    wallets: [
      { label: 'Phantom', url: 'https://phantom.app', color: '#AB9FF2', abbr: 'P' },
      { label: 'Trust Wallet', url: 'https://trustwallet.com', color: '#3375BB', abbr: 'T' },
      { label: 'Ledger', url: 'https://ledger.com', color: '#1D1D1B', abbr: 'L' },
      { label: 'Coinbase Wallet', url: 'https://wallet.coinbase.com', color: '#0052FF', abbr: 'C' },
    ],
    tags: ['Layer 1', 'PoH', 'DeFi', 'NFT', 'High Speed'],
    ath: { price: '$260', rawPrice: 260, date: 'Nov 06, 2021', ago: 'over 3 years' },
    atl: { price: '$0.500', rawPrice: 0.5, date: 'May 11, 2020', ago: 'almost 5 years' },
    range7d: { low: '$112.40', high: '$148.70' },
    videoUrl: 'https://www.youtube.com/results?search_query=solana+explained+2024',
    ucid: 5426,
    rating: 4.3,
    rank: 5,
  },
  XRP: {
    website: 'https://xrpl.org', websiteLabel: 'xrpl.org',
    whitepaper: 'https://ripple.com/files/ripple_consensus_whitepaper.pdf', whitepaperLabel: 'Whitepaper',
    explorer: 'https://xrpscan.com', explorerLabel: 'xrpscan.com',
    socials: {
      twitter: 'https://twitter.com/Ripple',
      reddit: 'https://reddit.com/r/Ripple',
      github: 'https://github.com/XRPLF/rippled',
      discord: 'https://discord.gg/nypYsDCrXV',
    },
    contracts: [
      { address: '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE', chain: 'BNB', chainColor: '#F0B90B', auditUrl: 'https://bscscan.com/token/0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE', scanUrl: 'https://tokensniffer.com' },
    ],
    explorers: [
      { label: 'XRPScan', url: 'https://xrpscan.com' },
      { label: 'XRPL.org', url: 'https://livenet.xrpl.org' },
      { label: 'Bithomp', url: 'https://bithomp.com' },
    ],
    wallets: [
      { label: 'XUMM', url: 'https://xumm.app', color: '#346AA9', abbr: 'X' },
      { label: 'Trust Wallet', url: 'https://trustwallet.com', color: '#3375BB', abbr: 'T' },
      { label: 'Ledger', url: 'https://ledger.com', color: '#1D1D1B', abbr: 'L' },
      { label: 'Coinbase Wallet', url: 'https://wallet.coinbase.com', color: '#0052FF', abbr: 'C' },
    ],
    tags: ['Payments', 'Layer 1', 'CBDC', 'Cross-Border'],
    ath: { price: '$3.40', rawPrice: 3.4, date: 'Jan 07, 2018', ago: 'over 7 years' },
    atl: { price: '$0.00268', rawPrice: 0.00268, date: 'Jul 07, 2014', ago: 'over 10 years' },
    range7d: { low: '$1.92', high: '$2.34' },
    videoUrl: 'https://www.youtube.com/results?search_query=xrp+ripple+explained',
    ucid: 52,
    rating: 4.0,
    rank: 6,
  },
  DOGE: {
    website: 'https://dogecoin.com', websiteLabel: 'dogecoin.com',
    whitepaper: 'https://github.com/dogecoin/dogecoin', whitepaperLabel: 'Whitepaper',
    explorer: 'https://dogechain.info', explorerLabel: 'dogechain.info',
    socials: {
      twitter: 'https://twitter.com/dogecoin',
      reddit: 'https://reddit.com/r/dogecoin',
      github: 'https://github.com/dogecoin/dogecoin',
    },
    contracts: [
      { address: '0xbA2aE424d960c26247Dd6c32edC70B295c744C43', chain: 'BNB', chainColor: '#F0B90B', auditUrl: 'https://bscscan.com/token/0xbA2aE424d960c26247Dd6c32edC70B295c744C43', scanUrl: 'https://tokensniffer.com' },
    ],
    explorers: [
      { label: 'Dogechain', url: 'https://dogechain.info' },
      { label: 'Blockchair', url: 'https://blockchair.com/dogecoin' },
    ],
    wallets: [
      { label: 'MetaMask', url: 'https://metamask.io', color: '#E88B2E', abbr: 'M' },
      { label: 'Trust Wallet', url: 'https://trustwallet.com', color: '#3375BB', abbr: 'T' },
      { label: 'Ledger', url: 'https://ledger.com', color: '#1D1D1B', abbr: 'L' },
      { label: 'Coinbase Wallet', url: 'https://wallet.coinbase.com', color: '#0052FF', abbr: 'C' },
    ],
    tags: ['Meme', 'PoW', 'Payments', 'Community'],
    ath: { price: '$0.731', rawPrice: 0.731, date: 'May 08, 2021', ago: 'almost 4 years' },
    atl: { price: '$0.0000869', rawPrice: 0.0000869, date: 'May 06, 2015', ago: 'almost 10 years' },
    range7d: { low: '$0.1612', high: '$0.2084' },
    videoUrl: 'https://www.youtube.com/results?search_query=dogecoin+explained',
    ucid: 74,
    rating: 3.8,
    rank: 8,
  },
  ADA: {
    website: 'https://cardano.org', websiteLabel: 'cardano.org',
    whitepaper: 'https://docs.cardano.org/introduction/', whitepaperLabel: 'Whitepaper',
    explorer: 'https://cardanoscan.io', explorerLabel: 'cardanoscan.io',
    socials: {
      twitter: 'https://twitter.com/Cardano',
      reddit: 'https://reddit.com/r/cardano',
      github: 'https://github.com/input-output-hk/cardano-node',
      discord: 'https://discord.com/invite/vKy83yP6Ej',
      telegram: 'https://t.me/cardano',
    },
    contracts: [
      { address: '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47', chain: 'BNB', chainColor: '#F0B90B', auditUrl: 'https://bscscan.com/token/0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47', scanUrl: 'https://tokensniffer.com' },
    ],
    explorers: [
      { label: 'Cardanoscan', url: 'https://cardanoscan.io' },
      { label: 'Cexplorer', url: 'https://cexplorer.io' },
      { label: 'AdaStat', url: 'https://adastat.net' },
    ],
    wallets: [
      { label: 'Nami', url: 'https://namiwallet.io', color: '#349EA3', abbr: 'N' },
      { label: 'Trust Wallet', url: 'https://trustwallet.com', color: '#3375BB', abbr: 'T' },
      { label: 'Ledger', url: 'https://ledger.com', color: '#1D1D1B', abbr: 'L' },
      { label: 'Coinbase Wallet', url: 'https://wallet.coinbase.com', color: '#0052FF', abbr: 'C' },
    ],
    tags: ['Layer 1', 'PoS', 'Smart Contracts', 'Academic'],
    ath: { price: '$3.09', rawPrice: 3.09, date: 'Sep 02, 2021', ago: 'over 3 years' },
    atl: { price: '$0.01735', rawPrice: 0.01735, date: 'Oct 01, 2017', ago: 'over 7 years' },
    range7d: { low: '$0.5812', high: '$0.6948' },
    videoUrl: 'https://www.youtube.com/results?search_query=cardano+ada+explained',
    ucid: 2010,
    rating: 4.0,
    rank: 9,
  },
  DOT: {
    website: 'https://polkadot.network', websiteLabel: 'polkadot.network',
    whitepaper: 'https://polkadot.network/PolkaDotPaper.pdf', whitepaperLabel: 'Whitepaper',
    explorer: 'https://polkadot.subscan.io', explorerLabel: 'subscan.io',
    socials: { twitter: 'https://twitter.com/Polkadot', reddit: 'https://reddit.com/r/dot', github: 'https://github.com/paritytech/polkadot', discord: 'https://discord.gg/polkadot', telegram: 'https://t.me/PolkadotOfficial' },
    contracts: [{ address: '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402', chain: 'BNB', chainColor: '#F0B90B', auditUrl: 'https://bscscan.com/token/0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402', scanUrl: 'https://tokensniffer.com' }],
    explorers: [{ label: 'Subscan', url: 'https://polkadot.subscan.io' }, { label: 'Polkascan', url: 'https://polkascan.io' }],
    wallets: [{ label: 'Talisman', url: 'https://talisman.xyz', color: '#FF009B', abbr: 'T' }, { label: 'Nova Wallet', url: 'https://novawallet.io', color: '#E040FB', abbr: 'N' }, { label: 'Ledger', url: 'https://ledger.com', color: '#1D1D1B', abbr: 'L' }, { label: 'SubWallet', url: 'https://subwallet.app', color: '#4CAF50', abbr: 'S' }],
    tags: ['Layer 0', 'Parachain', 'Interoperability', 'PoS'],
    ath: { price: '$55.00', rawPrice: 55, date: 'Nov 04, 2021', ago: 'over 3 years' },
    atl: { price: '$2.69', rawPrice: 2.69, date: 'Aug 20, 2020', ago: 'over 4 years' },
    range7d: { low: '$3.82', high: '$4.61' },
    videoUrl: 'https://www.youtube.com/results?search_query=polkadot+dot+explained',
    ucid: 6636,
    rating: 4.1,
    rank: 14,
  },
  AVAX: {
    website: 'https://avax.network', websiteLabel: 'avax.network',
    whitepaper: 'https://www.avalabs.org/whitepapers', whitepaperLabel: 'Whitepaper',
    explorer: 'https://snowtrace.io', explorerLabel: 'snowtrace.io',
    socials: { twitter: 'https://twitter.com/avax', reddit: 'https://reddit.com/r/avax', github: 'https://github.com/ava-labs', discord: 'https://chat.avax.network', telegram: 'https://t.me/avalancheavax' },
    contracts: [{ address: '0x1CE0c2827e2eF14D5C4f29a091d735A204794041', chain: 'BNB', chainColor: '#F0B90B', auditUrl: 'https://bscscan.com/token/0x1CE0c2827e2eF14D5C4f29a091d735A204794041', scanUrl: 'https://tokensniffer.com' }],
    explorers: [{ label: 'Snowtrace', url: 'https://snowtrace.io' }, { label: 'AvaScan', url: 'https://avascan.info' }],
    wallets: [{ label: 'Core Wallet', url: 'https://core.app', color: '#E84142', abbr: 'C' }, { label: 'MetaMask', url: 'https://metamask.io', color: '#E88B2E', abbr: 'M' }, { label: 'Trust Wallet', url: 'https://trustwallet.com', color: '#3375BB', abbr: 'T' }, { label: 'Ledger', url: 'https://ledger.com', color: '#1D1D1B', abbr: 'L' }],
    tags: ['Layer 1', 'PoS', 'Smart Contracts', 'Subnets', 'DeFi'],
    ath: { price: '$144.96', rawPrice: 144.96, date: 'Nov 21, 2021', ago: 'over 3 years' },
    atl: { price: '$2.80', rawPrice: 2.8, date: 'Dec 31, 2020', ago: 'over 4 years' },
    range7d: { low: '$16.42', high: '$21.38' },
    videoUrl: 'https://www.youtube.com/results?search_query=avalanche+avax+explained',
    ucid: 5805,
    rating: 4.2,
    rank: 12,
  },
  LINK: {
    website: 'https://chain.link', websiteLabel: 'chain.link',
    whitepaper: 'https://link.smartcontract.com/whitepaper', whitepaperLabel: 'Whitepaper',
    explorer: 'https://etherscan.io/token/0x514910771af9ca656af840dff83e8264ecf986ca', explorerLabel: 'etherscan.io',
    socials: { twitter: 'https://twitter.com/chainlink', reddit: 'https://reddit.com/r/Chainlink', github: 'https://github.com/smartcontractkit/chainlink', discord: 'https://discord.com/invite/chainlink', telegram: 'https://t.me/chainlinkofficial' },
    contracts: [{ address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', chain: 'ETH', chainColor: '#627EEA', auditUrl: 'https://etherscan.io/token/0x514910771af9ca656af840dff83e8264ecf986ca', scanUrl: 'https://tokensniffer.com' }],
    explorers: [{ label: 'Etherscan', url: 'https://etherscan.io/token/0x514910771af9ca656af840dff83e8264ecf986ca' }],
    wallets: [{ label: 'MetaMask', url: 'https://metamask.io', color: '#E88B2E', abbr: 'M' }, { label: 'Trust Wallet', url: 'https://trustwallet.com', color: '#3375BB', abbr: 'T' }, { label: 'Ledger', url: 'https://ledger.com', color: '#1D1D1B', abbr: 'L' }, { label: 'Coinbase Wallet', url: 'https://wallet.coinbase.com', color: '#0052FF', abbr: 'C' }],
    tags: ['Oracle', 'DeFi', 'ERC-20', 'Infrastructure', 'Web3'],
    ath: { price: '$52.88', rawPrice: 52.88, date: 'May 10, 2021', ago: 'almost 4 years' },
    atl: { price: '$0.148', rawPrice: 0.148, date: 'Sep 23, 2017', ago: 'over 7 years' },
    range7d: { low: '$11.24', high: '$14.62' },
    videoUrl: 'https://www.youtube.com/results?search_query=chainlink+link+explained',
    ucid: 1975,
    rating: 4.3,
    rank: 16,
  },
  MATIC: {
    website: 'https://polygon.technology', websiteLabel: 'polygon.technology',
    whitepaper: 'https://polygon.technology/papers/pol-whitepaper', whitepaperLabel: 'Whitepaper',
    explorer: 'https://polygonscan.com', explorerLabel: 'polygonscan.com',
    socials: { twitter: 'https://twitter.com/0xPolygon', reddit: 'https://reddit.com/r/0xPolygon', github: 'https://github.com/maticnetwork', discord: 'https://discord.com/invite/polygon', telegram: 'https://t.me/polygonofficial' },
    contracts: [{ address: '0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', chain: 'ETH', chainColor: '#627EEA', auditUrl: 'https://etherscan.io/token/0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0', scanUrl: 'https://tokensniffer.com' }],
    explorers: [{ label: 'Polygonscan', url: 'https://polygonscan.com' }, { label: 'OKLink', url: 'https://www.oklink.com/polygon' }],
    wallets: [{ label: 'MetaMask', url: 'https://metamask.io', color: '#E88B2E', abbr: 'M' }, { label: 'Trust Wallet', url: 'https://trustwallet.com', color: '#3375BB', abbr: 'T' }, { label: 'Ledger', url: 'https://ledger.com', color: '#1D1D1B', abbr: 'L' }, { label: 'Coinbase Wallet', url: 'https://wallet.coinbase.com', color: '#0052FF', abbr: 'C' }],
    tags: ['Layer 2', 'Ethereum', 'DeFi', 'NFT', 'Scaling'],
    ath: { price: '$2.92', rawPrice: 2.92, date: 'Dec 27, 2021', ago: 'over 3 years' },
    atl: { price: '$0.00314', rawPrice: 0.00314, date: 'May 26, 2019', ago: 'almost 6 years' },
    range7d: { low: '$0.2214', high: '$0.2748' },
    videoUrl: 'https://www.youtube.com/results?search_query=polygon+matic+explained',
    ucid: 3890,
    rating: 4.0,
    rank: 20,
  },
  SHIB: {
    website: 'https://shibatoken.com', websiteLabel: 'shibatoken.com',
    whitepaper: 'https://github.com/shytoshikusama/woofpaper/raw/main/SHIB_WoofPaper_v2.pdf', whitepaperLabel: 'Woofpaper',
    explorer: 'https://etherscan.io/token/0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', explorerLabel: 'etherscan.io',
    socials: { twitter: 'https://twitter.com/Shibtoken', reddit: 'https://reddit.com/r/SHIBArmy', github: 'https://github.com/shytoshikusama', discord: 'https://discord.com/invite/shibatoken', telegram: 'https://t.me/ShibaInu_Dogetoken' },
    contracts: [{ address: '0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE', chain: 'ETH', chainColor: '#627EEA', auditUrl: 'https://etherscan.io/token/0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce', scanUrl: 'https://tokensniffer.com' }],
    explorers: [{ label: 'Etherscan', url: 'https://etherscan.io/token/0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce' }],
    wallets: [{ label: 'MetaMask', url: 'https://metamask.io', color: '#E88B2E', abbr: 'M' }, { label: 'Trust Wallet', url: 'https://trustwallet.com', color: '#3375BB', abbr: 'T' }, { label: 'Coinbase Wallet', url: 'https://wallet.coinbase.com', color: '#0052FF', abbr: 'C' }, { label: 'Ledger', url: 'https://ledger.com', color: '#1D1D1B', abbr: 'L' }],
    tags: ['Meme', 'ERC-20', 'DeFi', 'Community', 'Dog Coin'],
    ath: { price: '$0.00008845', rawPrice: 0.00008845, date: 'Oct 28, 2021', ago: 'over 3 years' },
    atl: { price: '$0.0000000000559', rawPrice: 0.0000000000559, date: 'Oct 01, 2020', ago: 'over 4 years' },
    range7d: { low: '$0.00001042', high: '$0.00001284' },
    videoUrl: 'https://www.youtube.com/results?search_query=shiba+inu+shib+explained',
    ucid: 5994,
    rating: 3.5,
    rank: 18,
  },
  LTC: {
    website: 'https://litecoin.org', websiteLabel: 'litecoin.org',
    whitepaper: 'https://litecoin.org/litecoin.pdf', whitepaperLabel: 'Whitepaper',
    explorer: 'https://blockchair.com/litecoin', explorerLabel: 'blockchair.com',
    socials: { twitter: 'https://twitter.com/LitecoinProject', reddit: 'https://reddit.com/r/litecoin', github: 'https://github.com/litecoin-project/litecoin', discord: 'https://discord.com/invite/ZTmojs8vnE' },
    contracts: [],
    explorers: [{ label: 'Blockchair', url: 'https://blockchair.com/litecoin' }, { label: 'Litecoinblockexplorer', url: 'https://litecoinblockexplorer.net' }],
    wallets: [{ label: 'Litewallet', url: 'https://litewallet.io', color: '#BFBBBB', abbr: 'L' }, { label: 'Trust Wallet', url: 'https://trustwallet.com', color: '#3375BB', abbr: 'T' }, { label: 'Ledger', url: 'https://ledger.com', color: '#1D1D1B', abbr: 'L' }, { label: 'Coinbase Wallet', url: 'https://wallet.coinbase.com', color: '#0052FF', abbr: 'C' }],
    tags: ['Layer 1', 'PoW', 'Payments', 'Mineable', 'Silver'],
    ath: { price: '$412.96', rawPrice: 412.96, date: 'May 10, 2021', ago: 'almost 4 years' },
    atl: { price: '$1.15', rawPrice: 1.15, date: 'Jan 14, 2015', ago: 'over 10 years' },
    range7d: { low: '$78.24', high: '$92.18' },
    videoUrl: 'https://www.youtube.com/results?search_query=litecoin+ltc+explained',
    ucid: 2,
    rating: 4.0,
    rank: 23,
  },
  UNI: {
    website: 'https://uniswap.org', websiteLabel: 'uniswap.org',
    whitepaper: 'https://uniswap.org/whitepaper-v3.pdf', whitepaperLabel: 'Whitepaper v3',
    explorer: 'https://etherscan.io/token/0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', explorerLabel: 'etherscan.io',
    socials: { twitter: 'https://twitter.com/Uniswap', reddit: 'https://reddit.com/r/UniSwap', github: 'https://github.com/Uniswap', discord: 'https://discord.com/invite/FCfyBSbCU5' },
    contracts: [{ address: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984', chain: 'ETH', chainColor: '#627EEA', auditUrl: 'https://etherscan.io/token/0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', scanUrl: 'https://tokensniffer.com' }],
    explorers: [{ label: 'Etherscan', url: 'https://etherscan.io/token/0x1f9840a85d5af5bf1d1762f925bdaddc4201f984' }],
    wallets: [{ label: 'MetaMask', url: 'https://metamask.io', color: '#E88B2E', abbr: 'M' }, { label: 'Trust Wallet', url: 'https://trustwallet.com', color: '#3375BB', abbr: 'T' }, { label: 'Coinbase Wallet', url: 'https://wallet.coinbase.com', color: '#0052FF', abbr: 'C' }, { label: 'Ledger', url: 'https://ledger.com', color: '#1D1D1B', abbr: 'L' }],
    tags: ['DEX', 'DeFi', 'ERC-20', 'Governance', 'AMM'],
    ath: { price: '$44.97', rawPrice: 44.97, date: 'May 03, 2021', ago: 'almost 4 years' },
    atl: { price: '$1.03', rawPrice: 1.03, date: 'Sep 17, 2020', ago: 'over 4 years' },
    range7d: { low: '$6.14', high: '$7.82' },
    videoUrl: 'https://www.youtube.com/results?search_query=uniswap+uni+explained',
    ucid: 7083,
    rating: 4.2,
    rank: 24,
  },
  ATOM: {
    website: 'https://cosmos.network', websiteLabel: 'cosmos.network',
    whitepaper: 'https://v1.cosmos.network/resources/whitepaper', whitepaperLabel: 'Whitepaper',
    explorer: 'https://www.mintscan.io/cosmos', explorerLabel: 'mintscan.io',
    socials: { twitter: 'https://twitter.com/cosmos', reddit: 'https://reddit.com/r/cosmosnetwork', github: 'https://github.com/cosmos', discord: 'https://discord.gg/cosmosnetwork', telegram: 'https://t.me/cosmosproject' },
    contracts: [{ address: '0x0EB3a705fc54725037CC9e008bDede697f62F335', chain: 'ETH', chainColor: '#627EEA', auditUrl: 'https://etherscan.io/token/0x0EB3a705fc54725037CC9e008bDede697f62F335', scanUrl: 'https://tokensniffer.com' }],
    explorers: [{ label: 'Mintscan', url: 'https://www.mintscan.io/cosmos' }, { label: 'ATOMScan', url: 'https://atomscan.com' }],
    wallets: [{ label: 'Keplr', url: 'https://keplr.app', color: '#6B4EFF', abbr: 'K' }, { label: 'Cosmostation', url: 'https://cosmostation.io', color: '#2460FA', abbr: 'C' }, { label: 'Ledger', url: 'https://ledger.com', color: '#1D1D1B', abbr: 'L' }, { label: 'Trust Wallet', url: 'https://trustwallet.com', color: '#3375BB', abbr: 'T' }],
    tags: ['Layer 0', 'IBC', 'Interoperability', 'PoS', 'Tendermint'],
    ath: { price: '$44.45', rawPrice: 44.45, date: 'Jan 17, 2022', ago: 'over 3 years' },
    atl: { price: '$1.13', rawPrice: 1.13, date: 'Feb 05, 2020', ago: 'over 5 years' },
    range7d: { low: '$3.82', high: '$4.94' },
    videoUrl: 'https://www.youtube.com/results?search_query=cosmos+atom+explained',
    ucid: 3794,
    rating: 4.1,
    rank: 22,
  },
};

const STOCK_META: Record<string, {
  website: string; websiteLabel: string;
  irPage: string;
  secFilings: string;
  tags: string[];
}> = {
  AAPL: { website: 'https://apple.com', websiteLabel: 'apple.com', irPage: 'https://investor.apple.com', secFilings: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=AAPL&type=10-K', tags: ['Technology', 'Consumer Electronics', 'S&P 500', 'Mega Cap'] },
  MSFT: { website: 'https://microsoft.com', websiteLabel: 'microsoft.com', irPage: 'https://www.microsoft.com/en-us/investor', secFilings: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=MSFT&type=10-K', tags: ['Technology', 'Cloud', 'S&P 500', 'AI'] },
  GOOGL: { website: 'https://alphabet.com', websiteLabel: 'alphabet.com', irPage: 'https://abc.xyz/investor/', secFilings: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=GOOGL&type=10-K', tags: ['Technology', 'Advertising', 'S&P 500', 'AI'] },
  TSLA: { website: 'https://tesla.com', websiteLabel: 'tesla.com', irPage: 'https://ir.tesla.com', secFilings: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=TSLA&type=10-K', tags: ['Automotive', 'EV', 'Energy', 'S&P 500'] },
  NVDA: { website: 'https://nvidia.com', websiteLabel: 'nvidia.com', irPage: 'https://investor.nvidia.com', secFilings: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=NVDA&type=10-K', tags: ['Technology', 'Semiconductors', 'AI', 'S&P 500'] },
  AMZN: { website: 'https://amazon.com', websiteLabel: 'amazon.com', irPage: 'https://ir.aboutamazon.com', secFilings: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=AMZN&type=10-K', tags: ['E-Commerce', 'Cloud', 'S&P 500', 'Mega Cap'] },
  META: { website: 'https://meta.com', websiteLabel: 'meta.com', irPage: 'https://investor.fb.com', secFilings: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=META&type=10-K', tags: ['Social Media', 'Advertising', 'S&P 500', 'AI'] },
  NFLX: { website: 'https://netflix.com', websiteLabel: 'netflix.com', irPage: 'https://ir.netflix.net', secFilings: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=NFLX&type=10-K', tags: ['Streaming', 'Entertainment', 'S&P 500', 'Content'] },
  AMD: { website: 'https://amd.com', websiteLabel: 'amd.com', irPage: 'https://ir.amd.com', secFilings: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=AMD&type=10-K', tags: ['Semiconductors', 'AI', 'Data Center', 'S&P 500'] },
  SPY: { website: 'https://www.ssga.com/us/en/individual/etfs/funds/spdr-sp-500-etf-trust-spy', websiteLabel: 'ssga.com', irPage: 'https://www.ssga.com/us/en/individual/etfs/funds/spdr-sp-500-etf-trust-spy', secFilings: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=SPY&type=N-1A', tags: ['ETF', 'S&P 500', 'Index Fund', 'SPDR'] },
  QQQ: { website: 'https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=Investor&ticker=QQQ', websiteLabel: 'invesco.com', irPage: 'https://www.invesco.com/us/financial-products/etfs/product-detail?audienceType=Investor&ticker=QQQ', secFilings: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=QQQ&type=N-1A', tags: ['ETF', 'Nasdaq-100', 'Index Fund', 'Tech'] },
  INTC: { website: 'https://intel.com', websiteLabel: 'intel.com', irPage: 'https://www.intc.com', secFilings: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=INTC&type=10-K', tags: ['Semiconductors', 'x86', 'S&P 500', 'Foundry'] },
  BA: { website: 'https://boeing.com', websiteLabel: 'boeing.com', irPage: 'https://investors.boeing.com', secFilings: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=BA&type=10-K', tags: ['Aerospace', 'Defense', 'S&P 500', 'Industrial'] },
  DIS: { website: 'https://thewaltdisneycompany.com', websiteLabel: 'disney.com', irPage: 'https://thewaltdisneycompany.com/investor-relations/', secFilings: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=DIS&type=10-K', tags: ['Entertainment', 'Streaming', 'S&P 500', 'Media'] },
  V: { website: 'https://usa.visa.com', websiteLabel: 'visa.com', irPage: 'https://investor.visa.com', secFilings: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=V&type=10-K', tags: ['Payments', 'Fintech', 'S&P 500', 'Mega Cap'] },
};

// ────────────────────────────────────────────────────────────────────────────

function fmt(v: number | null, style: 'currency' | 'compact' = 'compact'): string {
  if (v === null) return '—';
  if (style === 'currency') {
    if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6)  return `$${(v / 1e6).toFixed(2)}M`;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(v);
  }
  if (v >= 1e9)  return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6)  return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3)  return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(2);
}

const ROW = ({ label, value, change, hasArrow, tooltip }: { label: string; value: string; change?: number | null; hasArrow?: boolean; tooltip?: string }) => (
  <div className="flex items-center justify-between py-2.5" style={{ borderBottom: '1px solid #1B2236' }}>
    <span className="text-[12px] flex items-center gap-1" style={{ color: '#5A6478' }} title={tooltip}>
      {label} <Info className="w-3 h-3" style={{ color: '#5A6478' }} />
    </span>
    <div className="flex items-center gap-1.5">
      <span className="text-[13px] font-semibold text-white">{value}</span>
      {change !== undefined && change !== null && (
        <span className="text-[11px] font-bold" style={{ color: change >= 0 ? '#00C853' : '#FF3D3D' }}>
          {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
        </span>
      )}
      {hasArrow && <ChevronRight className="w-3.5 h-3.5" style={{ color: '#5A6478' }} />}
    </div>
  </div>
);

interface AssetInfoPanelProps {
  asset: string;
  onAskAI?: () => void;
}

export const AssetInfoPanel: React.FC<AssetInfoPanelProps> = ({ asset, onAskAI }) => {
  const [price,     setPrice]     = useState<number | null>(null);
  const [change,    setChange]    = useState<number | null>(null);
  const [marketCap, setMarketCap] = useState<number | null>(null);
  const [volume,    setVolume]    = useState<number | null>(null);
  const [supply,    setSupply]    = useState<number | null>(null);
  const [maxSupply, setMaxSupply] = useState<number | null>(null);
  const [low24h,    setLow24h]    = useState<number | null>(null);
  const [high24h,   setHigh24h]   = useState<number | null>(null);

  // UI state
  const [isWatchlisted, setIsWatchlisted] = useState(() => {
    try { return (JSON.parse(localStorage.getItem('watchlist') || '[]') as string[]).includes(asset); }
    catch { return false; }
  });
  const [cryptoAmt, setCryptoAmt] = useState('1');
  const [usdAmt, setUsdAmt]       = useState('');
  const [activeTags, setActiveTags] = useState<string[]>([]);

  // Links section state
  const [explorerOpen, setExplorerOpen]   = useState(false);
  const [contractOpen, setContractOpen]   = useState(false);
  const [copiedUcid,   setCopiedUcid]     = useState(false);
  const [copiedContract, setCopiedContract] = useState<string | null>(null);

  const assetInfo = [...CRYPTO_ASSETS, ...STOCK_ASSETS].find(a => a.symbol === asset);
  const assetName = assetInfo?.name || asset;
  const isCrypto  = isCryptoAsset(asset);
  const meta      = isCrypto ? (ASSET_META[asset] ?? null) : null;
  const stockMeta = !isCrypto ? (STOCK_META[asset]) : null;
  const rank      = meta?.rank ?? 1;

  // ── Live price feed ──────────────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        if (isCrypto) {
          const [b, c] = await Promise.allSettled([
            fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${asset}USDT`).then(r => r.json()),
            fetch('https://api.coinlore.net/api/tickers/').then(r => r.json()),
          ]);
          if (b.status === 'fulfilled' && live) {
            setPrice(parseFloat(b.value.lastPrice));
            setChange(parseFloat(b.value.priceChangePercent));
            setVolume(parseFloat(b.value.quoteVolume));
            setLow24h(parseFloat(b.value.lowPrice));
            setHigh24h(parseFloat(b.value.highPrice));
          }
          if (c.status === 'fulfilled' && live) {
            const coin = c.value.data?.find((x: any) => x.symbol === asset);
            if (coin) {
              setMarketCap(parseFloat(coin.market_cap_usd));
              setSupply(parseFloat(coin.csupply));
              setMaxSupply(parseFloat(coin.tsupply));
            }
          }
        } else {
          const r = await fetch(`/api/quote?symbols=${asset}`);
          const d = await r.json();
          const q = d.quoteResponse?.result?.[0];
          if (q && live) {
            setPrice(q.regularMarketPrice);
            setChange(q.regularMarketChangePercent);
            setMarketCap(q.marketCap);
            setVolume(q.regularMarketVolume);
            setLow24h(q.regularMarketDayLow);
            setHigh24h(q.regularMarketDayHigh);
          }
        }
      } catch { /* silent */ }
    };
    load();
    const iv = setInterval(load, 12000);
    return () => { live = false; clearInterval(iv); };
  }, [asset, isCrypto]);

  // ── Converter sync ───────────────────────────────────────────────────────
  useEffect(() => {
    if (price !== null && cryptoAmt !== '') {
      const n = parseFloat(cryptoAmt);
      if (!isNaN(n)) setUsdAmt((n * price).toFixed(2));
    }
  }, [price]);

  const handleCryptoChange = useCallback((val: string) => {
    setCryptoAmt(val);
    if (price !== null) {
      const n = parseFloat(val);
      setUsdAmt(!isNaN(n) && val !== '' ? (n * price).toFixed(2) : '');
    }
  }, [price]);

  const handleUsdChange = useCallback((val: string) => {
    setUsdAmt(val);
    if (price !== null && price > 0) {
      const n = parseFloat(val);
      setCryptoAmt(!isNaN(n) && val !== '' ? (n / price).toFixed(price < 1 ? 4 : 8) : '');
    }
  }, [price]);

  // ── Watchlist ────────────────────────────────────────────────────────────
  const toggleWatchlist = () => {
    const wl: string[] = JSON.parse(localStorage.getItem('watchlist') || '[]');
    const next = isWatchlisted ? wl.filter(s => s !== asset) : [...wl, asset];
    localStorage.setItem('watchlist', JSON.stringify(next));
    setIsWatchlisted(!isWatchlisted);
  };

  // ── Tag toggle ───────────────────────────────────────────────────────────
  const toggleTag = (tag: string) => {
    setActiveTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  };

  const priceStr = price !== null
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: price < 1 ? 4 : 2, maximumFractionDigits: price < 1 ? 6 : 2 }).format(price)
    : '...';
  const positive  = (change ?? 0) >= 0;
  const fdv       = price && maxSupply ? price * maxSupply : null;
  const volMktCap = volume && marketCap ? (volume / marketCap) * 100 : null;
  const tags      = meta?.tags ?? stockMeta ? (stockMeta?.tags ?? []) : [];

  // coin gradient per asset
  const coinGradient: Record<string, string> = {
    BTC: 'linear-gradient(135deg,#F7931A,#FFCD00)',
    ETH: 'linear-gradient(135deg,#627EEA,#A4B8F5)',
    BNB: 'linear-gradient(135deg,#F0B90B,#F8D06B)',
    SOL: 'linear-gradient(135deg,#9945FF,#14F195)',
    XRP: 'linear-gradient(135deg,#346AA9,#6BAED6)',
    DOGE: 'linear-gradient(135deg,#C2A633,#F5D564)',
    ADA: 'linear-gradient(135deg,#0033AD,#4A9FFF)',
  };
  const gradient = coinGradient[asset] ?? 'linear-gradient(135deg,#2962FF,#7C3AED)';

  // ── Star rating renderer ─────────────────────────────────────────────────
  const renderStars = (rating: number) => {
    const stars = [];
    for (let i = 1; i <= 5; i++) {
      const filled = i <= Math.floor(rating);
      const half   = !filled && i === Math.ceil(rating) && rating % 1 >= 0.5;
      stars.push(
        <span key={i} style={{ color: filled || half ? '#F59E0B' : '#2A3347', fontSize: 13 }}>
          {filled ? '★' : half ? '⯨' : '★'}
        </span>
      );
    }
    return stars;
  };

  // pill button style
  const pillStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 8px', borderRadius: 8, fontSize: 12,
    background: '#0E1320', border: '1px solid #1B2236', color: '#C4CDD8',
    cursor: 'pointer', textDecoration: 'none', whiteSpace: 'nowrap',
  };

  const linkRowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    borderBottom: '1px solid #1B2236', paddingTop: 10, paddingBottom: 10,
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12, color: '#5A6478', minWidth: 80, flexShrink: 0,
  };

  const iconBtnStyle = (bgColor: string): React.CSSProperties => ({
    width: 28, height: 28, borderRadius: '50%', border: '1px solid #1B2236',
    background: '#0E1320', color: '#C4CDD8', display: 'flex', alignItems: 'center',
    justifyContent: 'center', cursor: 'pointer', flexShrink: 0,
    transition: 'background 0.15s, border-color 0.15s',
    // store color for hover via data attr — handled inline
  });

  return (
    <div className="w-[320px] shrink-0 flex flex-col h-full"
      style={{ background: '#0B0E14', borderRight: '1px solid #1B2236' }}>
      <style>{`.aip::-webkit-scrollbar{display:none}`}</style>

      <div className="aip overflow-y-auto h-full" style={{ scrollbarWidth: 'none' }}>

        {/* ── HEADER ── */}
        <div className="px-4 pt-5 pb-4" style={{ borderBottom: '1px solid #1B2236' }}>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center font-black text-white text-sm shrink-0"
              style={{ background: gradient }}>
              {asset.charAt(0)}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[16px] font-bold text-white">{assetName}</span>
              <span className="text-[12px] font-bold px-1.5 py-0.5 rounded" style={{ color: '#5A6478', background: '#0E1320' }}>{asset}</span>
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ color: '#5A6478', background: '#0E1320' }}>#{rank}</span>
            </div>
          </div>

          {/* Watchlist toggle */}
          <button
            onClick={toggleWatchlist}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-all"
            style={{
              color: isWatchlisted ? '#F6B87E' : '#5A6478',
              background: isWatchlisted ? 'rgba(246,184,126,0.12)' : '#0E1320',
              border: `1px solid ${isWatchlisted ? 'rgba(246,184,126,0.3)' : '#1B2236'}`,
            }}
          >
            <Star className="w-3.5 h-3.5" fill={isWatchlisted ? '#F6B87E' : 'none'} stroke={isWatchlisted ? '#F6B87E' : '#5A6478'} />
            {isWatchlisted ? 'Watchlisted' : 'Add to Watchlist'}
          </button>

          {/* Price */}
          <div className="flex items-baseline gap-2 mt-3">
            <span className="text-[28px] font-bold text-white">{priceStr}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[13px] font-bold px-2 py-0.5 rounded-lg"
              style={{
                color: positive ? '#00C853' : '#FF3D3D',
                background: positive ? 'rgba(0,200,83,0.12)' : 'rgba(255,61,61,0.12)',
              }}>
              {positive ? '▲' : '▼'} {Math.abs(change ?? 0).toFixed(2)}% (24h)
            </span>
          </div>
        </div>

        {/* ── STATS ── */}
        <div className="px-4 py-1">
          <ROW label="Market cap"        value={fmt(marketCap, 'currency')} change={change}  tooltip="Total market value" />
          <ROW label="Volume (24h)"      value={fmt(volume, 'currency')}    change={-18.08}  hasArrow tooltip="24-hour trading volume" />
          <ROW label="Vol/Mkt Cap (24h)" value={volMktCap ? `${volMktCap.toFixed(2)}%` : '—'} tooltip="Volume / Market Cap ratio" />
          <ROW label="FDV"               value={fmt(fdv, 'currency')}       hasArrow         tooltip="Fully Diluted Valuation" />

          {isCrypto && (
            <>
              <div style={{ borderBottom: '1px solid #1B2236' }} className="py-2">
                <div className="grid grid-cols-2 gap-x-4">
                  <div className="py-1.5">
                    <div className="text-[11px] flex items-center gap-1 mb-0.5" style={{ color: '#5A6478' }}>
                      Total supply <Info className="w-3 h-3" style={{ color: '#5A6478' }} />
                    </div>
                    <div className="text-[13px] font-semibold text-white">
                      {supply ? `${fmt(supply)} ${asset}` : '—'}
                    </div>
                  </div>
                  <div className="py-1.5">
                    <div className="text-[11px] flex items-center gap-1 mb-0.5" style={{ color: '#5A6478' }}>
                      Max. supply <Info className="w-3 h-3" style={{ color: '#5A6478' }} />
                    </div>
                    <div className="text-[13px] font-semibold text-white">
                      {maxSupply ? `${fmt(maxSupply)} ${asset}` : '∞'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="py-2.5 flex items-center justify-between" style={{ borderBottom: '1px solid #1B2236' }}>
                <span className="text-[12px] flex items-center gap-1" style={{ color: '#5A6478' }}>
                  Circulating supply <Info className="w-3 h-3" style={{ color: '#5A6478' }} />
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-semibold text-white">
                    {supply ? `${fmt(supply)} ${asset}` : '—'}
                  </span>
                  <CheckCircle2 className="w-4 h-4" style={{ color: '#2962FF' }} />
                </div>
              </div>

              {/* Supply bar */}
              {supply && maxSupply && (
                <div className="py-2.5" style={{ borderBottom: '1px solid #1B2236' }}>
                  <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: '#1B2236' }}>
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${Math.min(100, (supply / maxSupply) * 100)}%`,
                      background: 'linear-gradient(90deg, #2962FF, #5D8BFF)',
                    }} />
                  </div>
                  <div className="flex justify-between mt-1 text-[10px]" style={{ color: '#5A6478' }}>
                    <span>{((supply / maxSupply) * 100).toFixed(1)}% circulating</span>
                    <span>Max: {fmt(maxSupply)}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── AI BANNER ── */}
        <button
          onClick={onAskAI}
          className="mx-4 mt-3 mb-1 w-[calc(100%-32px)] rounded-xl px-3 py-2.5 flex items-center gap-2.5 transition-all text-left"
          style={{ background: 'rgba(41,98,255,0.12)', border: '1px solid rgba(41,98,255,0.3)' }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(41,98,255,0.2)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'rgba(41,98,255,0.12)')}
        >
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'linear-gradient(135deg, #2962FF, #7C3AED)' }}>
            <span className="text-white text-[10px] font-extrabold">AI</span>
          </div>
          <span className="text-[12px] font-semibold flex-1" style={{ color: '#A0AFFF' }}>
            Why is {asset}'s price moving today?
          </span>
          <ChevronRight className="w-4 h-4 shrink-0" style={{ color: '#2962FF' }} />
        </button>

        {/* ── COINBITES / VIDEO WIDGET ── */}
        {meta?.videoUrl && (
          <a
            href={meta.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-4 my-3 rounded-xl overflow-hidden flex items-center gap-3 p-3 transition-all"
            style={{ background: '#0E1320', border: '1px solid #1B2236', textDecoration: 'none' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#2962FF')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#1B2236')}
          >
            <div className="w-16 h-12 rounded-lg flex items-center justify-center shrink-0 relative overflow-hidden"
              style={{ background: gradient }}>
              <Play className="w-5 h-5 text-white" fill="white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white" style={{ background: '#2962FF' }}>VIDEO</span>
                <span className="text-[10px] font-bold" style={{ color: '#5A6478' }}>YouTube</span>
              </div>
              <div className="text-[12px] font-semibold leading-tight text-white truncate">
                {assetName}: Learn &amp; Explore
              </div>
              <div className="text-[10px] mt-0.5" style={{ color: '#5A6478' }}>Opens YouTube search</div>
            </div>
            <ExternalLink className="w-3.5 h-3.5 shrink-0" style={{ color: '#5A6478' }} />
          </a>
        )}

        {/* ── LINKS ── */}
        <div className="px-4 py-3" style={{ borderTop: '1px solid #1B2236' }}>
          <div className="text-[11px] font-bold uppercase tracking-wider mb-1" style={{ color: '#5A6478' }}>Links</div>

          {isCrypto && meta ? (
            <>
              {/* Website row */}
              <div style={linkRowStyle}>
                <span style={labelStyle}>Website</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <a href={meta.website} target="_blank" rel="noopener noreferrer" style={pillStyle}>
                    <Globe className="w-3.5 h-3.5" /> {meta.websiteLabel}
                  </a>
                  <a href={meta.whitepaper} target="_blank" rel="noopener noreferrer" style={pillStyle}>
                    <FileText className="w-3.5 h-3.5" /> {meta.whitepaperLabel}
                  </a>
                </div>
              </div>

              {/* Socials row */}
              <div style={linkRowStyle}>
                <span style={labelStyle}>Socials</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {meta.socials.twitter && (
                    <a
                      href={meta.socials.twitter}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="X / Twitter"
                      style={iconBtnStyle('#1DA1F2')}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(29,161,242,0.18)'; (e.currentTarget as HTMLElement).style.borderColor = '#1DA1F2'; (e.currentTarget as HTMLElement).style.color = '#1DA1F2'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#0E1320'; (e.currentTarget as HTMLElement).style.borderColor = '#1B2236'; (e.currentTarget as HTMLElement).style.color = '#C4CDD8'; }}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.747l7.73-8.835L1.254 2.25H8.08l4.259 5.63zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                    </a>
                  )}
                  {meta.socials.reddit && (
                    <a
                      href={meta.socials.reddit}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Reddit"
                      style={iconBtnStyle('#FF4500')}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,69,0,0.18)'; (e.currentTarget as HTMLElement).style.borderColor = '#FF4500'; (e.currentTarget as HTMLElement).style.color = '#FF4500'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#0E1320'; (e.currentTarget as HTMLElement).style.borderColor = '#1B2236'; (e.currentTarget as HTMLElement).style.color = '#C4CDD8'; }}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                        <path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/>
                      </svg>
                    </a>
                  )}
                  {meta.socials.github && (
                    <a
                      href={meta.socials.github}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="GitHub"
                      style={iconBtnStyle('#6E6E6E')}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(110,110,110,0.22)'; (e.currentTarget as HTMLElement).style.borderColor = '#8B8B8B'; (e.currentTarget as HTMLElement).style.color = '#FFFFFF'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#0E1320'; (e.currentTarget as HTMLElement).style.borderColor = '#1B2236'; (e.currentTarget as HTMLElement).style.color = '#C4CDD8'; }}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
                      </svg>
                    </a>
                  )}
                  {meta.socials.discord && (
                    <a
                      href={meta.socials.discord}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Discord"
                      style={iconBtnStyle('#5865F2')}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(88,101,242,0.18)'; (e.currentTarget as HTMLElement).style.borderColor = '#5865F2'; (e.currentTarget as HTMLElement).style.color = '#5865F2'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#0E1320'; (e.currentTarget as HTMLElement).style.borderColor = '#1B2236'; (e.currentTarget as HTMLElement).style.color = '#C4CDD8'; }}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.031.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                      </svg>
                    </a>
                  )}
                  {meta.socials.telegram && (
                    <a
                      href={meta.socials.telegram}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Telegram"
                      style={iconBtnStyle('#2AABEE')}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(42,171,238,0.18)'; (e.currentTarget as HTMLElement).style.borderColor = '#2AABEE'; (e.currentTarget as HTMLElement).style.color = '#2AABEE'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#0E1320'; (e.currentTarget as HTMLElement).style.borderColor = '#1B2236'; (e.currentTarget as HTMLElement).style.color = '#C4CDD8'; }}
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-3.5 h-3.5">
                        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                      </svg>
                    </a>
                  )}
                </div>
              </div>

              {/* Contracts row */}
              {meta.contracts.length > 0 && (
                <div style={{ ...linkRowStyle, flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <span style={labelStyle}>Contracts</span>
                    {meta.contracts.length > 1 && (
                      <button
                        onClick={() => setContractOpen(o => !o)}
                        style={{ ...pillStyle, gap: 4 }}
                      >
                        {contractOpen ? 'Less' : `+${meta.contracts.length - 1} more`}
                        <ChevronDown className="w-3 h-3" style={{ transform: contractOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                      </button>
                    )}
                  </div>
                  {(contractOpen ? meta.contracts : meta.contracts.slice(0, 1)).map((c) => (
                    <div key={c.address} style={{ display: 'flex', alignItems: 'center', gap: 5, width: '100%' }}>
                      {/* Chain color dot + name */}
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.chainColor, flexShrink: 0, display: 'inline-block' }} />
                      <span style={{ fontSize: 10, color: c.chainColor, fontWeight: 700, flexShrink: 0 }}>{c.chain}</span>
                      <span style={{ fontSize: 11, color: '#C4CDD8', fontFamily: 'monospace', flexShrink: 0 }}>
                        {c.address.slice(0, 6)}...{c.address.slice(-4)}
                      </span>
                      {/* Copy button */}
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(c.address).then(() => {
                            setCopiedContract(c.address);
                            setTimeout(() => setCopiedContract(null), 2000);
                          });
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: copiedContract === c.address ? '#00C853' : '#5A6478', display: 'flex', alignItems: 'center' }}
                        title="Copy address"
                      >
                        {copiedContract === c.address ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      </button>
                      {/* Audit badge */}
                      {c.auditUrl && (
                        <a href={c.auditUrl} target="_blank" rel="noopener noreferrer" title="View on block explorer" style={{ color: '#00C853', display: 'flex', alignItems: 'center' }}>
                          <Shield className="w-3 h-3" />
                        </a>
                      )}
                      {/* Scanner link */}
                      {c.scanUrl && (
                        <a href={c.scanUrl} target="_blank" rel="noopener noreferrer" title="Token scanner" style={{ color: '#5A6478', display: 'flex', alignItems: 'center' }}>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Rating row */}
              <div style={linkRowStyle}>
                <span style={labelStyle}>Rating</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ display: 'flex', gap: 1 }}>{renderStars(meta.rating)}</span>
                  <span style={{ fontSize: 12, color: '#C4CDD8', fontWeight: 600 }}>{meta.rating.toFixed(1)}</span>
                  <ChevronDown className="w-3 h-3" style={{ color: '#5A6478' }} />
                </div>
              </div>

              {/* Explorers row */}
              <div style={{ ...linkRowStyle, position: 'relative' }}>
                <span style={labelStyle}>Explorers</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
                  {meta.explorers[0] && (
                    <a href={meta.explorers[0].url} target="_blank" rel="noopener noreferrer" style={pillStyle}>
                      <ExternalLink className="w-3 h-3" /> {meta.explorers[0].label}
                    </a>
                  )}
                  {meta.explorers.length > 1 && (
                    <div style={{ position: 'relative' }}>
                      <button
                        onClick={() => setExplorerOpen(o => !o)}
                        style={{ ...pillStyle, gap: 4 }}
                      >
                        <ChevronDown className="w-3 h-3" style={{ transform: explorerOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                      </button>
                      {explorerOpen && (
                        <div style={{
                          position: 'absolute', right: 0, top: '110%', zIndex: 50,
                          background: '#131929', border: '1px solid #1B2236', borderRadius: 8,
                          minWidth: 160, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', overflow: 'hidden',
                        }}>
                          {meta.explorers.map((exp) => (
                            <a
                              key={exp.label}
                              href={exp.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '8px 12px', fontSize: 12, color: '#C4CDD8',
                                textDecoration: 'none', borderBottom: '1px solid #1B2236',
                              }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1B2236'; (e.currentTarget as HTMLElement).style.color = '#FFFFFF'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.color = '#C4CDD8'; }}
                            >
                              <ExternalLink className="w-3 h-3" style={{ flexShrink: 0 }} /> {exp.label}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Wallets row */}
              <div style={linkRowStyle}>
                <span style={labelStyle}>Wallets</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {meta.wallets.map((w) => (
                    <a
                      key={w.label}
                      href={w.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={w.label}
                      style={{
                        width: 28, height: 28, borderRadius: '50%',
                        background: w.color, color: '#FFFFFF',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 800, textDecoration: 'none', flexShrink: 0,
                        border: '1px solid rgba(255,255,255,0.12)',
                        transition: 'opacity 0.15s, transform 0.15s',
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '0.8'; (e.currentTarget as HTMLElement).style.transform = 'scale(1.1)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                    >
                      {w.abbr}
                    </a>
                  ))}
                </div>
              </div>

              {/* UCID row */}
              <div style={{ ...linkRowStyle, borderBottom: 'none' }}>
                <span style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 4 }}>
                  UCID <Info className="w-3 h-3" style={{ color: '#5A6478' }} />
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#C4CDD8', fontFamily: 'monospace' }}>{meta.ucid}</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(String(meta.ucid)).then(() => {
                        setCopiedUcid(true);
                        setTimeout(() => setCopiedUcid(false), 2000);
                      });
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: copiedUcid ? '#00C853' : '#5A6478', display: 'flex', alignItems: 'center' }}
                    title="Copy UCID"
                  >
                    {copiedUcid ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </>
          ) : stockMeta ? (
            <div className="space-y-2.5">
              <LinkRow label="Website"    icon={<Globe className="w-3.5 h-3.5" />}        href={stockMeta.website}    display={stockMeta.websiteLabel} />
              <LinkRow label="Investor Relations" icon={<FileText className="w-3.5 h-3.5" />} href={stockMeta.irPage}  display="Investor Relations" />
              <LinkRow label="SEC Filings" icon={<ExternalLink className="w-3.5 h-3.5" />} href={stockMeta.secFilings} display="EDGAR" />
            </div>
          ) : null}
        </div>

        {/* ── CONVERTER ── */}
        <div className="px-4 py-3" style={{ borderTop: '1px solid #1B2236' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#5A6478' }}>
              {asset} ↔ USD Converter
            </div>
            <ArrowLeftRight className="w-3.5 h-3.5" style={{ color: '#5A6478' }} />
          </div>
          <div className="space-y-2">
            {/* Crypto input */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all"
              style={{ background: '#0E1320', border: '1px solid #1B2236' }}
              onFocus={() => {}} >
              <span className="text-[12px] font-bold w-10 shrink-0" style={{ color: gradient.includes('F7931A') ? '#F7931A' : '#00C853' }}>{asset}</span>
              <input
                type="number"
                min="0"
                value={cryptoAmt}
                onChange={e => handleCryptoChange(e.target.value)}
                className="flex-1 bg-transparent text-right font-bold text-[14px] focus:outline-none text-white"
                placeholder="0"
                style={{ appearance: 'none' }}
              />
            </div>
            {/* USD input */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl transition-all"
              style={{ background: '#0E1320', border: '1px solid #1B2236' }}>
              <span className="text-[12px] font-bold w-10 shrink-0" style={{ color: '#2962FF' }}>USD</span>
              <input
                type="number"
                min="0"
                value={usdAmt}
                onChange={e => handleUsdChange(e.target.value)}
                className="flex-1 bg-transparent text-right font-bold text-[14px] focus:outline-none text-white"
                placeholder="0"
                style={{ appearance: 'none' }}
              />
            </div>
          </div>
          {price && (
            <div className="text-[11px] mt-2 text-right" style={{ color: '#5A6478' }}>
              1 {asset} = {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: price < 1 ? 6 : 2 }).format(price)}
            </div>
          )}
        </div>

        {/* ── PRICE PERFORMANCE ── */}
        <div className="px-4 py-3" style={{ borderTop: '1px solid #1B2236' }}>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#5A6478' }}>Price Performance</div>
            <div className="flex items-center gap-0.5 rounded-lg p-0.5" style={{ background: '#0E1320' }}>
              {(['24h', '7D', '30D'] as const).map(p => (
                <button key={p}
                  className="px-2 py-0.5 text-[11px] font-bold rounded-md transition-all"
                  style={{ color: '#5A6478', background: 'transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1B2236')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-between text-[11px] mb-1" style={{ color: '#5A6478' }}>
            <span>Low</span><span>High</span>
          </div>
          <div className="flex justify-between text-[13px] font-semibold mb-2 text-white">
            <span>${low24h ? low24h.toLocaleString('en-US', { maximumFractionDigits: low24h < 1 ? 4 : 0 }) : '—'}</span>
            <span>${high24h ? high24h.toLocaleString('en-US', { maximumFractionDigits: high24h < 1 ? 4 : 0 }) : '—'}</span>
          </div>
          <div className="h-2 w-full rounded-full overflow-hidden relative" style={{ background: '#1B2236' }}>
            {low24h && high24h && price && high24h > low24h && (
              <div className="absolute h-full rounded-full"
                style={{
                  left: 0,
                  width: `${Math.min(100, ((price - low24h) / (high24h - low24h)) * 100)}%`,
                  background: 'linear-gradient(90deg, rgba(41,98,255,0.4), #2962FF)',
                }} />
            )}
          </div>

        </div>

        {/* ── HISTORICAL PRICE ── */}
        {meta && (
          <div className="px-4 py-3" style={{ borderTop: '1px solid #1B2236' }}>
            <div className="text-[11px] font-bold uppercase tracking-wider mb-3" style={{ color: '#5A6478' }}>
              {asset} Historical Price
            </div>

            {/* 24h Range */}
            <div className="flex items-center justify-between py-2.5" style={{ borderBottom: '1px solid #1B2236' }}>
              <span className="text-[12px]" style={{ color: '#5A6478' }}>24h Range</span>
              <span className="text-[13px] font-semibold text-white">
                {low24h ? `$${low24h.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: low24h < 1 ? 4 : 2 })}` : '—'}
                {' — '}
                {high24h ? `$${high24h.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: high24h < 1 ? 4 : 2 })}` : '—'}
              </span>
            </div>

            {/* 7d Range */}
            <div className="flex items-center justify-between py-2.5" style={{ borderBottom: '1px solid #1B2236' }}>
              <span className="text-[12px]" style={{ color: '#5A6478' }}>7d Range</span>
              <span className="text-[13px] font-semibold text-white">{meta.range7d.low} — {meta.range7d.high}</span>
            </div>

            {/* All-Time High */}
            <div className="flex items-center justify-between py-2.5" style={{ borderBottom: '1px solid #1B2236' }}>
              <span className="text-[12px]" style={{ color: '#5A6478' }}>All-Time High</span>
              <div className="text-right">
                <div className="text-[13px] font-semibold text-white">{meta.ath.price}</div>
                <div className="text-[11px] flex items-center justify-end gap-1" style={{ color: '#FF3D3D' }}>
                  ▼ {price && meta.ath.rawPrice > 0 ? `${Math.abs(((price - meta.ath.rawPrice) / meta.ath.rawPrice) * 100).toFixed(1)}%` : '—'}
                  <span style={{ color: '#5A6478' }}>{meta.ath.date} ({meta.ath.ago})</span>
                </div>
              </div>
            </div>

            {/* All-Time Low */}
            <div className="flex items-center justify-between py-2.5">
              <span className="text-[12px]" style={{ color: '#5A6478' }}>All-Time Low</span>
              <div className="text-right">
                <div className="text-[13px] font-semibold text-white">{meta.atl.price}</div>
                <div className="text-[11px] flex items-center justify-end gap-1" style={{ color: '#00C853' }}>
                  ▲ {price && meta.atl.rawPrice > 0 ? `${(((price - meta.atl.rawPrice) / meta.atl.rawPrice) * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%` : '—'}
                  <span style={{ color: '#5A6478' }}>{meta.atl.date} ({meta.atl.ago})</span>
                </div>
              </div>
            </div>

            {/* Advertise banner */}
            <div className="mt-3 rounded-xl px-3 py-2.5 flex items-center justify-between gap-2"
              style={{ background: '#0E1320', border: '1px solid #1B2236' }}>
              <div>
                <div className="text-[12px] font-semibold text-white leading-tight">Now open to the community!</div>
                <div className="text-[11px]" style={{ color: '#5A6478' }}>Promote your token right here.</div>
                <a href="#" className="text-[11px] font-bold flex items-center gap-1 mt-0.5"
                  style={{ color: '#2962FF', textDecoration: 'none' }}
                  onMouseEnter={e => (e.currentTarget.style.textDecoration = 'underline')}
                  onMouseLeave={e => (e.currentTarget.style.textDecoration = 'none')}
                >
                  Advertise with us <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="text-3xl shrink-0 select-none">🐸</div>
            </div>
          </div>
        )}

        {/* ── TAGS ── */}
        {tags.length > 0 && (
          <div className="px-4 py-3" style={{ borderTop: '1px solid #1B2236' }}>
            <div className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: '#5A6478' }}>Tags</div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map(tag => {
                const active = activeTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className="px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer transition-all"
                    style={{
                      color: active ? '#FFFFFF' : '#5A6478',
                      background: active ? '#2962FF' : '#0E1320',
                      border: `1px solid ${active ? '#2962FF' : '#1B2236'}`,
                    }}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── OWNERSHIP ── */}
        <div className="mx-4 my-3 rounded-xl p-4" style={{ background: '#0E1320', border: '1px solid #1B2236' }}>
          <div className="text-[13px] font-bold mb-3 text-white">Do you own this project?</div>
          {[
            { icon: <Edit2 className="w-3.5 h-3.5" />,        label: 'Update Token Info',     href: 'https://coinmarketcap.com/request/' },
            { icon: <Unlock className="w-3.5 h-3.5" />,       label: 'Submit Token Unlocks',  href: 'https://coinmarketcap.com/request/' },
            { icon: <CheckCircle2 className="w-3.5 h-3.5" />, label: 'Claim Community Badge', href: 'https://coinmarketcap.com/request/' },
          ].map(({ icon, label, href }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-[12px] font-semibold w-full py-1.5 transition-all hover:underline"
              style={{ color: '#2962FF', textDecoration: 'none' }}
            >
              {icon} {label}
            </a>
          ))}
        </div>

        {/* ── COMMUNITY PRICE PREDICTION ── */}
        {isCrypto && <CommunityPrediction asset={asset} assetName={assetName} />}

      </div>
    </div>
  );
};

// ── Community price prediction widget ─────────────────────────────────────────
interface Prediction { price: string; votes: number; pct: number }
interface PredictionData { asset: string; label: string; month: string; totalVotes: number; predictions: Prediction[] }

const LEADERBOARD = [
  { symbol: 'KAS', icon: '🔷', bullPct: 88.4 },
  { symbol: 'FET', icon: '🤖', bullPct: 82.3 },
  { symbol: 'SUI', icon: '💧', bullPct: 82.3 },
  { symbol: 'TAO', icon: '🧠', bullPct: 79.1 },
  { symbol: 'INJ', icon: '⚡', bullPct: 76.8 },
];

function buildChartData(bullPct: number, n: number) {
  const now = new Date();
  let s = Math.max(30, Math.min(90, bullPct + (Math.random() * 16 - 8)));
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now); d.setDate(d.getDate() - (n - 1 - i));
    s = Math.max(30, Math.min(95, s + (Math.random() * 8 - 4)));
    return { date: `Mar ${d.getDate()}`, sentiment: Math.round(s), price: 70000 + Math.sin(i * 0.7) * 4500 + Math.random() * 1200 };
  });
}

function SentimentModal({ asset, assetName, data, onClose }: {
  asset: string; assetName: string; data: PredictionData; onClose: () => void;
}) {
  const [tab, setTab]     = useState<'7d'|'15d'|'30d'>('7d');
  const [lbTab, setLbTab] = useState<'bull'|'bear'>('bull');

  const bullVotes = data.predictions.slice(Math.ceil(data.predictions.length / 2)).reduce((s, p) => s + p.votes, 0);
  const bearVotes = data.predictions.slice(0, Math.floor(data.predictions.length / 2)).reduce((s, p) => s + p.votes, 0);
  const total     = bullVotes + bearVotes || 1;
  const bullPct   = Math.round((bullVotes / total) * 100);
  const bearPct   = 100 - bullPct;
  const n         = tab === '7d' ? 7 : tab === '15d' ? 15 : 30;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const chartData = useMemo(() => buildChartData(bullPct, n), [bullPct, tab]);
  const trend     = chartData.length > 1 ? Math.round(chartData[chartData.length-1].sentiment - chartData[0].sentiment) : 0;
  const name      = assetName.split(' ')[0];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.82)' }} onClick={onClose}>
      <div className="relative w-[900px] max-w-[96vw] rounded-2xl overflow-hidden flex flex-col"
        style={{ background: '#131722', border: '1px solid #2A3550', maxHeight: '90vh' }}
        onClick={e => e.stopPropagation()}>

        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid #1B2236' }}>
          <div className="text-[18px] font-bold text-white">Community sentiment</div>
          <button onClick={onClose} className="text-[20px] leading-none transition-opacity hover:opacity-60 text-white">×</button>
        </div>

        <div className="flex overflow-hidden" style={{ minHeight: 0 }}>
          {/* LEFT — chart */}
          <div className="flex-1 px-6 py-4 flex flex-col">
            {/* Time tabs */}
            <div className="flex gap-0 mb-4 rounded-xl overflow-hidden" style={{ background: '#0E1320', border: '1px solid #1B2236', width: 'fit-content' }}>
              {(['7d','15d','30d'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className="px-8 py-2 text-[13px] font-semibold transition-all"
                  style={{ background: tab === t ? '#1B2236' : 'transparent', color: tab === t ? '#fff' : '#5A6478' }}>{t}</button>
              ))}
            </div>

            {/* Chart */}
            <div className="flex-1" style={{ minHeight: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 60, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1B2236" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#5A6478' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="s" domain={[55, 90]} tick={{ fontSize: 11, fill: '#5A6478' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} width={40} />
                  <YAxis yAxisId="p" orientation="right" tick={{ fontSize: 11, fill: '#5A6478' }} axisLine={false} tickLine={false} tickFormatter={v => `$${(v/1000).toFixed(1)}K`} width={52} />
                  <Tooltip
                    contentStyle={{ background: '#0E1320', border: '1px solid #2A3550', borderRadius: 10, fontSize: 12 }}
                    labelStyle={{ color: '#8A92A6', marginBottom: 4 }}
                    formatter={(val: number, key: string) => key === 'sentiment' ? [`${val}%`, 'Sentiment'] : [`$${val.toLocaleString(undefined,{maximumFractionDigits:0})}`, 'Price']}
                  />
                  <Line yAxisId="p" type="monotone" dataKey="price" stroke="#FF6B6B" strokeWidth={2} dot={false} name="price" />
                  <Line yAxisId="s" type="monotone" dataKey="sentiment" stroke="#2962FF" strokeWidth={2.5} dot={false} name="sentiment" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-6 mt-3 text-[12px]" style={{ color: '#5A6478' }}>
              <span className="flex items-center gap-2"><span className="inline-block w-5 h-0.5 rounded" style={{ background: '#FF6B6B' }}/>{name} Price</span>
              <span className="flex items-center gap-2"><span className="inline-block w-5 h-0.5 rounded" style={{ background: '#2962FF' }}/>Community Sentiment</span>
            </div>
          </div>

          {/* RIGHT — stats */}
          <div className="w-[280px] shrink-0 px-5 py-4 overflow-y-auto" style={{ borderLeft: '1px solid #1B2236' }}>
            {/* Vote total */}
            <div className="text-[14px] font-bold text-white mb-3">Vote (Total)</div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[20px] font-black" style={{ color: '#00C853' }}>↗ {bullPct}%</span>
              <div className="flex-1 h-3 rounded-full overflow-hidden flex" style={{ background: '#1B2236' }}>
                <div style={{ width: `${bullPct}%`, background: 'linear-gradient(90deg,#00C853,#0BBF76)', transition: 'width 0.8s ease' }} />
                <div style={{ width: `${bearPct}%`, background: 'linear-gradient(90deg,#FF3D3D,#CC2222)', transition: 'width 0.8s ease' }} />
              </div>
              <span className="text-[20px] font-black" style={{ color: '#FF3D3D' }}>{bearPct}% ↘</span>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-2 mt-4 mb-5">
              {[
                { label: 'Trend (7d)', value: `${trend >= 0 ? '+' : ''}${trend}%`, color: trend >= 0 ? '#00C853' : '#FF3D3D' },
                { label: '# of Votes (24h)', value: `${data.totalVotes >= 1000 ? (data.totalVotes/1000).toFixed(1)+'K' : data.totalVotes} votes`, color: '#fff' },
              ].map(s => (
                <div key={s.label} className="rounded-xl px-3 py-3 text-center" style={{ background: '#0E1320', border: '1px solid #1B2236' }}>
                  <div className="text-[10px] mb-1" style={{ color: '#5A6478' }}>{s.label}</div>
                  <div className="text-[16px] font-black" style={{ color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Leaderboard */}
            <div className="text-[14px] font-bold text-white mb-2">Leaderboard (Top 100)</div>
            <div className="flex rounded-lg overflow-hidden mb-3" style={{ background: '#0E1320', border: '1px solid #1B2236' }}>
              {[['bull','Most Bullish'],['bear','Most Bearish']].map(([k,l]) => (
                <button key={k} onClick={() => setLbTab(k as 'bull'|'bear')}
                  className="flex-1 py-1.5 text-[11px] font-semibold transition-all"
                  style={{ background: lbTab === k ? '#1B2236' : 'transparent', color: lbTab === k ? '#fff' : '#5A6478' }}>{l}</button>
              ))}
            </div>
            <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1B2236' }}>
              <div className="grid grid-cols-3 px-3 py-2" style={{ borderBottom: '1px solid #1B2236' }}>
                <span className="text-[11px] font-bold" style={{ color: '#5A6478' }}>Name</span>
                <span className="text-[11px] font-bold text-center" style={{ color: '#5A6478' }}>Vote</span>
                <span className="text-[11px] font-bold text-right" style={{ color: '#00C853' }}>Bullish</span>
              </div>
              {LEADERBOARD.map(coin => {
                const b = lbTab === 'bull' ? coin.bullPct : 100 - coin.bullPct;
                return (
                  <div key={coin.symbol} className="grid grid-cols-3 items-center px-3 py-2.5" style={{ borderBottom: '1px solid #1B2236' }}>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[15px]">{coin.icon}</span>
                      <span className="text-[12px] font-bold text-white">{coin.symbol}</span>
                    </div>
                    <div className="flex items-center justify-center gap-1">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: '#00C85322', color: '#00C853', border: '1px solid #00C85440' }}>↗</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ background: '#FF3D3D22', color: '#FF3D3D', border: '1px solid #FF3D3D40' }}>↘</span>
                    </div>
                    <div className="text-right text-[13px] font-black" style={{ color: b >= 70 ? '#00C853' : b <= 40 ? '#FF3D3D' : '#F7931A' }}>{b.toFixed(1)}%</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CommunityPrediction({ asset, assetName }: { asset: string; assetName: string }) {
  const [data, setData]   = useState<PredictionData | null>(null);
  const [modal, setModal] = useState(false);
  const [selectedPred, setSelectedPred] = useState<number | null>(null);
  const [hoveredPred, setHoveredPred]   = useState<number | null>(null);

  const pm   = POLYMARKET_DATA[asset] ?? POLYMARKET_DATA.BTC;
  const name = assetName.split(' ')[0];

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(`/api/predictions/${asset}`);
      if (!res.ok) throw new Error('failed');
      setData(await res.json() as PredictionData);
    } catch { /* silent */ }
  }, [asset]);

  useEffect(() => {
    setData(null); setModal(false);
    fetchData();
  }, [asset, fetchData]);

  const maxPmPct = Math.max(...pm.predictions.map(p => p.pct), 1);

  // Derive bull/bear from vote data
  const bullVotes = data ? data.predictions.slice(Math.ceil(data.predictions.length / 2)).reduce((s, p) => s + p.votes, 0) : 0;
  const bearVotes = data ? data.predictions.slice(0, Math.floor(data.predictions.length / 2)).reduce((s, p) => s + p.votes, 0) : 0;
  const vTotal  = bullVotes + bearVotes || 1;
  const bullPct = Math.round((bullVotes / vTotal) * 100);
  const bearPct = 100 - bullPct;
  const totalVotesLabel = data
    ? data.totalVotes >= 1000 ? `${(data.totalVotes / 1000).toFixed(1)}K votes` : `${data.totalVotes} votes`
    : '';

  return (
    <>
      {/* ── POLYMARKET PRICE PREDICTIONS (always visible) ── */}
      <div className="px-4 py-3" style={{ borderTop: '1px solid #1B2236' }}>
        <div className="text-[14px] font-bold text-white mb-0.5">
          What price will {name} hit in {pm.month}?
        </div>
        <div className="text-[11px] mb-3" style={{ color: '#5A6478' }}>Data from Polymarket</div>

        <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1B2236' }}>
          {pm.predictions.map((pred, i) => {
            const isSelected = selectedPred === i;
            const isHovered  = hoveredPred === i;
            return (
              <div
                key={i}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedPred(prev => prev === i ? null : i)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedPred(prev => prev === i ? null : i); } }}
                onMouseEnter={() => setHoveredPred(i)}
                onMouseLeave={() => setHoveredPred(null)}
                className="flex items-center justify-between py-2.5 px-3 relative"
                style={{
                  borderBottom: i < pm.predictions.length - 1 ? '1px solid #1B2236' : 'none',
                  cursor: 'pointer',
                  background: isSelected ? 'rgba(41,98,255,0.10)' : isHovered ? 'rgba(41,98,255,0.04)' : 'transparent',
                  transition: 'background 0.2s ease, box-shadow 0.2s ease, transform 0.15s ease',
                  boxShadow: isSelected ? 'inset 0 0 0 1.5px rgba(41,98,255,0.5), 0 0 12px rgba(41,98,255,0.15)' : 'none',
                  transform: isHovered && !isSelected ? 'scale(1.01)' : 'scale(1)',
                }}
              >
                {/* Animated fill bar */}
                <div className="absolute inset-y-0 left-0 pointer-events-none"
                  style={{
                    width: `${(pred.pct / maxPmPct) * 100}%`,
                    background: isSelected
                      ? 'linear-gradient(90deg, rgba(41,98,255,0.18), rgba(41,98,255,0.08))'
                      : isHovered
                        ? 'rgba(41,98,255,0.10)'
                        : 'rgba(41,98,255,0.06)',
                    transition: 'background 0.25s ease, width 0.4s ease',
                  }} />
                <span className="text-[13px] font-semibold relative z-10 transition-colors duration-200"
                  style={{ color: isSelected ? '#5B9AFF' : '#2962FF' }}>
                  {pred.price}
                </span>
                <span className="text-[13px] font-bold relative z-10 transition-colors duration-200"
                  style={{ color: isSelected ? '#FFFFFF' : isHovered ? '#E0E0E0' : '#C4CDD8' }}>
                  {pred.pct}%
                </span>
              </div>
            );
          })}
        </div>

        {/* External links */}
        <div className="flex items-center gap-3 mt-3">
          <a href={pm.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-all"
            style={{ color: '#8A92A6', background: '#0E1320', border: '1px solid #1B2236', textDecoration: 'none' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#4F46E5'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1B2236'; (e.currentTarget as HTMLElement).style.color = '#8A92A6'; }}>
            <span style={{ fontSize: 14 }}>🟣</span> Polymarket <ExternalLink className="w-3 h-3" />
          </a>
          <a href={(pm as any).kalshiUrl ?? 'https://kalshi.com'} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg transition-all"
            style={{ color: '#8A92A6', background: '#0E1320', border: '1px solid #1B2236', textDecoration: 'none' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#00C853'; (e.currentTarget as HTMLElement).style.color = '#fff'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1B2236'; (e.currentTarget as HTMLElement).style.color = '#8A92A6'; }}>
            <span style={{ fontSize: 14 }}>🟢</span> Kalshi <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {/* ── COMMUNITY SENTIMENT BAR (clickable) ── */}
      <div className="px-4 pb-4" style={{ borderTop: '1px solid #1B2236' }}>
        <button
          onClick={() => data && setModal(true)}
          disabled={!data}
          className="w-full mt-3 flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
          style={{ background: '#0E1320', border: '1px solid #1B2236', cursor: data ? 'pointer' : 'default', textAlign: 'left' }}
          onMouseEnter={e => { if (data) (e.currentTarget as HTMLElement).style.borderColor = '#2A3550'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1B2236'; }}
        >
          {/* Left: label + vote count */}
          <div className="flex items-center gap-1.5 shrink-0">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ color: '#8A92A6' }}>
              <path d="M7 1L8.5 5H13L9.5 7.5L11 11.5L7 9L3 11.5L4.5 7.5L1 5H5.5L7 1Z" fill="#F7931A" opacity="0.9"/>
            </svg>
            <span className="text-[12px] font-semibold" style={{ color: '#8A92A6' }}>Community sentiment</span>
            {data && <span className="text-[11px]" style={{ color: '#5A6478' }}>{totalVotesLabel}</span>}
          </div>

          {/* Right: bull% bar bear% + Data button */}
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {data ? (
              <>
                <span className="text-[13px] font-black" style={{ color: '#00C853' }}>↗ {bullPct}%</span>
                <div className="w-16 h-2.5 rounded-full overflow-hidden flex" style={{ background: '#1B2236' }}>
                  <div style={{ width: `${bullPct}%`, background: 'linear-gradient(90deg,#00C853,#0BBF76)' }} />
                  <div style={{ width: `${bearPct}%`, background: 'linear-gradient(90deg,#FF3D3D,#CC2222)' }} />
                </div>
                <span className="text-[13px] font-black" style={{ color: '#FF3D3D' }}>{bearPct}% ↘</span>
                <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold ml-1"
                  style={{ background: '#1B2236', color: '#8A92A6', border: '1px solid #2A3550' }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="6" width="2" height="5" rx="0.5" fill="#8A92A6"/><rect x="5" y="3" width="2" height="8" rx="0.5" fill="#8A92A6"/><rect x="9" y="1" width="2" height="10" rx="0.5" fill="#8A92A6"/></svg>
                  Data
                </span>
              </>
            ) : (
              <span className="text-[11px]" style={{ color: '#5A6478' }}>Loading…</span>
            )}
          </div>
        </button>
      </div>

      {/* ── CMC-STYLE MODAL ── */}
      {modal && data && (
        <SentimentModal asset={asset} assetName={assetName} data={data} onClose={() => setModal(false)} />
      )}
    </>
  );
}

// ── Reusable link row ─────────────────────────────────────────────────────────
function LinkRow({ label, icon, href, display }: { label: string; icon: React.ReactNode; href: string; display: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[12px]" style={{ color: '#5A6478' }}>{label}</span>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold transition-all"
        style={{ color: '#C4CDD8', background: '#0E1320', border: '1px solid #1B2236', textDecoration: 'none' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#2962FF'; (e.currentTarget as HTMLElement).style.color = '#FFFFFF'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#1B2236'; (e.currentTarget as HTMLElement).style.color = '#C4CDD8'; }}
      >
        {icon} {display}
      </a>
    </div>
  );
}
