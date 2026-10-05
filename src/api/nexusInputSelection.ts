import type { Cardano } from '@cardano-sdk/core';

/**
 * How many UTxOs a Nexus build request may carry. Mirrors `@Size(max = 200)` on
 * `BuildTxRequest.utxos`, `MaxAdaRequest.utxos` and the certificate / withdrawal
 * requests in nexus `model/txbuilder/*Request.java`. A longer list is refused
 * with HTTP 400 "Validation failed" before coin selection runs, so the wallet,
 * not Nexus, decides which UTxOs a request carries. Change both sides together.
 */
export const NEXUS_MAX_INPUTS = 200;

export interface InputSelection {
  /** The candidates to send: the whole wallet when it fits, else at most `limit`. */
  utxos: Cardano.Utxo[];
  /** True when the wallet holds more UTxOs than one request may carry. */
  truncated: boolean;
  /** UTxOs the wallet offered. */
  total: number;
  /** The cap that was applied. */
  limit: number;
}

export interface InputSelectionOptions {
  /**
   * Base units of every non-ADA asset the outputs must carry, keyed by unit
   * (policyId + assetName hex). Their holders are kept ahead of any lovelace.
   */
  requiredAssets?: ReadonlyMap<string, bigint>;
  /** Defaults to NEXUS_MAX_INPUTS; tests pass smaller values. */
  limit?: number;
}

/**
 * Thrown before any request is made when the required assets alone sit on more
 * UTxOs than one transaction may spend. Nothing Nexus could select would fit, so
 * the user has to consolidate first; `friendlyTxError` turns this into copy.
 */
export class InputLimitError extends Error {
  constructor(readonly total: number, readonly limit: number) {
    super(`The assets to send sit on more than ${limit} of the wallet's ${total} UTxOs; one transaction can spend at most ${limit}`);
    this.name = 'InputLimitError';
  }
}

/**
 * Visit a TxOut's native assets whatever shape they are stored in: the SDK's
 * Map, the `[{ unit, quantity }]` form sync delivers, or the plain object a
 * chrome.storage round-trip flattens a Map into. Quantities that do not parse
 * are skipped rather than treated as zero holders.
 */
export function forEachAsset(txOut: Cardano.TxOut, visit: (unit: string, quantity: bigint) => void): void {
  const raw = txOut.value.assets as unknown;
  if (!raw) return;
  const emit = (unit: unknown, quantity: unknown) => {
    try {
      visit(String(unit), BigInt(String(quantity)));
    } catch {
      /* unparseable quantity: not a holder */
    }
  };
  if (raw instanceof Map) {
    raw.forEach((quantity, unit) => emit(unit, quantity));
  } else if (Array.isArray(raw)) {
    for (const entry of raw as { unit: unknown; quantity: unknown }[]) emit(entry.unit, entry.quantity);
  } else if (typeof raw === 'object') {
    for (const [unit, quantity] of Object.entries(raw as Record<string, unknown>)) emit(unit, quantity);
  }
}

function lovelaceOf(utxo: Cardano.Utxo): bigint {
  try {
    return BigInt(String(utxo[1].value.coins ?? 0));
  } catch {
    return BigInt(0);
  }
}

function refOf(utxo: Cardano.Utxo): string {
  return `${utxo[0].txId}#${utxo[0].index}`;
}

function assetQuantity(utxo: Cardano.Utxo, unit: string): bigint {
  let held = BigInt(0);
  forEachAsset(utxo[1], (u, quantity) => {
    if (u === unit) held += quantity;
  });
  return held;
}

/** Largest lovelace first; ties broken by the UTxO reference so the order never depends on the wallet's listing. */
function byLovelaceDesc(a: Cardano.Utxo, b: Cardano.Utxo): number {
  const la = lovelaceOf(a);
  const lb = lovelaceOf(b);
  if (la !== lb) return la > lb ? -1 : 1;
  return refOf(a) < refOf(b) ? -1 : refOf(a) > refOf(b) ? 1 : 0;
}

/**
 * A pick made for one asset can turn redundant once later assets bring in inputs
 * that also carry it, and the other way round when the assets are listed in the
 * opposite order. Drop every input the remaining picks still cover without,
 * smallest lovelace first, so the result does not depend on the asset order.
 * Each asset's target is what the wallet can supply at most, so an asset the
 * wallet lacks does not pin every other pick in place.
 */
function pruneRedundant(chosen: Map<string, Cardano.Utxo>, required: [string, bigint][], utxos: Cardano.Utxo[]): void {
  const target = new Map<string, bigint>();
  for (const [unit, needed] of required) {
    let available = BigInt(0);
    for (const utxo of utxos) available += assetQuantity(utxo, unit);
    target.set(unit, available < needed ? available : needed);
  }
  const holdings = new Map<string, Map<string, bigint>>();
  const coverage = new Map<string, bigint>();
  for (const [key, utxo] of chosen) {
    const held = new Map<string, bigint>();
    for (const [unit] of required) {
      const quantity = assetQuantity(utxo, unit);
      held.set(unit, quantity);
      coverage.set(unit, (coverage.get(unit) ?? BigInt(0)) + quantity);
    }
    holdings.set(key, held);
  }
  const smallestFirst = [...chosen.values()].sort((a, b) => byLovelaceDesc(b, a));
  for (const candidate of smallestFirst) {
    const key = refOf(candidate);
    const held = holdings.get(key) ?? new Map<string, bigint>();
    const stillCovered = required.every(([unit]) =>
      (coverage.get(unit) ?? BigInt(0)) - (held.get(unit) ?? BigInt(0)) >= (target.get(unit) ?? BigInt(0)));
    if (!stillCovered) continue;
    chosen.delete(key);
    for (const [unit, quantity] of held) coverage.set(unit, (coverage.get(unit) ?? BigInt(0)) - quantity);
  }
}

/**
 * Choose which UTxOs a Nexus build request carries.
 *
 * A wallet that fits under the limit is sent as-is. Over it, the candidates are
 * the holders of every required asset (largest holding first, until the needed
 * quantity is covered) followed by the largest lovelace, up to the limit. Nexus
 * then runs its own coin selection over that list, so the candidates only have
 * to be the best ones the request can carry, not a final selection. Largest
 * lovelace maximises what the request can cover; if even that falls short,
 * Nexus reports the shortfall and the caller can tell the user that the wallet
 * holds the balance but spread across too many UTxOs.
 *
 * Throws InputLimitError when the required assets alone exceed the limit, since
 * no selection could then satisfy the outputs.
 */
export function selectInputCandidates(utxos: Cardano.Utxo[], options: InputSelectionOptions = {}): InputSelection {
  const limit = options.limit ?? NEXUS_MAX_INPUTS;
  const total = utxos.length;
  if (total <= limit) return { utxos, truncated: false, total, limit };

  const chosen = new Map<string, Cardano.Utxo>();
  const required = [...(options.requiredAssets ?? [])].filter(([, needed]) => needed > BigInt(0));
  if (required.length > 0) {
    for (const [unit, needed] of required) {
      // Inputs picked for an earlier asset may carry this one too; count them
      // first so no input is added for a quantity that is already on board.
      let covered = BigInt(0);
      for (const picked of chosen.values()) covered += assetQuantity(picked, unit);
      if (covered >= needed) continue;
      const holders = utxos
        .filter((utxo) => !chosen.has(refOf(utxo)))
        .map((utxo) => ({ utxo, quantity: assetQuantity(utxo, unit) }))
        .filter((holder) => holder.quantity > BigInt(0))
        .sort((a, b) => (a.quantity === b.quantity ? byLovelaceDesc(a.utxo, b.utxo) : a.quantity > b.quantity ? -1 : 1));
      for (const holder of holders) {
        chosen.set(refOf(holder.utxo), holder.utxo);
        covered += holder.quantity;
        if (covered >= needed) break;
      }
    }
    pruneRedundant(chosen, required, utxos);
    if (chosen.size > limit) throw new InputLimitError(total, limit);
  }

  const rest = utxos.filter((utxo) => !chosen.has(refOf(utxo))).sort(byLovelaceDesc);
  const selected = [...chosen.values(), ...rest.slice(0, limit - chosen.size)];
  return { utxos: selected, truncated: true, total, limit };
}
