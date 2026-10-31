import type Dexie from 'dexie';
import { refreshEnvelopeV2Flag } from '@/shared/utils/envelopeV2Flag';
import {
  decryptDeviceShare,
  deviceShareNeedsUpgrade,
  encryptDeviceShare,
  type DeviceShareSecret,
} from '@/shared/utils/mpc/deviceShareCipher';
import { debugLog } from '@/utils/debug';

/**
 * Upgrade an MPC wallet's password-encrypted device share to the current format
 * after it has just been proven correct (the unlock reconstructed the wallet's own
 * xpub from it). An old CryptoJS (MD5, 1 iteration) share becomes `gpw1`, or `gpw2`
 * with `isKeyEnvelopeV2Enabled` on; a `gpw1` share becomes `gpw2` with the flag on.
 *
 * Same safety rules as the secret migration: the re-sealed share is opened in
 * memory, written with a compare-and-swap on the wallets row, then read back from
 * storage and opened again. It never runs while a re-split has a next share staged
 * (that slot belongs to `setRecoveryPasswordFlow`) and never throws.
 */

export interface DeviceShareRow {
  mpcDeviceShare?: string;
  mpcDeviceShareNext?: string;
}

export interface DeviceShareStore {
  getWallet(walletId: number): Promise<DeviceShareRow | undefined>;
  /** Atomically: if the primary share is still `expected` and nothing is staged, write `next`. */
  casDeviceShare(walletId: number, expected: string, next: string): Promise<boolean>;
}

export type DeviceShareUpgradeOutcome = 'upgraded' | 'current' | 'skipped' | 'failed';

/**
 * `walletsDb` opens gero-db. The caller supplies it rather than this module
 * importing gero-db: in the background's single iife an inlined dynamic import is
 * a namespace const, and this module is emitted before gero-db's
 * (scripts/check-bundle-tdz.mjs).
 */
export function createDexieDeviceShareStore(walletsDb: () => Promise<Dexie>): DeviceShareStore {
  return {
    async getWallet(walletId) {
      return (await walletsDb()).table('wallets').get(walletId);
    },
    async casDeviceShare(walletId, expected, next) {
      const db = await walletsDb();
      const table = db.table('wallets');
      return db.transaction('rw', table, async () => {
        const row = await table.get(walletId);
        if (!row || row.mpcDeviceShare !== expected || row.mpcDeviceShareNext) return false;
        await table.update(walletId, { mpcDeviceShare: next });
        return true;
      });
    },
  };
}

export async function upgradeMpcDeviceShare(
  walletId: number,
  secret: DeviceShareSecret,
  store: DeviceShareStore,
): Promise<DeviceShareUpgradeOutcome> {
  if (secret.kind !== 'password') return 'skipped';
  try {
    const row = await store.getWallet(walletId);
    const stored = row?.mpcDeviceShare;
    if (!stored || row?.mpcDeviceShareNext) return 'skipped';
    if (!deviceShareNeedsUpgrade(stored, await refreshEnvelopeV2Flag())) return 'current';

    const plain = await decryptDeviceShare(stored, secret);
    const next = await encryptDeviceShare(plain, secret, stored);
    if ((await decryptDeviceShare(next, secret)) !== plain) return 'failed';

    if (!(await store.casDeviceShare(walletId, stored, next))) return 'failed';
    const back = await store.getWallet(walletId);
    if (back?.mpcDeviceShare !== next || (await decryptDeviceShare(back.mpcDeviceShare, secret)) !== plain) return 'failed';

    debugLog(`🔐 MPC device share for wallet ${walletId} re-sealed in the current format`);
    return 'upgraded';
  } catch {
    // Best-effort: a failed upgrade leaves the share exactly as it was and retries next unlock.
    return 'failed';
  }
}
