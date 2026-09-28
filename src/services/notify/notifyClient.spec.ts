import { describe, it, expect } from 'vitest';
import { createNotifyClient, NotifyDeferred, NotifyError } from './notifyClient';
import { createNotifyStore, memoryNotifyStorage } from './notifyStore';
import type { DeviceBody } from './notifyTypes';

// A scripted server: each entry answers one request in order; `seen` records what was sent.
type Reply = { status: number; json?: unknown; headers?: Record<string, string> } | Error;
type Seen = { method: string; url: string; headers: Record<string, string>; body: string };
function harness(replies: Reply[], opts: { now?: () => number; deviceBody?: () => Promise<DeviceBody | null> } = {}) {
  const seen: Seen[] = [];
  const sleeps: number[] = [];
  const scheduled: Array<{ dueAt: number; reason: string }> = [];
  let clock = 1_790_553_600_000;
  const now = opts.now ?? (() => clock);
  const store = createNotifyStore(memoryNotifyStorage());
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ method: init.method as string, url, headers: (init.headers as Record<string, string>) ?? {}, body: init.body ? new TextDecoder().decode(init.body as Uint8Array) : '' });
    const reply = replies.shift();
    if (!reply) throw new Error('no scripted reply left');
    if (reply instanceof Error) throw reply;
    const body = reply.json === undefined ? '' : JSON.stringify(reply.json);
    return new Response(body, { status: reply.status, headers: reply.headers });
  }) as unknown as typeof fetch;
  const client = createNotifyClient({
    baseUrl: 'https://sync.gerowallet.io/api/notify/v1', fetch: fetchImpl, store, now,
    identity: async () => ({ deviceId: '21fe31dfa154a261626bf854046fd227', privKeyHex: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60' }),
    sleep: async (ms) => { sleeps.push(ms); clock += ms; },
    random: () => 0.5,
    scheduleRetry: (dueAt, reason) => { scheduled.push({ dueAt, reason }); },
    deviceBody: opts.deviceBody,
  });
  return { client, seen, sleeps, scheduled, store, advance: (ms: number) => { clock += ms; } };
}
const deviceView = { deviceId: '21fe31dfa154a261626bf854046fd227', target: { transport: 'none', status: 'none' }, wallets: [], servedCategories: {}, reassertAfterMs: 604800000, serverTime: 1_790_553_600_500 };
const err = (status: number, code: string, details?: Record<string, unknown>, headers?: Record<string, string>): Reply => ({ status, json: { error: { code, message: code, details } }, headers });

describe('notifyClient', () => {
  it('signs the raw path with the four headers, sends the same bytes it hashed, and records serverTime as clockOffset', async () => {
    const h = harness([{ status: 200, json: deviceView }]);
    await h.client.getDevice();
    const [req] = h.seen;
    expect(req.url).toBe('https://sync.gerowallet.io/api/notify/v1/device');
    expect(req.headers['X-Gero-Device']).toBe('21fe31dfa154a261626bf854046fd227');
    expect(req.headers['X-Gero-Ts']).toBe('1790553600000');
    expect(req.headers['X-Gero-Nonce']).toMatch(/^[0-9a-f]{32}$/);
    expect(req.headers['X-Gero-Sig']).toMatch(/^[0-9a-f]{128}$/);
    expect(req.headers['Content-Type']).toBeUndefined();
    expect(await h.client.clockOffsetMs()).toBe(500);
  });

  it('PUT sends application/json with compact bytes and signs with the corrected clock', async () => {
    const h = harness([{ status: 200, json: deviceView }]);
    await h.store.updateDevice({ clockOffsetMs: 1234 });
    const body: DeviceBody = { protocol: 1, relayPubKey: 'd75a', platform: 'extension', appVersion: '2.8.0', locale: 'en', osPermission: true, transport: 'none' };
    await h.client.putDevice(body);
    expect(h.seen[0].headers['Content-Type']).toBe('application/json');
    expect(h.seen[0].body).toBe(JSON.stringify(body));
    expect(h.seen[0].headers['X-Gero-Ts']).toBe(String(1_790_553_600_000 + 1234));
  });

  it('auth_clock_skew: stores serverTime − now and retries exactly once', async () => {
    const h = harness([err(401, 'auth_clock_skew', { serverTime: 1_790_553_900_000 }), { status: 200, json: deviceView }]);
    await h.client.getDevice();
    expect(h.seen).toHaveLength(2);
    expect(h.seen[1].headers['X-Gero-Ts']).toBe('1790553900000');
    expect(h.seen[1].headers['X-Gero-Nonce']).not.toBe(h.seen[0].headers['X-Gero-Nonce']);
    const again = harness([err(401, 'auth_clock_skew', { serverTime: 1 }), err(401, 'auth_clock_skew', { serverTime: 2 })]);
    await expect(again.client.getDevice()).rejects.toMatchObject({ code: 'auth_clock_skew' });
    expect(again.seen).toHaveLength(2);
  });

  it('device_unknown: registers the device through the hook, then retries once; on DELETE it is success', async () => {
    const body: DeviceBody = { protocol: 1, relayPubKey: 'd75a', platform: 'extension', appVersion: '2.8.0', osPermission: true, transport: 'none' };
    const h = harness([err(401, 'device_unknown'), { status: 201, json: { ...deviceView, created: true } }, { status: 200, json: { synced: {}, device: { muted: false } } }], { deviceBody: async () => body });
    await h.client.getPrefs('a'.repeat(32));
    expect(h.seen.map((s) => `${s.method} ${s.url.split('/v1')[1]}`)).toEqual(['GET /device/wallets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/prefs', 'PUT /device', 'GET /device/wallets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/prefs']);
    const del = harness([err(401, 'device_unknown')]);
    await expect(del.client.deleteWallet('b'.repeat(32))).resolves.toBeUndefined();
    const noHook = harness([err(401, 'device_unknown')]);
    await expect(noHook.client.getDevice()).rejects.toMatchObject({ code: 'device_unknown' });
  });

  it('auth_replay: re-signs with a fresh nonce once', async () => {
    const h = harness([err(401, 'auth_replay'), { status: 200, json: deviceView }]);
    await h.client.getDevice();
    expect(h.seen).toHaveLength(2);
    expect(h.seen[1].headers['X-Gero-Nonce']).not.toBe(h.seen[0].headers['X-Gero-Nonce']);
  });

  it('429 honours Retry-After (short waits in-process), every attempt freshly signed, three retries then stop', async () => {
    const h = harness([err(429, 'rate_limited', undefined, { 'retry-after': '7' }), err(429, 'rate_limited', undefined, { 'retry-after': '7' }), { status: 200, json: deviceView }]);
    await h.client.getDevice();
    expect(h.sleeps).toEqual([7000, 7000]); // random 0.5 × 5 s / 10 s ceilings stay below Retry-After
    expect(new Set(h.seen.map((s) => s.headers['X-Gero-Nonce'])).size).toBe(3);
    expect(h.seen[2].headers['X-Gero-Ts']).not.toBe(h.seen[0].headers['X-Gero-Ts']);
    const stop = harness([err(503, 'unavailable'), err(503, 'unavailable'), err(503, 'unavailable'), err(503, 'unavailable'), { status: 200, json: deviceView }]);
    await expect(stop.client.getDevice()).rejects.toMatchObject({ status: 503, code: 'unavailable' });
    expect(stop.seen).toHaveLength(4); // one call + three retries
    expect(stop.sleeps).toEqual([2500, 5000, 10000]); // full jitter at 0.5: 5 s, 10 s, 20 s ceilings
  });

  it('network errors back off the same way', async () => {
    const h = harness([new TypeError('Failed to fetch'), { status: 200, json: deviceView }]);
    await h.client.getDevice();
    expect(h.sleeps).toEqual([2500]);
  });

  it('503 nonce_store_unavailable with Retry-After 600 (G2): one alarm at least 600 s out, nothing sent again now', async () => {
    const h = harness([err(503, 'nonce_store_unavailable', undefined, { 'retry-after': '600' })]);
    await expect(h.client.getDevice()).rejects.toBeInstanceOf(NotifyDeferred);
    expect(h.seen).toHaveLength(1);
    expect(h.sleeps).toEqual([]);
    expect(h.scheduled).toEqual([{ dueAt: 1_790_553_600_000 + 600_000, reason: 'nonce_store_unavailable' }]);
    expect(await h.store.getRetry()).toEqual({ dueAt: 1_790_553_600_000 + 600_000, attempt: 1, reason: 'nonce_store_unavailable' });
  });

  it('426 marks the protocol unsupported and throws', async () => {
    const h = harness([err(426, 'client_protocol_unsupported')]);
    await expect(h.client.getDevice()).rejects.toMatchObject({ code: 'client_protocol_unsupported' });
    expect((await h.store.getDevice()).protocolUnsupported).toBe(true);
  });

  it('other errors are thrown as NotifyError with code and details, no retry', async () => {
    const h = harness([err(409, 'target_invalid', { invalidReason: '410', invalidSince: 5 })]);
    const e = await h.client.putDevice({ protocol: 1, relayPubKey: 'd75a', platform: 'extension', appVersion: '1', osPermission: true, transport: 'none' }).catch((x) => x);
    expect(e).toBeInstanceOf(NotifyError);
    expect(e).toMatchObject({ status: 409, code: 'target_invalid', details: { invalidReason: '410', invalidSince: 5 } });
    expect(h.seen).toHaveLength(1);
  });

  it('getConfig is public, cached for an hour, refetched with force, and applies serverTime and minClientProtocol', async () => {
    const config = { protocol: 1, protocols: [1], minClientProtocol: 1, enabled: true, vapidPublicKey: 'k', vapidKid: 'v1', categories: [], securityCategories: [], networks: [], servedCategories: {}, limits: { walletsPerDevice: 20, devicesPerWallet: 50, paymentCredsPerLink: 200, paymentCredsPerWallet: 200 }, serverTime: 1_790_553_601_000 };
    const h = harness([{ status: 200, json: config }, { status: 200, json: { ...config, minClientProtocol: 2 } }]);
    expect((await h.client.getConfig()).vapidKid).toBe('v1');
    expect(h.seen[0].headers['X-Gero-Sig']).toBeUndefined();
    expect(await h.client.clockOffsetMs()).toBe(1000);
    await h.client.getConfig();
    expect(h.seen).toHaveLength(1); // cache hit
    h.advance(3_600_001);
    await h.client.getConfig();
    expect(h.seen).toHaveLength(2);
    expect((await h.store.getDevice()).protocolUnsupported).toBe(true);
  });
});
