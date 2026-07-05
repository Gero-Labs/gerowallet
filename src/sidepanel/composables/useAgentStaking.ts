// src/sidepanel/composables/useAgentStaking.ts
import { ref, type Ref } from 'vue';
import type { StakingIntent } from '@/services/agent/stakingIntent';
import type { StakeVerdict } from '@/services/agent/stakingGuardrail';

// ---------------------------------------------------------------------------
// MAX_FEE note (Gap 2 from Guardrail review)
//
// This cap covers only the NETWORK FEE on the staking transaction (~0.17 ADA
// typical). The ~2 ADA stake-registration deposit is an implicit coin recorded
// in the tx body as a negative balance adjustment (deducted from inputs and
// paid to the treasury). It does NOT appear as a foreign output, so it is
// invisible to foreignLovelace() in the Guardrail and must NOT inflate this
// value. Keeping MAX_FEE at 1 ADA ensures the Guardrail stays tight.
// ---------------------------------------------------------------------------
const MAX_FEE = 1_000000n; // 1 ADA -- covers network fee only

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DelegateProposal {
  kind: 'delegate';
  status: 'ready' | 'blocked';
  poolSymbol: string;
  targetPoolId: string;
  unsignedTxCbor: string;
  reasons: string[];
}

export interface ClaimRewardsProposal {
  kind: 'claimRewards';
  status: 'ready' | 'blocked';
  amount: bigint;
  unsignedTxCbor: string;
  reasons: string[];
}

export type StakingProposal = DelegateProposal | ClaimRewardsProposal;

export interface AgentStakingDeps {
  /** Resolve a pool ticker symbol to a bech32 pool id, or null if not found. */
  resolvePool: (poolSymbol: string) => Promise<string | null>;
  /** Return the claimable (withdrawable) rewards amount in lovelace. */
  getWithdrawable: () => Promise<bigint>;
  /** Return the wallet's stake (reward) address in bech32. */
  getStakeAddress: () => Promise<string>;
  /** Return all own payment + change addresses for the active wallet. */
  getOwnAddresses: () => string[];
  /** Build a delegation tx and return the unsigned CBOR hex. */
  buildDelegate: (poolId: string) => Promise<string>;
  /** Build a rewards-withdrawal tx and return the unsigned CBOR hex. */
  buildWithdraw: (amount: bigint) => Promise<string>;
  /** Decode the delegation CBOR and run the Guardrail. */
  decodeAndVerifyDelegate: (
    cbor: string,
    ownAddresses: string[],
    targetPoolId: string,
    maxFee: bigint,
  ) => StakeVerdict;
  /** Decode the withdrawal CBOR and run the Guardrail. */
  decodeAndVerifyWithdraw: (
    cbor: string,
    ownAddresses: string[],
    stakeAddress: string,
    withdrawable: bigint,
    maxFee: bigint,
  ) => StakeVerdict;
}

// ---------------------------------------------------------------------------
// Composable factory
// ---------------------------------------------------------------------------

export function createAgentStaking(deps: AgentStakingDeps) {
  const busy: Ref<boolean> = ref(false);
  const error: Ref<string> = ref('');
  const proposal: Ref<StakingProposal | null> = ref(null);

  async function prepare(intent: StakingIntent): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    proposal.value = null;

    try {
      if (intent.type === 'delegate') {
        const targetPoolId = await deps.resolvePool(intent.poolSymbol);
        if (!targetPoolId) {
          error.value = 'Could not find that pool.';
          return;
        }

        const cbor = await deps.buildDelegate(targetPoolId);
        const ownAddresses = deps.getOwnAddresses();
        const verdict = deps.decodeAndVerifyDelegate(cbor, ownAddresses, targetPoolId, MAX_FEE);

        proposal.value = {
          kind: 'delegate',
          status: verdict.ok ? 'ready' : 'blocked',
          poolSymbol: intent.poolSymbol,
          targetPoolId,
          unsignedTxCbor: cbor,
          reasons: verdict.reasons,
        };
      } else if (intent.type === 'claimRewards') {
        const amount = await deps.getWithdrawable();
        if (amount <= 0n) {
          error.value = 'You have no rewards to claim.';
          return;
        }

        const stake = await deps.getStakeAddress();
        const cbor = await deps.buildWithdraw(amount);
        const ownAddresses = deps.getOwnAddresses();
        const verdict = deps.decodeAndVerifyWithdraw(cbor, ownAddresses, stake, amount, MAX_FEE);

        proposal.value = {
          kind: 'claimRewards',
          status: verdict.ok ? 'ready' : 'blocked',
          amount,
          unsignedTxCbor: cbor,
          reasons: verdict.reasons,
        };
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Could not prepare the staking action.';
    } finally {
      busy.value = false;
    }
  }

  return { busy, error, proposal, prepare };
}
