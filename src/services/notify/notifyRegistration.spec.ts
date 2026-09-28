import { describe, it, expect, vi } from 'vitest';
import { NotifyDeferred, NotifyError, type NotifyClient } from './notifyClient';
import { createNotifyStore, memoryNotifyStorage, type NotifyStore } from './notifyStore';
import {
  capPaymentCredentials, createNotifyRegistration, credentialsHash, isEligibleWallet, toBcp47, wireNetworkOf,
  type LoggedWallet, type NotifyRegistration, type PushManagerLike, type PushSubscriptionLike,
} from './notifyRegistration';
import type { DeviceBody, DeviceView, NotifyConfig, WalletLinkBody, WalletPrefs, WalletProof } from './notifyTypes';

// ---- an in-memory server that behaves like the contract for what the machine sends ----
const CONFIG: NotifyConfig = {
  protocol: 1, protocols: [1], minClientProtocol: 1, enabled: true, vapidPublicKey: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  vapidKid: 'v1', categories: ['funds'], securityCategories: ['remoteSigning'], networks: ['cardano-preprod'],
  servedCategories: { webpush: { 'cardano-preprod': ['funds'] } }, limits: { walletsPerDevice: 20, devicesPerWallet: 50, paymentCredsPerLink: 200, paymentCredsPerWallet: 200 }, serverTime: 0,
};
const PREFS: WalletPrefs = { synced: { categoriesOff: [], showAmounts: false, minReceiveLovelace: 1_000_000, updatedAt: null }, device: { muted: false } };
type Call = { m: string; path?: string; body?: unknown };

function fakeServer() {
  const calls: Call[] = [];
  const server = {
    device: null as null | { body: DeviceBody; targetStatus: 'active' | 'none' | 'invalid'; invalidEndpoint?: string },
    links: new Map<string, WalletLinkBody>(),
    config: { ...CONFIG },
    fail: [] as Array<{ m: string; error: Error; times?: number }>,
    prefs: PREFS as WalletPrefs,
  };
  const failing = (m: string) => {
    const f = server.fail.find((x) => x.m === m && (x.times ?? 1) > 0);
    if (f) { f.times = (f.times ?? 1) - 1; throw f.error; }
  };
  const view = (): DeviceView => ({
    deviceId: 'dev', target: { transport: server.device?.body.transport ?? 'none', status: server.device?.targetStatus ?? 'none', ...(server.device?.targetStatus === 'invalid' ? { invalidReason: '410', invalidSince: 1 } : {}) },
    wallets: [...server.links.entries()].map(([walletTag, b]) => ({ walletTag, network: b.network, muted: false })),
    servedCategories: { 'cardano-preprod': ['funds'] }, reassertAfterMs: 604_800_000, serverTime: 0,
  });
  const client: NotifyClient = {
    async getConfig() { calls.push({ m: 'GET /config' }); failing('GET /config'); return server.config; },
    async getDevice() { calls.push({ m: 'GET /device' }); failing('GET /device'); if (!server.device) throw new NotifyError(401, 'device_unknown'); return view(); },
    async putDevice(body) {
      calls.push({ m: 'PUT /device', body }); failing('PUT /device');
      if (server.device?.targetStatus === 'invalid' && body.webpush?.endpoint === server.device.invalidEndpoint) throw new NotifyError(409, 'target_invalid', { invalidReason: '410', invalidSince: 1 });
      server.device = { body, targetStatus: body.transport === 'webpush' ? 'active' : 'none' };
      return { ...view(), created: true };
    },
    async deleteDevice() { calls.push({ m: 'DELETE /device' }); failing('DELETE /device'); server.device = null; server.links.clear(); },
    async putWallet(walletTag, body) {
      calls.push({ m: 'PUT /wallet', path: walletTag, body }); failing('PUT /wallet');
      if (!server.device) throw new NotifyError(401, 'device_unknown');
      const created = !server.links.has(walletTag);
      server.links.set(walletTag, body);
      return { walletTag, created, prefs: PREFS, servedCategories: { [body.network]: ['funds'] }, credentialCoverage: { link: body.paymentCreds.length, wallet: body.paymentCreds.length, walletTruncated: 0 } };
    },
    async deleteWallet(walletTag) { calls.push({ m: 'DELETE /wallet', path: walletTag }); failing('DELETE /wallet'); server.links.delete(walletTag); },
    async getPrefs(walletTag) { calls.push({ m: 'GET /prefs', path: walletTag }); failing('GET /prefs'); if (!server.links.has(walletTag)) throw new NotifyError(404, 'wallet_not_registered'); return server.prefs; },
    async putPrefs(walletTag, body) { calls.push({ m: 'PUT /prefs', path: walletTag, body }); return { ...PREFS, device: body.device ?? PREFS.device }; },
    async clockOffsetMs() { return 0; },
  };
  return { server, calls, client };
}

// ---- a fake pushManager that hands out numbered endpoints ----
function fakePushManager() {
  let current: PushSubscriptionLike | null = null;
  let n = 0;
  const subscribe = vi.fn(async (_options: { userVisibleOnly: true; applicationServerKey: Uint8Array }) => {
    n++;
    const endpoint = `https://push.example.net/push/ep${n}`;
    const sub: PushSubscriptionLike = { endpoint, expirationTime: null, toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } }), unsubscribe: async () => { current = null; return true; } };
    current = sub;
    return sub;
  });
  const pm: PushManagerLike = { getSubscription: async () => current, subscribe };
  return { pm, subscribe, set: (s: PushSubscriptionLike | null) => { current = s; }, get: () => current, fail: () => { subscribe.mockRejectedValueOnce(new Error('push service error')); } };
}

const PROOF: WalletProof = { coseSign1: '84', coseKey: 'a5', stakeAddress: 'stake_test1abc' };
const creds = (n: number) => Array.from({ length: n }, (_, i) => i.toString(16).padStart(56, '0'));
function loggedWallet(over: Partial<LoggedWallet> = {}): LoggedWallet {
  return { id: 4, chain: 'Cardano', network: 'Preprod', type: 'Normal', stakeAddress: 'stake_test1abc', derivePaymentCredentials: () => creds(40), ...over };
}

function machine(opts: { logged?: LoggedWallet | null; wallets?: Array<{ id: number; chain: string; network: string; type?: string }>; proof?: WalletProof | null; storage?: ReturnType<typeof memoryNotifyStorage>; pushManager?: PushManagerLike | null } = {}) {
  const fake = fakeServer();
  const push = fakePushManager();
  const storage = opts.storage ?? memoryNotifyStorage();
  const store: NotifyStore = createNotifyStore(storage);
  const proofs = new Map<string, WalletProof>();
  if (opts.proof !== null) proofs.set('stake_test1abc', opts.proof ?? PROOF);
  const produceProof = vi.fn(async () => { proofs.set('stake_test1abc', PROOF); return true; });
  const logs: string[] = [];
  let clock = 1_790_553_600_000;
  const logged = opts.logged === undefined ? loggedWallet() : opts.logged;
  const reg: NotifyRegistration = createNotifyRegistration({
    client: fake.client, store,
    identity: async () => ({ deviceId: 'dev', pubKeyHex: 'd75a' }),
    pushManager: () => (opts.pushManager === undefined ? push.pm : opts.pushManager),
    appVersion: () => '2.8.0', locale: async () => 'us',
    wallets: async () => opts.wallets ?? (logged ? [logged] : []),
    logged: () => logged,
    loadProof: async (_id, stake) => proofs.get(stake) ?? null,
    produceProof,
    now: () => clock, random: (n) => new Uint8Array(n).fill(n === 16 ? 0x5a : 1), log: (m) => logs.push(m),
  });
  return { reg, fake, push, store, storage, proofs, produceProof, logs, advance: (ms: number) => { clock += ms; } };
}

async function optedIn(m = machine()) {
  expect(await m.reg.setBrowserEnabled(true)).toBe('ok');
  expect(await m.reg.enableWallet()).toBe('ok');
  m.fake.calls.length = 0;
  m.push.subscribe.mockClear();
  return m;
}

describe('pure helpers', () => {
  it('wire network, locale mapping, eligibility', () => {
    expect(wireNetworkOf('Preprod')).toBe('cardano-preprod');
    expect(toBcp47('us')).toBe('en');
    expect(toBcp47('de')).toBe('de');
    expect(toBcp47('es')).toBe('es');
    expect(isEligibleWallet({ chain: 'Cardano', network: 'Mainnet', type: 'Normal', stakeAddress: 'stake1abc' })).toBe(true);
    expect(isEligibleWallet({ chain: 'Cardano', network: 'Preview', type: 'Normal', stakeAddress: 'stake_test1abc' })).toBe(true);
    expect(isEligibleWallet({ chain: 'Cardano', network: 'Mainnet', type: 'Ledger', stakeAddress: 'stake1abc' })).toBe(false);
    expect(isEligibleWallet({ chain: 'Cardano', network: 'Mainnet', type: 'Watch', stakeAddress: 'stake1abc' })).toBe(false);
    expect(isEligibleWallet({ chain: 'Bitcoin', network: 'Mainnet', type: 'Normal', stakeAddress: undefined })).toBe(false);
    expect(isEligibleWallet({ chain: 'Cardano', network: 'Mainnet', type: 'Normal', stakeAddress: '' })).toBe(false);
  });

  it('above 200 credentials, sends the lowest 100 external plus the lowest 100 internal', () => {
    const external = Array.from({ length: 160 }, (_, i) => `e${i}`);
    const internal = Array.from({ length: 160 }, (_, i) => `i${i}`);
    const capped = capPaymentCredentials([...external, ...internal]);
    expect(capped).toHaveLength(200);
    expect(capped.slice(0, 100)).toEqual(external.slice(0, 100));
    expect(capped.slice(100)).toEqual(internal.slice(0, 100));
    expect(capPaymentCredentials(['a', 'a', 'b'])).toEqual(['a', 'b']);
    expect(credentialsHash(['a', 'b'])).not.toBe(credentialsHash(['b', 'a']));
  });
});

describe('opt-in (§8.1)', () => {
  it('browser on: /config, subscribe with the VAPID key, PUT /device with the subscription from toJSON()', async () => {
    const m = machine();
    expect(await m.reg.setBrowserEnabled(true)).toBe('ok');
    expect(m.push.subscribe).toHaveBeenCalledTimes(1);
    expect(m.push.subscribe.mock.calls[0][0].userVisibleOnly).toBe(true);
    const put = m.fake.calls.find((c) => c.m === 'PUT /device')?.body as DeviceBody;
    expect(put).toMatchObject({ protocol: 1, relayPubKey: 'd75a', platform: 'extension', appVersion: '2.8.0', locale: 'en', osPermission: true, transport: 'webpush' });
    expect(put.webpush).toEqual({ endpoint: 'https://push.example.net/push/ep1', p256dh: expect.any(String), auth: 'BTBZMqHH6r4Tts7J_aSIgg', vapidKid: 'v1', expirationTime: null });
    expect(await m.store.getDevice()).toMatchObject({ browserEnabled: true, targetStatus: 'active', endpoint: 'https://push.example.net/push/ep1', vapidKid: 'v1' });
  });

  it('does not subscribe while /config has enabled:false or vapidPublicKey:null (stays dark)', async () => {
    for (const patch of [{ enabled: false }, { vapidPublicKey: null }]) {
      const m = machine();
      m.fake.server.config = { ...CONFIG, ...patch };
      expect(await m.reg.setBrowserEnabled(true)).toBe('unavailable');
      expect(m.push.subscribe).not.toHaveBeenCalled();
      expect(m.fake.calls.map((c) => c.m)).toEqual(['GET /config']);
      expect((await m.store.getDevice()).unavailable).toBe('server_disabled');
    }
  });

  it('a failed subscribe() (Brave, no push service) stores browserEnabled:false with the hint', async () => {
    const m = machine();
    m.push.fail();
    expect(await m.reg.setBrowserEnabled(true)).toBe('subscribe_failed');
    expect(await m.store.getDevice()).toMatchObject({ browserEnabled: false, unavailable: 'subscribe_failed' });
    expect(m.fake.calls.some((c) => c.m === 'PUT /device')).toBe(false);
  });

  it('422 endpoint_not_allowed is treated the same way', async () => {
    const m = machine();
    m.fake.server.fail.push({ m: 'PUT /device', error: new NotifyError(422, 'endpoint_not_allowed') });
    expect(await m.reg.setBrowserEnabled(true)).toBe('endpoint_not_allowed');
    expect(await m.store.getDevice()).toMatchObject({ browserEnabled: false, unavailable: 'endpoint_not_allowed' });
  });

  it('422 vapid_kid_stale: unsubscribe, refetch /config, subscribe again, PUT again with the new kid', async () => {
    const m = machine();
    m.fake.server.fail.push({ m: 'PUT /device', error: new NotifyError(422, 'vapid_kid_stale', { currentKid: 'v2' }) });
    let configs = 0;
    const original = m.fake.client.getConfig;
    m.fake.client.getConfig = async (o) => { configs++; if (configs >= 2) m.fake.server.config = { ...CONFIG, vapidKid: 'v2' }; return original(o); };
    expect(await m.reg.setBrowserEnabled(true)).toBe('ok');
    expect(m.push.subscribe).toHaveBeenCalledTimes(2);
    const puts = m.fake.calls.filter((c) => c.m === 'PUT /device').map((c) => (c.body as DeviceBody).webpush);
    expect(puts.map((w) => w?.vapidKid)).toEqual(['v1', 'v2']);
    expect(puts[1]?.endpoint).toBe('https://push.example.net/push/ep2');
  });

  it('wallet on: uses the cached proof (no prompt), sends this device\'s credentials, stores prefs and servedCategories', async () => {
    const m = machine();
    await m.reg.setBrowserEnabled(true);
    expect(await m.reg.enableWallet()).toBe('ok');
    expect(m.produceProof).not.toHaveBeenCalled();
    const put = m.fake.calls.find((c) => c.m === 'PUT /wallet') as Call;
    expect(put.path).toBe('5a'.repeat(16));
    expect(put.body).toMatchObject({ network: 'cardano-preprod', stakeAddress: 'stake_test1abc', proof: PROOF, eventKey: '5a'.repeat(16) });
    expect((put.body as WalletLinkBody).paymentCreds).toHaveLength(40);
    const w = await m.store.getWallet(4);
    expect(w).toMatchObject({ walletTag: '5a'.repeat(16), prefs: PREFS, servedCategories: ['funds'], needsProof: false });
    expect(w?.registeredAt).not.toBeNull();
  });

  it('wallet on without a cached proof: needs_auth first, then produces the proof under auth', async () => {
    const m = machine({ proof: null });
    await m.reg.setBrowserEnabled(true);
    expect(await m.reg.enableWallet()).toBe('needs_auth');
    expect(await m.reg.enableWallet({ password: 'pw' })).toBe('ok');
    expect(m.produceProof).toHaveBeenCalledWith({ password: 'pw' });
  });

  it('wallet on refuses when the browser switch is off, the wallet is ineligible, or none is logged in', async () => {
    expect(await machine().reg.enableWallet()).toBe('browser_off');
    const ledger = machine({ logged: loggedWallet({ type: 'Ledger' }) });
    await ledger.reg.setBrowserEnabled(true);
    expect(await ledger.reg.enableWallet()).toBe('ineligible');
    const none = machine({ logged: null });
    await none.reg.setBrowserEnabled(true);
    expect(await none.reg.enableWallet()).toBe('no_wallet');
  });

  it('a 409 wallet_tag_conflict picks a new tag once; 422 proof_invalid flags needsProof', async () => {
    const m = machine();
    await m.reg.setBrowserEnabled(true);
    m.fake.server.fail.push({ m: 'PUT /wallet', error: new NotifyError(409, 'wallet_tag_conflict') });
    expect(await m.reg.enableWallet()).toBe('ok');
    expect(m.fake.calls.filter((c) => c.m === 'PUT /wallet')).toHaveLength(2);
    const p = machine();
    await p.reg.setBrowserEnabled(true);
    p.fake.server.fail.push({ m: 'PUT /wallet', error: new NotifyError(422, 'proof_invalid', { reason: 'key_binding' }) });
    expect(await p.reg.enableWallet()).toBe('proof_invalid');
    expect((await p.store.getWallet(4))?.needsProof).toBe(true);
  });
});

describe('re-assertion (§8.2)', () => {
  it('starts with GET /device (F2) and sends nothing when nothing changed', async () => {
    const m = await optedIn();
    expect(await m.reg.reassert('start')).toBe('reasserted');
    expect(m.fake.calls.map((c) => c.m)).toEqual(['GET /device', 'GET /config']);
    expect(m.push.subscribe).not.toHaveBeenCalled();
  });

  it('device_unknown on GET runs the full registration and restores the wallet links', async () => {
    const m = await optedIn();
    m.fake.server.device = null; m.fake.server.links.clear(); // the server garbage-collected us
    expect(await m.reg.reassert('start')).toBe('registered');
    expect(m.fake.calls.map((c) => c.m)).toEqual(['GET /device', 'GET /config', 'PUT /device', 'PUT /wallet']);
  });

  it('re-sends PUT /device when the fingerprint changed (appVersion) or reassertAfterMs passed', async () => {
    const m = await optedIn();
    m.advance(7 * 86_400_000 + 1);
    expect(await m.reg.reassert('alarm')).toBe('reasserted');
    expect(m.fake.calls.filter((c) => c.m === 'PUT /device')).toHaveLength(1);
    expect(m.push.subscribe).not.toHaveBeenCalled();
  });

  it('invalid target: unsubscribe, subscribe, PUT with the NEW endpoint, never the old one; a second 409 stops with needs_attention', async () => {
    const m = await optedIn();
    m.fake.server.device!.targetStatus = 'invalid';
    m.fake.server.device!.invalidEndpoint = 'https://push.example.net/push/ep1';
    expect(await m.reg.reassert('start')).toBe('recovered');
    const puts = m.fake.calls.filter((c) => c.m === 'PUT /device').map((c) => (c.body as DeviceBody).webpush?.endpoint);
    expect(puts).toEqual(['https://push.example.net/push/ep2']);
    expect(m.push.subscribe).toHaveBeenCalledTimes(1);
    // The browser hands the same endpoint back every time: one more try, then stop.
    const same = await optedIn();
    same.fake.server.device!.targetStatus = 'invalid';
    same.fake.server.device!.invalidEndpoint = 'https://push.example.net/push/ep1';
    same.push.subscribe.mockImplementation(async () => { const sub: PushSubscriptionLike = { endpoint: 'https://push.example.net/push/ep1', expirationTime: null, toJSON: () => ({ endpoint: 'https://push.example.net/push/ep1', keys: { p256dh: 'p', auth: 'a' } }), unsubscribe: async () => true }; same.push.set(sub); return sub; });
    expect(await same.reg.reassert('start')).toBe('needs_attention');
    expect((await same.store.getDevice()).targetStatus).toBe('needs_attention');
    expect(same.fake.calls.filter((c) => c.m === 'PUT /device')).toHaveLength(1);
  });

  it('endpoint drift, an expirationTime within 7 days, or a different VAPID key resubscribe', async () => {
    const drift = await optedIn();
    drift.push.set({ ...drift.push.get()!, endpoint: 'https://push.example.net/push/other', toJSON: () => ({ endpoint: 'https://push.example.net/push/other', keys: { p256dh: 'p', auth: 'a' } }) });
    expect(await drift.reg.reassert('start')).toBe('reasserted');
    expect(drift.push.subscribe).toHaveBeenCalledTimes(1);
    const expiring = await optedIn();
    expiring.push.get()!.expirationTime = 1_790_553_600_000 + 3 * 86_400_000;
    await expiring.reg.reassert('start');
    expect(expiring.push.subscribe).toHaveBeenCalledTimes(1);
    const rotated = await optedIn();
    rotated.fake.server.config = { ...CONFIG, vapidKid: 'v2', vapidPublicKey: 'BLhfj0vFsN1yeZm8nqfEEUW4UpEvCEwhHfTJRa9zPqNEwqS_zGaA6pMzXD5jBkjbg8mA2VfRQwvW3kQz6KTzSIY' };
    await rotated.reg.reassert('start');
    expect(rotated.push.subscribe).toHaveBeenCalledTimes(1);
    expect((await rotated.store.getDevice()).vapidKid).toBe('v2');
  });

  it('opt-out rule (F7): with browserEnabled:false a start, the alarm and pushsubscriptionchange call subscribe 0 times and send no webpush PUT, while pending deletes still flush', async () => {
    const m = await optedIn();
    expect(await m.reg.setBrowserEnabled(false)).toBe('off');
    expect((m.fake.calls.find((c) => c.m === 'PUT /device')?.body as DeviceBody).transport).toBe('none');
    expect(m.push.get()).toBeNull();
    m.fake.calls.length = 0;
    await m.store.enqueueDelete({ kind: 'wallet', walletTag: 'ff'.repeat(16), enqueuedAt: 1 });
    for (const trigger of ['start', 'alarm', 'pushsubscriptionchange'] as const) {
      expect(await m.reg.reassert(trigger)).toBe('opted_out');
    }
    expect(m.push.subscribe).not.toHaveBeenCalled();
    expect(m.fake.calls.filter((c) => c.m === 'PUT /device')).toEqual([]);
    expect(m.fake.calls.filter((c) => c.m === 'DELETE /wallet')).toHaveLength(1);
    expect(await m.store.getPendingDeletes()).toEqual([]);
  });

  it('reconciliation deletes a server link whose wallet is gone locally', async () => {
    const m = await optedIn();
    m.fake.server.links.set('ab'.repeat(16), { network: 'cardano-preprod', stakeAddress: 'stake_test1old', proof: PROOF, paymentCreds: [], eventKey: 'x' });
    await m.reg.reassert('start');
    expect(m.fake.calls.filter((c) => c.m === 'DELETE /wallet').map((c) => c.path)).toEqual(['ab'.repeat(16)]);
    expect(m.fake.server.links.has('5a'.repeat(16))).toBe(true);
  });

  it('G4: restores a link the server lost from stored state and the cached proof, with no prompt and no DELETE', async () => {
    const m = await optedIn();
    m.fake.server.links.clear();
    await m.store.setWallet(4, { ...(await m.store.getWallet(4))!, prefs: { ...PREFS, device: { muted: true } } });
    expect(await m.reg.reassert('start')).toBe('reasserted');
    const put = m.fake.calls.find((c) => c.m === 'PUT /wallet') as Call;
    expect(put.path).toBe('5a'.repeat(16));
    expect(put.body).toMatchObject({ eventKey: '5a'.repeat(16), proof: PROOF, stakeAddress: 'stake_test1abc' });
    expect((put.body as WalletLinkBody).paymentCreds).toHaveLength(40);
    expect(m.fake.calls.filter((c) => c.m === 'DELETE /wallet')).toEqual([]);
    expect(m.produceProof).not.toHaveBeenCalled();
    expect(m.fake.calls.find((c) => c.m === 'PUT /prefs')).toMatchObject({ path: '5a'.repeat(16), body: { device: { muted: true } } });
  });

  it('G4 without a cached proof: no PUT, the wallet shows the re-confirm hint', async () => {
    const m = await optedIn();
    m.fake.server.links.clear();
    m.proofs.clear();
    await m.reg.reassert('start');
    expect(m.fake.calls.filter((c) => c.m === 'PUT /wallet')).toEqual([]);
    expect((await m.store.getWallet(4))?.needsProof).toBe(true);
  });

  it('G4 restores even when the wallet is not logged in, using the credentials last sent', async () => {
    const m = await optedIn();
    const state = await m.store.getWallet(4);
    const closed = machine({ logged: null, wallets: [{ id: 4, chain: 'Cardano', network: 'Preprod', type: 'Normal' }], storage: m.storage });
    closed.fake.server.device = m.fake.server.device; // same server, links lost
    await closed.reg.reassert('start');
    const put = closed.fake.calls.find((c) => c.m === 'PUT /wallet') as Call;
    expect((put.body as WalletLinkBody).paymentCreds).toEqual(state?.paymentCreds);
  });

  it('a changed credential set (range expansion) re-sends the wallet link', async () => {
    const m = await optedIn();
    (m as unknown as { grow: () => void }).grow = () => undefined;
    const logged = loggedWallet({ derivePaymentCredentials: () => creds(80) });
    const grown = machine({ logged, storage: m.storage });
    grown.fake.server.device = m.fake.server.device; grown.fake.server.links = m.fake.server.links;
    await grown.reg.credentialsChanged();
    const put = grown.fake.calls.find((c) => c.m === 'PUT /wallet') as Call;
    expect((put.body as WalletLinkBody).paymentCreds).toHaveLength(80);
    grown.fake.calls.length = 0;
    await grown.reg.credentialsChanged(); // unchanged now: nothing
    expect(grown.fake.calls).toEqual([]);
  });

  it('a deferred retry (nonce fence) stops the run quietly and a later run continues', async () => {
    const m = await optedIn();
    m.fake.server.fail.push({ m: 'GET /device', error: new NotifyDeferred('nonce_store_unavailable', 1_790_554_200_000) });
    expect(await m.reg.reassert('start')).toBe('deferred');
    await m.store.setRetry({ dueAt: 1_790_554_200_000, attempt: 1, reason: 'nonce_store_unavailable' });
    expect(await m.reg.reassert('alarm')).toBe('skipped'); // before dueAt, not the retry alarm
    expect(await m.reg.reassert('retry')).toBe('reasserted');
    expect(await m.store.getRetry()).toBeNull();
  });

  it('426 stops every run', async () => {
    const m = await optedIn();
    await m.store.updateDevice({ protocolUnsupported: true });
    expect(await m.reg.reassert('start')).toBe('skipped');
    expect(m.fake.calls).toEqual([]);
  });
});

describe('wallet removal (§8.5, §8.6)', () => {
  it('enqueues the DELETE durably before anything else, sends it, and forgets the tag only on success', async () => {
    const m = await optedIn();
    m.fake.server.fail.push({ m: 'DELETE /wallet', error: new NotifyError(503, 'unavailable') });
    await m.reg.walletRemoved(4);
    expect(await m.store.getWallet(4)).toBeNull();
    expect(await m.store.getPendingDeletes()).toMatchObject([{ kind: 'wallet', walletTag: '5a'.repeat(16) }, { kind: 'device' }]);
    // The queue survives a restart and flushes on the next run.
    const restarted = machine({ logged: null, wallets: [], storage: m.storage });
    restarted.fake.server.device = m.fake.server.device; restarted.fake.server.links = m.fake.server.links;
    expect(await restarted.reg.reassert('start')).toBe('opted_out'); // the last wallet went: no re-subscribe
    expect(restarted.fake.calls.map((c) => c.m)).toEqual(['DELETE /wallet', 'DELETE /device']);
    expect(restarted.push.subscribe).not.toHaveBeenCalled();
    expect(await restarted.store.getPendingDeletes()).toEqual([]);
  });

  it('the last registered wallet also unregisters the device and unsubscribes', async () => {
    const m = await optedIn();
    await m.reg.walletRemoved(4);
    expect(m.fake.calls.map((c) => c.m)).toEqual(['DELETE /wallet', 'DELETE /device']);
    expect(m.push.get()).toBeNull();
    expect(m.fake.server.device).toBeNull();
  });

  it('disableWallet removes only the link; prefs writes go through PUT …/prefs', async () => {
    const m = await optedIn();
    expect(await m.reg.setPrefs(4, { synced: { categoriesOff: ['staking'], showAmounts: true, minReceiveLovelace: 2_000_000 } })).toBe('ok');
    expect(m.fake.calls[0]).toMatchObject({ m: 'PUT /prefs', body: { synced: { categoriesOff: ['staking'] } } });
    await m.reg.disableWallet(4);
    expect(m.fake.calls.map((c) => c.m)).toEqual(['PUT /prefs', 'DELETE /wallet']);
    expect(m.fake.server.device).not.toBeNull();
    expect(await m.reg.setPrefs(4, { device: { muted: true } })).toBe('not_registered');
  });
});

describe('settings refresh (§4.8)', () => {
  it('refreshPrefs replaces the stored synced prefs with the server\'s (another device wrote them)', async () => {
    const m = await optedIn();
    m.fake.server.prefs = { synced: { categoriesOff: ['funds'], showAmounts: true, minReceiveLovelace: 5_000_000, updatedAt: 7 }, device: { muted: false } };
    expect(await m.reg.refreshPrefs(4)).toBe('ok');
    expect(m.fake.calls.map((c) => c.m)).toEqual(['GET /prefs']);
    expect((await m.store.getWallet(4))?.prefs?.synced).toEqual({ categoriesOff: ['funds'], showAmounts: true, minReceiveLovelace: 5_000_000, updatedAt: 7 });
  });

  it('refreshPrefs on a link the server dropped marks the wallet unregistered; an unregistered wallet is not fetched', async () => {
    const m = await optedIn();
    m.fake.server.links.clear();
    expect(await m.reg.refreshPrefs(4)).toBe('not_registered');
    expect((await m.store.getWallet(4))?.registeredAt).toBeNull();
    m.fake.calls.length = 0;
    expect(await m.reg.refreshPrefs(4)).toBe('not_registered');
    expect(m.fake.calls).toEqual([]);
  });
});
