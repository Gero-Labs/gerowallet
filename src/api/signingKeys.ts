/**
 * The keys that may sign Gero's answers, as the root holders approved them.
 *
 * gero-backend serves the root-signed statements at `GET /api/signing/delegations`.
 * That answer is not trusted: every statement is checked against the pinned roots
 * here (signedResponseRoots.ts), so whoever serves it can only withhold approvals,
 * never add one. A delegation needs both roots' entries; a revocation needs one. It is
 * fetched with `fetch` rather than a checked axios client, since it is what those
 * checks need.
 *
 *  - Delegations only grow until they expire or are revoked: the stored entries and
 *    every fetched one count together. A server (or anyone in between) that stops
 *    serving one, serves an empty list or pads it with junk cannot take an approved key
 *    away; a revocation is the only way, and the runbook says to revoke, never to just
 *    stop serving.
 *  - Revocations only ever grow: the stored ones, the ones shipped in this release
 *    (BUNDLED_REVOCATIONS) and every verified one fetched. A server that stops serving
 *    one cannot bring a key back.
 *
 * Every entry is verified before anything is capped, so padding cannot push a real
 * entry out.
 *
 * The verified copy lives in the extension-origin store (privateStore.ts), never in
 * chrome.storage.local, which content scripts can rewrite. Stored delegations are
 * verified again on every load, so a root removed in a later release takes its
 * delegations with it.
 *
 * Nothing is fetched while no root is pinned: no delegation could verify.
 */
import { getPrivate, setPrivate } from '@/utils/privateStore';
import type { KeyResolver } from '@/shared/utils/signedResponse';
import {
  delegationResolver,
  pinnedRoots,
  verifyDelegations,
  verifyRevocationList,
  type Delegation,
  type SignedStatement,
  type SigningService,
} from '@/shared/utils/signedResponseRoots';
import { debugLog } from '@/utils/debug';

export type { SignedStatement };

/**
 * Revocations shipped in this release, so a revoked key stays revoked for wallets that
 * cannot reach the server or are served an old list. Each must verify against a root.
 */
export const BUNDLED_REVOCATIONS: readonly SignedStatement[] = [];

export const DELEGATIONS_PATH = '/api/signing/delegations';
export const STORE_KEY = 'signedResponses.keys.v1';
/** A copy older than this is fetched again. */
export const REFRESH_AFTER_MS = 6 * 3600_000;
/** An unknown key id fetches again at most this often. */
export const MIN_REFETCH_MS = 5 * 60_000;
/** While no delegation is known, a failed fetch is tried again after this. */
export const RETRY_EMPTY_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 64 * 1024;
/** Entries read from one list. 64 KiB holds about 150, so in practice every entry is read. */
const MAX_ENTRIES_READ = 256;
/** Approved delegations kept; the ones lasting longest win. */
const MAX_DELEGATIONS_KEPT = 64;

interface StoredKeys {
  fetchedAt: number;
  delegations: SignedStatement[];
  revoked: string[];
}

export interface SigningKeyOptions {
  roots?: readonly Uint8Array[];
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch;
  bundled?: readonly SignedStatement[];
  nowMs?: () => number;
}

function isSignedStatement(value: unknown): value is SignedStatement {
  const v = value as Partial<SignedStatement> | null;
  return typeof v?.statement === 'string' && typeof v.coseSign1 === 'string'
    && v.statement.length <= 512 && v.coseSign1.length <= 4096;
}

function statementList(value: unknown): SignedStatement[] {
  return Array.isArray(value) ? value.filter(isSignedStatement).slice(0, MAX_ENTRIES_READ) : [];
}

/** `lists` concatenated, each statement-and-signature pair once. */
function uniqueEntries(...lists: SignedStatement[][]): SignedStatement[] {
  const seen = new Set<string>();
  const out: SignedStatement[] = [];
  for (const entry of lists.flat()) {
    const key = `${entry.statement}\n${entry.coseSign1}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ statement: entry.statement, coseSign1: entry.coseSign1 });
  }
  return out;
}

/** One context's view of the approved keys. */
export class SigningKeys {
  private readonly roots: readonly Uint8Array[];
  private readonly baseUrl: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly bundled: readonly SignedStatement[];
  private readonly nowMs: () => number;

  private delegations: Delegation[] = [];
  /** The verified entries behind `delegations`, as stored. */
  private entries: SignedStatement[] = [];
  private revoked = new Set<string>();
  private fetchedAt = 0;
  private lastAttempt = Number.NEGATIVE_INFINITY;
  private loaded: Promise<void> | undefined;
  private inFlight: Promise<void> | undefined;

  constructor(options: SigningKeyOptions = {}) {
    this.roots = options.roots ?? pinnedRoots();
    this.baseUrl = 'baseUrl' in options ? options.baseUrl : import.meta.env['VITE_BACKEND_URL'];
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.bundled = options.bundled ?? BUNDLED_REVOCATIONS;
    this.nowMs = options.nowMs ?? Date.now;
  }

  /**
   * The resolver for one service. Waits for a fetch only when no delegation is known
   * yet; a stale copy is used while a fresh one is fetched.
   */
  async resolver(service: SigningService): Promise<KeyResolver> {
    if (this.roots.length === 0) return delegationResolver(service, []);
    await this.load();
    if (this.nowMs() - this.fetchedAt >= REFRESH_AFTER_MS && this.mayRetry()) {
      const refresh = this.refresh();
      if (this.delegations.length === 0) await refresh;
    }
    return this.current(service);
  }

  /** After a failed or recent fetch, wait before the next: 30 s with nothing known, else MIN_REFETCH_MS. */
  private mayRetry(): boolean {
    const wait = this.delegations.length === 0 ? RETRY_EMPTY_MS : MIN_REFETCH_MS;
    return this.nowMs() - this.lastAttempt >= wait;
  }

  /**
   * Fetches again because an answer named a key id no delegation covers (a new key may
   * have been approved since the last fetch). At most once per MIN_REFETCH_MS.
   */
  async refetchForUnknownKey(service: SigningService): Promise<KeyResolver> {
    if (this.roots.length === 0) return delegationResolver(service, []);
    await this.load();
    if (this.mayRetry()) await this.refresh();
    return this.current(service);
  }

  private current(service: SigningService): KeyResolver {
    return delegationResolver(service, this.delegations, new Set(this.revoked));
  }

  private load(): Promise<void> {
    this.loaded ??= this.loadStored();
    return this.loaded;
  }

  private async loadStored(): Promise<void> {
    let stored: StoredKeys | undefined;
    try {
      stored = await getPrivate<StoredKeys>(STORE_KEY);
    } catch (error) {
      debugLog('[signing-keys] stored copy unreadable', error instanceof Error ? error.name : 'error');
    }
    for (const kid of Array.isArray(stored?.revoked) ? stored.revoked : []) {
      if (typeof kid === 'string') this.revoked.add(kid);
    }
    for (const list of this.bundled) {
      const verified = await verifyRevocationList(list.statement, list.coseSign1, this.roots);
      verified?.revoked.forEach((kid) => this.revoked.add(kid));
    }
    await this.adopt(statementList(stored?.delegations));
    this.fetchedAt = typeof stored?.fetchedAt === 'number' && stored.fetchedAt <= this.nowMs() ? stored.fetchedAt : 0;
  }

  /**
   * Verifies `candidates` together with the entries already held and keeps every
   * delegation both roots approved that has neither expired nor been revoked.
   */
  private async adopt(candidates: SignedStatement[]): Promise<void> {
    const nowSeconds = this.nowMs() / 1000;
    const approved = (await verifyDelegations(uniqueEntries(this.entries, candidates), this.roots))
      .filter((a) => nowSeconds < a.delegation.notAfter && !this.revoked.has(a.delegation.kid))
      .sort((a, b) => b.delegation.notAfter - a.delegation.notAfter)
      .slice(0, MAX_DELEGATIONS_KEPT);
    this.delegations = approved.map((a) => a.delegation);
    this.entries = approved.flatMap((a) => a.entries);
  }

  private refresh(): Promise<void> {
    this.inFlight ??= this.fetchAndStore().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async fetchAndStore(): Promise<void> {
    this.lastAttempt = this.nowMs();
    if (!this.baseUrl) return;
    let body: { delegations?: unknown; revocations?: unknown };
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${DELEGATIONS_PATH}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`answered ${response.status}`);
      const text = await response.text();
      if (text.length > MAX_BODY_BYTES) throw new Error('answer too large');
      body = JSON.parse(text) as typeof body;
      if (!body || typeof body !== 'object') throw new Error('not an object');
    } catch (error) {
      // Keep what is stored; the next call tries again.
      debugLog('[signing-keys] fetch failed', error instanceof Error ? error.message : 'error');
      return;
    }

    for (const list of statementList(body.revocations)) {
      const verified = await verifyRevocationList(list.statement, list.coseSign1, this.roots);
      verified?.revoked.forEach((kid) => this.revoked.add(kid));
    }
    await this.adopt(statementList(body.delegations));
    this.fetchedAt = this.nowMs();
    try {
      // Another context (the worker, a dashboard) may have stored entries and revocations
      // this one has not seen: keep them too.
      const stored = await getPrivate<StoredKeys>(STORE_KEY);
      for (const kid of Array.isArray(stored?.revoked) ? stored.revoked : []) {
        if (typeof kid === 'string') this.revoked.add(kid);
      }
      await this.adopt(statementList(stored?.delegations));
      await setPrivate(STORE_KEY, {
        fetchedAt: this.fetchedAt,
        delegations: this.entries,
        revoked: [...this.revoked],
      } satisfies StoredKeys);
    } catch (error) {
      debugLog('[signing-keys] could not store', error instanceof Error ? error.name : 'error');
    }
  }
}

let shared: SigningKeys | undefined;

/** This context's approved keys. */
export function signingKeys(): SigningKeys {
  shared ??= new SigningKeys();
  return shared;
}

/** Test seam. */
export function resetSigningKeysForTest(keys?: SigningKeys): void {
  shared = keys;
}
