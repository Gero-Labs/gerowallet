<!-- src/sidepanel/components/agent/StakingCard.vue -->
<template>
  <div class="staking-card">
    <!-- Loading state -->
    <div v-if="busy" class="staking-card__loading">
      <span class="staking-card__spinner"></span>
      <span class="staking-card__loading-text">{{ $t('copilot.staking.preparing') }}</span>
    </div>

    <!-- Error state (pool not found / no rewards / network error) -->
    <div v-else-if="stakingError" class="staking-card__error">
      {{ stakingError }}
    </div>

    <!-- Proposal ready or blocked -->
    <template v-else-if="proposal">
      <!-- Delegate: show pool ticker + resolved pool id -->
      <template v-if="proposal.kind === 'delegate'">
        <div class="staking-card__row">
          <span class="staking-card__label">{{ $t('copilot.staking.delegateTitle') }}</span>
        </div>
        <div class="staking-card__row">
          <span class="staking-card__label">{{ $t('copilot.staking.pool') }}</span>
          <span class="staking-card__value">{{ proposal.poolSymbol }}</span>
        </div>
        <div class="staking-card__row">
          <span class="staking-card__label">{{ $t('copilot.staking.poolId') }}</span>
          <span class="staking-card__value staking-card__poolid">{{ proposal.targetPoolId }}</span>
        </div>
      </template>

      <!-- Claim rewards: show the ADA amount -->
      <template v-else-if="proposal.kind === 'claimRewards'">
        <div class="staking-card__row">
          <span class="staking-card__label">{{ $t('copilot.staking.claimTitle') }}</span>
        </div>
        <div class="staking-card__row">
          <span class="staking-card__label">{{ $t('copilot.staking.rewards') }}</span>
          <span class="staking-card__value">{{ rewardsAdaDisplay }}</span>
        </div>
      </template>

      <!-- Guardrail block reasons -->
      <div v-if="proposal.status === 'blocked'" class="staking-card__blocked">
        <div class="staking-card__blocked-title">{{ $t('copilot.staking.blocked') }}</div>
        <ul class="staking-card__reasons">
          <li v-for="(reason, i) in proposal.reasons" :key="i">{{ reason }}</li>
        </ul>
      </div>

      <!-- Submitted / failed -->
      <div v-if="submitResult === 'submitted'" class="staking-card__submitted">
        {{ $t('copilot.staking.submitted') }}
      </div>
      <div v-else-if="submitResult === 'failed'" class="staking-card__failed">
        {{ submitError || $t('copilot.staking.failed') }}
      </div>

      <!-- Sign button -->
      <button
        v-if="submitResult !== 'submitted'"
        class="staking-card__sign-btn"
        :disabled="proposal.status !== 'ready' || signing || !!submitResult"
        @click="onSign()"
      >
        {{ signing ? $t('copilot.staking.signing') : $t('copilot.staking.sign') }}
      </button>

      <!-- Not financial advice -->
      <p class="staking-card__advice">{{ $t('copilot.staking.notAdvice') }}</p>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, type PropType } from 'vue';
import type { StakingIntent } from '@/services/agent/stakingIntent';
import type { StakingProposal } from '@/sidepanel/composables/useAgentStaking';
import { createAgentStaking } from '@/sidepanel/composables/useAgentStaking';
import { resolvePoolSymbolToId } from '@/services/agent/poolResolver';
import { deserializeCardanoJsSdkTx, serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { toDecodedStakeTx } from '@/services/agent/decodeStakeTx';
import { verifyDelegateTx, verifyWithdrawTx } from '@/services/agent/stakingGuardrail';
import { nexusTxApi, cardanoUtxoToNexusInput } from '@/api/nexus-tx-api';
import { Cardano } from '@cardano-sdk/core';
import { Messaging, type BackgroundResponse } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import { isStakeKeyRegistered } from '@/shared/utils/stakeRegistration';
import { Blockchain } from '@/models/types';
import type { Keys } from '@/models/types';

export default defineComponent({
  name: 'StakingCard',

  props: {
    intent: {
      type: Object as PropType<StakingIntent>,
      required: true,
    },
  },

  setup(props) {
    const busy = ref(false);
    const stakingError = ref('');
    const proposal = ref<StakingProposal | null>(null);
    const signing = ref(false);
    const submitResult = ref<'submitted' | 'failed' | null>(null);
    const submitError = ref('');

    // -------------------------------------------------------------------
    // Helper: collect own addresses (payment + change), with fallback
    // -------------------------------------------------------------------
    function getOwnAddresses(): string[] {
      const keys = walletStore.keys as Keys | null;
      const addrs: string[] = [];
      if (keys && (keys.payment?.length || keys.change?.length)) {
        for (const k of [...(keys.payment ?? []), ...(keys.change ?? [])]) {
          if (k.address) addrs.push(k.address);
        }
      }
      if (addrs.length === 0) {
        const base = walletStore.loggedWallet?.baseAddress;
        if (base) addrs.push(base);
      }
      return addrs;
    }

    // -------------------------------------------------------------------
    // Dep: resolvePool
    // -------------------------------------------------------------------
    async function resolvePool(sym: string): Promise<string | null> {
      return resolvePoolSymbolToId(sym);
    }

    // -------------------------------------------------------------------
    // Dep: getWithdrawable
    // -------------------------------------------------------------------
    async function getWithdrawable(): Promise<bigint> {
      return BigInt(walletStore.account?.withdrawable_amount ?? '0');
    }

    // -------------------------------------------------------------------
    // Dep: getStakeAddress
    // -------------------------------------------------------------------
    async function getStakeAddress(): Promise<string> {
      const addr = walletStore.loggedWallet?.stakeAddress;
      if (!addr) throw new Error('No stake address available.');
      return addr;
    }

    // -------------------------------------------------------------------
    // Dep: buildDelegate
    // Replicates the core delegation build from useDelegation.ts:
    // builds the certificates array and calls buildCardanoTransaction,
    // then serializes to CBOR hex.
    //
    // STUB NOTE: This path requires walletStore.keys.stake[0].cred, which
    // is only populated once the wallet is unlocked and synced. If keys.stake
    // is unavailable at call time, this throws a clear error rather than
    // fabricating a tx. The wallet must be unlocked (dock is only visible when
    // unlocked) so in practice this should always be available.
    // -------------------------------------------------------------------
    async function buildDelegate(poolId: string): Promise<string> {
      const keys = walletStore.keys as Keys | null;
      const epochParams = networkStore.epochParams;
      const tip = networkStore.tip;

      if (!keys?.stake?.length) throw new Error('Stake key not available. Please ensure your wallet is fully synced.');
      if (!epochParams) throw new Error('Epoch parameters not available yet. Please try again shortly.');
      if (!keys.payment?.length) throw new Error('Payment key not available.');

      const stakeCredential: Cardano.Credential = {
        type: Cardano.CredentialType.KeyHash,
        hash: keys.stake[0].cred,
      };
      const poolIdBech32 = Cardano.PoolId(poolId);
      const account = walletStore.account;
      const certificates: Cardano.Certificate[] = [];
      const stakeKeyDepositLovelace = BigInt(epochParams.stakeKeyDeposit ?? 2_000000);
      let implicitCoin = 0n;

      if (!isStakeKeyRegistered(account)) {
        // Conway combined cert: register + delegate + vote (abstain)
        certificates.push({
          __typename: Cardano.CertificateType.StakeVoteRegistrationDelegation,
          stakeCredential,
          poolId: poolIdBech32,
          dRep: { __typename: 'AlwaysAbstain' } as Cardano.AlwaysAbstain,
          deposit: stakeKeyDepositLovelace,
        });
        implicitCoin = stakeKeyDepositLovelace;
      } else if (!account?.drep_id) {
        // Conway combined: delegate pool + vote (abstain)
        certificates.push({
          __typename: Cardano.CertificateType.StakeVoteDelegation,
          stakeCredential,
          poolId: poolIdBech32,
          dRep: { __typename: 'AlwaysAbstain' } as Cardano.AlwaysAbstain,
        });
      } else {
        // Simple pool delegation only
        certificates.push({
          __typename: Cardano.CertificateType.StakeDelegation,
          stakeCredential,
          poolId: poolIdBech32,
        });
      }

      const tx = await buildCardanoTransaction({
        certificates,
        utxos: walletStore.utxos as Cardano.Utxo[],
        epochParams,
        changeAddress: keys.payment[0].address,
        tip,
        implicitCoin,
        walletContext: {
          keys,
          stakeAddress: walletStore.loggedWallet?.stakeAddress || '',
          accountIndex: 0,
        },
      });

      return serializeCardanoJsSdkTx(tx);
    }

    // -------------------------------------------------------------------
    // Dep: buildWithdraw
    // Uses the live Nexus /api/tx/build/withdrawal endpoint (Nexus path).
    // -------------------------------------------------------------------
    async function buildWithdraw(amount: bigint): Promise<string> {
      const keys = walletStore.keys as Keys | null;
      if (!keys?.payment?.length) throw new Error('Payment key not available.');
      const stakeAddress = walletStore.loggedWallet?.stakeAddress;
      if (!stakeAddress) throw new Error('Stake address not available.');
      // Conway pre-flight (issue 951): withdrawing rewards requires DRep
      // delegation. Every other withdrawal path enforces this (useWithdrawal,
      // autoWithdraw, WithdrawalDialog); the copilot path reimplements the build
      // and must gate too, or it proposes a ready-to-sign withdrawal that can't
      // succeed for a DRep-less account.
      if (walletStore.loggedWallet?.chain === Blockchain.CARDANO && !walletStore.account?.drep_id) {
        throw new Error('Withdrawing rewards requires DRep delegation. Delegate to a DRep in Governance first.');
      }
      const network = walletStore.loggedWallet?.network;

      const request = {
        stakeAddress,
        amount: amount.toString(),
        changeAddress: keys.payment[0].address,
        utxos: (walletStore.utxos as Cardano.Utxo[]).map(cardanoUtxoToNexusInput),
      };
      const { tx_cbor } = await nexusTxApi.buildWithdrawalTx(request, network);
      if (!tx_cbor) throw new Error('Nexus returned an empty transaction CBOR.');
      return tx_cbor;
    }

    // -------------------------------------------------------------------
    // Dep: decodeAndVerifyDelegate
    // -------------------------------------------------------------------
    function decodeAndVerifyDelegate(
      cbor: string,
      ownAddresses: string[],
      targetPoolId: string,
      maxFee: bigint,
    ) {
      const tx = deserializeCardanoJsSdkTx(cbor);
      const decoded = toDecodedStakeTx(tx);
      return verifyDelegateTx(decoded, { ownAddresses, targetPoolId, maxFeeLovelace: maxFee });
    }

    // -------------------------------------------------------------------
    // Dep: decodeAndVerifyWithdraw
    // -------------------------------------------------------------------
    function decodeAndVerifyWithdraw(
      cbor: string,
      ownAddresses: string[],
      stakeAddress: string,
      withdrawable: bigint,
      maxFee: bigint,
    ) {
      const tx = deserializeCardanoJsSdkTx(cbor);
      const decoded = toDecodedStakeTx(tx);
      return verifyWithdrawTx(decoded, {
        ownAddresses,
        stakeAddress,
        withdrawableAmount: withdrawable,
        maxFeeLovelace: maxFee,
      });
    }

    // -------------------------------------------------------------------
    // Wire the composable
    // -------------------------------------------------------------------
    const staking = createAgentStaking({
      resolvePool,
      getWithdrawable,
      getStakeAddress,
      getOwnAddresses,
      buildDelegate,
      buildWithdraw,
      decodeAndVerifyDelegate,
      decodeAndVerifyWithdraw,
    });

    onMounted(async () => {
      busy.value = true;
      stakingError.value = '';
      try {
        await staking.prepare(props.intent);
        if (staking.error.value) {
          stakingError.value = staking.error.value;
        } else {
          proposal.value = staking.proposal.value;
        }
      } catch (e) {
        stakingError.value = e instanceof Error ? e.message : 'Failed to prepare staking action.';
      } finally {
        busy.value = false;
      }
    });

    // -------------------------------------------------------------------
    // Display helpers
    // -------------------------------------------------------------------
    const rewardsAdaDisplay = computed(() => {
      if (!proposal.value || proposal.value.kind !== 'claimRewards') return '';
      const ada = Number(proposal.value.amount) / 1_000_000;
      return `${ada.toFixed(6)} ADA`;
    });

    // -------------------------------------------------------------------
    // Sign handler: SIGN_TX -> SUBMIT_TX (same pattern as SwapCard)
    // Password path: the wallet must already be unlocked (dock visible only
    // when unlocked). PRF/hardware follow-up documented below.
    // -------------------------------------------------------------------
    async function onSign() {
      if (!proposal.value || proposal.value.status !== 'ready') return;
      signing.value = true;
      submitResult.value = null;
      submitError.value = '';

      const cbor = proposal.value.unsignedTxCbor;

      try {
        // 1. Sign via background SIGN_TX
        // Password path: background decrypts keys using the unlocked session key.
        // PRF (PassKey) path: requires the PassKey popup -- documented follow-up.
        // Hardware (Ledger/Trezor) path: not yet wired here -- documented follow-up.
        const signResult = await (Messaging as typeof Messaging).sendToBackgroundFromOptions({
          method: MessageTypes.SIGN_TX,
          data: {
            txCbor: cbor,
            partialSign: true,
            accountIndex: 0,
            utxos: walletStore.utxos,
            addresses: walletStore.keys,
            mergeWitnesses: false,
          },
        }) as BackgroundResponse<{ witnesses?: string; error?: string }>;

        if (signResult.data.error) {
          throw new Error(signResult.data.error);
        }

        const witnessHex = signResult.data.witnesses;
        if (!witnessHex) throw new Error('No witness returned from signing.');

        // 2. Submit via background SUBMIT_TX (merges witness into the CBOR)
        const submitRes = await (Messaging as typeof Messaging).sendToBackgroundFromOptions({
          method: MessageTypes.SUBMIT_TX,
          data: {
            txCbor: cbor,
            witnessHex,
          },
        }) as BackgroundResponse<{ success?: boolean; error?: string }>;

        if (submitRes.data.error) {
          throw new Error(submitRes.data.error);
        }

        submitResult.value = 'submitted';
      } catch (e) {
        submitResult.value = 'failed';
        submitError.value = e instanceof Error ? e.message : 'Signing or submit failed.';
      } finally {
        signing.value = false;
      }
    }

    return {
      busy,
      stakingError,
      proposal,
      signing,
      submitResult,
      submitError,
      rewardsAdaDisplay,
      onSign,
    };
  },
});
</script>

<style scoped>
.staking-card {
  border-radius: var(--g-r-card);
  padding: 10px;
  background: var(--g-raised);
  font-size: 13px;
}

.staking-card__loading {
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0.7;
}

.staking-card__spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--g-hairline-3);
  border-top-color: var(--g-text-1);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.staking-card__error {
  color: var(--g-error);
  font-size: 12px;
}

.staking-card__row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
}

.staking-card__label {
  opacity: 0.65;
}

.staking-card__value {
  font-weight: 600;
}

.staking-card__poolid {
  font-size: 11px;
  word-break: break-all;
  text-align: right;
  max-width: 60%;
}

.staking-card__blocked {
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: var(--g-r-control);
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
}

.staking-card__blocked-title {
  color: var(--g-error);
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 4px;
}

.staking-card__reasons {
  margin: 0;
  padding-left: 16px;
  color: var(--g-error);
  font-size: 11px;
}

.staking-card__submitted {
  margin-top: 6px;
  color: var(--g-success);
  font-size: 12px;
}

.staking-card__failed {
  margin-top: 6px;
  color: var(--g-error);
  font-size: 12px;
}

.staking-card__sign-btn {
  margin-top: 10px;
  width: 100%;
  padding: 8px;
  border-radius: var(--g-r-control);
  border: none;
  background: var(--g-grad);
  color: var(--g-on-grad);
  font-weight: 700;
  cursor: pointer;
  font-size: 13px;
  transition: opacity 0.15s;
}

.staking-card__sign-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.staking-card__advice {
  margin: 8px 0 0;
  font-size: 11px;
  opacity: 0.45;
}
</style>
