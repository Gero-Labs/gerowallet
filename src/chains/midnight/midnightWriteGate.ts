/**
 * "Midnight network upgrade": per network, are sends and DUST registration
 * paused? Checked before the password, before any proving.
 *
 * What turns it on, in order of preference:
 *   1. `status`: the server's status read for the network (`GET
 *      /api/midnight/{network}/status`, `writesOpen: false` with reason
 *      `NETWORK_UPGRADING`), polled while a Midnight wallet is open. A server
 *      without the route answers 404, and the wallet simply has no status.
 *   2. `response`: the first 501 `MIDNIGHT_NETWORK_UPGRADING` a write route
 *      answers for the network. Works with no server change. Remembered for
 *      {@link RESPONSE_GATE_TTL_MS}, after which the next attempt asks the
 *      server again, so a network that reopens is not locked out until the
 *      browser restarts when there is no status read to say so.
 * What turns it off: a status read that reports writes open, or a write that
 * succeeds. A failed status read never changes the state.
 *
 * (A remote feature flag was the ticket's second trigger. The flag channel
 * carries one boolean per flag with no per-network values, so none is wired.)
 *
 * Each network's entry lives under its own chrome.storage.session key
 * (`midnightWriteGate:<network>`): shared by the worker, the dashboard and the
 * side panel, cleared with the browser session, and not readable by content
 * scripts. A status-read pause lapses after STATUS_GATE_TTL_MS without a new
 * read, and goes when the status route answers 404.
 */
import { computed, reactive, type ComputedRef } from 'vue';
import { Network } from '@/models/types';

export const MIDNIGHT_WRITE_GATE_KEY = 'midnightWriteGate';
/** How long a 501 alone keeps a network paused before the next attempt asks the server again. */
export const RESPONSE_GATE_TTL_MS = 30 * 60_000;
/**
 * How long a status-read pause holds without being confirmed. The status is
 * re-read every 5 minutes while a Midnight wallet is open; if those reads stop,
 * the pause lapses instead of holding until the browser restarts.
 */
export const STATUS_GATE_TTL_MS = 15 * 60_000;

export type MidnightWriteGateSource = 'status' | 'response';

export interface MidnightWriteGateEntry {
  source: MidnightWriteGateSource;
  /** When this entry was written, epoch ms. */
  at: number;
}

/** Network key (lowercased wallet network name) → why it is paused. Absent = open. */
export type MidnightWriteGateRecord = Record<string, MidnightWriteGateEntry>;

export const midnightGateKey = (network: string): string => network.trim().toLowerCase();

/** Pure: is `network` paused in `record` at `now`? */
export function isPausedIn(record: MidnightWriteGateRecord | null | undefined, network: string, now: number): boolean {
  if (!network) return false;
  const entry = record?.[midnightGateKey(network)];
  if (!entry) return false;
  return now - entry.at < (entry.source === 'response' ? RESPONSE_GATE_TTL_MS : STATUS_GATE_TTL_MS);
}

/** Pure: the record after a status read or a write outcome. */
export function nextGateRecord(
  record: MidnightWriteGateRecord,
  network: string,
  change: { paused: true; source: MidnightWriteGateSource; at: number } | { paused: false; onlySource?: MidnightWriteGateSource },
): MidnightWriteGateRecord {
  const key = midnightGateKey(network);
  if (!key) return record;
  if (change.paused === false) {
    if (!(key in record)) return record;
    if (change.onlySource && record[key]?.source !== change.onlySource) return record;
    const rest = { ...record };
    delete rest[key];
    return rest;
  }
  // A live status-read pause outranks a 501, never the other way round. An
  // expired one doesn't: the 501 replaces it, or the network would read open.
  if (change.source === 'response' && record[key]?.source === 'status' && isPausedIn(record, network, change.at)) return record;
  return { ...record, [key]: { source: change.source, at: change.at } };
}

function readEntry(value: unknown): MidnightWriteGateEntry | null {
  const e = value as Partial<MidnightWriteGateEntry> | null;
  return e && typeof e === 'object' && (e.source === 'status' || e.source === 'response') && typeof e.at === 'number'
    ? { source: e.source, at: e.at } : null;
}

type SessionArea = {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
};

function sessionArea(): SessionArea | null {
  try {
    const area = typeof chrome !== 'undefined' ? chrome.storage?.session : undefined;
    return area ? (area as unknown as SessionArea) : null;
  } catch {
    return null;
  }
}

// ── Reactive mirror for the UI ────────────────────────────────────────────

const mirror = reactive({ record: {} as MidnightWriteGateRecord, now: Date.now() });
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

/** Re-evaluate when the earliest pause runs out, so the buttons re-enable on time. */
function scheduleExpiry(): void {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  const ends = Object.values(mirror.record)
    .map((e) => e.at + (e.source === 'response' ? RESPONSE_GATE_TTL_MS : STATUS_GATE_TTL_MS))
    .filter((t) => t > Date.now());
  if (!ends.length) return;
  expiryTimer = setTimeout(() => { mirror.now = Date.now(); scheduleExpiry(); }, Math.min(...ends) - Date.now() + 50);
}

function applyMirrorEntry(key: string, entry: MidnightWriteGateEntry | null): void {
  const next = { ...mirror.record };
  if (entry) next[key] = entry;
  else delete next[key];
  mirror.record = next;
  mirror.now = Date.now();
  scheduleExpiry();
}

function applyMirror(record: MidnightWriteGateRecord): void {
  mirror.record = record;
  mirror.now = Date.now();
  scheduleExpiry();
}

const storageKeyOf = (network: string) => `${MIDNIGHT_WRITE_GATE_KEY}:${midnightGateKey(network)}`;
const networkKeyOf = (storageKey: string) => (storageKey.startsWith(`${MIDNIGHT_WRITE_GATE_KEY}:`)
  ? storageKey.slice(MIDNIGHT_WRITE_GATE_KEY.length + 1) : null);

let mirrorStarted = false;
/** Keys a change event (or our own write) already set: the first read must not overwrite them. */
const mirrorTouched = new Set<string>();
function startMirror(): void {
  if (mirrorStarted) return;
  mirrorStarted = true;
  mirrorTouched.clear();
  const area = sessionArea();
  if (!area) return;
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'session') return;
      for (const [storageKey, change] of Object.entries(changes)) {
        const key = networkKeyOf(storageKey);
        if (!key) continue;
        mirrorTouched.add(key);
        applyMirrorEntry(key, readEntry(change?.newValue));
      }
    });
  } catch { /* no change events here: the mirror keeps its first read */ }
  // Only the gate's own keys, one per network name the wallet knows: never the
  // whole session area, which also holds unrelated secrets.
  void area.get(Object.values(Network).map(storageKeyOf)).then((items) => {
    const record: MidnightWriteGateRecord = { ...mirror.record };
    for (const [storageKey, value] of Object.entries(items ?? {})) {
      const key = networkKeyOf(storageKey);
      if (!key || mirrorTouched.has(key)) continue;
      const entry = readEntry(value);
      if (entry) record[key] = entry;
    }
    applyMirror(record);
  }, () => undefined);
}

/** Reactive: is `network` paused? For buttons and banners. */
export function useMidnightNetworkUpgrading(network: () => string | undefined | null): ComputedRef<boolean> {
  startMirror();
  return computed(() => isPausedIn(mirror.record, network() ?? '', mirror.now));
}

// ── Reads and writes ──────────────────────────────────────────────────────

/** The current state, read from session storage (not the mirror, which may lag one event). */
export async function isMidnightNetworkUpgrading(network: string): Promise<boolean> {
  const area = sessionArea();
  if (!area) return isPausedIn(mirror.record, network, Date.now());
  try {
    const storageKey = storageKeyOf(network);
    const items = await area.get(storageKey);
    const entry = readEntry(items?.[storageKey]);
    return isPausedIn(entry ? { [midnightGateKey(network)]: entry } : {}, network, Date.now());
  } catch {
    return false;
  }
}

let writeChain: Promise<void> = Promise.resolve();

/**
 * Serialised read-modify-write of one network's key, so two notes from one
 * context never undo each other. Each network has its own session-storage key.
 */
function update(network: string, change: Parameters<typeof nextGateRecord>[2]): Promise<void> {
  const key = midnightGateKey(network);
  writeChain = writeChain.then(async () => {
    if (!key) return;
    const area = sessionArea();
    if (!area) {
      applyMirror(nextGateRecord(mirror.record, network, change));
      return;
    }
    try {
      const storageKey = storageKeyOf(network);
      const items = await area.get(storageKey);
      const currentEntry = readEntry(items?.[storageKey]);
      const current: MidnightWriteGateRecord = currentEntry ? { [key]: currentEntry } : {};
      const next = nextGateRecord(current, network, change);
      if (next !== current) {
        if (next[key]) await area.set({ [storageKey]: next[key] });
        else await area.remove(storageKey);
      }
      mirrorTouched.add(key);
      applyMirrorEntry(key, next[key] ?? null);
    } catch {
      // Storage unavailable: the server still refuses, it just says so later.
    }
  });
  return writeChain;
}

/** A write route answered 501 MIDNIGHT_NETWORK_UPGRADING, or the status read says writes are closed. */
export function noteMidnightNetworkUpgrading(network: string, source: MidnightWriteGateSource, now: number = Date.now()): Promise<void> {
  return update(network, { paused: true, source, at: now });
}

/** A write succeeded, or the status read says writes are open. */
export function noteMidnightWritesOpen(network: string): Promise<void> {
  return update(network, { paused: false });
}

/** The status route is gone (404): a pause it set no longer has a source. A remembered 501 stays. */
export function clearMidnightStatusPause(network: string): Promise<void> {
  return update(network, { paused: false, onlySource: 'status' });
}

/** Test hook. */
export function resetMidnightWriteGateForTests(): void {
  applyMirror({});
  writeChain = Promise.resolve();
  mirrorStarted = false;
  mirrorTouched.clear();
}
