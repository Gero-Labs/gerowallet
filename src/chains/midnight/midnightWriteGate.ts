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
 * The record lives in chrome.storage.session: shared by the worker, the
 * dashboard and the side panel, cleared with the browser session, and not
 * readable by content scripts.
 */
import { computed, reactive, type ComputedRef } from 'vue';

export const MIDNIGHT_WRITE_GATE_KEY = 'midnightWriteGate';
/** How long a 501 alone keeps a network paused before the next attempt asks the server again. */
export const RESPONSE_GATE_TTL_MS = 30 * 60_000;

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
  if (entry.source === 'response') return now - entry.at < RESPONSE_GATE_TTL_MS;
  return true;
}

/** Pure: the record after a status read or a write outcome. */
export function nextGateRecord(
  record: MidnightWriteGateRecord,
  network: string,
  change: { paused: true; source: MidnightWriteGateSource; at: number } | { paused: false },
): MidnightWriteGateRecord {
  const key = midnightGateKey(network);
  if (!key) return record;
  if (!change.paused) {
    if (!(key in record)) return record;
    const rest = { ...record };
    delete rest[key];
    return rest;
  }
  // A status read outranks a remembered 501, never the other way round.
  if (change.source === 'response' && record[key]?.source === 'status') return record;
  return { ...record, [key]: { source: change.source, at: change.at } };
}

function readRecord(value: unknown): MidnightWriteGateRecord {
  if (!value || typeof value !== 'object') return {};
  const out: MidnightWriteGateRecord = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const e = entry as Partial<MidnightWriteGateEntry> | null;
    if (e && (e.source === 'status' || e.source === 'response') && typeof e.at === 'number') out[key] = { source: e.source, at: e.at };
  }
  return out;
}

type SessionArea = { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };

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

/** Re-evaluate when the earliest remembered 501 runs out, so the buttons re-enable on time. */
function scheduleExpiry(): void {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  const ends = Object.values(mirror.record)
    .filter((e) => e.source === 'response')
    .map((e) => e.at + RESPONSE_GATE_TTL_MS)
    .filter((t) => t > Date.now());
  if (!ends.length) return;
  expiryTimer = setTimeout(() => { mirror.now = Date.now(); scheduleExpiry(); }, Math.min(...ends) - Date.now() + 50);
}

function applyMirror(record: MidnightWriteGateRecord): void {
  mirror.record = record;
  mirror.now = Date.now();
  scheduleExpiry();
}

let mirrorStarted = false;
/** A change event (or our own write) landed: the first read, if still pending, is older than it. */
let mirrorUpdated = false;
function startMirror(): void {
  if (mirrorStarted) return;
  mirrorStarted = true;
  mirrorUpdated = false;
  const area = sessionArea();
  if (!area) return;
  try {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'session' || !(MIDNIGHT_WRITE_GATE_KEY in changes)) return;
      mirrorUpdated = true;
      applyMirror(readRecord(changes[MIDNIGHT_WRITE_GATE_KEY]?.newValue));
    });
  } catch { /* no change events here: the mirror keeps its first read */ }
  void area.get(MIDNIGHT_WRITE_GATE_KEY).then((items) => {
    if (!mirrorUpdated) applyMirror(readRecord(items?.[MIDNIGHT_WRITE_GATE_KEY]));
  }, () => undefined);
}

/** Reactive: is `network` paused? For buttons and banners. */
export function useMidnightNetworkUpgrading(network: () => string | undefined | null): ComputedRef<boolean> {
  startMirror();
  return computed(() => isPausedIn(mirror.record, network() ?? '', mirror.now));
}

// ── Reads and writes ──────────────────────────────────────────────────────

/** The current state, read from the shared record (not the mirror, which may lag one event). */
export async function isMidnightNetworkUpgrading(network: string): Promise<boolean> {
  const area = sessionArea();
  if (!area) return isPausedIn(mirror.record, network, Date.now());
  try {
    const items = await area.get(MIDNIGHT_WRITE_GATE_KEY);
    return isPausedIn(readRecord(items?.[MIDNIGHT_WRITE_GATE_KEY]), network, Date.now());
  } catch {
    return false;
  }
}

let writeChain: Promise<void> = Promise.resolve();

/** Serialised read-modify-write, so two notes from one context never undo each other. */
function update(network: string, change: Parameters<typeof nextGateRecord>[2]): Promise<void> {
  writeChain = writeChain.then(async () => {
    const area = sessionArea();
    if (!area) {
      applyMirror(nextGateRecord(mirror.record, network, change));
      return;
    }
    try {
      const items = await area.get(MIDNIGHT_WRITE_GATE_KEY);
      const current = readRecord(items?.[MIDNIGHT_WRITE_GATE_KEY]);
      const next = nextGateRecord(current, network, change);
      if (next !== current) await area.set({ [MIDNIGHT_WRITE_GATE_KEY]: next });
      mirrorUpdated = true;
      applyMirror(next);
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

/** Test hook. */
export function resetMidnightWriteGateForTests(): void {
  applyMirror({});
  writeChain = Promise.resolve();
  mirrorStarted = false;
}
