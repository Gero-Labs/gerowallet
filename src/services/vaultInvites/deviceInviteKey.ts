/**
 * This device's X25519 invite key pair (`PROTOCOL.md` 3.1): read, and made when there is none.
 *
 * Every device with vault invitations available has one and publishes its public half with
 * `PUT /device`, whether or not a vault screen was ever opened: a cosigner is invited by stake
 * credential, and a device that published no key is not in the directory, so an invitation sealed
 * for it reaches only decoys and is lost. So the key is made by the notify registration
 * (`publishableInviteKey`), not by the Create screen.
 *
 * The secret stays in the private store (`inviteRecords.ts`); only the public key leaves here.
 */
import { isUsableX25519Key, x25519PublicKey } from '@/shared/gerovault/invite';
import { bytesToHex, hexToBytes } from '@/shared/gerovault/cbor';
import type { InviteRecords } from './inviteRecords';

export interface DeviceInviteKey {
  readonly secret: Uint8Array;
  readonly publicKey: Uint8Array;
}

export interface DeviceInviteKeyDeps {
  random(n: number): Uint8Array;
  now(): number;
  log?(message: string): void;
}

/** The stored key pair, or null when there is none or it does not read as a usable pair. */
export async function readDeviceInviteKey(records: InviteRecords, log?: (message: string) => void): Promise<DeviceInviteKey | null> {
  const stored = await records.deviceKey();
  if (!stored) return null;
  const secret = hexToBytes(stored.secret);
  const publicKey = hexToBytes(stored.publicKey);
  if (secret?.length === 32 && publicKey && isUsableX25519Key(publicKey) && bytesToHex(x25519PublicKey(secret)) === stored.publicKey) {
    return { secret, publicKey };
  }
  log?.('vault invite key unreadable: a new one is made');
  return null;
}

type Ensured = { key: DeviceInviteKey | null; created: boolean };

// One creation at a time per store: the registration and a vault screen may both ask at worker
// start, and two keys would leave the published one without its secret.
const creating = new WeakMap<InviteRecords, Promise<Ensured>>();

/**
 * The device's key pair, made and stored when there is none. `created` tells the caller to publish
 * it. `key` is null only when no usable key could be drawn (never with a working random source).
 */
export function ensureDeviceInviteKey(records: InviteRecords, deps: DeviceInviteKeyDeps): Promise<Ensured> {
  const pending = creating.get(records);
  if (pending) return pending.then(r => ({ key: r.key, created: false }));
  const run = (async (): Promise<Ensured> => {
    const existing = await readDeviceInviteKey(records, deps.log);
    if (existing) return { key: existing, created: false };
    for (let attempt = 0; attempt < 4; attempt++) {
      const secret = deps.random(32);
      const publicKey = x25519PublicKey(secret);
      if (!isUsableX25519Key(publicKey)) continue;
      await records.setDeviceKey({ secret: bytesToHex(secret), publicKey: bytesToHex(publicKey), createdAt: deps.now() });
      return { key: { secret, publicKey }, created: true };
    }
    return { key: null, created: false };
  })().finally(() => creating.delete(records));
  creating.set(records, run);
  return run;
}

/**
 * The invite public key `PUT /device` carries (hex), or null: the key this device has, made first
 * when vault invitations are available here and it has none. With invitations unavailable nothing
 * is made, and a key from before is still published (its invitations stay readable). Never throws.
 */
export async function publishableInviteKey(records: InviteRecords, deps: DeviceInviteKeyDeps & { available(): Promise<boolean> }): Promise<string | null> {
  try {
    const existing = await readDeviceInviteKey(records);
    if (existing) return bytesToHex(existing.publicKey);
    if (!(await deps.available())) return null;
    const { key } = await ensureDeviceInviteKey(records, deps);
    return key ? bytesToHex(key.publicKey) : null;
  } catch (error) {
    deps.log?.(`vault invite key: ${String(error)}`);
    return null;
  }
}
