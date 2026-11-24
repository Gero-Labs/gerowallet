import { Blockchain, Network } from '@/models/types';
import { PREVIEW_MOVE_NOTICE_CONFIG_KEY } from '@/chains/midnight/midnightPreviewMove';

/**
 * Whether the one-time "moved to Preview" notice applies: a Midnight Preview
 * wallet whose per-wallet config still has the flag the login that completed
 * its move from Stagenet set (midnightPreviewMoveCleanup.ts), until dismissed.
 */
export function showsPreviewMoveNotice(
  wallet: { chain?: string; network?: string } | null | undefined,
  config: Record<string, unknown> | null | undefined,
): boolean {
  return wallet?.chain === Blockchain.MIDNIGHT && wallet?.network === Network.PREVIEW
    && config?.[PREVIEW_MOVE_NOTICE_CONFIG_KEY] === true;
}
