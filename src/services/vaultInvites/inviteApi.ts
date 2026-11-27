/**
 * The vault-invite routes of gero-sync (`src/shared/gerovault/invite/PROTOCOL.md` section 7), over
 * the notify client's signed transport: every call is signed exactly like `PUT /device`, with the
 * same clock correction, nonce, retries and `device_unknown` recovery (`notifyClient.ts`).
 *
 * gero-sync is untrusted (PROTOCOL 8.1): every answer is checked for shape here, and a row that is
 * not well formed is dropped (lists) or refused (`invalid_response`). Nothing here decrypts or
 * decides anything; `inviteService.ts` opens what this returns with the pure core.
 *
 * Runs in the background worker only.
 */
import { INVITE_NETWORKS, type InviteNetwork, type WireDelivery, type WireWrap } from '@/shared/gerovault/invite';

export type InviteMethod = 'GET' | 'PUT' | 'POST' | 'DELETE';

/** The signed request of the notify client (`NotifyClient.send`). Throws a `NotifyError` shape. */
export interface InviteTransport {
  send<T>(method: InviteMethod, path: string, body?: unknown): Promise<T>;
}

/**
 * - the gero-sync codes of PROTOCOL 7.1 (`not_found`, `forbidden`, `setup_exists`,
 *   `already_answered`, `expired`, `revoked`, `too_many_pending`, `limit_exceeded`,
 *   `rate_limited`, `invalid_field`, `device_unknown`, ...), passed through;
 * - `network`: no answer; `invalid_response`: an answer this client refuses to read;
 * - `deferred`: the notify client scheduled a retry (a long Retry-After) for something other than
 *   a rate limit;
 * - `rate_limited` always carries `retryAfterMs`: gero-sync's `Retry-After`, or this client's own
 *   backoff when it sent none. Until then the same kind of request is not sent again (below).
 */
export class InviteApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
    readonly retryAfterMs?: number,
  ) {
    super(`vault invite api: ${status} ${code}`);
    this.name = 'InviteApiError';
  }
}

const HEX = (bytes: number) => new RegExp(`^[0-9a-f]{${bytes * 2}}$`);
const HEX16 = HEX(16);
const HEX24 = HEX(24);
const HEX28 = HEX(28);
const HEX32 = HEX(32);
const HEX48 = HEX(48);
const B64URL = /^[A-Za-z0-9_-]+$/;
/** The largest ciphertext a route may carry (6160 decoded bytes), as base64url characters. */
const MAX_CIPHERTEXT_CHARS = Math.ceil((6160 * 4) / 3);
const MAX_REVOKE_CHARS = Math.ceil((128 * 4) / 3);

export type InviteState = 'open' | 'accepted' | 'declined' | 'revoked' | 'expired' | 'replaced';
export type LinkState = 'open' | 'used' | 'withdrawn' | 'expired';
const INVITE_STATES: readonly string[] = ['open', 'accepted', 'declined', 'revoked', 'expired', 'replaced'];
const LINK_STATES: readonly string[] = ['open', 'used', 'withdrawn', 'expired'];

export interface SetupView {
  readonly setupId: string;
  readonly network: InviteNetwork;
  readonly state: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface DirectoryEntry {
  readonly slot: number;
  readonly inviteKey: string;
}

export interface MailboxInvite {
  readonly inviteId: string;
  readonly setupId: string;
  readonly network: InviteNetwork;
  readonly stakeCredential: string;
  readonly state: InviteState;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly answeredAt?: number;
  readonly answeredHere?: boolean;
  readonly delivery?: WireDelivery;
  readonly revoke?: string;
}

export interface LinkCopy {
  readonly setupId: string;
  readonly network: InviteNetwork;
  readonly expiresAt: number;
  readonly nonce: string;
  readonly ciphertext: string;
}

export interface SetupResponse {
  readonly responseId: string;
  readonly kind: 'accept' | 'decline';
  readonly inviteId?: string;
  readonly joinTokenHash?: string;
  readonly receivedAt: number;
  readonly delivery: WireDelivery;
}

export interface SetupInviteRow {
  readonly inviteId: string;
  readonly stakeCredential: string;
  readonly state: InviteState;
  readonly createdAt: number;
  readonly answeredAt?: number;
}

export interface SetupLinkRow {
  readonly joinTokenHash: string;
  readonly state: LinkState;
  readonly expiresAt: number;
}

export interface SetupResponses {
  readonly setupId: string;
  readonly network: InviteNetwork;
  readonly state: string;
  readonly expiresAt: number;
  readonly invites: readonly SetupInviteRow[];
  readonly links: readonly SetupLinkRow[];
  readonly responses: readonly SetupResponse[];
}

export interface SealedBody {
  readonly wraps: readonly WireWrap[];
  readonly nonce: string;
  readonly ciphertext: string;
}

export interface InviteApi {
  createSetup(body: { setupId: string; network: InviteNetwork; expiresAt: number }): Promise<SetupView>;
  deleteSetup(setupId: string): Promise<void>;
  directory(network: InviteNetwork, stakeCredential: string): Promise<readonly DirectoryEntry[]>;
  postInvite(setupId: string, body: { stakeCredential: string } & SealedBody): Promise<{ inviteId: string; expiresAt: number }>;
  remind(setupId: string, inviteId: string): Promise<void>;
  revoke(setupId: string, inviteId: string, revoke: string): Promise<void>;
  putLink(setupId: string, joinTokenHash: string, body: { nonce: string; ciphertext: string; expiresAt: number }): Promise<void>;
  deleteLink(setupId: string, joinTokenHash: string): Promise<void>;
  listInvites(): Promise<readonly MailboxInvite[]>;
  byLink(joinToken: string): Promise<LinkCopy>;
  block(inviteId: string): Promise<void>;
  respond(setupId: string, body: { kind: 'accept' | 'decline'; inviteId?: string; joinToken?: string } & SealedBody): Promise<{ responseId: string }>;
  responses(setupId: string): Promise<SetupResponses>;
}

// ---------------------------------------------------------------------------------------------
// Readers (never throw for a row; `undefined` for anything not exactly well formed)

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isHex = (v: unknown, re: RegExp): v is string => typeof v === 'string' && re.test(v);
const isNetwork = (v: unknown): v is InviteNetwork => typeof v === 'string' && (INVITE_NETWORKS as readonly string[]).includes(v);
const isCiphertext = (v: unknown, max = MAX_CIPHERTEXT_CHARS): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && B64URL.test(v);

export function readWrap(v: unknown): WireWrap | undefined {
  if (!isObject(v)) return undefined;
  const { slot, recipientKey, ephemeralKey, nonce, wrappedKey } = v;
  if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot > 4) return undefined;
  if (!isHex(recipientKey, HEX32) || !isHex(ephemeralKey, HEX32) || !isHex(nonce, HEX24) || !isHex(wrappedKey, HEX48)) return undefined;
  return { slot, recipientKey, ephemeralKey, nonce, wrappedKey };
}

export function readDelivery(v: unknown): WireDelivery | undefined {
  if (!isObject(v)) return undefined;
  const wrap = readWrap(v['wrap']);
  const nonce = v['nonce'];
  const ciphertext = v['ciphertext'];
  if (!wrap || !isHex(nonce, HEX24) || !isCiphertext(ciphertext)) return undefined;
  return { wrap, nonce, ciphertext };
}

function readMailboxInvite(v: unknown): MailboxInvite | undefined {
  if (!isObject(v)) return undefined;
  const { inviteId, setupId, network, stakeCredential, state, createdAt, expiresAt, answeredAt, answeredHere, delivery, revoke } = v;
  if (!isHex(inviteId, HEX16) || !isHex(setupId, HEX16) || !isNetwork(network) || !isHex(stakeCredential, HEX28)) return undefined;
  if (typeof state !== 'string' || !INVITE_STATES.includes(state) || !isTime(createdAt) || !isTime(expiresAt)) return undefined;
  if (answeredAt !== undefined && !isTime(answeredAt)) return undefined;
  if (answeredHere !== undefined && typeof answeredHere !== 'boolean') return undefined;
  const out: { -readonly [K in keyof MailboxInvite]: MailboxInvite[K] } = { inviteId, setupId, network, stakeCredential, state: state as InviteState, createdAt, expiresAt };
  if (isTime(answeredAt)) out.answeredAt = answeredAt;
  if (typeof answeredHere === 'boolean') out.answeredHere = answeredHere;
  if (delivery !== undefined) {
    const read = readDelivery(delivery);
    // A delivery belongs to an open invitation only, and must be well formed.
    if (!read || state !== 'open') return undefined;
    out.delivery = read;
  }
  if (revoke !== undefined) {
    if (!isCiphertext(revoke, MAX_REVOKE_CHARS) || state !== 'revoked') return undefined;
    out.revoke = revoke;
  }
  return out;
}

function readResponse(v: unknown): SetupResponse | undefined {
  if (!isObject(v)) return undefined;
  const { responseId, kind, inviteId, joinTokenHash, receivedAt, delivery } = v;
  if (!isHex(responseId, HEX16) || (kind !== 'accept' && kind !== 'decline') || !isTime(receivedAt)) return undefined;
  // Exactly one of the two channels.
  if ((inviteId === undefined) === (joinTokenHash === undefined)) return undefined;
  if (inviteId !== undefined && !isHex(inviteId, HEX16)) return undefined;
  if (joinTokenHash !== undefined && !isHex(joinTokenHash, HEX32)) return undefined;
  const read = readDelivery(delivery);
  if (!read) return undefined;
  return {
    responseId,
    kind,
    ...(typeof inviteId === 'string' ? { inviteId } : {}),
    ...(typeof joinTokenHash === 'string' ? { joinTokenHash } : {}),
    receivedAt,
    delivery: read,
  };
}

function invalid(what: string): never {
  throw new InviteApiError('invalid_response', 200, { what });
}

function readSetupView(v: unknown): SetupView {
  if (!isObject(v)) return invalid('setup');
  const { setupId, network, state, createdAt, expiresAt } = v;
  if (!isHex(setupId, HEX16) || !isNetwork(network) || typeof state !== 'string' || !isTime(createdAt) || !isTime(expiresAt)) return invalid('setup');
  return { setupId, network, state, createdAt, expiresAt };
}

function readDirectory(v: unknown, network: InviteNetwork, stakeCredential: string): readonly DirectoryEntry[] {
  if (!isObject(v) || v['network'] !== network || v['stakeCredential'] !== stakeCredential || !Array.isArray(v['entries'])) return invalid('directory');
  const entries: unknown[] = v['entries'];
  // Exactly five, slots 0 to 4 in order: a directory of another shape is a broken server.
  if (entries.length !== 5) return invalid('directory');
  return entries.map((e, i) => {
    if (!isObject(e) || e['slot'] !== i) return invalid('directory');
    const inviteKey = e['inviteKey'];
    if (!isHex(inviteKey, HEX32)) return invalid('directory');
    return { slot: i, inviteKey };
  });
}

function readInviteRow(i: unknown): SetupInviteRow[] {
  if (!isObject(i)) return [];
  const { inviteId, stakeCredential, state, createdAt, answeredAt } = i;
  if (!isHex(inviteId, HEX16) || !isHex(stakeCredential, HEX28) || typeof state !== 'string' || !INVITE_STATES.includes(state) || !isTime(createdAt)) return [];
  if (answeredAt !== undefined && !isTime(answeredAt)) return [];
  return [{ inviteId, stakeCredential, state: state as InviteState, createdAt, ...(isTime(answeredAt) ? { answeredAt } : {}) }];
}

function readLinkRow(l: unknown): SetupLinkRow[] {
  if (!isObject(l)) return [];
  const { joinTokenHash, state, expiresAt } = l;
  if (!isHex(joinTokenHash, HEX32) || typeof state !== 'string' || !LINK_STATES.includes(state) || !isTime(expiresAt)) return [];
  return [{ joinTokenHash, state: state as LinkState, expiresAt }];
}

function readResponses(v: unknown, setupId: string): SetupResponses {
  if (!isObject(v)) return invalid('responses');
  const { network, state, expiresAt } = v;
  if (v['setupId'] !== setupId || !isNetwork(network) || typeof state !== 'string' || !isTime(expiresAt)) return invalid('responses');
  const list = (key: string): unknown[] => {
    const value = v[key];
    return Array.isArray(value) ? value : invalid('responses');
  };
  return {
    setupId,
    network,
    state,
    expiresAt,
    invites: list('invites').flatMap(readInviteRow),
    links: list('links').flatMap(readLinkRow),
    responses: list('responses').flatMap(r => {
      const read = readResponse(r);
      return read ? [read] : [];
    }),
  };
}

// ---------------------------------------------------------------------------------------------

/** The notify client's `NotifyError` (status, code, details, retryAfterMs) or `NotifyDeferred`, as an `InviteApiError`. */
function asApiError(error: unknown, now: number): InviteApiError {
  if (error instanceof InviteApiError) return error;
  const e = error as { name?: unknown; status?: unknown; code?: unknown; details?: unknown; retryAfterMs?: unknown; dueAt?: unknown } | null;
  if (e?.name === 'NotifyDeferred') {
    // A Retry-After the notify client would not sit through: still a rate limit, with its wait.
    if (e.code === 'rate_limited') return new InviteApiError('rate_limited', 429, undefined, typeof e.dueAt === 'number' ? Math.max(0, e.dueAt - now) : undefined);
    return new InviteApiError('deferred', 0);
  }
  if (e && typeof e.code === 'string' && typeof e.status === 'number') {
    return new InviteApiError(
      e.status === 0 ? 'network' : e.code,
      e.status,
      isObject(e.details) ? e.details : undefined,
      typeof e.retryAfterMs === 'number' ? e.retryAfterMs : undefined,
    );
  }
  return new InviteApiError('network', 0);
}

/** The wait after a 429 that named none, doubling with every further one. */
export const RATE_LIMIT_BACKOFF_MS = 60_000;
export const RATE_LIMIT_BACKOFF_CAP_MS = 15 * 60_000;

/**
 * Which of gero-sync's rate limits a request counts against (PROTOCOL 7.6), or null for a route
 * without one of its own. Both lists (`GET /vault-invites`, `GET …/responses`) share one.
 */
export function rateLimitScope(method: InviteMethod, path: string): string | null {
  if (method === 'GET') return 'read';
  if (method !== 'POST') return null;
  if (path === '/vault-invites/recipients') return 'directory';
  if (path === '/vault-invites/by-link') return 'by-link';
  if (/\/invites$/.test(path)) return 'invite';
  if (/\/responses$/.test(path)) return 'respond';
  const remind = path.match(/\/invites\/([0-9a-f]{32})\/remind$/);
  return remind ? `remind:${remind[1]}` : null;
}

export interface InviteApiOptions {
  readonly now?: () => number;
}

export function createInviteApi(transport: InviteTransport, options: InviteApiOptions = {}): InviteApi {
  const now = options.now ?? (() => Date.now());
  // After a 429 the same kind of request waits out Retry-After here, without reaching gero-sync:
  // a screen that keeps asking would only spend the next window too. Worker memory only.
  const limited = new Map<string, { until: number; strikes: number }>();

  async function call<T>(method: InviteMethod, path: string, body?: unknown): Promise<T> {
    const scope = rateLimitScope(method, path);
    const held = scope ? limited.get(scope) : undefined;
    if (held && now() < held.until) throw new InviteApiError('rate_limited', 429, undefined, held.until - now());
    try {
      const answer = await transport.send<T>(method, path, body);
      if (scope) limited.delete(scope);
      return answer;
    } catch (error) {
      const failure = asApiError(error, now());
      if (failure.code !== 'rate_limited') throw failure;
      // Never sooner than Retry-After; without one, or when it keeps happening, back off further.
      const strikes = (held?.strikes ?? 0) + 1;
      const backoff = Math.min(RATE_LIMIT_BACKOFF_CAP_MS, (failure.retryAfterMs ?? RATE_LIMIT_BACKOFF_MS) * 2 ** (strikes - 1));
      const wait = Math.max(failure.retryAfterMs ?? 0, backoff);
      if (scope) limited.set(scope, { until: now() + wait, strikes });
      throw new InviteApiError('rate_limited', failure.status || 429, failure.details, wait);
    }
  }
  const id = (value: string, re: RegExp): string => {
    if (!re.test(value)) throw new InviteApiError('invalid_request', 0);
    return value;
  };

  return {
    async createSetup(body) {
      return readSetupView(await call('POST', '/vault-setups', body));
    },
    async deleteSetup(setupId) {
      await call('DELETE', `/vault-setups/${id(setupId, HEX16)}`);
    },
    async directory(network, stakeCredential) {
      return readDirectory(await call('POST', '/vault-invites/recipients', { network, stakeCredential }), network, stakeCredential);
    },
    async postInvite(setupId, body) {
      const r = await call<unknown>('POST', `/vault-setups/${id(setupId, HEX16)}/invites`, body);
      if (!isObject(r)) return invalid('invite');
      const { inviteId, expiresAt } = r;
      if (!isHex(inviteId, HEX16) || !isTime(expiresAt)) return invalid('invite');
      return { inviteId, expiresAt };
    },
    async remind(setupId, inviteId) {
      await call('POST', `/vault-setups/${id(setupId, HEX16)}/invites/${id(inviteId, HEX16)}/remind`, {});
    },
    async revoke(setupId, inviteId, revoke) {
      await call('POST', `/vault-setups/${id(setupId, HEX16)}/invites/${id(inviteId, HEX16)}/revoke`, { revoke });
    },
    async putLink(setupId, joinTokenHash, body) {
      await call('PUT', `/vault-setups/${id(setupId, HEX16)}/links/${id(joinTokenHash, HEX32)}`, body);
    },
    async deleteLink(setupId, joinTokenHash) {
      await call('DELETE', `/vault-setups/${id(setupId, HEX16)}/links/${id(joinTokenHash, HEX32)}`);
    },
    async listInvites() {
      const r = await call<unknown>('GET', '/vault-invites');
      if (!isObject(r)) return invalid('invites');
      const invites = r['invites'];
      if (!Array.isArray(invites)) return invalid('invites');
      return invites.flatMap(i => {
        const read = readMailboxInvite(i);
        return read ? [read] : [];
      });
    },
    async byLink(joinToken) {
      const r = await call<unknown>('POST', '/vault-invites/by-link', { joinToken: id(joinToken, HEX32) });
      if (!isObject(r)) return invalid('link');
      const { setupId, network, expiresAt, nonce, ciphertext } = r;
      if (!isHex(setupId, HEX16) || !isNetwork(network) || !isTime(expiresAt) || !isHex(nonce, HEX24) || !isCiphertext(ciphertext)) return invalid('link');
      return { setupId, network, expiresAt, nonce, ciphertext };
    },
    async block(inviteId) {
      await call('POST', `/vault-invites/${id(inviteId, HEX16)}/block`, {});
    },
    async respond(setupId, body) {
      const r = await call<unknown>('POST', `/vault-setups/${id(setupId, HEX16)}/responses`, body);
      if (!isObject(r)) return invalid('response');
      const { responseId } = r;
      if (!isHex(responseId, HEX16)) return invalid('response');
      return { responseId };
    },
    async responses(setupId) {
      return readResponses(await call('GET', `/vault-setups/${id(setupId, HEX16)}/responses`), setupId);
    },
  };
}
