import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { walletStore } from '@/stores/walletStore';
import { CIP45_REVOKED, sameWallet, walletContext } from './authorization';
import type { Cip45Authorization } from './types';

export async function validateCip45Signing(payload: { cip45Authorization?: Cip45Authorization } | undefined): Promise<void> {
  const authorization = payload?.cip45Authorization;
  if (!authorization) return;
  const response = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.CIP45_VALIDATE_SESSION, data: { authorization },
  }) as { data?: { success: boolean } };
  if (!response?.data?.success || walletStore.isLocked
    || !sameWallet(authorization, walletContext(walletStore.loggedWallet))) throw new Error(CIP45_REVOKED);
}
