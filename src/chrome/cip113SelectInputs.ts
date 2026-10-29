// Which of the wallet's programmable (CIP-113) UTxOs a Send spends. Background only: the page
// never sees these refs, it sends the token, amount and recipient, and the background picks.
//
// Rules, each also checked by Nexus:
//  - one programmable address, so one PLB script and one owner key (Nexus refuses mixed
//    owners): the owner is the one key that signs the transfer;
//  - UTxOs holding only this token and ADA, with no datum hash or reference script, so the
//    transfer moves nothing else and the change output holds exactly one token;
//  - as few UTxOs as cover the amount (largest first), at most
//    CIP113_MAX_PROGRAMMABLE_INPUTS, the most Nexus accepts.
// A balance spread across owners is not consolidated first (decision 3): the user is told
// the most one transfer can send.

import { Cardano } from '@cardano-sdk/core';
import { forEachAsset } from '@/api/nexusInputSelection';
import { cip68Label } from '@/shared/utils/resolver';

/** Most programmable inputs Nexus's transfer builder accepts in one request. */
export const CIP113_MAX_PROGRAMMABLE_INPUTS = 20;

export interface Cip113InputSelection {
  /** The UTxOs to spend, largest first, all at `address`. */
  utxos: Cardano.Utxo[];
  /** `PLB ‖ owner`, the address they all sit at. */
  address: string;
  baseScriptHash: string;
  /** The key in the owner slot: the one key that must sign the transfer. */
  ownerKeyHash: string;
  /** Base units of the token across `utxos`. */
  total: bigint;
}

export type Cip113SelectionResult =
  | { ok: true; selection: Cip113InputSelection }
  | {
      ok: false;
      /** INSUFFICIENT: the wallet holds less. NOT_IN_ONE_TRANSFER: it holds enough, but not at one owner in few enough UTxOs. */
      reason: 'INVALID_REQUEST' | 'INSUFFICIENT' | 'NOT_IN_ONE_TRANSFER';
      /** The most one transfer can send. */
      maxSingleTransfer: bigint;
    };

interface Candidate {
  utxo: Cardano.Utxo;
  quantity: bigint;
}

interface Group {
  address: string;
  baseScriptHash: string;
  ownerKeyHash: string;
  candidates: Candidate[];
}

const UNIT_PATTERN = /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/;

export function selectCip113TransferInputs(
  programmableUtxos: readonly Cardano.Utxo[],
  unit: string,
  quantity: bigint,
  baseScriptHashes: ReadonlySet<string>,
): Cip113SelectionResult {
  if (typeof unit !== 'string' || !UNIT_PATTERN.test(unit) || quantity <= 0n || cip68Label(unit.slice(56)) === 100) {
    return { ok: false, reason: 'INVALID_REQUEST', maxSingleTransfer: 0n };
  }

  const groups = new Map<string, Group>();
  for (const utxo of programmableUtxos) {
    const candidate = candidateQuantity(utxo, unit);
    if (candidate === null) continue;
    const owner = programmableOwner(String(utxo[1].address), baseScriptHashes);
    if (!owner) continue;
    let group = groups.get(owner.address);
    if (!group) {
      group = { ...owner, candidates: [] };
      groups.set(owner.address, group);
    }
    group.candidates.push({ utxo, quantity: candidate });
  }

  let best: { group: Group; picked: Candidate[]; total: bigint } | null = null;
  let held = 0n;
  let maxSingleTransfer = 0n;
  for (const group of [...groups.values()].sort((a, b) => a.address.localeCompare(b.address))) {
    group.candidates.sort(largestFirst);
    held += group.candidates.reduce((sum, c) => sum + c.quantity, 0n);
    const picked: Candidate[] = [];
    let total = 0n;
    for (const candidate of group.candidates.slice(0, CIP113_MAX_PROGRAMMABLE_INPUTS)) {
      if (total >= quantity) break;
      picked.push(candidate);
      total += candidate.quantity;
    }
    const reach = group.candidates.slice(0, CIP113_MAX_PROGRAMMABLE_INPUTS).reduce((sum, c) => sum + c.quantity, 0n);
    if (reach > maxSingleTransfer) maxSingleTransfer = reach;
    if (total >= quantity && (!best || picked.length < best.picked.length)) {
      best = { group, picked, total };
    }
  }

  if (!best) {
    return { ok: false, reason: held >= quantity ? 'NOT_IN_ONE_TRANSFER' : 'INSUFFICIENT', maxSingleTransfer };
  }
  return {
    ok: true,
    selection: {
      utxos: best.picked.map((c) => c.utxo),
      address: best.group.address,
      baseScriptHash: best.group.baseScriptHash,
      ownerKeyHash: best.group.ownerKeyHash,
      total: best.total,
    },
  };
}

/** The UTxO's quantity of `unit` when it holds only that token, else null. */
function candidateQuantity(utxo: Cardano.Utxo, unit: string): bigint | null {
  const out = utxo[1];
  if (out.datumHash || out.scriptReference) return null;
  const held = { quantity: null as bigint | null, others: 0 };
  forEachAsset(out, (u, q) => {
    if (u === unit) held.quantity = q;
    else held.others++;
  });
  return held.others === 0 && held.quantity !== null && held.quantity > 0n ? held.quantity : null;
}

/** The PLB script and key owner of a programmable address, or null for any other address. */
function programmableOwner(
  address: string,
  baseScriptHashes: ReadonlySet<string>,
): { address: string; baseScriptHash: string; ownerKeyHash: string } | null {
  try {
    const base = Cardano.Address.fromString(address)?.asBase();
    if (!base) return null;
    const payment = base.getPaymentCredential();
    const stake = base.getStakeCredential();
    if (payment.type !== Cardano.CredentialType.ScriptHash || !baseScriptHashes.has(payment.hash)) return null;
    if (stake.type !== Cardano.CredentialType.KeyHash) return null;
    return { address: base.toAddress().toBech32(), baseScriptHash: payment.hash, ownerKeyHash: stake.hash };
  } catch {
    return null;
  }
}

function largestFirst(a: Candidate, b: Candidate): number {
  if (a.quantity !== b.quantity) return a.quantity > b.quantity ? -1 : 1;
  const ra = `${a.utxo[0].txId}#${a.utxo[0].index}`;
  const rb = `${b.utxo[0].txId}#${b.utxo[0].index}`;
  return ra.localeCompare(rb);
}
