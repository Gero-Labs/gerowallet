import type { CardanoExplorerId } from '@/shared/utils/explorer';
import cexplorer from '@/assets/explorers/cexplorer.png';
import cardanoscan from '@/assets/explorers/cardanoscan.png';
import adastat from '@/assets/explorers/adastat.png';
import poolpm from '@/assets/explorers/poolpm.png';

/**
 * Each explorer's own 180px touch icon, bundled so the settings list makes no
 * request to the explorers' sites. UI-only: kept out of explorer.ts, which the
 * background worker bundles through walletStore.
 */
export const EXPLORER_LOGOS: Record<CardanoExplorerId, string> = {
  cexplorer,
  cardanoscan,
  adastat,
  poolpm,
};
