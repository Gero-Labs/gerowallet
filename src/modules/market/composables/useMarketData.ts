import { ref, computed, type Ref, type ComputedRef } from 'vue';

export interface MarketToken {
  unit: string;
  name: string;
  ticker: string;
  img: string;
  verified: boolean;
  price: number;
  priceAda: number;
  change1h: number;
  change24h: number;
  change7d: number;
  volume24h: number;
  mcap: number;
  tvl: number | null;
  liquidity: number;
  holders: number;
  riskRating: string | null;
  isNew: boolean;
  policyLocked: boolean;
  fingerprint: string;
  description?: string;
  // Populated when cross-referencing with wallet holdings
  balance?: number;
  value?: number;
}

export interface CandlestickDataPoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

// --- Mock data ---

const MOCK_TOKENS: MarketToken[] = [
  { unit: 'lovelace', name: 'Cardano', ticker: 'ADA', img: '', verified: true, price: 0.58, priceAda: 1, change1h: 0.12, change24h: 3.4, change7d: 8.2, volume24h: 125000000, mcap: 21000000000, tvl: null, liquidity: 500000000, holders: 4200000, riskRating: 'AAA', isNew: false, policyLocked: true, fingerprint: 'asset1_ada', description: 'Cardano is a proof-of-stake blockchain platform' },
  { unit: 'min_policy.MIN', name: 'Minswap', ticker: 'MIN', img: '', verified: true, price: 0.042, priceAda: 0.072, change1h: 0.5, change24h: 5.2, change7d: 12.1, volume24h: 8500000, mcap: 180000000, tvl: 52000000, liquidity: 12000000, holders: 85000, riskRating: 'AA', isNew: false, policyLocked: true, fingerprint: 'asset1_min', description: 'Minswap is the leading DEX on Cardano' },
  { unit: 'snek_policy.SNEK', name: 'Snek', ticker: 'SNEK', img: '', verified: true, price: 0.00032, priceAda: 0.00055, change1h: 2.3, change24h: 45.2, change7d: 120.5, volume24h: 4500000, mcap: 25000000, tvl: null, liquidity: 890000, holders: 42000, riskRating: 'B', isNew: false, policyLocked: true, fingerprint: 'asset1_snek', description: 'The most memeable meme coin on Cardano' },
  { unit: 'indy_policy.INDY', name: 'Indigo Protocol', ticker: 'INDY', img: '', verified: true, price: 1.82, priceAda: 3.14, change1h: -0.3, change24h: -2.1, change7d: 4.5, volume24h: 2800000, mcap: 95000000, tvl: 48500000, liquidity: 5600000, holders: 28000, riskRating: 'AA', isNew: false, policyLocked: true, fingerprint: 'asset1_indy', description: 'Indigo is a decentralized synthetic assets protocol' },
  { unit: 'lq_policy.LQ', name: 'Liqwid Finance', ticker: 'LQ', img: '', verified: true, price: 2.45, priceAda: 4.22, change1h: -1.2, change24h: -8.3, change7d: -15.4, volume24h: 1200000, mcap: 72000000, tvl: 35200000, liquidity: 3800000, holders: 15000, riskRating: 'A', isNew: false, policyLocked: true, fingerprint: 'asset1_lq', description: 'Liqwid is the leading lending and borrowing protocol on Cardano' },
  { unit: 'wmt_policy.WMT', name: 'World Mobile Token', ticker: 'WMT', img: '', verified: true, price: 0.21, priceAda: 0.36, change1h: 0.8, change24h: 12.8, change7d: 25.3, volume24h: 3200000, mcap: 120000000, tvl: null, liquidity: 2100000, holders: 95000, riskRating: 'BBB', isNew: false, policyLocked: true, fingerprint: 'asset1_wmt', description: 'World Mobile is bringing connectivity to the unconnected' },
  { unit: 'djed_policy.DJED', name: 'Djed Stablecoin', ticker: 'DJED', img: '', verified: true, price: 1.01, priceAda: 1.74, change1h: 0.01, change24h: 0.05, change7d: -0.02, volume24h: 950000, mcap: 28000000, tvl: 28900000, liquidity: 8500000, holders: 18000, riskRating: 'AAA', isNew: false, policyLocked: true, fingerprint: 'asset1_djed', description: 'Djed is an overcollateralized algorithmic stablecoin' },
  { unit: 'sundae_policy.SUNDAE', name: 'SundaeSwap', ticker: 'SUNDAE', img: '', verified: true, price: 0.0089, priceAda: 0.015, change1h: -0.4, change24h: 2.1, change7d: -5.8, volume24h: 1800000, mcap: 45000000, tvl: 15000000, liquidity: 4200000, holders: 62000, riskRating: 'A', isNew: false, policyLocked: true, fingerprint: 'asset1_sundae', description: 'SundaeSwap is a decentralized exchange on Cardano' },
  { unit: 'hosky_policy.HOSKY', name: 'Hosky Token', ticker: 'HOSKY', img: '', verified: true, price: 0.0000012, priceAda: 0.0000021, change1h: 5.4, change24h: 18.2, change7d: -32.1, volume24h: 320000, mcap: 2500000, tvl: null, liquidity: 180000, holders: 125000, riskRating: 'D', isNew: false, policyLocked: true, fingerprint: 'asset1_hosky', description: 'The OG Cardano meme token' },
  { unit: 'lenfi_policy.LENFI', name: 'Lenfi', ticker: 'LENFI', img: '', verified: true, price: 0.35, priceAda: 0.60, change1h: 0.2, change24h: 1.8, change7d: 9.4, volume24h: 650000, mcap: 32000000, tvl: 18000000, liquidity: 2800000, holders: 12000, riskRating: 'BBB', isNew: false, policyLocked: true, fingerprint: 'asset1_lenfi', description: 'Lenfi is a peer-to-pool lending protocol' },
  { unit: 'optim_policy.OPTIM', name: 'Optim Finance', ticker: 'OPTIM', img: '', verified: true, price: 0.089, priceAda: 0.15, change1h: -0.6, change24h: -3.2, change7d: 7.1, volume24h: 420000, mcap: 18000000, tvl: 22000000, liquidity: 1500000, holders: 8500, riskRating: 'A', isNew: false, policyLocked: true, fingerprint: 'asset1_optim', description: 'Optim is a yield optimization protocol' },
  { unit: 'encs_policy.ENCS', name: 'Encoins', ticker: 'ENCS', img: '', verified: true, price: 0.15, priceAda: 0.26, change1h: 1.1, change24h: 6.7, change7d: 15.2, volume24h: 280000, mcap: 12000000, tvl: 5000000, liquidity: 900000, holders: 6200, riskRating: 'BB', isNew: false, policyLocked: true, fingerprint: 'asset1_encs', description: 'Encoins brings privacy features to Cardano' },
  { unit: 'nmkr_policy.NMKR', name: 'NMKR', ticker: 'NMKR', img: '', verified: true, price: 0.012, priceAda: 0.021, change1h: 0.3, change24h: -1.5, change7d: -8.2, volume24h: 180000, mcap: 8500000, tvl: null, liquidity: 650000, holders: 22000, riskRating: 'BB', isNew: false, policyLocked: true, fingerprint: 'asset1_nmkr', description: 'NMKR is the leading NFT minting platform on Cardano' },
  { unit: 'jpg_policy.JPG', name: 'JPG Store', ticker: 'JPG', img: '', verified: true, price: 0.025, priceAda: 0.043, change1h: -0.2, change24h: 4.5, change7d: 11.3, volume24h: 350000, mcap: 15000000, tvl: null, liquidity: 1200000, holders: 35000, riskRating: 'A', isNew: false, policyLocked: true, fingerprint: 'asset1_jpg', description: 'JPG Store is the top NFT marketplace on Cardano' },
  { unit: 'book_policy.BOOK', name: 'Book Token', ticker: 'BOOK', img: '', verified: true, price: 0.0045, priceAda: 0.0078, change1h: 3.2, change24h: 22.1, change7d: 45.8, volume24h: 520000, mcap: 5500000, tvl: null, liquidity: 380000, holders: 18000, riskRating: 'B', isNew: false, policyLocked: true, fingerprint: 'asset1_book', description: 'Book.io brings eBooks and audiobooks to Web3' },
  { unit: 'fact_policy.FACT', name: 'Fact Finance', ticker: 'FACT', img: '', verified: true, price: 0.078, priceAda: 0.13, change1h: -0.8, change24h: -4.2, change7d: 2.1, volume24h: 150000, mcap: 9000000, tvl: 3500000, liquidity: 520000, holders: 4800, riskRating: 'BBB', isNew: false, policyLocked: true, fingerprint: 'asset1_fact' },
  { unit: 'clay_policy.CLAY', name: 'Clay Nation', ticker: 'CLAY', img: '', verified: true, price: 0.032, priceAda: 0.055, change1h: 0.1, change24h: 1.2, change7d: -3.5, volume24h: 95000, mcap: 4200000, tvl: null, liquidity: 320000, holders: 15000, riskRating: 'B', isNew: false, policyLocked: true, fingerprint: 'asset1_clay' },
  { unit: 'iag_policy.IAG', name: 'iagon', ticker: 'IAG', img: '', verified: true, price: 0.065, priceAda: 0.11, change1h: 0.4, change24h: 3.8, change7d: 18.5, volume24h: 210000, mcap: 22000000, tvl: null, liquidity: 780000, holders: 11000, riskRating: 'BB', isNew: false, policyLocked: true, fingerprint: 'asset1_iag', description: 'Decentralized cloud computing on Cardano' },
  { unit: 'agix_policy.AGIX', name: 'SingularityNET', ticker: 'AGIX', img: '', verified: true, price: 0.42, priceAda: 0.72, change1h: -0.9, change24h: -5.1, change7d: -12.3, volume24h: 3800000, mcap: 520000000, tvl: null, liquidity: 8900000, holders: 145000, riskRating: 'A', isNew: false, policyLocked: true, fingerprint: 'asset1_agix', description: 'Decentralized AI marketplace' },
  { unit: 'ntx_policy.NTX', name: 'NuNet', ticker: 'NTX', img: '', verified: true, price: 0.028, priceAda: 0.048, change1h: 1.5, change24h: 8.9, change7d: 22.4, volume24h: 180000, mcap: 14000000, tvl: null, liquidity: 450000, holders: 9200, riskRating: 'BB', isNew: false, policyLocked: true, fingerprint: 'asset1_ntx', description: 'Decentralized computing infrastructure' },
  { unit: 'copi_policy.COPI', name: 'Cornucopias', ticker: 'COPI', img: '', verified: true, price: 0.0052, priceAda: 0.009, change1h: 0.6, change24h: -2.8, change7d: -9.1, volume24h: 120000, mcap: 6500000, tvl: null, liquidity: 280000, holders: 32000, riskRating: 'CCC', isNew: false, policyLocked: true, fingerprint: 'asset1_copi', description: 'Play-to-earn metaverse on Cardano' },
  { unit: 'meld_policy.MELD', name: 'MELD', ticker: 'MELD', img: '', verified: true, price: 0.018, priceAda: 0.031, change1h: -0.3, change24h: 1.5, change7d: 5.8, volume24h: 450000, mcap: 38000000, tvl: 8500000, liquidity: 2200000, holders: 48000, riskRating: 'BBB', isNew: false, policyLocked: true, fingerprint: 'asset1_meld', description: 'DeFi banking protocol' },
  { unit: 'iusd_policy.iUSD', name: 'Indigo USD', ticker: 'iUSD', img: '', verified: true, price: 0.99, priceAda: 1.71, change1h: -0.01, change24h: 0.02, change7d: -0.08, volume24h: 680000, mcap: 15000000, tvl: 15000000, liquidity: 4500000, holders: 9500, riskRating: 'AA', isNew: false, policyLocked: true, fingerprint: 'asset1_iusd', description: 'Synthetic USD stablecoin by Indigo Protocol' },
  { unit: 'ibtc_policy.iBTC', name: 'Indigo BTC', ticker: 'iBTC', img: '', verified: true, price: 95000, priceAda: 163793, change1h: 0.05, change24h: 1.2, change7d: 3.5, volume24h: 520000, mcap: 8500000, tvl: 8500000, liquidity: 2800000, holders: 3200, riskRating: 'AA', isNew: false, policyLocked: true, fingerprint: 'asset1_ibtc', description: 'Synthetic BTC on Cardano by Indigo Protocol' },
  { unit: 'ieth_policy.iETH', name: 'Indigo ETH', ticker: 'iETH', img: '', verified: true, price: 3200, priceAda: 5517, change1h: -0.2, change24h: -1.5, change7d: 5.2, volume24h: 380000, mcap: 5200000, tvl: 5200000, liquidity: 1800000, holders: 2800, riskRating: 'AA', isNew: false, policyLocked: true, fingerprint: 'asset1_ieth', description: 'Synthetic ETH on Cardano by Indigo Protocol' },
  { unit: 'newt1_policy.ALPHA', name: 'Alpha Token', ticker: 'ALPHA', img: '', verified: false, price: 0.0001, priceAda: 0.00017, change1h: 12.5, change24h: 85.2, change7d: 85.2, volume24h: 45000, mcap: 500000, tvl: null, liquidity: 25000, holders: 850, riskRating: 'D', isNew: true, policyLocked: false, fingerprint: 'asset1_alpha' },
  { unit: 'newt2_policy.BETA', name: 'Beta Protocol', ticker: 'BETA', img: '', verified: false, price: 0.0025, priceAda: 0.0043, change1h: -5.2, change24h: 32.1, change7d: 32.1, volume24h: 28000, mcap: 800000, tvl: null, liquidity: 15000, holders: 420, riskRating: null, isNew: true, policyLocked: false, fingerprint: 'asset1_beta' },
  { unit: 'newt3_policy.GAMMA', name: 'Gamma DeFi', ticker: 'GAMMA', img: '', verified: false, price: 0.0008, priceAda: 0.0014, change1h: 8.3, change24h: 145.0, change7d: 145.0, volume24h: 62000, mcap: 1200000, tvl: 50000, liquidity: 35000, holders: 1200, riskRating: 'CC', isNew: true, policyLocked: true, fingerprint: 'asset1_gamma' },
  { unit: 'wing_policy.WRT', name: 'WingRiders', ticker: 'WRT', img: '', verified: true, price: 0.015, priceAda: 0.026, change1h: 0.7, change24h: 3.2, change7d: -2.1, volume24h: 380000, mcap: 12000000, tvl: 9500000, liquidity: 2800000, holders: 15000, riskRating: 'A', isNew: false, policyLocked: true, fingerprint: 'asset1_wrt', description: 'WingRiders is a Cardano DEX' },
  { unit: 'splash_policy.SPLASH', name: 'Splash', ticker: 'SPLASH', img: '', verified: true, price: 0.085, priceAda: 0.15, change1h: 1.8, change24h: 9.5, change7d: 28.3, volume24h: 290000, mcap: 8000000, tvl: 6500000, liquidity: 1200000, holders: 5800, riskRating: 'BBB', isNew: false, policyLocked: true, fingerprint: 'asset1_splash', description: 'Splash is a Cardano DEX protocol' },
];

function generateCandles(basePrice: number, count: number, volatility: number, interval: number = 300): CandlestickDataPoint[] {
  const candles: CandlestickDataPoint[] = [];
  let currentPrice = basePrice;
  const now = Math.floor(Date.now() / 1000);

  for (let i = count - 1; i >= 0; i--) {
    const change = (Math.random() - 0.48) * volatility * currentPrice;
    const open = currentPrice;
    const close = Math.max(currentPrice + change, 0.000001);
    const high = Math.max(open, close) + Math.random() * volatility * currentPrice * 0.5;
    const low = Math.max(Math.min(open, close) - Math.random() * volatility * currentPrice * 0.5, 0.000001);
    const volume = Math.random() * 100000 + 10000;

    candles.push({
      time: now - i * interval,
      open: parseFloat(open.toFixed(6)),
      high: parseFloat(high.toFixed(6)),
      low: parseFloat(low.toFixed(6)),
      close: parseFloat(close.toFixed(6)),
      volume: parseFloat(volume.toFixed(0)),
    });

    currentPrice = close;
  }
  return candles;
}

// Timeframe multipliers (candle interval in seconds)
const TIMEFRAME_CONFIG: Record<string, { interval: number; count: number }> = {
  '1m': { interval: 60, count: 200 },
  '5m': { interval: 300, count: 200 },
  '15m': { interval: 900, count: 200 },
  '1h': { interval: 3600, count: 200 },
  '4h': { interval: 14400, count: 200 },
  '1d': { interval: 86400, count: 200 },
  '1w': { interval: 604800, count: 100 },
};

// --- Composable ---

export function useMarketData() {
  const allTokens: Ref<MarketToken[]> = ref([...MOCK_TOKENS]);
  const loading = ref(false);
  const error: Ref<string | null> = ref(null);

  const trendingTokens: ComputedRef<MarketToken[]> = computed(() =>
    [...allTokens.value].sort((a, b) => b.volume24h - a.volume24h).slice(0, 20)
  );

  const topGainers: ComputedRef<MarketToken[]> = computed(() =>
    [...allTokens.value]
      .filter(tok => tok.change24h > 0)
      .sort((a, b) => b.change24h - a.change24h)
      .slice(0, 20)
  );

  const topLosers: ComputedRef<MarketToken[]> = computed(() =>
    [...allTokens.value]
      .filter(tok => tok.change24h < 0)
      .sort((a, b) => a.change24h - b.change24h)
      .slice(0, 20)
  );

  const newTokens: ComputedRef<MarketToken[]> = computed(() =>
    allTokens.value.filter(t => t.isNew)
  );

  function searchTokens(query: string): MarketToken[] {
    if (!query.trim()) return allTokens.value;
    const q = query.toLowerCase().trim();
    return allTokens.value.filter(
      t => t.name.toLowerCase().includes(q) || t.ticker.toLowerCase().includes(q)
    );
  }

  function getTokenByUnit(unit: string): MarketToken | undefined {
    return allTokens.value.find(t => t.unit === unit);
  }

  function getTokenCandles(unit: string, timeframe: string): CandlestickDataPoint[] {
    const token = getTokenByUnit(unit);
    if (!token) return [];
    const normalizedTf = timeframe.toLowerCase();
    const config = TIMEFRAME_CONFIG[normalizedTf] || TIMEFRAME_CONFIG['1h'];
    const volatility = token.ticker === 'DJED' || token.ticker === 'iUSD' ? 0.002 : 0.04;
    return generateCandles(token.price, config.count, volatility, config.interval);
  }

  return {
    allTokens,
    trendingTokens,
    topGainers,
    topLosers,
    newTokens,
    loading,
    error,
    searchTokens,
    getTokenByUnit,
    getTokenCandles,
  };
}
