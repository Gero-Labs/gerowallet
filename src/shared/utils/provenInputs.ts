import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { Network } from '@/models/types';
import { debugLog } from '@/utils/debug';
import { canonicalAddress } from '@/shared/utils/txIntentGuard';

/**
 * Input values the wallet can prove instead of taking a server's word for them.
 *
 * The wallet's UTxO list comes from gero-sync, the same backend trust domain as
 * Nexus and the swap aggregator that build the transactions it signs. A spend
 * budget computed from those values trusts the backend twice: understate one
 * input's value and a drain fits inside the budget.
 *
 * A transaction id is the blake2b-256 hash of the transaction body, so the CBOR
 * of the transaction that created `txHash#index` proves that output's address
 * and value, whoever served the CBOR: hash the body, compare with `txHash`, read
 * output `index`. Sources are tried in order (the wallet's own history first,
 * then gero-backend) and a CBOR whose hash does not match is simply ignored.
 *
 * The source does not have to be independent of the backend that reported the
 * UTxOs. For an output that is on chain, only the real transaction hashes to its
 * id. One that is not on chain can be "proven" with any value, but a transaction
 * spending it is rejected by the chain, so nothing leaves the wallet.
 */

/** `txHash#index`, lower case. */
export type OutputRef = string;

/** Raw transaction CBOR for each requested hash it has; missing hashes are left out. */
export type TxCborSource = (txHashes: string[]) => Promise<Map<string, string>>;

export function outputRef(txIn: { txId: string; index: number }): OutputRef {
  return `${String(txIn.txId).toLowerCase()}#${Number(txIn.index)}`;
}

function parseRef(ref: OutputRef): { txHash: string; index: number } | null {
  const match = /^([0-9a-f]{64})#(\d+)$/.exec(ref.toLowerCase());
  return match ? { txHash: match[1], index: Number(match[2]) } : null;
}

/**
 * Output `index` of transaction `txHash`, read from `cborHex` only if `cborHex`
 * really is that transaction (its body hashes to `txHash`). A transaction whose
 * scripts failed (`isValid` false) created no outputs but its collateral
 * return, which sits at index = number of outputs.
 */
export function provenOutput(cborHex: string, txHash: string, index: number): Cardano.TxOut | null {
  let tx: Serialization.Transaction;
  try {
    tx = Serialization.Transaction.fromCbor(HexBlob(cborHex));
  } catch {
    return null;
  }
  if (String(tx.getId()).toLowerCase() !== txHash.toLowerCase()) return null;
  const core = tx.toCore();
  if (core.isValid === false) {
    return index === core.body.outputs.length ? core.body.collateralReturn ?? null : null;
  }
  return core.body.outputs[index] ?? null;
}

export interface ProvenInputs {
  /** Every ref a source proved, with the output it names. */
  proven: Map<OutputRef, Cardano.TxOut>;
  /** Refs no source could prove. */
  unproven: OutputRef[];
}

/** Prove each `ref` from the first source whose CBOR hashes to its transaction id. */
export async function proveOutputs(refs: Iterable<OutputRef>, sources: TxCborSource[]): Promise<ProvenInputs> {
  const wanted = new Map<OutputRef, { txHash: string; index: number }>();
  const unparseable: OutputRef[] = [];
  for (const ref of refs) {
    const parsed = parseRef(ref);
    if (parsed) wanted.set(ref.toLowerCase(), parsed);
    else unparseable.push(ref);
  }
  const proven = new Map<OutputRef, Cardano.TxOut>();
  for (const source of sources) {
    const missing = [...wanted].filter(([ref]) => !proven.has(ref));
    if (missing.length === 0) break;
    let found: Map<string, string>;
    try {
      found = await source([...new Set(missing.map(([, { txHash }]) => txHash))]);
    } catch (e) {
      debugLog('Input proof: a CBOR source failed', e);
      continue;
    }
    for (const [ref, { txHash, index }] of missing) {
      const cbor = found.get(txHash);
      if (!cbor) continue;
      const output = provenOutput(cbor, txHash, index);
      if (output) proven.set(ref, output);
    }
  }
  const unproven = [...unparseable, ...[...wanted.keys()].filter((ref) => !proven.has(ref))];
  return { proven, unproven };
}

/** The transactions the wallet already holds (gero-sync history), keyed by hash. */
export function historySource(transactions: readonly unknown[] | null | undefined): TxCborSource {
  return async (txHashes) => {
    const want = new Set(txHashes.map((h) => h.toLowerCase()));
    const found = new Map<string, string>();
    for (const item of transactions ?? []) {
      const t = item as { tx_hash?: unknown; cbor?: unknown };
      if (typeof t?.tx_hash !== 'string' || typeof t.cbor !== 'string' || !t.cbor) continue;
      const hash = t.tx_hash.toLowerCase();
      if (want.has(hash)) found.set(hash, t.cbor);
    }
    return found;
  };
}

/** gero-backend's network names, as its `network` query parameter takes them. */
const BACKEND_NETWORKS: Record<string, string> = {
  [Network.MAINNET]: 'MAINNET',
  [Network.PREPROD]: 'PREPROD',
  [Network.PREVIEW]: 'PREVIEW',
};

const BACKEND_BATCH = 50;
const BACKEND_TIMEOUT_MS = 15_000;

/**
 * gero-backend's `POST /api/transactions/cbor`. Its answers are not trusted:
 * proveOutputs keeps only CBOR that hashes to the id asked for. No source for a
 * network the backend does not serve.
 */
export function backendSource(
  network: string | undefined,
  fetchImpl: typeof fetch = fetch,
  baseUrl: string | undefined = import.meta.env['VITE_BACKEND_URL'],
): TxCborSource {
  const backendNetwork = network ? BACKEND_NETWORKS[network] : undefined;
  return async (txHashes) => {
    const found = new Map<string, string>();
    if (!backendNetwork || !baseUrl) return found;
    for (let i = 0; i < txHashes.length; i += BACKEND_BATCH) {
      const response = await fetchImpl(`${baseUrl}/api/transactions/cbor?chain=CARDANO&network=${backendNetwork}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(txHashes.slice(i, i + BACKEND_BATCH)),
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`gero-backend transactions/cbor answered ${response.status}`);
      const rows = (await response.json()) as unknown;
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const r = row as { tx_hash?: unknown; cbor?: unknown };
        if (typeof r?.tx_hash === 'string' && typeof r.cbor === 'string') found.set(r.tx_hash.toLowerCase(), r.cbor);
      }
    }
    return found;
  };
}

function assetsEqual(a: Cardano.TokenMap | undefined, b: Cardano.TokenMap | undefined): boolean {
  const left = new Map([...(a ?? new Map())].filter(([, q]) => BigInt(q) !== 0n).map(([u, q]) => [String(u), BigInt(q)]));
  const right = new Map([...(b ?? new Map())].filter(([, q]) => BigInt(q) !== 0n).map(([u, q]) => [String(u), BigInt(q)]));
  if (left.size !== right.size) return false;
  for (const [unit, qty] of left) if (right.get(unit) !== qty) return false;
  return true;
}

/** Whether a claimed output says exactly what the proven one does (address and value). */
export function sameOutput(claimed: Cardano.TxOut, proven: Cardano.TxOut): boolean {
  return canonicalAddress(String(claimed.address)) === canonicalAddress(String(proven.address))
    && BigInt(claimed.value?.coins ?? 0n) === BigInt(proven.value?.coins ?? 0n)
    && assetsEqual(claimed.value?.assets, proven.value?.assets);
}
