import { describe, expect, it } from 'vitest';
import { NotifyError, type NotifyClient } from './notifyClient';
import { createNotifyStore, memoryNotifyStorage } from './notifyStore';
import { VAULT_INVITES_CAP, createNotifyRegistration, type PushManagerLike, type PushSubscriptionLike } from './notifyRegistration';
import type { DeviceBody, DeviceView, NotifyConfig, WalletPrefs } from './notifyTypes';
import { publishableInviteKey } from '@/services/vaultInvites/deviceInviteKey';
import { createInviteRecords, memoryInviteKv } from '@/services/vaultInvites/inviteRecords';

// The device's GeroVault invite key is made and published by the normal notify registration
// (PUT /device `inviteKey` + the `vault_invites` cap), not only when Create vault is opened: a
// wallet with notifications on must be in the directory, or an invitation to it is lost.

const CONFIG: NotifyConfig = {
  protocol: 1, protocols: [1], minClientProtocol: 1, enabled: true, vapidPublicKey: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  vapidKid: 'v1', categories: ['funds'], securityCategories: ['remoteSigning'], networks: ['cardano-preprod'],
  servedCategories: { webpush: { 'cardano-preprod': ['funds'] } }, limits: { walletsPerDevice: 20, devicesPerWallet: 50, paymentCredsPerLink: 200, paymentCredsPerWallet: 200 }, serverTime: 0,
};
const PREFS: WalletPrefs = { synced: { categoriesOff: [], typesOff: [], showAmounts: false, minReceiveLovelace: 1_000_000, updatedAt: null }, device: { muted: false } };
const ENDPOINT = 'https://push.example.net/push/ep1';

function machine(available: { value: boolean }) {
  const puts: DeviceBody[] = [];
  let device: DeviceBody | null = null;
  const view = (): DeviceView => ({
    deviceId: 'dev', target: { transport: device?.transport ?? 'none', status: device?.transport === 'webpush' ? 'active' : 'none' },
    wallets: [], servedCategories: {}, reassertAfterMs: 604_800_000, serverTime: 0,
  });
  const client: NotifyClient = {
    async getConfig() { return CONFIG; },
    async getDevice() { if (!device) throw new NotifyError(401, 'device_unknown'); return view(); },
    async putDevice(body) { puts.push(body); device = body; return { ...view(), created: true }; },
    async deleteDevice() { device = null; },
    async putWallet() { throw new Error('not used'); },
    async deleteWallet() { /* not used */ },
    async getPrefs() { return PREFS; },
    async putPrefs() { return PREFS; },
    async watchOrders() { return { watching: 0 }; },
    async watchListings() { return { watching: 0 }; },
    async clockOffsetMs() { return 0; },
  };
  let current: PushSubscriptionLike | null = null;
  const pm: PushManagerLike = {
    getSubscription: async () => current,
    subscribe: async () => {
      current = { endpoint: ENDPOINT, expirationTime: null, toJSON: () => ({ endpoint: ENDPOINT, expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: async () => { current = null; return true; } };
      return current;
    },
  };
  const records = createInviteRecords(memoryInviteKv());
  let draws = 0;
  const reg = createNotifyRegistration({
    client, store: createNotifyStore(memoryNotifyStorage()),
    identity: async () => ({ deviceId: 'dev', pubKeyHex: 'd75a' }),
    pushManager: () => pm, appVersion: () => '2.9.0', locale: async () => 'us',
    wallets: async () => [], logged: () => null, loadProof: async () => null, produceProof: async () => false,
    // As notifyBackground wires it (`registrationInviteKey`).
    inviteKey: () => publishableInviteKey(records, {
      available: async () => available.value,
      random: n => new Uint8Array(n).fill(++draws),
      now: () => 1_790_553_600_000,
    }),
    now: () => 1_790_553_600_000, random: (n) => new Uint8Array(n).fill(1),
  });
  return { reg, puts, records };
}

describe('the invite key of the device registration', () => {
  it('turning notifications on makes the key and publishes it, without any vault screen', async () => {
    const m = machine({ value: true });
    expect(await m.records.deviceKey()).toBeUndefined();
    expect(await m.reg.setBrowserEnabled(true)).toBe('ok');
    const stored = await m.records.deviceKey();
    expect(stored?.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(m.puts.at(-1)).toMatchObject({ inviteKey: stored!.publicKey, caps: [VAULT_INVITES_CAP] });
    // Only the public half leaves the private store.
    expect(JSON.stringify(m.puts)).not.toContain(stored!.secret);
  });

  it('a worker start publishes the key of a device that registered before it had one', async () => {
    const available = { value: false };
    const m = machine(available);
    await m.reg.setBrowserEnabled(true);
    expect(m.puts.at(-1)?.inviteKey).toBeUndefined();
    expect(m.puts.at(-1)?.caps).toEqual([]);
    expect(await m.records.deviceKey()).toBeUndefined();
    const before = m.puts.length;

    // Vault invitations became available (the flag, or the update that makes the key here).
    available.value = true;
    expect(await m.reg.reassert('start')).toBe('reasserted');
    expect(m.puts).toHaveLength(before + 1);
    const key = (await m.records.deviceKey())!.publicKey;
    expect(m.puts.at(-1)).toMatchObject({ inviteKey: key, caps: [VAULT_INVITES_CAP] });

    // The same key from then on, and no PUT when nothing changed.
    await m.reg.reassert('start');
    expect(m.puts).toHaveLength(before + 1);
    expect((await m.records.deviceKey())!.publicKey).toBe(key);
  });

  it('makes no key where vault invitations are not available, and keeps publishing one it has', async () => {
    const available = { value: false };
    const m = machine(available);
    await m.reg.setBrowserEnabled(true);
    await m.reg.reassert('alarm');
    expect(await m.records.deviceKey()).toBeUndefined();

    available.value = true;
    await m.reg.reassert('alarm');
    const key = (await m.records.deviceKey())!.publicKey;
    available.value = false;
    await m.reg.reassert('settings');
    expect(m.puts.at(-1)?.inviteKey).toBe(key);
  });

  it('two callers at once end with one key', async () => {
    const records = createInviteRecords(memoryInviteKv());
    let draws = 0;
    const deps = { available: async () => true, random: (n: number) => new Uint8Array(n).fill(++draws), now: () => 1 };
    const [a, b] = await Promise.all([publishableInviteKey(records, deps), publishableInviteKey(records, deps)]);
    expect(a).toBe(b);
    expect((await records.deviceKey())?.publicKey).toBe(a);
  });
});
