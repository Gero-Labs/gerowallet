import type { Cardano } from '@cardano-sdk/core';
import { NEXUS_MAX_INPUTS, refOf } from './nexusInputSelection';
import { planMerges, type MergePlan } from './sweepPlan';
import type { BuiltSweep } from './sweepBuild';

/** Merges built earlier that still apply, and when the oldest of them was built. */
export interface KeptSweep {
  built: BuiltSweep;
  builtAt: number;
}

/** What a sweep still needs: merges to keep as built, and merges still to build. */
export interface SweepStep {
  /** Merges built earlier that still apply, `direct` recomputed from the UTxOs spendable now. */
  kept: KeptSweep | null;
  /** Merges still to build: all of them, or one more for UTxOs that arrived since. Null when `kept` is enough. */
  plan: MergePlan | null;
}

/** The UTxOs a built merge spends, or null when its body does not say (then it is never kept). */
const spentBy = (tx: Cardano.Tx): string[] | null =>
  Array.isArray(tx.body?.inputs) && tx.body.inputs.length > 0 ? tx.body.inputs.map((input) => `${input.txId}#${input.index}`) : null;

/**
 * The last sweep built for a wallet, kept so that pressing Max again, typing an amount or a
 * payment arriving does not rebuild its merges: each build counts against the server's
 * request limit, and a wallet that receives often (a swap-fee wallet gains a UTxO every few
 * blocks) would otherwise rebuild them all on almost every press. One cache per sender.
 */
export function createSweepCache() {
  let last: (KeptSweep & { walletKey: string }) | null = null;

  return {
    /** Keep `built` as the wallet's sweep; `builtAt` is when its oldest merge was built. */
    remember(walletKey: string, built: BuiltSweep, builtAt: number): void {
      last = { walletKey, built, builtAt };
    },

    /**
     * What a sweep of `available` still needs. The wallet's last sweep is kept while it is
     * younger than `freshMs` and every UTxO its merges spend is still spendable: UTxOs that
     * arrived since join the payment, and only when they push it past `limit` is one more
     * merge planned, from the smallest of them. Anything else plans the sweep afresh. Null
     * when the wallet fits one request, or no merges can bring it under the limit.
     */
    nextStep(walletKey: string, available: Cardano.Utxo[], nowMs: number, freshMs: number, limit: number = NEXUS_MAX_INPUTS): SweepStep | null {
      if (available.length <= limit) return null;
      const prior = last && last.walletKey === walletKey && nowMs - last.builtAt < freshMs ? last : null;
      const spentLists = prior ? prior.built.merges.map(spentBy) : [];
      if (prior && spentLists.every((list) => list !== null)) {
        const spendable = new Set(available.map(refOf));
        const spent = new Set(spentLists.flat() as string[]);
        if ([...spent].every((ref) => spendable.has(ref))) {
          const direct = available.filter((utxo) => !spent.has(refOf(utxo)));
          const kept: KeptSweep = { built: { ...prior.built, direct, utxoCount: available.length }, builtAt: prior.builtAt };
          const room = limit - prior.built.mergeOutputs.length;
          if (direct.length <= room) return { kept, plan: null };
          const more = planMerges(direct, room);
          if (more) return { kept, plan: more };
        }
      }
      const plan = planMerges(available, limit);
      return plan ? { kept: null, plan } : null;
    },
  };
}

export type SweepCache = ReturnType<typeof createSweepCache>;

/** Kept merges and the ones built since, as one sweep: the kept ones go out first. */
export function combineSweeps(kept: BuiltSweep, added: BuiltSweep, utxoCount: number): BuiltSweep {
  return {
    merges: [...kept.merges, ...added.merges],
    mergeCbors: [...kept.mergeCbors, ...added.mergeCbors],
    mergeOutputs: [...kept.mergeOutputs, ...added.mergeOutputs],
    direct: added.direct,
    mergeFee: kept.mergeFee + added.mergeFee,
    utxoCount,
  };
}
