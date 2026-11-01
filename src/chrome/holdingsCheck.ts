import type { Cardano } from '@cardano-sdk/core';
import { debugLog } from '@/utils/debug';
import { koiosBaseUrl, outputRef, type OutputRef } from '@/shared/utils/provenInputs';
import { canonicalAddress } from '@/shared/utils/txIntentGuard';

/**
 * The wallet's holdings, checked outside Gero's backend.
 *
 * gero-sync reports the wallet's UTxOs and its stake-level total, and the only
 * client-side gate (classifyUtxoAddress) checks the address. So a compromised or
 * faulty backend could show funds that do not exist: an output that was never on
 * chain, one spent long ago, or a total that is simply larger. Nothing can be
 * spent from them (the chain rejects the inputs), but a balance the user reads is
 * how scams start ("I sent you 50,000 ADA by mistake, look at your wallet").
 *
 * Koios, a public indexer independent of Gero's backend, is asked about every
 * output the backend reports and about the account total:
 *
 *  - An output Koios has with a different address or value is hidden at once.
 *  - One Koios does not have, or has as spent, is given CONFIRM_GRACE_MS (indexers
 *    trail each other by a block or two). Still unconfirmed after that, it is
 *    hidden. An output that leaves the reported set before then is still followed
 *    until Koios has it: a fabricated one swapped for a new one every few minutes
 *    would otherwise never be caught.
 *  - A total that differs from Koios's for CONFIRM_GRACE_MS, whatever the values,
 *    is not corrected but flagged.
 *
 * Any of these raises a warning that stays for the session. When Koios cannot be
 * reached, nothing is hidden or flagged: an outage must not take a balance away,
 * and an attacker controlling Gero's backend cannot cause one.
 */

/** What the independent indexer holds for one output. */
export interface IndexedOutput {
  address: string;
  coins: bigint;
  assets: Map<string, bigint>;
  spent: boolean;
}

/** The outputs the source knows, by ref; refs it does not know are left out. */
export type OutputSource = (refs: OutputRef[]) => Promise<Map<OutputRef, IndexedOutput>>;
/** A stake address's total (UTxOs plus withdrawable rewards), or null when the source has no record. */
export type AccountTotalSource = (stakeAddress: string) => Promise<bigint | null>;

/** How long an output or a total may stay unconfirmed before it counts as contradicted. */
export const CONFIRM_GRACE_MS = 3 * 60_000;

const KOIOS_BATCH = 50;
const KOIOS_TIMEOUT_MS = 15_000;

async function koiosPost(fetchImpl: typeof fetch, url: string, body: unknown): Promise<unknown> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(KOIOS_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Koios answered ${response.status}`);
  return response.json();
}

/** Koios `utxo_info` (extended, for the assets). Null for a network Koios does not serve. */
export function koiosOutputSource(network: string | undefined, fetchImpl: typeof fetch = fetch): OutputSource | null {
  const base = koiosBaseUrl(network);
  if (!base) return null;
  return async (refs) => {
    const found = new Map<OutputRef, IndexedOutput>();
    for (let i = 0; i < refs.length; i += KOIOS_BATCH) {
      const rows = await koiosPost(fetchImpl, `${base}/utxo_info`, { _utxo_refs: refs.slice(i, i + KOIOS_BATCH), _extended: true });
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const r = row as {
          tx_hash?: unknown; tx_index?: unknown; address?: unknown; value?: unknown; is_spent?: unknown;
          asset_list?: Array<{ policy_id?: unknown; asset_name?: unknown; quantity?: unknown }> | null;
        };
        if (typeof r?.tx_hash !== 'string' || typeof r.tx_index !== 'number' || typeof r.address !== 'string') continue;
        const assets = new Map<string, bigint>();
        for (const a of r.asset_list ?? []) {
          if (typeof a?.policy_id !== 'string') continue;
          assets.set(`${a.policy_id}${typeof a.asset_name === 'string' ? a.asset_name : ''}`.toLowerCase(), BigInt(String(a.quantity ?? 0)));
        }
        found.set(outputRef({ txId: r.tx_hash, index: r.tx_index }), {
          address: r.address,
          coins: BigInt(String(r.value ?? 0)),
          assets,
          spent: r.is_spent === true,
        });
      }
    }
    return found;
  };
}

/** Koios `account_info` total_balance. Null for a network Koios does not serve. */
export function koiosAccountTotalSource(network: string | undefined, fetchImpl: typeof fetch = fetch): AccountTotalSource | null {
  const base = koiosBaseUrl(network);
  if (!base) return null;
  return async (stakeAddress) => {
    const rows = await koiosPost(fetchImpl, `${base}/account_info`, { _stake_addresses: [stakeAddress] });
    const row = Array.isArray(rows) ? (rows[0] as { total_balance?: unknown } | undefined) : undefined;
    return row?.total_balance == null ? null : BigInt(String(row.total_balance));
  };
}

function sameContent(claimed: Cardano.TxOut, indexed: IndexedOutput): boolean {
  if (canonicalAddress(String(claimed.address)) !== canonicalAddress(indexed.address)) return false;
  if (BigInt(claimed.value?.coins ?? 0n) !== indexed.coins) return false;
  const claimedAssets = new Map(
    [...(claimed.value?.assets ?? new Map())]
      .map(([unit, quantity]) => [String(unit).toLowerCase(), BigInt(quantity)] as const)
      .filter(([, quantity]) => quantity !== 0n),
  );
  const indexedAssets = [...indexed.assets].filter(([, quantity]) => quantity !== 0n);
  return claimedAssets.size === indexedAssets.length
    && indexedAssets.every(([unit, quantity]) => claimedAssets.get(unit) === quantity);
}

export interface HoldingsWarning {
  /** The account total the indexer reports, in lovelace, when it could be read. */
  chainTotal: string | null;
}

export class HoldingsCheck {
  private readonly confirmed = new Set<OutputRef>();
  private readonly hidden = new Set<OutputRef>();
  /** Outputs the indexer has not confirmed yet, reported or not, with when that started. */
  private readonly unconfirmedSince = new Map<OutputRef, number>();
  private totalMismatchSince: number | null = null;
  private chainTotal: bigint | null = null;
  private warned = false;

  constructor(
    private readonly outputs: OutputSource,
    private readonly accountTotal: AccountTotalSource | null,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Whether an output the backend reports is not to be shown. */
  hides(ref: OutputRef): boolean {
    return this.hidden.has(ref);
  }

  get warning(): HoldingsWarning | null {
    return this.warned ? { chainTotal: this.chainTotal === null ? null : this.chainTotal.toString() } : null;
  }

  /** Whether a later run can still change something: outputs or a total waiting to be confirmed. */
  get pending(): boolean {
    return this.unconfirmedSince.size > 0 || this.totalMismatchSince !== null;
  }

  /**
   * Check what the backend reports now. Returns whether what is hidden, or the
   * warning, changed.
   */
  async run(reported: readonly Cardano.Utxo[], account: { stakeAddress: string; claimedTotal: bigint } | null): Promise<boolean> {
    const before = { hidden: [...this.hidden].sort().join(), warning: JSON.stringify(this.warning) };
    const t = this.now();
    const claims = new Map(reported.map(([input, output]) => [outputRef(input), output] as const));

    const asked = new Set<OutputRef>(this.unconfirmedSince.keys());
    for (const ref of claims.keys()) if (!this.confirmed.has(ref)) asked.add(ref);
    let answers: Map<OutputRef, IndexedOutput> | null = null;
    if (asked.size > 0) {
      try {
        answers = await this.outputs([...asked]);
      } catch (e) {
        debugLog('Holdings check: the indexer could not be reached', e);
      }
    }
    if (answers) {
      for (const ref of asked) this.settle(ref, claims.get(ref), answers.get(ref), t);
    }

    if (account && this.accountTotal) {
      let chain: bigint | null | undefined;
      try {
        chain = await this.accountTotal(account.stakeAddress);
      } catch (e) {
        debugLog('Holdings check: the indexer could not read the account', e);
      }
      if (chain !== undefined && chain !== null) {
        this.chainTotal = chain;
        if (chain === account.claimedTotal) {
          this.totalMismatchSince = null;
        } else {
          this.totalMismatchSince ??= t;
          if (t - this.totalMismatchSince >= CONFIRM_GRACE_MS) {
            this.warned = true;
            this.totalMismatchSince = null;
          }
        }
      }
    }

    return before.hidden !== [...this.hidden].sort().join() || before.warning !== JSON.stringify(this.warning);
  }

  private settle(ref: OutputRef, claimed: Cardano.TxOut | undefined, indexed: IndexedOutput | undefined, t: number): void {
    if (indexed && claimed && !sameContent(claimed, indexed)) {
      // The indexer has this output, and it is not what the backend says.
      this.hidden.add(ref);
      this.unconfirmedSince.delete(ref);
      this.warned = true;
      return;
    }
    if (indexed && (!indexed.spent || !claimed)) {
      // Confirmed unspent, or confirmed spent and no longer reported: real either way.
      if (claimed) this.confirmed.add(ref);
      this.hidden.delete(ref);
      this.unconfirmedSince.delete(ref);
      return;
    }
    // Unknown to the indexer, or spent while the backend still reports it unspent.
    const since = this.unconfirmedSince.get(ref) ?? t;
    if (t - since < CONFIRM_GRACE_MS) {
      this.unconfirmedSince.set(ref, since);
      return;
    }
    this.unconfirmedSince.delete(ref);
    if (claimed) this.hidden.add(ref);
    this.warned = true;
  }
}
