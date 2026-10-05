/**
 * RealFi order building — stake, unstake, claim, cancel.
 *
 * Nexus builds every order (`POST /api/realfi/build/*`, through gero-backend's Nexus
 * proxy) and returns it UNSIGNED. Nexus holds no key: the wallet signs and submits the
 * exact bytes it was given. Like the reads, nothing here talks to RealFi directly, so
 * RealFi's compliance screening runs server-side and sees Nexus, not the user's IP.
 */

import axios, { type AxiosInstance } from 'axios';
import type { Cardano } from '@cardano-sdk/core';
import { toNexusNetwork } from '@/api/nexus-tx-api';
import type { SmallestUnit } from '../types';

export type RealFiOrderKind = 'stake' | 'unstake' | 'claim' | 'cancel';

export interface UtxoRef {
  txHash: string;
  index: number;
}

export type RealFiBuildRequest =
  | { kind: 'stake'; amount: SmallestUnit }
  /** `unlockSlot` is the protocol's `nextCooldownSlot` at the time of unstaking. */
  | { kind: 'unstake'; amount: SmallestUnit; unlockSlot: string }
  /** Both fields come from the executed unstake order, never from a fresh read. */
  | { kind: 'claim'; resultUtxo: UtxoRef; unlockSlot: string }
  | { kind: 'cancel'; orderInputs: UtxoRef[] };

export interface RealFiBuiltTx {
  txCbor: string;
  txHash: string;
}

/**
 * Why an order could not be placed. The first four are RealFi's compliance outcomes
 * and each needs different words: a refusal will not change on retry, a pending
 * review will, and "screening unavailable" is nobody's verdict at all.
 */
export type RealFiOrderFailure =
  | 'not-authorized'
  | 'pending-review'
  | 'screening-unavailable'
  | 'unsupported-wallet'
  | 'build-failed'
  | 'wrong-password'
  | 'sign-failed'
  | 'submit-failed';

export class RealFiOrderError extends Error {
  constructor(
    readonly reason: RealFiOrderFailure,
    /** RealFi's id for a compliance decision — what their support asks for. */
    readonly correlationId: string | null = null,
    detail?: string,
  ) {
    super(detail ?? reason);
    this.name = 'RealFiOrderError';
  }
}

const COMPLIANCE_CODES: Record<string, RealFiOrderFailure> = {
  NOT_AUTHORIZED: 'not-authorized',
  PENDING_REVIEW: 'pending-review',
  HANDSHAKE_UNAVAILABLE: 'screening-unavailable',
  UNSUPPORTED_OWNER: 'unsupported-wallet',
};

/**
 * Map a failed build call onto a reason.
 *
 * Recognised by Nexus's `errorCode` only, never by HTTP status: a 400 is also what a
 * malformed amount gets, and telling someone their wallet was refused screening when
 * they mistyped would be false.
 */
export function classifyBuildError(err: unknown): RealFiOrderError {
  if (axios.isAxiosError(err)) {
    const data = (err.response?.data ?? {}) as {
      errorCode?: unknown;
      message?: unknown;
      providerErrors?: Record<string, unknown> | null;
    };
    const code = typeof data.errorCode === 'string' ? data.errorCode : '';
    const reason = COMPLIANCE_CODES[code];
    if (reason) {
      const id = data.providerErrors?.['realfi.correlationId'];
      return new RealFiOrderError(reason, typeof id === 'string' ? id : null, code);
    }
    const detail = typeof data.message === 'string' ? data.message : err.message;
    return new RealFiOrderError('build-failed', null, detail);
  }
  return new RealFiOrderError('build-failed', null, err instanceof Error ? err.message : String(err));
}

/* ── The wallet's UTxO set ─────────────────────────────────────────────────────── */

/** Nexus's bounds on a client UTxO set (its `UtxoSetValidator`); see `selectBuildUtxos`. */
export const MAX_BUILD_UTXOS = 500;
export const MAX_BUILD_UTXOS_HEX = 900_000;

function lovelaceOf(utxo: Cardano.Utxo): bigint {
  return BigInt(utxo[1]?.value?.coins ?? 0);
}

/** Asset ids held by a UTxO. `assets` is a Map, or a plain object after chrome.storage. */
function assetIdsOf(utxo: Cardano.Utxo): string[] {
  const assets = utxo[1]?.value?.assets as unknown;
  if (assets instanceof Map) return [...assets.keys()] as string[];
  if (assets && typeof assets === 'object') return Object.keys(assets);
  return [];
}

/**
 * The UTxOs to send with a build, serialised with `toHex`.
 *
 * All of them, normally: Nexus builds from exactly this set, and it is the only way
 * funds on a multi-address wallet's other addresses are visible to it. Past Nexus's
 * count or size bound, the ones holding RealFi's assets go first — without them there
 * is nothing to stake or unstake — then the largest by ADA, which cover fees and
 * deposits. A UTxO too big for what is left of the budget is skipped, not truncated.
 */
export function selectBuildUtxos(
  utxos: readonly Cardano.Utxo[],
  priorityAssetIds: readonly string[],
  toHex: (utxo: Cardano.Utxo) => string,
): string[] {
  const all = utxos.map((utxo) => ({ utxo, hex: toHex(utxo) }));
  const total = all.reduce((n, x) => n + x.hex.length, 0);
  if (all.length <= MAX_BUILD_UTXOS && total <= MAX_BUILD_UTXOS_HEX) return all.map((x) => x.hex);

  const priority = new Set(priorityAssetIds);
  const holdsPriority = (u: Cardano.Utxo) => assetIdsOf(u).some((id) => priority.has(id));
  const byAdaDesc = (a: { utxo: Cardano.Utxo }, b: { utxo: Cardano.Utxo }) => {
    const x = lovelaceOf(a.utxo);
    const y = lovelaceOf(b.utxo);
    return x === y ? 0 : x > y ? -1 : 1;
  };
  const ordered = [
    ...all.filter((x) => holdsPriority(x.utxo)).sort(byAdaDesc),
    ...all.filter((x) => !holdsPriority(x.utxo)).sort(byAdaDesc),
  ];

  const picked: string[] = [];
  let used = 0;
  for (const { hex } of ordered) {
    if (picked.length === MAX_BUILD_UTXOS) break;
    if (used + hex.length > MAX_BUILD_UTXOS_HEX) continue;
    picked.push(hex);
    used += hex.length;
  }
  return picked;
}

/* ── The build call ────────────────────────────────────────────────────────────── */

const nexusAxios = axios.create({
  baseURL: import.meta.env['VITE_NEXUS_URL'],
  // Longer than the reads: a build runs RealFi's compliance screen and a protocol
  // read before Blaze balances the transaction.
  timeout: 45000,
  headers: { 'Content-Type': 'application/json' },
});

export interface BuildContext {
  /** Wallet network as stored on the wallet ('Mainnet', 'Preprod'). */
  network: string;
  /** Receives change and the order's proceeds; must be the wallet's own address. */
  changeAddress: string;
  /** CIP-30 TransactionUnspentOutput CBOR hex. */
  utxos: string[];
}

function bodyFor(req: RealFiBuildRequest): Record<string, unknown> {
  switch (req.kind) {
    case 'stake':
      return { amount: req.amount };
    case 'unstake':
      return { amount: req.amount, unlockSlot: req.unlockSlot };
    case 'claim':
      return { resultUtxo: req.resultUtxo, unlockSlot: req.unlockSlot };
    case 'cancel':
      return { orderInputs: req.orderInputs };
  }
}

/** Ask Nexus for the unsigned transaction. Throws `RealFiOrderError` on any failure. */
export async function buildOrder(
  req: RealFiBuildRequest,
  ctx: BuildContext,
  http: AxiosInstance = nexusAxios,
): Promise<RealFiBuiltTx> {
  const network = toNexusNetwork(ctx.network);
  if (!network) throw new RealFiOrderError('build-failed', null, `No RealFi on ${ctx.network}`);

  let data: unknown;
  try {
    const res = await http.post(
      `/api/realfi/build/${req.kind}`,
      { changeAddress: ctx.changeAddress, utxos: ctx.utxos, ...bodyFor(req) },
      { params: { network } },
    );
    data = res.data;
  } catch (err) {
    throw classifyBuildError(err);
  }

  const built = (data ?? {}) as { txCbor?: unknown; txHash?: unknown };
  // What comes back is what the user will sign. Anything that is not plain hex is a
  // proxy error page or a partial body, never a transaction.
  if (typeof built.txCbor !== 'string' || !/^[0-9a-fA-F]+$/.test(built.txCbor)) {
    throw new RealFiOrderError('build-failed', null, 'Nexus returned no transaction');
  }
  return {
    txCbor: built.txCbor,
    txHash: typeof built.txHash === 'string' ? built.txHash : '',
  };
}
