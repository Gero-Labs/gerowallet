import type { DustGenerationInfo, QualifiedDustOutput } from '@midnight-ntwrk/ledger-v8';
// Wallet SDK 2's codec: the SDK 1.x one instantiates ledger 8 when imported.
import { ScaleBigInt } from 'midnight-v9-address-format';
import { MidnightLedgerChangedError, ledgerForProtocolVersion, noteMidnightProtocolVersion, type MidnightLedger } from './midnightLedger';

/** Whether `protocolVersion` (a transaction's or an event's) is on `ledger`; malformed is not. */
function onLedger(protocolVersion: unknown, ledger: MidnightLedger): boolean {
  try { return ledgerForProtocolVersion(protocolVersion as number) === ledger; } catch { return false; }
}

export interface DustSyncBlock {
  hash: string;
  height: number;
  timestamp: number;
  protocolVersion: number;
  ledgerParameters: string;
  dustGenerationEndIndex: number;
  dustCommitmentEndIndex: number;
  dustGenerationMerkleTreeRoot: string | null;
  dustCommitmentMerkleTreeRoot: string | null;
}
export interface CollapsedDustTree { startIndex: number; endIndex: number; update: string; protocolVersion: number }
export interface DustGenerationRecord {
  __typename: 'DustGenerationsItem';
  generationMtIndex: number;
  commitmentMtIndex: number;
  owner: string;
  value: string;
  initialValue: string;
  initialNonce: string;
  backingNight: string;
  ctime: number;
  collapsedMerkleTree: CollapsedDustTree | null;
}
export interface DustDtimeRecord {
  __typename: 'DustGenerationDtimeUpdateItem';
  generationMtIndex: number;
  owner: string;
  nightUtxoHash: string;
  newDtime: number;
}
export interface DustSnapshot {
  version: number;
  network: string;
  block: DustSyncBlock;
  generations: (DustGenerationRecord | DustDtimeRecord | {
    __typename: 'DustGenerationsProgress'; highestIndex: number; collapsedMerkleTree: CollapsedDustTree | null;
  })[];
}
export interface DustSpendTransaction {
  hash: string;
  matchedNullifiers: string[];
  protocolVersion: number;
  block: { hash: string; height: number; ledgerParameters: string };
  dustLedgerEvents: { raw: string; protocolVersion: number }[];
}
export interface DustSpendEvent {
  nullifier: bigint; commitment: bigint; commitmentIndex: bigint;
  declaredTime: Date; blockTime: Date; vFee: bigint;
}
export interface DustSpendPage { transactions: DustSpendTransaction[]; nextBlock: number | null }
export interface DustLightTransport {
  snapshot(address: string): Promise<DustSnapshot>;
  spends(block: DustSyncBlock, prefixes: string[], fromBlock: number, toBlock: number): Promise<DustSpendPage>;
  commitments(block: DustSyncBlock, ranges: { startIndex: number; endIndex: number }[]): Promise<CollapsedDustTree[]>;
}

/** Keep WASM objects within their own ledger module; only wire values cross adapters. */
export interface DustLightLedger<State, Key> {
  /** The ledger this adapter's WASM module implements. */
  ledger: MidnightLedger;
  createState(parametersHex: string): State;
  publicKey(key: Key): bigint;
  address(key: Key, network: string): string;
  insertGeneration(state: State, index: number, generation: DustGenerationInfo): State;
  applyGeneration(state: State, update: string): State;
  applyCommitment(state: State, update: string): State;
  insertCoin(state: State, key: Key, coin: QualifiedDustOutput): State;
  nullifier(coin: QualifiedDustOutput, key: Key): bigint;
  commitment(coin: QualifiedDustOutput): bigint;
  decodeSpend(raw: string): DustSpendEvent | null;
  successor(coin: QualifiedDustOutput, generation: DustGenerationInfo, spend: DustSpendEvent, parameters: string, key: Key): QualifiedDustOutput;
  roots(state: State): [bigint | undefined, bigint | undefined];
}

export function littleEndianHex(value: bigint): string {
  if (value < 0n || value >= (1n << 256n)) throw new Error('Invalid DUST field');
  return Buffer.from(value.toString(16).padStart(64, '0'), 'hex').reverse().toString('hex');
}
function hex(value: string): Uint8Array {
  if (typeof value !== 'string' || !/^(?:[0-9a-fA-F]{2})+$/.test(value)) throw new Error('Invalid DUST bytes');
  return Buffer.from(value, 'hex');
}
export const dustHexBytes = hex;
function index(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid DUST index');
  return value;
}
function amount(value: string): bigint {
  if (typeof value !== 'string' || !/^\d{1,78}$/.test(value)) throw new Error('Invalid DUST amount');
  return BigInt(value);
}
function date(seconds: number): Date {
  index(seconds);
  const result = new Date(seconds * 1000);
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid DUST time');
  return result;
}

/** Prefix queries retain an anonymity set, as in Midnight's event-less SDK.
 * Avoid trailing ff: older indexers compute that prefix's exclusive bound incorrectly. */
export function dustNullifierPrefix(nullifier: bigint, commitments: number): string {
  const encoded = littleEndianHex(nullifier);
  let bytes = Math.max(1, Math.min(31, Math.floor(Math.log2(Math.max(1, commitments / 128)) / 8)));
  while (bytes > 1 && encoded.slice(bytes * 2 - 2, bytes * 2) === 'ff') bytes--;
  // Nexus expands ff to the same broad cover for every caller, preserving its
  // anonymity set instead of revealing the next byte of the owned nullifier.
  // The bounded cover excludes four leading ff bytes; never misread those as unspent.
  if (bytes === 1 && encoded.startsWith('ffffffff')) throw new Error('DUST nullifier prefix is unsupported by the indexer');
  return encoded.slice(0, bytes * 2);
}

function assertTreeUpdate(update: CollapsedDustTree, start: number, end: number, protocol: number): void {
  if (update.startIndex !== start || update.endIndex !== end || update.protocolVersion !== protocol) {
    throw new Error('DUST tree update does not match the requested snapshot range');
  }
  hex(update.update);
}

class DustRootMismatch extends Error {}

/** A DUST coin as plain wire values (bigints as decimal strings, time in ms). */
export interface DustCoinWire {
  initialValue: string;
  owner: string;
  nonce: string;
  seq: number;
  ctime: number;
  backingNight: string;
  mtIndex: string;
}

/**
 * Where the last reconstruction left each of the wallet's spend chains, so the
 * next one scans only the blocks after it. Owned coins, so private: it is kept
 * in the extension's own storage (midnightWalletStatePersistence), never in
 * chrome.storage.
 */
export interface DustSpendCheckpoint {
  /** Every spend at or below this height is applied to `heads`. */
  checkedThrough: number;
  /** Per generation (`generationKey`), the newest coin of its chain created at or below `checkedThrough`. */
  heads: Record<string, DustCoinWire>;
  /**
   * Generations that are not as far as `checkedThrough` yet: one found after
   * the checkpoint was taken, still being scanned from its first block. How
   * far each is, and its newest coin there. A generation is in `heads` or
   * here, never both, so a build that does not know this field scans these
   * from their first block.
   */
  behind?: Record<string, { checkedThrough: number; head: DustCoinWire }>;
}

export interface ReconstructDustOptions {
  /** Resume from this checkpoint instead of scanning every spend chain from the first block. */
  checkpoint?: DustSpendCheckpoint | null;
  /**
   * The chain's first block on the snapshot's ledger (MIDNIGHT_LEDGER9_FIRST_BLOCK):
   * a chain whose coin was created at or after it is scanned from it, not from
   * block 0. Every wallet scans from the same block, so it tells the server nothing.
   */
  ledgerFirstBlock?: { readonly height: number; readonly timestamp: number };
  /**
   * Blocks below the snapshot tip the returned checkpoint stays, so a short
   * reorg never leaves a reverted spend in it. Default `DUST_CHECKPOINT_MARGIN_BLOCKS`.
   */
  checkpointMarginBlocks?: number;
  /** Warm scans start on a multiple of this many blocks (`dustWarmScanStart`); 0 starts right after the checkpoint. Default `DUST_SCAN_ALIGN_BLOCKS`. */
  scanAlignBlocks?: number;
  /** A scan of at least two of these many blocks is settled in stages (`dustScanStages`). Default `DUST_SCAN_MIN_STAGE_BLOCKS`. */
  scanStageBlocks?: number;
  /**
   * Called during the spend scan, each time more of it is settled, with a
   * checkpoint the next attempt can resume from: after each stage of a long
   * scan, and inside a stage when a whole week of it is settled. A long scan
   * is minutes for a wallet with many coins, longer than a build may take (it
   * ends at the transaction's expiry), so a build that fails or runs out of
   * time must not send the next one back to the first block. A checkpoint
   * taken during a scan never stands on one of the wallet's own spends
   * (`dustScanStages`). The checkpoint is not yet
   * checked against the commitment root: like any stored one it is a hint, and
   * a head the chain does not have is dropped by `reconstructDustState`'s cold
   * attempts. Must not throw or block.
   */
  onCheckpoint?: (checkpoint: DustSpendCheckpoint) => void;
}

/** About half an hour of Midnight blocks: a spend this deep is final. */
export const DUST_CHECKPOINT_MARGIN_BLOCKS = 300;

// The indexer streams a spend scan at ~11 ms per matching record, one page
// after another: a fork-to-tip scan of one prefix took 56 s on mainnet
// (2026-11-16), the same scan in 8 block slices 12-13 s with 4 requests in
// flight. 6 in flight was no faster and drew 429s from Nexus, whose sidecar
// serves 16 DUST requests at once for every wallet.
/**
 * About a day of Midnight blocks. A warm scan starting just after the
 * checkpoint would cover ~300 blocks, where a prefix matches 2-4 spends on
 * mainnet (2026-11-16): the next round's prefix would all but name the
 * wallet's own spend among them. Starting on a shared day boundary keeps a
 * day or more of spends (~300 per prefix) in every warm scan, and tells the
 * server only the day the wallet last synced.
 */
export const DUST_SCAN_ALIGN_BLOCKS = 14_400;

/**
 * Where a resumed chain is scanned from: the multiple of `align` that leaves
 * at least `align` blocks before the first unchecked one, never below `floor`
 * (the ledger's first block). `align` 0 is the block after the checkpoint.
 */
export function dustWarmScanStart(checkedThrough: number, align: number, floor: number): number {
  if (align === 0) return checkedThrough + 1;
  return Math.max(floor, 0, Math.floor((checkedThrough + 1 - align) / align) * align);
}

/** At most this many fixed block slices per scan. */
export const DUST_SCAN_MAX_SLICES = 8;
/** No slice shorter than this: a short warm scan stays one request. */
export const DUST_SCAN_MIN_SLICE_BLOCKS = 2_000;
/** One reconstruction's spend requests in flight. */
export const DUST_SPEND_CONCURRENCY = 4;

/**
 * Splits the inclusive block range of a scan into contiguous slices. They
 * depend on the range alone, never on an owned nullifier, so asking for the
 * slices tells the server nothing the whole range would not.
 */
export function dustScanSlices(from: number, to: number, max: number = DUST_SCAN_MAX_SLICES): [number, number][] {
  const span = to - from + 1;
  if (!Number.isSafeInteger(span) || span < 1) throw new Error('Invalid DUST scan range');
  const count = Math.max(1, Math.min(max, Math.floor(span / DUST_SCAN_MIN_SLICE_BLOCKS)));
  const size = Math.ceil(span / count);
  const slices: [number, number][] = [];
  for (let start = from; start <= to; start += size) slices.push([start, Math.min(to, start + size - 1)]);
  return slices;
}

/** At most this many stages per scan. */
export const DUST_SCAN_MAX_STAGES = 8;
/**
 * No stage shorter than this, about a week of Midnight blocks: a scan shorter
 * than two of them (every warm scan of a wallet used in the last days) is one
 * stage, scanned to the tip as before.
 */
export const DUST_SCAN_MIN_STAGE_BLOCKS = 7 * DUST_SCAN_ALIGN_BLOCKS;

/**
 * The last block of each stage of a scan of `from..to`, in order; the last one
 * is `to`. A long scan (a new profile, a wallet unused for weeks) is settled
 * stage by stage: every chain is followed to the end of a stage, successors
 * included, before the next stage is asked for, and each settled stage is a
 * checkpoint. Scanning the whole range for every link of a chain instead cost
 * a wallet with ten coins more than five minutes per pass on preprod
 * (2026-11-23), longer than a fee build may take, so it never finished and
 * kept nothing.
 *
 * What the stages add for the server: it sees in which stage a chain moves to
 * its next coin. That must stay a week of blocks or more, also over several
 * attempts, so nothing the wallet asks for or stores during a scan may depend
 * on where its own spends are:
 * - A stage ends on a fixed grid, the block before a multiple of `minBlocks`
 *   (only the last one ends at `to`), and no stage is shorter than
 *   `minBlocks`. Two attempts cut their ranges differently, but always on the
 *   same grid, so what they show together is still whole weeks.
 * - A checkpoint taken during a scan stands on that grid too
 *   (`dustStageBoundaryAtOrBelow`), never one block below a spend: the next
 *   attempt starts from a day boundary before its checkpoint, which would
 *   name that spend's day.
 * - A successor is asked for from the first block of its stage's scan, never
 *   from the block it was created in.
 * The tip of each attempt is the one thing not on the grid: like any
 * synchronization, an attempt shows that what it found happened before it.
 */
export function dustScanStages(from: number, to: number, minBlocks: number = DUST_SCAN_MIN_STAGE_BLOCKS): number[] {
  const span = to - from + 1;
  if (!Number.isSafeInteger(span) || span < 1) throw new Error('Invalid DUST scan range');
  if (!Number.isSafeInteger(minBlocks) || minBlocks < 1) throw new Error('Invalid DUST scan stage');
  const ends: number[] = [];
  for (let width = Math.max(1, Math.ceil(span / (minBlocks * DUST_SCAN_MAX_STAGES))) * minBlocks; ; width += minBlocks) {
    ends.length = 0;
    for (let end = Math.ceil((from + minBlocks) / width) * width - 1; end <= to - minBlocks; end += width) ends.push(end);
    if (ends.length < DUST_SCAN_MAX_STAGES) break;
  }
  ends.push(to);
  return ends;
}

/** The highest block at or below `height` that ends a `minBlocks` cell of the stage grid; -1 when there is none. */
export function dustStageBoundaryAtOrBelow(height: number, minBlocks: number = DUST_SCAN_MIN_STAGE_BLOCKS): number {
  return Math.floor((height + 1) / minBlocks) * minBlocks - 1;
}

/** Runs at most `max` tasks at once; a finished task hands its slot to the next waiting one. */
function concurrencyLimit(max: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < max) active++;
    else await new Promise<void>(resolve => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}

function generationKey(generationMtIndex: number, backingNight: string): string {
  return `${generationMtIndex}:${backingNight.toLowerCase()}`;
}

export function dustCoinToWire(coin: QualifiedDustOutput): DustCoinWire {
  return {
    initialValue: coin.initialValue.toString(), owner: coin.owner.toString(), nonce: coin.nonce.toString(),
    seq: coin.seq, ctime: coin.ctime.getTime(), backingNight: coin.backingNight, mtIndex: coin.mtIndex.toString(),
  };
}

/** The checkpoint's head for `root`'s chain, or null when it is not a coin this chain can have. */
function dustCoinFromWire(wire: unknown, root: QualifiedDustOutput, commitmentEnd: number): QualifiedDustOutput | null {
  try {
    const w = wire as DustCoinWire;
    if (!w || typeof w !== 'object' || !Number.isSafeInteger(w.seq) || w.seq < root.seq
      || !Number.isSafeInteger(w.ctime) || w.ctime < root.ctime.getTime()
      || typeof w.backingNight !== 'string' || w.backingNight.toLowerCase() !== root.backingNight.toLowerCase()) return null;
    const coin: QualifiedDustOutput = {
      initialValue: amount(w.initialValue), owner: amount(w.owner), nonce: amount(w.nonce), seq: w.seq,
      ctime: new Date(w.ctime), backingNight: root.backingNight, mtIndex: amount(w.mtIndex),
    };
    if (coin.owner !== root.owner || coin.mtIndex < root.mtIndex || coin.mtIndex >= BigInt(commitmentEnd)) return null;
    if (coin.seq === root.seq && (coin.mtIndex !== root.mtIndex || coin.nonce !== root.nonce
      || coin.initialValue !== root.initialValue)) return null;
    return coin;
  } catch {
    return null;
  }
}

/** Legacy indexers can publish tree projections ahead of their block metadata.
 * Retry with a fresh anchor, under the caller's shared deadline; never accept a mismatch. */
export async function reconstructDustState<State, Key>(
  ledger: DustLightLedger<State, Key>, key: Key, network: string, transport: DustLightTransport,
  progress: (percent: number, detail: string) => void = () => {},
  options: ReconstructDustOptions = {},
): Promise<{ state: State; block: DustSyncBlock; checkpoint: DustSpendCheckpoint | null }> {
  // A head the chain does not have (a deep reorg, a damaged row) fails the
  // commitment root on every resumed attempt; the cold attempts after it
  // succeed and their checkpoint replaces the bad one.
  const attempts = options.checkpoint ? 4 : 3;
  for (let attempt = 0; ; attempt++) {
    const run = options.checkpoint && attempt >= 2 ? { ...options, checkpoint: null } : options;
    try { return await reconstructDustStateOnce(ledger, key, network, transport, progress, run); }
    catch (error) { if (!(error instanceof DustRootMismatch) || attempt >= attempts - 1) throw error; }
  }
}

/** Rebuild from public projections, independent of wallet creation time and event IDs.
 * Only the wallet's own spend chains are followed. Foreign tree ranges are compact hashes.
 *
 * A chain is scanned from the first block, or from a shared day boundary before
 * a checkpoint's `checkedThrough` when the checkpoint has its head. A successor found on the
 * way is scanned from where its parent's scan started, never from the block it
 * was created in: that block would name the wallet's own spend to the server.
 * A long scan is settled in stages (`dustScanStages`), each stage resumed from
 * the one before it exactly as a later build resumes from a checkpoint. */
async function reconstructDustStateOnce<State, Key>(
  ledger: DustLightLedger<State, Key>, key: Key, network: string, transport: DustLightTransport,
  progress: (percent: number, detail: string) => void = () => {},
  options: ReconstructDustOptions = {},
): Promise<{ state: State; block: DustSyncBlock; checkpoint: DustSpendCheckpoint | null }> {
  const report = (percent: number, detail: string) => { try { progress(percent, detail); } catch { /* advisory */ } };
  report(5, '');
  const snapshot = await transport.snapshot(ledger.address(key, network));
  if (snapshot.version !== 1 || snapshot.network !== `midnight-${network}` || !Array.isArray(snapshot.generations)) {
    throw new Error('Invalid DUST snapshot network or version');
  }
  const { block } = snapshot;
  if (!/^[0-9a-f]{64}$/i.test(block.hash)) throw new Error('Invalid DUST snapshot block');
  index(block.height); index(block.protocolVersion);
  // The snapshot block says which ledger the chain is on. Record it, and never
  // rebuild ledger 9 DUST state with ledger 8 (or the reverse): that is a
  // network that changed ledger since this send chose its path.
  noteMidnightProtocolVersion(network, block.protocolVersion);
  const snapshotLedger = ledgerForProtocolVersion(block.protocolVersion);
  if (snapshotLedger !== ledger.ledger) throw new MidnightLedgerChangedError(network, snapshotLedger);
  const generationEnd = index(block.dustGenerationEndIndex);
  const commitmentEnd = index(block.dustCommitmentEndIndex);
  const timestamp = new Date(index(block.timestamp));
  if (Math.abs(Date.now() - timestamp.getTime()) > 5 * 60_000) throw new Error('DUST indexer is behind; please retry shortly');
  const owner = ScaleBigInt.encode(ledger.publicKey(key)).toString('hex');
  const dtimes = new Map<string, DustDtimeRecord>();
  const generations: DustGenerationRecord[] = [];
  const gaps: CollapsedDustTree[] = [];
  for (const item of snapshot.generations) {
    if (item.__typename === 'DustGenerationDtimeUpdateItem') {
      if (item.owner.toLowerCase() !== owner || !/^[0-9a-f]{64}$/i.test(item.nightUtxoHash)) throw new Error('Invalid DUST generation owner');
      index(item.generationMtIndex); date(item.newDtime);
      dtimes.set(item.nightUtxoHash.toLowerCase(), item);
    } else if (item.__typename === 'DustGenerationsItem' || item.__typename === 'DustGenerationsProgress') {
      if (item.collapsedMerkleTree) gaps.push(item.collapsedMerkleTree);
      if (item.__typename === 'DustGenerationsItem') generations.push(item);
    } else throw new Error('Unknown DUST generation record');
  }
  let state = ledger.createState(block.ledgerParameters);
  // A checkpoint resumes only behind this snapshot (a lagging server can answer with an older block).
  const saved = options.checkpoint;
  const resume = saved && Number.isSafeInteger(saved.checkedThrough) && saved.checkedThrough >= 0
    && saved.checkedThrough < block.height && saved.heads && typeof saved.heads === 'object' ? saved : null;
  const margin = options.checkpointMarginBlocks ?? DUST_CHECKPOINT_MARGIN_BLOCKS;
  if (!Number.isSafeInteger(margin) || margin < 0) throw new Error('Invalid DUST checkpoint margin');
  const align = options.scanAlignBlocks ?? DUST_SCAN_ALIGN_BLOCKS;
  if (!Number.isSafeInteger(align) || align < 0) throw new Error('Invalid DUST scan alignment');
  const stageBlocks = options.scanStageBlocks ?? DUST_SCAN_MIN_STAGE_BLOCKS;
  // What the returned checkpoint covers: never below the one resumed from.
  const checkedThrough = Math.max(block.height - margin, resume ? resume.checkedThrough : -1);
  interface LiveCoin {
    coin: QualifiedDustOutput; generation: DustGenerationInfo; generationKey: string;
    /** First block this chain's spends are looked for in; moves up as stages of a long scan are settled. */
    scanFrom: number;
    /** Never scanned below this block: the ledger's first block, or 0. */
    floor: number;
    /** How far this chain is settled: where it was resumed from, then each stage end it reached; -1 before any. */
    through: number;
    /** The coin this attempt started the chain from: its first coin, or the checkpoint's head. */
    base: QualifiedDustOutput;
    /** Each successor found since, in chain order, with the height of the spend that created it. */
    links: { coin: QualifiedDustOutput; height: number }[];
  }
  const live = new Map<bigint, LiveCoin>();
  /** The chain's newest coin created at or below `height`. */
  const headAt = (entry: LiveCoin, height: number): QualifiedDustOutput => {
    let head = entry.base;
    for (const link of entry.links) {
      if (link.height > height) break;
      head = link.coin;
    }
    return head;
  };
  const checkpointAt = (through: number): DustSpendCheckpoint => ({
    checkedThrough: through,
    heads: Object.fromEntries([...live.values()].map(entry => [entry.generationKey, dustCoinToWire(headAt(entry, through))])),
  });
  const segments = [...gaps.map(gap => ({ start: gap.startIndex, gap })),
    ...generations.map(generation => ({ start: generation.generationMtIndex, generation }))]
    .sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const segment of segments) {
    if (index(segment.start) !== cursor) throw new Error('Incomplete or overlapping DUST generation snapshot');
    if ('gap' in segment) {
      const { gap } = segment;
      if (index(gap.endIndex) < cursor || gap.endIndex >= generationEnd) throw new Error('Invalid DUST generation range');
      assertTreeUpdate(gap, cursor, gap.endIndex, block.protocolVersion);
      state = ledger.applyGeneration(state, gap.update);
      cursor = gap.endIndex + 1;
      continue;
    }
    const item = segment.generation;
    if (cursor >= generationEnd || index(item.commitmentMtIndex) >= commitmentEnd
      || item.owner.toLowerCase() !== owner || !/^[0-9a-f]{64}$/i.test(item.backingNight)) throw new Error('Invalid DUST generation');
    const decay = dtimes.get(item.backingNight.toLowerCase());
    if (decay && decay.generationMtIndex !== item.generationMtIndex) throw new Error('DUST decay index mismatch');
    const generation: DustGenerationInfo = { owner: ledger.publicKey(key), value: amount(item.value),
      nonce: item.backingNight, dtime: decay ? date(decay.newDtime) : undefined };
    const coin: QualifiedDustOutput = { owner: generation.owner, initialValue: amount(item.initialValue),
      nonce: amount(item.initialNonce), seq: 0, ctime: date(item.ctime),
      backingNight: item.backingNight, mtIndex: BigInt(item.commitmentMtIndex) };
    state = ledger.insertGeneration(state, cursor, generation);
    if (live.has(ledger.nullifier(coin, key))) throw new Error('Duplicate DUST generation');
    const chainKey = generationKey(item.generationMtIndex, item.backingNight);
    let head = resume && Object.hasOwn(resume.heads, chainKey)
      ? dustCoinFromWire(resume.heads[chainKey], coin, commitmentEnd) : null;
    let through = head && resume ? resume.checkedThrough : -1;
    // A generation the checkpoint has, but not as far as its other chains.
    const lagging = resume && !Object.hasOwn(resume.heads, chainKey) && resume.behind && typeof resume.behind === 'object'
      && Object.hasOwn(resume.behind, chainKey) ? resume.behind[chainKey] : null;
    if (lagging && typeof lagging === 'object' && Number.isSafeInteger(lagging.checkedThrough)
      && lagging.checkedThrough >= 0 && lagging.checkedThrough < resume!.checkedThrough) {
      head = dustCoinFromWire(lagging.head, coin, commitmentEnd);
      if (head) through = lagging.checkedThrough;
    }
    const start = head ?? coin;
    const nullifier = ledger.nullifier(start, key);
    if (live.has(nullifier)) throw new Error('Duplicate DUST generation');
    // A coin from before the ledger's first block (it should have none: DUST
    // was reset there) is scanned from block 0, so the check below still
    // refuses a spend of it from another ledger.
    const first = options.ledgerFirstBlock;
    const fromFirst = first && Number.isSafeInteger(first.height) && first.height >= 0 && first.height <= block.height
      && coin.ctime.getTime() >= first.timestamp ? first.height : 0;
    live.set(nullifier, { coin: start, generation, generationKey: chainKey,
      scanFrom: through >= 0 ? dustWarmScanStart(through, align, fromFirst) : fromFirst, floor: fromFirst, through,
      base: start, links: [] });
    cursor++;
  }
  if (cursor !== generationEnd) throw new Error('Incomplete DUST generation tree');
  const matchesRoot = (root: bigint | undefined, expected: string | null, end: number) => expected === null
    ? end === 0 && (root === undefined || root === 0n)
    : root !== undefined && ScaleBigInt.encode(root).toString('hex') === expected.toLowerCase();
  if (!matchesRoot(ledger.roots(state)[0], block.dustGenerationMerkleTreeRoot, generationEnd)) {
    throw new DustRootMismatch('DUST generation root verification failed');
  }
  report(30, '');
  // Retain only exact owned matches, never the potentially large decoy history.
  // A descendant in an already queried prefix must be checked again: its spend
  // may have appeared before we knew that descendant's nullifier.
  const checked = new Set<bigint>();
  const matches = new Map<bigint, DustSpendTransaction>();
  const seen = new Set<bigint>();
  let discovered = 0;
  const limit = concurrencyLimit(DUST_SPEND_CONCURRENCY);
  // How far each chain is settled in the stage that ends at `stageEnd`, and
  // the checkpoint that says so.
  // - A chain whose newest coin was looked up to the end of the stage is
  //   settled to it.
  // - A chain whose newest coin is still to be looked up is settled below the
  //   block that coin was created in, but said to be settled only to the stage
  //   grid below that: a checkpoint one block under a spend would have the
  //   next attempt start from that spend's day (`dustScanStages`).
  // - A chain whose scan starts after the stage (resumed from a later
  //   checkpoint) is where it was resumed from.
  // The checkpoint stands where every chain is settled, or, while a chain is
  // still behind the checkpoint this build resumed from (a generation found
  // since), at that checkpoint with the chain's own progress in `behind`: its
  // scan from the first block is long, and must not start again each attempt.
  const resumedAt = resume ? resume.checkedThrough : -1;
  /** Per generation, how far the last reported checkpoint said it was. */
  const reported = new Map<string, number>([...live.values()].map(entry => [entry.generationKey, entry.through]));
  const reportSettled = (stageEnd: number) => {
    const target = Math.min(stageEnd, checkedThrough);
    const at = new Map<LiveCoin, number>();
    for (const [nullifier, entry] of live) {
      let through = entry.through;
      if (entry.scanFrom <= stageEnd) {
        if (checked.has(nullifier)) through = Math.max(through, target);
        else if (entry.links.length) {
          const below = entry.links[entry.links.length - 1].height - 1;
          through = Math.max(through, below >= target ? target : dustStageBoundaryAtOrBelow(below, stageBlocks));
        }
      }
      at.set(entry, through);
    }
    if (!at.size) return;
    const everyChain = Math.min(...at.values());
    const stands = Math.max(everyChain, resumedAt);
    let further = false;
    for (const [entry, through] of at) {
      if (Math.min(through, stands) > reported.get(entry.generationKey)!) further = true;
    }
    if (!further) return;
    const heads: Record<string, DustCoinWire> = {};
    const behind: NonNullable<DustSpendCheckpoint['behind']> = {};
    for (const [entry, through] of at) {
      reported.set(entry.generationKey, Math.min(through, stands));
      if (through >= stands) heads[entry.generationKey] = dustCoinToWire(headAt(entry, stands));
      else if (through >= 0) behind[entry.generationKey] = { checkedThrough: through, head: dustCoinToWire(headAt(entry, through)) };
    }
    const checkpoint: DustSpendCheckpoint = Object.keys(behind).length
      ? { checkedThrough: stands, heads, behind } : { checkedThrough: stands, heads };
    try { options.onCheckpoint?.(checkpoint); } catch { /* advisory */ }
  };
  const stages = live.size
    ? dustScanStages(Math.min(...[...live.values()].map(entry => entry.scanFrom)), block.height, stageBlocks) : [block.height];
  let stage = 0;
  for (;;) {
    const stageEnd = stages[stage];
    const pending = [...live.keys()].filter(n => !checked.has(n) && live.get(n)!.scanFrom <= stageEnd);
    // One scan per prefix and start block, each in fixed block slices; a
    // round's scans and slices run side by side, under one request limit.
    const scans = new Map<string, { prefix: string; from: number; nullifiers: bigint[] }>();
    for (const n of pending) {
      const prefix = dustNullifierPrefix(n, commitmentEnd);
      const from = live.get(n)!.scanFrom;
      const id = `${prefix}@${from}`;
      const scan = scans.get(id) ?? { prefix, from, nullifiers: [] };
      scan.nullifiers.push(n);
      scans.set(id, scan);
    }
    // A stage is already a part of the range: its scans share the request
    // limit between them instead of each taking eight slices of it.
    const slices = stages.length > 1 ? Math.max(1, Math.ceil(DUST_SPEND_CONCURRENCY / scans.size)) : DUST_SCAN_MAX_SLICES;
    await Promise.all([...scans.values()].map(async ({ prefix, from, nullifiers }) => {
      await Promise.all(dustScanSlices(from, stageEnd, slices).map(async ([sliceFrom, sliceTo]) => {
        let fromBlock = sliceFrom;
        let window = 250_000;
        for (;;) {
          const toBlock = Math.min(sliceTo, fromBlock + window - 1);
          const { transactions, nextBlock } = await limit(() => transport.spends(block, [prefix], fromBlock, toBlock));
          if (!Array.isArray(transactions) || (nextBlock !== null
            && (!Number.isSafeInteger(nextBlock) || nextBlock <= fromBlock || nextBlock > toBlock + 1 || nextBlock > block.height))
            || (nextBlock === null && toBlock !== block.height)) {
            throw new Error('Invalid DUST spend page cursor');
          }
          for (const tx of transactions) {
            const height = index(tx.block.height);
            if (height < fromBlock || height > toBlock || (nextBlock !== null && height >= nextBlock)) {
              throw new Error('DUST spend is outside its snapshot page');
            }
            // DUST state resets once, at the ledger 9 crossing: every coin the
            // snapshot lists was created on the snapshot's ledger, so a spend
            // from before the crossing (another ledger's events) cannot be one
            // of them. Skip that history, but only while it touches no owned
            // nullifier: a match means the reset assumption does not hold, and
            // the reconstructed state would be wrong, so fail loudly.
            // A malformed version is a bad page, not another ledger's history.
            if (!Number.isSafeInteger(tx.protocolVersion) || tx.protocolVersion < 0) throw new Error('Invalid DUST spend protocol version');
            const sameLedger = onLedger(tx.protocolVersion, ledger.ledger);
            for (const encoded of tx.matchedNullifiers) {
              if (!/^[0-9a-f]{64}$/i.test(encoded)) throw new Error('Invalid matched DUST nullifier');
              const nullifier = BigInt(`0x${Buffer.from(encoded, 'hex').reverse().toString('hex')}`);
              if (!live.has(nullifier)) continue;
              if (!sameLedger) {
                throw new Error(`An owned DUST coin was spent by a transaction from another ledger (protocol version ${tx.protocolVersion}); the DUST reset at the ledger crossing does not hold`);
              }
              const prior = matches.get(nullifier);
              if (prior && prior.hash !== tx.hash) throw new Error('Conflicting DUST spends');
              matches.set(nullifier, tx);
            }
          }
          // Below the tip the server answers the block after the page, so a
          // slice ends when that block is past it.
          if (nextBlock === null || nextBlock > sliceTo) break;
          window = nextBlock - fromBlock;
          fromBlock = nextBlock;
        }
      }));
      nullifiers.forEach(n => checked.add(n));
    }));
    let advanced = false;
    for (const [nullifier, entry] of [...live]) {
      const transaction = matches.get(nullifier);
      if (!transaction) continue;
      let spend: DustSpendEvent | undefined;
      for (const event of transaction.dustLedgerEvents) {
        // Decode only transactions with exact owned matches, and only this
        // ledger's events. An unreadable owned spend of this ledger is fatal.
        if (!onLedger(event.protocolVersion, ledger.ledger)) continue;
        try {
          const decoded = ledger.decodeSpend(event.raw);
          if (decoded?.nullifier === nullifier) spend = decoded;
        } catch { /* the required matched spend is checked below */ }
      }
      if (!spend) throw new Error('Cannot decode an owned DUST spend');
      if (seen.has(nullifier) || spend.commitmentIndex <= entry.coin.mtIndex || spend.commitmentIndex >= BigInt(commitmentEnd)
        || spend.blockTime.getTime() > timestamp.getTime()
        || spend.declaredTime.getTime() < entry.coin.ctime.getTime()) throw new Error('Cyclic or out-of-order DUST spend');
      const successor = ledger.successor(entry.coin, entry.generation, spend, transaction.block.ledgerParameters, key);
      if (ledger.commitment(successor) !== spend.commitment) throw new Error('DUST successor commitment verification failed');
      seen.add(nullifier);
      matches.delete(nullifier);
      live.delete(nullifier);
      live.set(ledger.nullifier(successor, key), { ...entry, coin: successor,
        links: [...entry.links, { coin: successor, height: index(transaction.block.height) }] });
      advanced = true;
      if (++discovered > commitmentEnd) throw new Error('Invalid DUST spend chain');
    }
    reportSettled(stageEnd);
    if (advanced) {
      if (stages.length === 1) report(50, '');
      continue;
    }
    if (stageEnd === block.height) break;
    // The stage is settled. The next one asks for every chain again, from a
    // shared day boundary before this stage's end: what a build resumed from
    // the checkpoint just reported would ask for.
    checked.clear();
    for (const entry of live.values()) {
      if (entry.scanFrom > stageEnd) continue;
      entry.through = Math.max(entry.through, Math.min(stageEnd, checkedThrough));
      entry.scanFrom = Math.max(entry.scanFrom, dustWarmScanStart(stageEnd, align, entry.floor));
    }
    report(30 + Math.floor(40 * ++stage / stages.length), '');
  }
  report(70, '');
  const coins = [...live.values()].map(e => e.coin).sort((a, b) => a.mtIndex < b.mtIndex ? -1 : a.mtIndex > b.mtIndex ? 1 : 0);
  const ranges: { startIndex: number; endIndex: number }[] = [];
  cursor = 0;
  for (const coin of coins) {
    const coinIndex = Number(coin.mtIndex);
    if (coinIndex < cursor) throw new Error('Duplicate DUST commitment');
    if (coinIndex > cursor) ranges.push({ startIndex: cursor, endIndex: coinIndex - 1 });
    cursor = coinIndex + 1;
  }
  if (cursor < commitmentEnd) ranges.push({ startIndex: cursor, endIndex: commitmentEnd - 1 });
  const updates: CollapsedDustTree[] = [];
  // One range per request, one request at a time. Requests with several
  // ranges were answered 503 on preprod (2026-11-22), which failed the fee
  // builds of a wallet with ten coins; a range alone answers in well under a
  // second, so this costs little.
  for (const range of ranges) {
    const result = await transport.commitments(block, [range]);
    if (result.length !== 1) throw new Error('Incomplete DUST commitment snapshot');
    assertTreeUpdate(result[0], range.startIndex, range.endIndex, block.protocolVersion);
    updates.push(result[0]);
  }
  const commitments = [...updates.map(gap => ({ start: gap.startIndex, gap })),
    ...coins.map(coin => ({ start: Number(coin.mtIndex), coin }))].sort((a, b) => a.start - b.start);
  for (const segment of commitments) state = 'gap' in segment
    ? ledger.applyCommitment(state, segment.gap.update) : ledger.insertCoin(state, key, segment.coin);
  if (!matchesRoot(ledger.roots(state)[1], block.dustCommitmentMerkleTreeRoot, commitmentEnd)) {
    throw new DustRootMismatch('DUST commitment root verification failed');
  }
  report(100, '');
  return { state, block, checkpoint: checkedThrough < 0 ? null : checkpointAt(checkedThrough) };
}
