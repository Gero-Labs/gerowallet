import type { MidnightSwapOfferRecord } from '@/chains/midnight/midnightSwapRecords';

/** What a row shows: the record's status, or "withdrawing" between the withdrawal and the sync that sees it. */
export type SwapDisplayStatus = 'open' | 'withdrawing' | 'taken' | 'cancelled' | 'expired';

export function swapDisplayStatus(record: MidnightSwapOfferRecord, now: number): SwapDisplayStatus {
  if (record.status !== 'open') return record.status;
  if (record.withdrawTxHash) return 'withdrawing';
  // The worker's next read stamps it; the clock already knows.
  return now >= record.expiresAt ? 'expired' : 'open';
}

/** The chip's tone per status. */
export const SWAP_STATUS_TONE: Record<SwapDisplayStatus, 'accent' | 'success' | 'neutral' | 'warning'> = {
  open: 'accent',
  withdrawing: 'warning',
  taken: 'success',
  cancelled: 'neutral',
  expired: 'neutral',
};
