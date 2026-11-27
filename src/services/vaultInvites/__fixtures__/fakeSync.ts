/**
 * An in-memory gero-sync for the vault-invite routes (`PROTOCOL.md` section 7), for specs only.
 * It behaves as the contract says (directory of five with decoys, delivery by recipient key,
 * one-time links, answers filed to the owner) and can be told to misbehave, so the client's
 * fail-closed paths are exercised: a misfiled invitation, a decoy wrap handed out, an injected
 * response.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { x25519PublicKey, type WireDelivery, type WireWrap } from '@/shared/gerovault/invite';
import { bytesToHex, hexToBytes } from '@/shared/gerovault/cbor';
import type { InviteTransport } from '../inviteApi';

interface FakeInvite {
  inviteId: string;
  stakeCredential: string;
  wraps: WireWrap[];
  nonce: string;
  ciphertext: string;
  state: string;
  createdAt: number;
  expiresAt: number;
  revoke?: string;
  answeredBy?: string;
}

interface FakeSetup {
  setupId: string;
  owner: string;
  network: string;
  expiresAt: number;
  state: string;
  createdAt: number;
  invites: FakeInvite[];
  links: Map<string, { nonce: string; ciphertext: string; expiresAt: number; state: string }>;
  responses: { responseId: string; kind: string; inviteId?: string; joinTokenHash?: string; receivedAt: number; delivery: WireDelivery }[];
}

export class FakeSyncError extends Error {
  override readonly name = 'NotifyError';
  constructor(readonly status: number, readonly code: string, readonly details?: Record<string, unknown>) {
    super(code);
  }
}

let counter = 0;
const id16 = () => (++counter).toString(16).padStart(32, '0');

export class FakeSync {
  readonly devices = new Map<string, { inviteKey?: string; links: Set<string> }>();
  readonly setups = new Map<string, FakeSetup>();
  readonly calls: { device: string; method: string; path: string; body?: unknown }[] = [];
  /** Misbehaviour hooks. */
  listHook?: (device: string, rows: Record<string, unknown>[]) => Record<string, unknown>[];
  failNext?: { path: RegExp; error: FakeSyncError };

  constructor(readonly now: () => number) {}

  device(deviceId: string, opts: { inviteKey?: string; links?: string[] } = {}): void {
    const existing = this.devices.get(deviceId);
    this.devices.set(deviceId, { inviteKey: opts.inviteKey ?? existing?.inviteKey, links: new Set([...(existing?.links ?? []), ...(opts.links ?? [])]) });
  }

  transport(deviceId: string, inviteKey: () => Promise<string | null>): InviteTransport {
    return {
      send: async <T>(method: string, path: string, body?: unknown): Promise<T> => {
        this.calls.push({ device: deviceId, method, path, body });
        // The device's current key, as PUT /device would have published it.
        const key = await inviteKey();
        if (key) this.device(deviceId, { inviteKey: key });
        if (this.failNext && this.failNext.path.test(path)) {
          const { error } = this.failNext;
          this.failNext = undefined;
          throw error;
        }
        return this.route(deviceId, method, path, body) as T;
      },
    };
  }

  private setupOf(setupId: string, owner?: string): FakeSetup {
    const s = this.setups.get(setupId);
    if (!s) throw new FakeSyncError(404, 'not_found');
    if (owner && s.owner !== owner) throw new FakeSyncError(403, 'forbidden');
    return s;
  }

  private route(device: string, method: string, path: string, body: unknown): unknown {
    const b = (body ?? {}) as Record<string, unknown>;
    const now = this.now();
    let m: RegExpMatchArray | null;
    if (method === 'POST' && path === '/vault-setups') {
      const setupId = String(b['setupId']);
      const existing = this.setups.get(setupId);
      if (existing) {
        if (existing.owner !== device) throw new FakeSyncError(409, 'setup_exists');
        return { setupId, network: existing.network, state: existing.state, createdAt: existing.createdAt, expiresAt: existing.expiresAt, serverTime: now };
      }
      const open = [...this.setups.values()].filter(s => s.owner === device && s.state === 'open');
      if (open.length >= 10) throw new FakeSyncError(422, 'too_many_pending', { limit: 10, open: open.map(s => ({ setupId: s.setupId, expiresAt: s.expiresAt })) });
      this.setups.set(setupId, { setupId, owner: device, network: String(b['network']), expiresAt: Number(b['expiresAt']), state: 'open', createdAt: now, invites: [], links: new Map(), responses: [] });
      return { setupId, network: b['network'], state: 'open', createdAt: now, expiresAt: b['expiresAt'], serverTime: now };
    }
    if (method === 'POST' && path === '/vault-invites/recipients') {
      const tag = `${String(b['network'])}|${String(b['stakeCredential'])}`;
      const real = [...this.devices.values()].filter(d => d.links.has(tag) && d.inviteKey).map(d => d.inviteKey!);
      const decoy = (slot: number) => bytesToHex(x25519PublicKey(sha256(new TextEncoder().encode(`decoy|${tag}|${slot}`))));
      const entries = [0, 1, 2, 3, 4].map(slot => ({ slot, inviteKey: real[slot] ?? decoy(slot) }));
      return { network: b['network'], stakeCredential: b['stakeCredential'], entries, serverTime: now };
    }
    if ((m = path.match(/^\/vault-setups\/([0-9a-f]{32})$/)) && method === 'DELETE') {
      const s = this.setupOf(m[1], device);
      s.state = 'closed';
      for (const i of s.invites) if (i.state === 'open') i.state = 'revoked';
      for (const l of s.links.values()) if (l.state === 'open') l.state = 'withdrawn';
      return null;
    }
    if ((m = path.match(/^\/vault-setups\/([0-9a-f]{32})\/invites$/)) && method === 'POST') {
      const s = this.setupOf(m[1], device);
      for (const i of s.invites) if (i.stakeCredential === b['stakeCredential'] && i.state === 'open') i.state = 'replaced';
      const invite: FakeInvite = {
        inviteId: id16(),
        stakeCredential: String(b['stakeCredential']),
        wraps: b['wraps'] as WireWrap[],
        nonce: String(b['nonce']),
        ciphertext: String(b['ciphertext']),
        state: 'open',
        createdAt: now,
        expiresAt: s.expiresAt,
      };
      s.invites.push(invite);
      return { inviteId: invite.inviteId, expiresAt: invite.expiresAt, serverTime: now };
    }
    if ((m = path.match(/^\/vault-setups\/([0-9a-f]{32})\/invites\/([0-9a-f]{32})\/(remind|revoke)$/)) && method === 'POST') {
      const s = this.setupOf(m[1], device);
      const invite = s.invites.find(i => i.inviteId === m![2]);
      if (!invite) throw new FakeSyncError(404, 'not_found');
      if (m[3] === 'remind') return { serverTime: now };
      if (invite.state === 'accepted' || invite.state === 'declined') throw new FakeSyncError(409, 'already_answered');
      invite.state = 'revoked';
      invite.revoke = String(b['revoke']);
      return { inviteId: invite.inviteId, state: 'revoked', serverTime: now };
    }
    if ((m = path.match(/^\/vault-setups\/([0-9a-f]{32})\/links\/([0-9a-f]{64})$/))) {
      const s = this.setupOf(m[1], device);
      if (method === 'PUT') {
        s.links.set(m[2], { nonce: String(b['nonce']), ciphertext: String(b['ciphertext']), expiresAt: Number(b['expiresAt']), state: 'open' });
        return { joinTokenHash: m[2], state: 'open', expiresAt: b['expiresAt'], serverTime: now };
      }
      const l = s.links.get(m[2]);
      if (l && l.state === 'open') l.state = 'withdrawn';
      return null;
    }
    if (method === 'GET' && path === '/vault-invites') {
      const d = this.devices.get(device);
      const rows: Record<string, unknown>[] = [];
      for (const s of this.setups.values()) {
        for (const i of s.invites) {
          if (!d?.links.has(`${s.network}|${i.stakeCredential}`)) continue;
          const wrap = i.wraps.find(w => w.recipientKey === d.inviteKey);
          if (!wrap) continue;
          const state = i.state === 'open' && now >= i.expiresAt ? 'expired' : i.state;
          rows.push({
            inviteId: i.inviteId, setupId: s.setupId, network: s.network, stakeCredential: i.stakeCredential, state, createdAt: i.createdAt, expiresAt: i.expiresAt,
            ...(i.answeredBy ? { answeredAt: now, answeredHere: i.answeredBy === device } : {}),
            ...(state === 'open' ? { delivery: { wrap, nonce: i.nonce, ciphertext: i.ciphertext } } : {}),
            ...(state === 'revoked' && i.revoke ? { revoke: i.revoke } : {}),
          });
        }
      }
      return { invites: this.listHook ? this.listHook(device, rows) : rows, serverTime: now };
    }
    if (method === 'POST' && path === '/vault-invites/by-link') {
      const hash = bytesToHex(sha256(hexToBytes(String(b['joinToken']))!));
      for (const s of this.setups.values()) {
        const l = s.links.get(hash);
        if (!l) continue;
        if (l.state === 'used') throw new FakeSyncError(409, 'already_answered');
        if (l.state !== 'open') throw new FakeSyncError(404, 'not_found');
        if (now >= l.expiresAt) throw new FakeSyncError(410, 'expired');
        return { setupId: s.setupId, network: s.network, expiresAt: l.expiresAt, nonce: l.nonce, ciphertext: l.ciphertext, serverTime: now };
      }
      throw new FakeSyncError(404, 'not_found');
    }
    if ((m = path.match(/^\/vault-invites\/([0-9a-f]{32})\/block$/)) && method === 'POST') {
      return null;
    }
    if ((m = path.match(/^\/vault-setups\/([0-9a-f]{32})\/responses$/))) {
      const s = this.setupOf(m[1], method === 'GET' ? device : undefined);
      if (method === 'GET') {
        return {
          setupId: s.setupId, network: s.network, state: s.state, expiresAt: s.expiresAt,
          invites: s.invites.map(i => ({ inviteId: i.inviteId, stakeCredential: i.stakeCredential, state: i.state, createdAt: i.createdAt })),
          links: [...s.links.entries()].map(([joinTokenHash, l]) => ({ joinTokenHash, state: l.state, expiresAt: l.expiresAt })),
          responses: s.responses,
          serverTime: now,
        };
      }
      const wraps = b['wraps'] as WireWrap[];
      const owner = this.devices.get(s.owner);
      if (wraps?.length !== 1 || wraps[0].recipientKey !== owner?.inviteKey) throw new FakeSyncError(400, 'invalid_field');
      const delivery = { wrap: wraps[0], nonce: String(b['nonce']), ciphertext: String(b['ciphertext']) };
      const responseId = id16();
      if (typeof b['inviteId'] === 'string') {
        const invite = s.invites.find(i => i.inviteId === b['inviteId']);
        if (!invite) throw new FakeSyncError(404, 'not_found');
        if (invite.state === 'revoked') throw new FakeSyncError(410, 'revoked');
        if (invite.state !== 'open') throw new FakeSyncError(409, 'already_answered');
        if (now >= invite.expiresAt) throw new FakeSyncError(410, 'expired');
        invite.state = b['kind'] === 'accept' ? 'accepted' : 'declined';
        invite.answeredBy = device;
        s.responses.push({ responseId, kind: String(b['kind']), inviteId: invite.inviteId, receivedAt: now, delivery });
      } else {
        const hash = bytesToHex(sha256(hexToBytes(String(b['joinToken']))!));
        const l = s.links.get(hash);
        if (!l) throw new FakeSyncError(404, 'not_found');
        if (l.state !== 'open') throw new FakeSyncError(409, 'already_answered');
        l.state = 'used';
        s.responses.push({ responseId, kind: String(b['kind']), joinTokenHash: hash, receivedAt: now, delivery });
      }
      return { responseId, serverTime: now };
    }
    throw new FakeSyncError(404, 'not_found');
  }

  /** Files a response as gero-sync would, whoever made it (an injected or replayed answer). */
  inject(setupId: string, response: { kind: string; inviteId?: string; joinTokenHash?: string; delivery: WireDelivery }): void {
    this.setupOf(setupId).responses.push({ responseId: id16(), receivedAt: this.now(), ...response });
  }
}
