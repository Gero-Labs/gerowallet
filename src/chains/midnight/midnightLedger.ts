export type MidnightLedger = 8 | 9;

/**
 * The protocol version from which a Midnight chain runs ledger 9: wallet SDK
 * 2's `ProtocolVersion.V9NativeForkVersion`, and what upstream tells wallets
 * to treat as the upgrade signal. Below it the chain runs ledger 8.
 */
export const LEDGER9_PROTOCOL_VERSION = 2_000_000;

/** The newest ledger this build can sign, balance and prove for. */
export const NEWEST_MIDNIGHT_LEDGER: MidnightLedger = 9;

/** The ledger a chain reporting `protocolVersion` runs. Never chosen by network name. */
export function ledgerForProtocolVersion(protocolVersion: number): MidnightLedger {
  if (!Number.isSafeInteger(protocolVersion) || protocolVersion < 0) {
    throw new Error('Invalid Midnight protocol version');
  }
  return protocolVersion >= LEDGER9_PROTOCOL_VERSION ? 9 : 8;
}

/** `Mainnet`, `mainnet` and `midnight-mainnet` name the same chain. */
export function midnightLedgerKey(network: string): string {
  return network.trim().toLowerCase().replace(/^midnight-/, '');
}

/** The wallet's name for a network in a message: `Preprod`, never a slug. */
export function midnightNetworkName(network: string): string {
  const key = midnightLedgerKey(network);
  return key ? key[0].toUpperCase() + key.slice(1) : network;
}

/**
 * The message of {@link MidnightLedgerUnknownError}. A code, like the built
 * transaction refusals: only the message crosses from the background, and the
 * extension pages say it in the user's language (midnight-tx.service.ts).
 */
export const MIDNIGHT_LEDGER_UNKNOWN = 'MIDNIGHT_LEDGER_UNKNOWN';
/** The message of {@link MidnightLedgerChangedError}. */
export const MIDNIGHT_LEDGER_CHANGED = 'MIDNIGHT_LEDGER_CHANGED';

/** Thrown, before anything is prepared, when the chain's ledger hasn't been read. */
export class MidnightLedgerUnknownError extends Error {
  constructor(readonly network: string) {
    super(MIDNIGHT_LEDGER_UNKNOWN);
    this.name = 'MidnightLedgerUnknownError';
  }
}

/** Thrown when the chain reports another ledger while a transaction is prepared for it. */
export class MidnightLedgerChangedError extends Error {
  constructor(readonly network: string, readonly ledger: MidnightLedger) {
    super(MIDNIGHT_LEDGER_CHANGED);
    this.name = 'MidnightLedgerChangedError';
  }
}

export interface MidnightChainLedger {
  /** The tip's protocol version. */
  protocolVersion: number;
  ledger: MidnightLedger;
  /**
   * Whether the chain's first block was already on ledger 9. False for a chain
   * that crossed the upgrade (mainnet, preprod), which has ledger 8 history.
   * Undefined when only the tip was read.
   */
  bornOnLedger9?: boolean;
  /** When this was read (ms). */
  observedAt: number;
}

const observed = new Map<string, MidnightChainLedger>();
const listeners = new Set<(network: string, chain: MidnightChainLedger) => void>();

/**
 * Record what the chain reported. The latest report wins: it is the chain the
 * wallet reads and submits to, whichever way it moved.
 */
export function noteMidnightProtocolVersion(
  network: string,
  protocolVersion: number,
  genesisProtocolVersion?: number,
): MidnightChainLedger {
  const ledger = ledgerForProtocolVersion(protocolVersion);
  const key = midnightLedgerKey(network);
  const previous = observed.get(key);
  const bornOnLedger9 = genesisProtocolVersion === undefined
    ? previous?.bornOnLedger9
    : ledgerForProtocolVersion(genesisProtocolVersion) === 9;
  const chain: MidnightChainLedger = { protocolVersion, ledger, bornOnLedger9, observedAt: Date.now() };
  observed.set(key, chain);
  for (const listener of listeners) {
    try { listener(key, chain); } catch { /* advisory */ }
  }
  return chain;
}

/** Notified on every report, e.g. to mirror the ledger to the extension pages. */
export function onMidnightLedgerObserved(listener: (network: string, chain: MidnightChainLedger) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** What the chain last reported for `network`, if anything. */
export function observedMidnightChain(network: string): MidnightChainLedger | undefined {
  return observed.get(midnightLedgerKey(network));
}

/** The ledger `network`'s chain last reported, or undefined before the first read. */
export function knownMidnightLedger(network: string): MidnightLedger | undefined {
  return observedMidnightChain(network)?.ledger;
}

/**
 * For what the wallet shows and pre-selects (which local proof server, which
 * command): the ledger the chain last reported, else the newest this build
 * supports. Never the network name. Paths that build or prove a transaction
 * resolve the chain's ledger first and use {@link midnightLedgerVersion}.
 */
export function midnightLedgerOrNewest(network?: string): MidnightLedger {
  return (network ? knownMidnightLedger(network) : undefined) ?? NEWEST_MIDNIGHT_LEDGER;
}

/**
 * The ledger `network`'s chain runs, from its last reported protocol version.
 * Fails closed: before the first read it throws {@link MidnightLedgerUnknownError}
 * rather than guess. Async entry points call `resolveMidnightLedger` first.
 */
export function midnightLedgerVersion(network: string): MidnightLedger {
  const ledger = knownMidnightLedger(network);
  if (ledger === undefined) throw new MidnightLedgerUnknownError(network);
  return ledger;
}

/** Test hook: forget every report. */
export function forgetMidnightLedgersForTests(): void {
  observed.clear();
}

export function requireMidnightLedger8(network: string, operation: string): void {
  const ledger = midnightLedgerVersion(network);
  if (ledger !== 8) {
    throw new Error(`${operation} is not supported on Midnight ${midnightNetworkName(network)} (ledger ${ledger}) in this version`);
  }
}

/** Keep tagged ledger 9 values internal; the public REST/storage contract is hex. */
export function schnorrHex(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'tag' in value && 'value' in value
    && value.tag === 'schnorr' && typeof value.value === 'string') return value.value;
  throw new Error('Expected a Midnight Schnorr key or signature');
}

/**
 * The unshielded (BIP-340 Schnorr) keystore. Keys, addresses and signatures
 * are the same on both ledgers (ledger 9 only tags them), so this needs no
 * chain read and always uses wallet SDK 2.
 */
export async function midnightKeystore(secret: Uint8Array, network: string) {
  // Through midnightLedger9, which imports the SDK statically: a dynamic
  // import of the SDK itself is a new bundle TDZ hazard (check-bundle-tdz).
  const { ledger9Keystore } = await import('./midnightLedger9');
  return ledger9Keystore(secret, midnightLedgerKey(network));
}

export interface MidnightSigningSegment {
  index: number;
  role: 'NightExternal' | 'Zswap';
  dataHex: string;
}

/**
 * The background segment route is used for native NIGHT DUST registration.
 * Unshielded sends sign the complete fee-balanced transaction separately;
 * Nexus's per-input transfer indexes are not intent IDs and never enter here.
 * Validate every supplied payload before asking for any signatures.
 */
export async function validateMidnightSigningSegments(
  network: string,
  unprovenTxHex: string | undefined,
  segments: MidnightSigningSegment[],
): Promise<void> {
  // The caller reads the chain first (walletBg: resolveMidnightLedger).
  const version = midnightLedgerVersion(network);
  // Existing ledger-8 callers may omit the envelope. Ledger 9 must never do so.
  if (!unprovenTxHex) {
    if (version === 9) throw new Error('Ledger 9 signing requires the unproven transaction');
    return;
  }
  const raw = strictMidnightHex(unprovenTxHex);
  const tx = await (async () => {
    if (version === 9) {
      const ledger = await import('@midnightntwrk/ledger-v9');
      const decoded: import('@midnightntwrk/ledger-v9').UnprovenTransaction = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', raw);
      ledger.Transaction.fromParts(midnightLedgerKey(network)).merge(decoded);
      return decoded;
    }
    const ledger = await import('@midnight-ntwrk/ledger-v8');
    const decoded: import('@midnight-ntwrk/ledger-v8').UnprovenTransaction = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', raw);
    ledger.Transaction.fromParts(midnightLedgerKey(network)).merge(decoded);
    return decoded;
  })();
  if (new Set(segments.map(segment => segment.index)).size !== segments.length) {
    throw new Error('Duplicate Midnight signing segment');
  }
  if (version === 9 && (segments.length !== 1 || segments[0].index !== 1
    || !tx.intents?.get(1)?.dustActions?.registrations.length)) {
    throw new Error('Ledger 9 segment signing requires one native DUST registration payload');
  }
  for (const segment of segments) {
    const intent = tx.intents?.get(segment.index);
    if (!intent || segment.role !== 'NightExternal') throw new Error('Invalid Midnight signing segment');
    const canonical = intent.signatureData(segment.index);
    const supplied = strictMidnightHex(segment.dataHex);
    if (canonical.length !== supplied.length || canonical.some((byte, index) => byte !== supplied[index])) {
      throw new Error(`Segment ${segment.index}: signing payload does not match this network's transaction`);
    }
  }
}

export function strictMidnightHex(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length === 0 || clean.length % 2 || !/^[0-9a-fA-F]+$/.test(clean)) {
    throw new Error('Invalid Midnight transaction hex');
  }
  return Uint8Array.from(Buffer.from(clean, 'hex'));
}
