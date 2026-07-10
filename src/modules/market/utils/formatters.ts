/**
 * Re-export shim. The implementations moved to src/shared/utils/format.ts,
 * which is the canonical home; the seven importers under
 * src/modules/market/components keep working unchanged and get re-pointed
 * at the shared module by a later sweep.
 */
export {
  formatCompact,
  formatInt,
  formatBalance,
  formatPriceRaw,
  formatPrice,
  formatChange,
  changeColor,
  formatUsd,
  formatSignedChange,
} from '@/shared/utils/format';
