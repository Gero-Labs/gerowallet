/**
 * Shared holdings valuation — the ONE place wallet balances × market prices
 * become a portfolio value.
 *
 * WHY: the dashboard (PortfolioPage) and mini-Gero (sidepanel BalanceSection)
 * each computed their own total and drifted: the sidepanel copy lacked the
 * DexHunter price fallback, so any token priced only there silently dropped
 * out of the sidepanel's number (user-visible: ₳22,421 on the dashboard vs
 * ₳22,411 in mini-Gero). House rule: mini-Gero must mirror the dashboard's
 * exact logic — so both now consume THIS composable.
 *
 * The valuation logic is extracted verbatim from PortfolioPage.myHoldings /
 * currentPortfolioValues (including their two deliberately-different ADA
 * price expressions). P&L enrichment stays with consumers — it's a
 * mainnet-Cardano page concern, not part of valuation.
 */
import { computed, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import { networkStore } from '@/stores/networkStore';
import { coinGeckoStore } from '@/stores/coinGeckoStore';
import { tokenMetadataStore } from '@/stores/tokenMetadataStore';
import { Blockchain } from '@/models/types';
import { getBalance } from '@/chrome/serialization';
import type { Cardano } from '@cardano-sdk/core';
import { useMarketData, type MarketToken } from '@/modules/market/composables/useMarketData';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { useNativeCurrency } from '@/modules/market/composables/useNativeCurrency';

export function useHoldingsValuation() {
  const { loggedWallet, utxos, collateral, tokens: walletTokens } = toRefs(walletStore);
  const { price } = toRefs(networkStore);
  const { allTokens } = useMarketData();
  const { usdToEurRate } = useCurrencyConverter();
  const { currencyName: nativeCurrencyName, currencyTicker: nativeCurrencyTicker } = useNativeCurrency();

  const isApex = computed(() =>
    loggedWallet.value?.chain === Blockchain.APEX_PRIME
    || loggedWallet.value?.chain === Blockchain.APEX_VECTOR,
  );

  /** ADA (or native) balance from the UTxO set, in whole coins. */
  const adaBalance = computed(() => {
    // walletStore.utxos is a Cardano/Bitcoin union; this valuation only runs
    // for Cardano-family chains (Midnight/Bitcoin render their own views).
    return Number(getBalance(utxos.value as Cardano.Utxo[], collateral.value as Cardano.Utxo).coin().toString()) / 1000000;
  });

  /**
   * Native price used for the USD→ADA conversion of TOTALS
   * (market-API lovelace price first — same source as holdings rows).
   */
  const nativePriceUsd = computed(() => {
    if (isApex.value) {
      return coinGeckoStore.cache['apex-4']?.usd ?? 0;
    }
    const marketAdaPrice = allTokens.value.find(t => t.unit === 'lovelace')?.price;
    return marketAdaPrice || Number(price.value?.lastPrice) || 0;
  });

  /**
   * Holdings rows: wallet tokens enriched with market data. Valuation only —
   * P&L fields are left null for consumers that need them (PortfolioPage).
   */
  const holdings = computed<MarketToken[]>(() => {
    const tokens = walletTokens.value || {};
    const adaPriceUsd = isApex.value
      ? (coinGeckoStore.cache['apex-4']?.usd ?? 0)
      : (priceStore.adaUsd?.lastPrice || Number(price.value?.lastPrice) || 0);
    const dhTokens = tokenMetadataStore.tokens || {};
    const rows: MarketToken[] = [];

    Object.entries(tokens).forEach(([unit, token]: [string, { quantity?: number | string; amount?: string; name?: string; policy_id?: string; metadata?: { name?: string; ticker?: string; decimals?: number } }]) => {
      if (!token.quantity || Number(token.quantity) <= 0) return;

      // Find in market data for enrichment
      const marketToken = allTokens.value.find(t => t.unit === unit);
      const dhToken = dhTokens[unit];

      // Decimals: registry metadata first, then market/DexHunter fallbacks —
      // on a fresh profile the wallet token can be built before the registry
      // cache exists, and pricing the raw quantity inflates the portfolio by
      // 10^decimals. The same value feeds `decimals` below so balance and
      // formatting can never disagree.
      const decimals = token.metadata?.decimals ?? marketToken?.decimals ?? dhToken?.decimals ?? 0;
      const rawQuantity = Number(token.quantity);
      const quantity = decimals > 0 ? rawQuantity / Math.pow(10, decimals) : rawQuantity;

      // Price: prefer market API data, then DexHunter fallback
      let priceUsd = marketToken?.price || 0;
      let priceAda = marketToken?.priceAda || 0;

      const isNativeToken = unit === 'lovelace' || token.policy_id === '';
      if (isNativeToken) {
        priceUsd = adaPriceUsd;
        priceAda = 1;
      } else if (!priceUsd && dhToken?.price) {
        priceAda = dhToken.price;
        priceUsd = priceAda * adaPriceUsd;
      }

      const value = quantity * priceUsd;

      rows.push({
        unit,
        name: marketToken?.name || token.name || token.metadata?.name || (isNativeToken ? nativeCurrencyName.value : unit),
        ticker: marketToken?.ticker || token.metadata?.ticker || (isNativeToken ? nativeCurrencyTicker.value : ''),
        img: marketToken?.img || (token as { img?: string }).img || '',
        verified: marketToken?.verified ?? dhToken?.verified ?? isNativeToken,
        // Graduated snek.fun tokens are unverified but legit — carry the market
        // flag through so the verified-only filter exempts them and the snek
        // badge renders (mirrors the market list). Missing here = held snek
        // tokens silently stripped by verified-only.
        isSnekFun: marketToken?.isSnekFun ?? false,
        price: priceUsd,
        priceAda,
        priceEur: marketToken?.priceEur ?? 0,
        change1h: marketToken?.change1h || 0,
        change24h: marketToken?.change24h || 0,
        change7d: marketToken?.change7d || 0,
        change30d: marketToken?.change30d || 0,
        volume24h: marketToken?.volume24h || 0,
        volume7d: marketToken?.volume7d || 0,
        txnCount24h: marketToken?.txnCount24h ?? null,
        makerCount24h: marketToken?.makerCount24h ?? null,
        totalSupply: marketToken?.totalSupply ?? null,
        sparkline: marketToken?.sparkline ?? [],
        mcap: marketToken?.mcap ?? null,
        tvl: marketToken?.tvl || null,
        liquidity: marketToken?.liquidity || 0,
        holders: marketToken?.holders ?? dhToken?.holders ?? null,
        isNew: false,
        policyLocked: true,
        fingerprint: marketToken?.fingerprint || dhToken?.fingerprint || '',
        decimals,
        balance: quantity,
        value,
        allocation: value,
        avgCostBasis: null,
        totalPnl: null,
        realizedPnl: null,
        unrealizedPnl: null,
        isNative: isNativeToken,
      });
    });

    {
      const suspicious = rows.filter(r => !r.isNative && (r.decimals ?? 0) === 0 && (r.balance ?? 0) > 1e6);
      if (suspicious.length > 0) {
        // eslint-disable-next-line no-console -- temporary diagnostic for the fresh-restore decimals bug
        console.log(`🔬 valuation: ${suspicious.length}/${rows.length} tokens resolved decimals=0 with balance>1e6; sample unit=${suspicious[0].unit?.slice(0, 20)}… hasWalletMeta=${!!(tokens[suspicious[0].unit ?? ''] as { metadata?: unknown })?.metadata} marketDecimals=${allTokens.value.find(t => t.unit === suspicious[0].unit)?.decimals} dhDecimals=${dhTokens[suspicious[0].unit ?? '']?.decimals}`);
      }
    }

    // Sort: native token pinned to top, then by value descending
    rows.sort((a, b) => {
      if (a.unit === 'lovelace' || a.isNative) return -1;
      if (b.unit === 'lovelace' || b.isNative) return 1;
      return (b.value || 0) - (a.value || 0);
    });

    return rows;
  });

  /** Live portfolio totals derived from the holdings rows. */
  const totals = computed(() => {
    const totalUsd = holdings.value.reduce((sum, t) => sum + (t.value || 0), 0);
    const adaPriceUsd = nativePriceUsd.value;
    const totalAda = adaPriceUsd > 0 ? totalUsd / adaPriceUsd : adaBalance.value;
    const totalEur = totalUsd * usdToEurRate.value;
    return { ada: totalAda, usd: totalUsd, eur: totalEur };
  });

  return { holdings, totals, nativePriceUsd, adaBalance, isApex };
}
