import { describe, expect, it } from 'vitest';
import { NotifyError, type NotifyClient } from './notifyClient';
import { createNotifyStore, memoryNotifyStorage } from './notifyStore';
import { createNotifyRegistration, targetFingerprint, type PushManagerLike, type PushSubscriptionLike } from './notifyRegistration';
import type { DeviceBody, DeviceView, NotifyConfig, WalletPrefs } from './notifyTypes';

// The device registration tells gero-sync that this client can render broadcast announcements
// (`caps`) and which kinds its user switched off (`announcementsOff`). Both ride on PUT /device.

const CONFIG: NotifyConfig = {
  protocol: 1, protocols: [1], minClientProtocol: 1, enabled: true, vapidPublicKey: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  vapidKid: 'v1', categories: ['funds'], securityCategories: ['remoteSigning'], networks: ['cardano-preprod'],
  servedCategories: { webpush: { 'cardano-preprod': ['funds'] } }, limits: { walletsPerDevice: 20, devicesPerWallet: 50, paymentCredsPerLink: 200, paymentCredsPerWallet: 200 }, serverTime: 0,
};
const PREFS: WalletPrefs = { synced: { categoriesOff: [], typesOff: [], showAmounts: false, minReceiveLovelace: 1_000_000, updatedAt: null }, device: { muted: false } };
const TARGET = { endpoint: 'https://push.example.net/push/ep1', p256dh: 'p', auth: 'a', vapidKid: 'v1', expirationTime: null };

function machine(off: { value: unknown }, caps: (() => string[]) | null = () => ['announcements']) {
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
      current = { endpoint: TARGET.endpoint, expirationTime: null, toJSON: () => ({ endpoint: TARGET.endpoint, expirationTime: null, keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: async () => { current = null; return true; } };
      return current;
    },
  };
  const reg = createNotifyRegistration({
    client, store: createNotifyStore(memoryNotifyStorage()),
    identity: async () => ({ deviceId: 'dev', pubKeyHex: 'd75a' }),
    pushManager: () => pm, appVersion: () => '2.9.0', locale: async () => 'us',
    wallets: async () => [], logged: () => null, loadProof: async () => null, produceProof: async () => false,
    announcementsOff: async () => off.value as string[],
    ...(caps ? { caps } : {}),
    now: () => 1_790_553_600_000, random: (n) => new Uint8Array(n).fill(1),
  });
  return { reg, puts };
}

describe('announcement fields of the device registration', () => {
  it('says this client can render announcements, and which kinds are switched off', async () => {
    const m = machine({ value: ['news'] });
    expect(await m.reg.setBrowserEnabled(true)).toBe('ok');
    expect(m.puts.at(-1)).toMatchObject({ caps: ['announcements'], announcementsOff: ['news'] });
  });

  it('asks for no announcement pushes from a build that cannot verify one', async () => {
    // No key pinned: every announcement push could only be the generic text, so none is asked for.
    for (const caps of [() => [], null, () => ['announcements', 'root-access']]) {
      const m = machine({ value: [] }, caps);
      await m.reg.setBrowserEnabled(true);
      expect(m.puts.at(-1)?.caps).toEqual(caps && caps().includes('announcements') ? ['announcements'] : []);
    }
  });

  it('never sends service notices as switched off, whatever the store holds', async () => {
    for (const value of [['service', 'product', 'x', 7], 'news', null, undefined]) {
      const m = machine({ value });
      await m.reg.setBrowserEnabled(true);
      expect(m.puts.at(-1)?.announcementsOff).toEqual(Array.isArray(value) ? ['product'] : []);
    }
  });

  it('sends the registration again when the opt-outs change, and not when they do not', async () => {
    const off = { value: [] as string[] };
    const m = machine(off);
    await m.reg.setBrowserEnabled(true);
    const before = m.puts.length;
    await m.reg.reassert('settings');
    expect(m.puts).toHaveLength(before);
    off.value = ['product'];
    await m.reg.reassert('settings');
    expect(m.puts).toHaveLength(before + 1);
    expect(m.puts.at(-1)?.announcementsOff).toEqual(['product']);
    await m.reg.reassert('settings');
    expect(m.puts).toHaveLength(before + 1);
  });
});

describe('targetFingerprint', () => {
  it('is what it was for a device with nothing switched off', () => {
    expect(targetFingerprint(TARGET, '2.9.0', 'en', true)).toBe(JSON.stringify({ target: TARGET, appVersion: '2.9.0', locale: 'en', osPermission: true }));
    expect(targetFingerprint(TARGET, '2.9.0', 'en', true, [])).toBe(targetFingerprint(TARGET, '2.9.0', 'en', true));
  });

  it('changes with the opt-outs, whatever their order', () => {
    const none = targetFingerprint(TARGET, '2.9.0', 'en', true);
    const both = targetFingerprint(TARGET, '2.9.0', 'en', true, ['news', 'product']);
    expect(both).not.toBe(none);
    expect(targetFingerprint(TARGET, '2.9.0', 'en', true, ['product', 'news'])).toBe(both);
  });
});
