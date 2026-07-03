// Cross-device signing bridge — per-wallet settings persistence (background).
//
// The remote-signing settings (enable, policy, trusted devices) are per-wallet
// SECURITY config, so they live in the wallet-db `config` table alongside
// unlockMethod / autoLockMinutes — NOT in app-global chrome.storage. Read on
// login into an in-memory mirror (walletManager) so the signing service's trust
// predicates stay synchronous.

import { getDb } from '@/db/wallet-db';
import {
  defaultRemoteSigningSettings,
  type RemoteSigningSettings,
  type TrustedDevice,
} from './crossDeviceTrust';

const CONFIG_KEY = 'remoteSigning';

function sanitizeTrusted(raw: unknown): Record<string, TrustedDevice> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, TrustedDevice> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const d = v as Record<string, unknown>;
    if (typeof d['deviceId'] === 'string' && typeof d['pubKey'] === 'string') {
      out[id] = {
        deviceId: d['deviceId'],
        pubKey: d['pubKey'],
        label: typeof d['label'] === 'string' ? d['label'] : '',
        platform: typeof d['platform'] === 'string' ? d['platform'] : '',
        trustedAt: typeof d['trustedAt'] === 'number' ? d['trustedAt'] : 0,
      };
    }
  }
  return out;
}

/** Load a wallet's remote-signing settings, tolerant of missing/partial rows. */
export async function loadRemoteSigningSettings(walletId: number): Promise<RemoteSigningSettings> {
  try {
    const db = await getDb(walletId);
    const row = await db.table('config').where({ key: CONFIG_KEY }).first();
    const v = row?.value as Record<string, unknown> | undefined;
    if (!v || typeof v !== 'object') return defaultRemoteSigningSettings();
    return {
      enabled: v['enabled'] === true,
      policy: v['policy'] === 'require_remote' ? 'require_remote' : 'ask',
      trustedDevices: sanitizeTrusted(v['trustedDevices']),
    };
  } catch (e) {
    console.warn('loadRemoteSigningSettings failed, using defaults:', e);
    return defaultRemoteSigningSettings();
  }
}

/** Persist a wallet's remote-signing settings. */
export async function saveRemoteSigningSettings(
  walletId: number,
  settings: RemoteSigningSettings,
): Promise<void> {
  const db = await getDb(walletId);
  await db.table('config').put({ key: CONFIG_KEY, value: settings });
}
