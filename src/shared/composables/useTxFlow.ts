/**
 * Everything `TxFlowDiagram` needs for one stored transaction record of the
 * logged wallet: the flow model (Cardano only), token names and images, and the
 * currency symbol. Shared by the dashboard's transaction details, the side
 * panel's transaction sheet (to decide whether to offer the diagram) and the
 * popup window that shows it (`TxFlowWindow.vue`).
 */
import { computed, type Ref } from 'vue';
import type { FlowTokenInfo } from '@/shared/components/TxFlowDiagram.vue';
import { buildTxFlow, type FlowTxRecord } from '@/shared/utils/txFlow';
import { buildClassifyContext } from '@/modules/dashboard/utils/transactionClassifier';
import { resolveAsset } from '@/shared/utils/resolver';
import { getTokenByUnit } from '@/modules/market/composables/useMarketData';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import networks from '@/utils/networks';
import filters from '@/shared/utils/filters';

interface ResolvedAsset {
  name?: string;
  img?: string;
  metadata?: { decimals?: number | string };
}

export function useTxFlow(tx: Ref<FlowTxRecord | null | undefined>) {
  const ownAddresses = computed(() =>
    buildClassifyContext(walletStore.loggedWallet, walletStore.keys, walletStore.contacts).walletAddresses
  );

  // Bitcoin, Midnight and Solana have their own views
  const flowModel = computed(() =>
    walletStore.loggedWallet?.chain === Blockchain.CARDANO ? buildTxFlow(tx.value, ownAddresses.value) : null
  );

  const currencySymbol = computed(() =>
    networks.resolveCurrencySymbol(walletStore.loggedWallet?.chain, walletStore.loggedWallet?.network)
  );

  /** Resolved metadata for a unit, with the market's image when it has one. */
  const tokenInfo = (unit: string): FlowTokenInfo => {
    let resolved: ResolvedAsset | null = null;
    try {
      resolved = resolveAsset({ unit, quantity: 0 }) as ResolvedAsset | null;
    } catch {
      resolved = null;
    }
    const decimals = Number(resolved?.metadata?.decimals ?? 0);
    return {
      name: resolved?.name || filters.truncate(unit),
      img: getTokenByUnit(unit)?.img || resolved?.img,
      decimals: Number.isFinite(decimals) ? decimals : 0,
    };
  };

  return { flowModel, tokenInfo, currencySymbol };
}
