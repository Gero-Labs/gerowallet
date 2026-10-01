<template>
  <div>
    <!-- Non-output effects of the transaction. Shared by the side panel and the
         popup fallback so both show the same thing. Rendered only when at least
         one effect is present: an ordinary payment shows nothing here. -->
    <div v-if="hasIntents" class="tx-intents mb-3">
      <div class="tx-intents-header text-caption grey--text text-uppercase">{{ $t('signTx.thisTransactionWill') }}</div>

      <div v-for="(cert, i) in summary.certificates" :key="'cert-' + i" class="tx-intent-row">
        <v-icon size="14" :color="cert.stakeCredentialIsOwn === false ? 'error' : primaryColor" class="mr-1">mdi-certificate-outline</v-icon>
        <div class="tx-intent-text">
          <span class="white--text text-caption">{{ certificateLabel(cert.type) }}</span>
          <span v-if="cert.depositAda" class="grey--text text-caption ml-1">({{ $t('signTx.depositAmount', { amount: cert.depositAda }) }})</span>
          <span v-if="cert.drepSentinel" class="grey--text text-caption ml-1">{{ $t(`governance.${cert.drepSentinel}`) }}</span>
          <div v-if="cert.drepId" class="grey--text text-caption tx-intent-id">{{ $t('signTx.delegatesVoteTo', { drep: cert.drepId }) }}</div>
          <div v-if="cert.poolId" class="grey--text text-caption tx-intent-id">{{ cert.poolId }}</div>
          <div v-if="cert.stakeCredentialIsOwn === false" class="error--text text-caption">{{ $t('signTx.notYourStakeKey') }}</div>
        </div>
      </div>

      <div v-for="(w, i) in summary.withdrawals" :key="'wd-' + i" class="tx-intent-row">
        <v-icon size="14" :color="w.isOwn ? primaryColor : 'error'" class="mr-1">mdi-bank-transfer-in</v-icon>
        <div class="tx-intent-text">
          <span class="white--text text-caption">{{ $t('signTx.withdrawsFrom', { amount: w.ada, account: truncate(w.rewardAccount) }) }}</span>
          <span v-if="!w.isOwn" class="error--text text-caption ml-1">({{ $t('signTx.notYourAccount') }})</span>
        </div>
      </div>

      <div v-for="(v, i) in summary.votes" :key="'vote-' + i" class="tx-intent-row">
        <v-icon size="14" :color="v.isOwnVoter ? 'warning' : primaryColor" class="mr-1">mdi-vote-outline</v-icon>
        <div class="tx-intent-text">
          <div v-for="(a, j) in v.actions" :key="'vote-' + i + '-' + j" class="white--text text-caption">
            {{ $t('signTx.votesOn', { vote: $t(`governance.voteChoice.${a.vote}`), action: `${truncate(a.txId)}#${a.index}` }) }}
          </div>
          <span class="text-caption" :class="v.isOwnVoter ? 'warning--text' : 'grey--text'">{{ $t(v.isOwnVoter ? 'signTx.asYourDrep' : 'signTx.asOtherVoter') }}</span>
        </div>
      </div>

      <div v-for="(p, i) in summary.proposals" :key="'prop-' + i" class="tx-intent-row">
        <v-icon size="14" color="warning" class="mr-1">mdi-gavel</v-icon>
        <div class="tx-intent-text">
          <span class="white--text text-caption">{{ $t('signTx.submitsProposal', { type: actionTypeLabel(p.actionType), amount: p.depositAda, account: truncate(p.rewardAccount) }) }}</span>
          <span v-if="!p.isOwnRewardAccount" class="error--text text-caption ml-1">({{ $t('signTx.notYourAccount') }})</span>
        </div>
      </div>

      <div v-for="(mint, i) in summary.mints" :key="'mint-' + i" class="tx-intent-row">
        <v-icon size="14" :color="mint.isBurn ? 'error' : 'success'" class="mr-1">{{ mint.isBurn ? 'mdi-fire' : 'mdi-file-plus-outline' }}</v-icon>
        <span class="white--text text-caption">
          {{ $t(mint.isBurn ? 'signTx.burnsAsset' : 'signTx.mintsAsset', { quantity: mint.formattedQuantity, name: mint.label }) }}
        </span>
      </div>

      <div v-if="summary.collateralCount > 0" class="tx-intent-row">
        <v-icon size="14" color="var(--g-text-3)" class="mr-1">mdi-shield-lock-outline</v-icon>
        <div class="tx-intent-text">
          <span class="white--text text-caption">{{ $tc('signTx.reservesCollateral', summary.collateralCount, { count: summary.collateralCount }) }}</span>
          <div v-if="summary.totalCollateralAda" class="grey--text text-caption">{{ $t('signTx.totalCollateral', { amount: summary.totalCollateralAda }) }}</div>
          <div v-if="summary.collateralReturn" class="text-caption" :class="summary.collateralReturn.isOwn ? 'grey--text' : 'error--text'">
            {{ $t('signTx.collateralReturnTo', { amount: summary.collateralReturn.ada, address: truncate(summary.collateralReturn.address) }) }}
          </div>
        </div>
      </div>

      <div v-if="summary.referenceInputCount > 0" class="tx-intent-row">
        <v-icon size="14" color="var(--g-text-3)" class="mr-1">mdi-link-variant</v-icon>
        <span class="white--text text-caption">{{ $tc('signTx.referenceInputs', summary.referenceInputCount, { count: summary.referenceInputCount }) }}</span>
      </div>

      <div v-if="summary.requiredSigners.length > 0" class="tx-intent-row">
        <v-icon size="14" :color="foreignSignerCount > 0 ? 'warning' : 'var(--g-text-3)'" class="mr-1">mdi-key-chain-variant</v-icon>
        <div class="tx-intent-text">
          <span class="white--text text-caption">{{ $tc('signTx.requiredSigners', summary.requiredSigners.length, { count: summary.requiredSigners.length }) }}</span>
          <span v-if="foreignSignerCount > 0" class="warning--text text-caption ml-1">({{ $t('signTx.requiredSignersForeign', { count: foreignSignerCount }) }})</span>
        </div>
      </div>

      <div v-if="summary.validityStartSlot !== null" class="tx-intent-row">
        <v-icon size="14" color="var(--g-text-3)" class="mr-1">mdi-clock-start</v-icon>
        <span class="white--text text-caption">{{ $t('signTx.validFrom', { slot: summary.validityStartSlot }) }}</span>
      </div>

      <div v-if="summary.hasMetadata" class="tx-intent-row">
        <v-icon size="14" color="var(--g-text-3)" class="mr-1">mdi-tag-text-outline</v-icon>
        <span class="white--text text-caption">{{ $t('signTx.includesMetadata') }}</span>
      </div>
    </div>

    <!-- Network mismatch (blocking): the body network id, or any output
         (own included) or the collateral return, is on a different network
         than the active wallet. The parent gates Sign on the acknowledgement. -->
    <div v-if="networkMismatch" class="tx-network-banner mb-3">
      <v-icon color="error" size="20" class="mr-2">mdi-swap-horizontal-circle-outline</v-icon>
      <div class="tx-network-text">
        <div class="tx-network-title">{{ $t('signTx.networkMismatchTitle') }}</div>
        <div class="tx-network-body">{{ $t('signTx.networkMismatchBody') }}</div>
        <v-checkbox
          :input-value="networkAck"
          color="error"
          hide-details
          dark
          dense
          class="mt-2"
          :label="$t('signTx.networkMismatchAck')"
          @change="emit('update:networkAck', !!$event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import filters from '@/shared/utils/filters';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { TxApprovalSummary } from '@/shared/utils/txApprovalSummary';

const props = defineProps<{
  summary: TxApprovalSummary;
  networkAck: boolean;
  primaryColor?: string;
}>();
const emit = defineEmits<{ (e: 'update:networkAck', value: boolean): void }>();

const { t } = useTranslation();

const networkMismatch = computed(() => props.summary.bodyNetworkMismatch || props.summary.outputNetworkMismatch);
const foreignSignerCount = computed(() => props.summary.requiredSigners.filter(s => !s.isOwn).length);
const hasIntents = computed(() => {
  const s = props.summary;
  return s.certificates.length > 0 || s.withdrawals.length > 0 || s.votes.length > 0 || s.proposals.length > 0
    || s.mints.length > 0 || s.collateralCount > 0 || s.referenceInputCount > 0 || s.requiredSigners.length > 0
    || s.validityStartSlot !== null || s.hasMetadata;
});

const truncate = (value: string) => filters.truncate(value);

// SDK GovernanceActionType -> existing governance.actionType.* key.
const ACTION_TYPE_KEYS: Record<string, string> = {
  parameter_change_action: 'parameterchange',
  hard_fork_initiation_action: 'hardforkinitiation',
  treasury_withdrawals_action: 'treasurywithdrawals',
  no_confidence: 'noconfidence',
  update_committee: 'newcommittee',
  new_constitution: 'newconstitution',
  info_action: 'infoaction',
};
function actionTypeLabel(type: string): string {
  const key = ACTION_TYPE_KEYS[type];
  return key ? String(t(`governance.actionType.${key}`)) : type;
}

function certificateLabel(certificateType: Cardano.CertificateType): string {
  switch (certificateType) {
    case Cardano.CertificateType.StakeRegistration: return 'Stake Registration';
    case Cardano.CertificateType.StakeDeregistration: return 'Stake De-Registration';
    case Cardano.CertificateType.PoolRegistration: return 'Pool Registration';
    case Cardano.CertificateType.PoolRetirement: return 'Pool Retirement';
    case Cardano.CertificateType.StakeDelegation: return 'Stake Delegation';
    case Cardano.CertificateType.MIR: return 'MIR';
    case Cardano.CertificateType.GenesisKeyDelegation: return 'Genesis Key Delegation';
    case Cardano.CertificateType.Registration: return 'Registration';
    case Cardano.CertificateType.Unregistration: return 'Unregistration';
    case Cardano.CertificateType.VoteDelegation: return 'Vote Delegation';
    case Cardano.CertificateType.StakeVoteDelegation: return 'Stake Vote Delegation';
    case Cardano.CertificateType.StakeRegistrationDelegation: return 'Stake Registration Delegation';
    case Cardano.CertificateType.VoteRegistrationDelegation: return 'Vote Registration Delegation';
    case Cardano.CertificateType.StakeVoteRegistrationDelegation: return 'Stake Vote Registration Delegation';
    case Cardano.CertificateType.AuthorizeCommitteeHot: return 'Authorize Committee Hot';
    case Cardano.CertificateType.ResignCommitteeCold: return 'Resign Committee Cold';
    case Cardano.CertificateType.RegisterDelegateRepresentative: return 'Register Delegate Representative';
    case Cardano.CertificateType.UnregisterDelegateRepresentative: return 'Unregister Delegate Representative';
    case Cardano.CertificateType.UpdateDelegateRepresentative: return 'Update Delegate Representative';
    default: return 'Unknown certificate';
  }
}
</script>

<style scoped lang="scss">
.tx-intents {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tx-intents-header {
  letter-spacing: 0.5px;
}

.tx-intent-row {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.tx-intent-text {
  min-width: 0;
  overflow-wrap: break-word;
}

// Full ids (pool, DRep) must stay verifiable: wrap anywhere instead of truncating.
.tx-intent-id {
  font-family: var(--g-font-mono);
  word-break: break-all;
}

.tx-network-banner {
  display: flex;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
}

.tx-network-text {
  flex: 1;
  min-width: 0;
}

.tx-network-title {
  font-weight: 600;
}
</style>
