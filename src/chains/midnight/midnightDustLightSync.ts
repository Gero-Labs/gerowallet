import type { DustGenerationInfo, QualifiedDustOutput } from '@midnight-ntwrk/ledger-v8';
import { ScaleBigInt } from '@midnightntwrk/wallet-sdk-address-format';

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

/** Legacy indexers can publish tree projections ahead of their block metadata.
 * Retry with a fresh anchor, under the caller's shared deadline; never accept a mismatch. */
export async function reconstructDustState<State, Key>(
  ledger: DustLightLedger<State, Key>, key: Key, network: string, transport: DustLightTransport,
  progress: (percent: number, detail: string) => void = () => {},
): Promise<{ state: State; block: DustSyncBlock }> {
  for (let attempt = 0; ; attempt++) {
    try { return await reconstructDustStateOnce(ledger, key, network, transport, progress); }
    catch (error) { if (!(error instanceof DustRootMismatch) || attempt >= 2) throw error; }
  }
}

/** Rebuild from public projections, independent of wallet creation time and event IDs.
 * Only the wallet's own spend chains are followed. Foreign tree ranges are compact hashes. */
async function reconstructDustStateOnce<State, Key>(
  ledger: DustLightLedger<State, Key>, key: Key, network: string, transport: DustLightTransport,
  progress: (percent: number, detail: string) => void = () => {},
): Promise<{ state: State; block: DustSyncBlock }> {
  const report = (percent: number, detail: string) => { try { progress(percent, detail); } catch { /* advisory */ } };
  report(5, '');
  const snapshot = await transport.snapshot(ledger.address(key, network));
  if (snapshot.version !== 1 || snapshot.network !== `midnight-${network}` || !Array.isArray(snapshot.generations)) {
    throw new Error('Invalid DUST snapshot network or version');
  }
  const { block } = snapshot;
  if (!/^[0-9a-f]{64}$/i.test(block.hash)) throw new Error('Invalid DUST snapshot block');
  index(block.height); index(block.protocolVersion);
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
  const live = new Map<bigint, { coin: QualifiedDustOutput; generation: DustGenerationInfo }>();
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
    const nullifier = ledger.nullifier(coin, key);
    if (live.has(nullifier)) throw new Error('Duplicate DUST generation');
    live.set(nullifier, { coin, generation });
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
  for (;;) {
    const pending = [...live.keys()].filter(n => !checked.has(n));
    const prefixes = [...new Set(pending.map(n => dustNullifierPrefix(n, commitmentEnd)))];
    for (const prefix of prefixes) {
      let fromBlock = 0;
      let window = 250_000;
      for (;;) {
        const toBlock = Math.min(block.height, fromBlock + window - 1);
        const { transactions, nextBlock } = await transport.spends(block, [prefix], fromBlock, toBlock);
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
          for (const encoded of tx.matchedNullifiers) {
            if (!/^[0-9a-f]{64}$/i.test(encoded)) throw new Error('Invalid matched DUST nullifier');
            const nullifier = BigInt(`0x${Buffer.from(encoded, 'hex').reverse().toString('hex')}`);
            if (!live.has(nullifier)) continue;
            const prior = matches.get(nullifier);
            if (prior && prior.hash !== tx.hash) throw new Error('Conflicting DUST spends');
            matches.set(nullifier, tx);
          }
        }
        if (nextBlock === null) break;
        window = nextBlock - fromBlock;
        fromBlock = nextBlock;
      }
      pending.filter(n => dustNullifierPrefix(n, commitmentEnd) === prefix).forEach(n => checked.add(n));
    }
    let advanced = false;
    for (const [nullifier, entry] of [...live]) {
      const transaction = matches.get(nullifier);
      if (!transaction) continue;
      let spend: DustSpendEvent | undefined;
      for (const event of transaction.dustLedgerEvents) {
        // Decode only transactions with exact owned matches. Unrelated events
        // can belong to another ledger, but an unreadable owned spend is fatal.
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
      live.set(ledger.nullifier(successor, key), { coin: successor, generation: entry.generation });
      advanced = true;
      if (++discovered > commitmentEnd) throw new Error('Invalid DUST spend chain');
    }
    if (!advanced) break;
    report(50, '');
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
  for (let i = 0; i < ranges.length; i += 64) {
    const batch = ranges.slice(i, i + 64);
    const result = await transport.commitments(block, batch);
    if (result.length !== batch.length) throw new Error('Incomplete DUST commitment snapshot');
    result.forEach((update, j) => assertTreeUpdate(update, batch[j].startIndex, batch[j].endIndex, block.protocolVersion));
    updates.push(...result);
  }
  const commitments = [...updates.map(gap => ({ start: gap.startIndex, gap })),
    ...coins.map(coin => ({ start: Number(coin.mtIndex), coin }))].sort((a, b) => a.start - b.start);
  for (const segment of commitments) state = 'gap' in segment
    ? ledger.applyCommitment(state, segment.gap.update) : ledger.insertCoin(state, key, segment.coin);
  if (!matchesRoot(ledger.roots(state)[1], block.dustCommitmentMerkleTreeRoot, commitmentEnd)) {
    throw new DustRootMismatch('DUST commitment root verification failed');
  }
  report(100, '');
  return { state, block };
}
