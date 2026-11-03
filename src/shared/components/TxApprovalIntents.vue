<template>
  <div>
    <!-- Non-output effects of the transaction. Shared by the side panel and the
         popup fallback so both show the same thing. Rendered only when at least
         one effect is present: an ordinary payment shows nothing here. -->
    <div v-if="hasIntents" class="tx-intents mb-3">
      <div class="tx-intents-header text-caption grey--text text-uppercase">{{ $t('signTx.thisTransactionWill') }}</div>

      <!-- Gero market effects come first: a dApp transaction that spends the user's own listing or
           creates one is signable once approved, so this is where the user is told. A spent
           listing's NFT and price are the wallet's stored ones, never the dApp's. A created
           listing's terms ARE the dApp's, so its datum is read and every way it can pay someone
           else is said, in the error tone; the reassuring hint shows only when nothing warns. -->
      <div v-if="summary.listedInputs.length > 0">
        <div
          v-for="listed in summary.listedInputs"
          :key="'listed-' + listed.ref"
          class="tx-intent-row"
          data-testid="tx-intent-listing-spend"
        >
          <v-icon size="14" :color="listed.nftLeavesWallet ? 'error' : 'warning'" class="mr-1">mdi-storefront-minus-outline</v-icon>
          <div class="tx-intent-text">
            <div class="warning--text text-caption font-weight-medium">{{ $t('signTx.spendsYourListing') }}</div>
            <div class="white--text text-caption">{{ $t('signTx.listedFor', { name: listed.label, price: formatLovelace(listed.priceLovelace) }) }}</div>
            <div class="grey--text text-caption tx-intent-id">{{ listed.unit }}</div>
            <div v-if="listed.nftLeavesWallet" class="error--text text-caption font-weight-medium" data-testid="tx-intent-listing-nft-leaves">{{ $t('signTx.listingNftLeaves') }}</div>
          </div>
        </div>
        <div v-if="!nftLeaves" class="grey--text text-caption" data-testid="tx-intent-listing-spend-hint">{{ $t('signTx.spendsYourListingHint') }}</div>
      </div>

      <div
        v-for="listing in summary.createdListings"
        :key="'created-' + listing.outputIndex"
        class="tx-intent-row"
        data-testid="tx-intent-creates-listing"
      >
        <v-icon size="14" :color="listingWarns(listing) ? 'error' : 'warning'" class="mr-1">mdi-storefront-plus-outline</v-icon>
        <div class="tx-intent-text">
          <div class="warning--text text-caption font-weight-medium">{{ $t('signTx.createsMarketListing') }}</div>
          <template v-if="listing.datum === 'ok' && listing.priceLovelace !== null">
            <div class="white--text text-caption">{{ $t('signTx.listingPrice', { price: formatLovelace(listing.priceLovelace) }) }}</div>
            <div
              v-if="listing.royaltyCount > 0 && listing.royaltyTotalLovelace !== null"
              class="text-caption"
              :class="listing.tooManyRoyalties || listing.highRoyalties ? 'error--text' : 'grey--text'"
              data-testid="tx-intent-listing-royalties"
            >{{ $t('signTx.listingRoyalties', { count: listing.royaltyCount, total: formatLovelace(listing.royaltyTotalLovelace) }, listing.royaltyCount) }}</div>
            <div v-if="neverSells(listing)" class="error--text text-caption font-weight-medium" data-testid="tx-intent-listing-never-sells">{{ $t('signTx.listingNeverSells') }}</div>
            <div
              v-else-if="listing.sellerShareLovelace !== null"
              class="text-caption"
              :class="listing.lowSellerShare ? 'error--text' : 'grey--text'"
            >{{ $t('signTx.listingSellerReceives', { amount: formatLovelace(listing.sellerShareLovelace) }) }}</div>
            <div v-if="listing.buyerIsOther" class="error--text text-caption font-weight-medium" data-testid="tx-intent-listing-buyer-other">{{ $t('signTx.listingBuyerOther') }}</div>
            <div v-else-if="listing.hasBuyer" class="grey--text text-caption" data-testid="tx-intent-listing-private">{{ $t('signTx.listingPrivate') }}</div>
            <div v-if="!listing.ownerIsOwn" class="error--text text-caption font-weight-medium" data-testid="tx-intent-listing-owner-not-you">{{ $t('signTx.listingOwnerNotYou') }}</div>
            <div v-if="!listing.sellerIsOwn" class="error--text text-caption font-weight-medium" data-testid="tx-intent-listing-seller-not-you">{{ $t('signTx.listingSellerNotYou') }}</div>
            <div v-if="listing.tooManyRoyalties" class="error--text text-caption" data-testid="tx-intent-listing-too-many-royalties">{{ $t('signTx.listingTooManyRoyalties', { max: MAX_ROYALTIES }) }}</div>
            <div v-if="listing.highRoyalties" class="error--text text-caption" data-testid="tx-intent-listing-high-royalties">{{ $t('signTx.listingHighRoyalties', { percent: ROYALTY_CAP_PERCENT }) }}</div>
            <div v-if="listing.lowSellerShare && !neverSells(listing)" class="error--text text-caption" data-testid="tx-intent-listing-low-share">{{ $t('signTx.listingLowShare') }}</div>
          </template>
          <div v-else class="error--text text-caption font-weight-medium" data-testid="tx-intent-listing-datum-problem">{{ $t(DATUM_PROBLEM_KEYS[listing.datum]) }}</div>
          <!-- What the output holds is judged whatever its datum says. -->
          <div v-if="listing.holdsOtherAssets" class="error--text text-caption font-weight-medium" data-testid="tx-intent-listing-holds-more">{{ $t('signTx.listingHoldsMore') }}</div>
          <div v-if="listing.depositTooHigh" class="error--text text-caption" data-testid="tx-intent-listing-deposit-high">{{ $t('signTx.listingDepositHigh', { amount: formatLovelace(listing.depositLovelace), max: formatLovelace(MAX_LISTING_DEPOSIT) }) }}</div>
          <div v-if="listing.untrackedByGero" class="error--text text-caption font-weight-medium" data-testid="tx-intent-listing-not-tracked">{{ $t('signTx.listingNotTracked') }}</div>
          <div v-if="!listingWarns(listing)" class="grey--text text-caption" data-testid="tx-intent-creates-listing-hint">{{ $t('signTx.createsMarketListingHint') }}</div>
        </div>
      </div>

      <div v-for="(cert, i) in summary.certificates" :key="'cert-' + i" class="tx-intent-row">
        <v-icon size="14" :color="cert.stakeCredentialIsOwn === false ? 'error' : primaryColor" class="mr-1">mdi-certificate-outline</v-icon>
        <div class="tx-intent-text">
          <span class="white--text text-caption">{{ certificateLabel(cert.type) }}</span>
          <span v-if="cert.depositAda && cert.depositDirection === 'refunded'" class="grey--text text-caption ml-1">({{ $t('txGuard.depositRefunded', { amount: cert.depositAda }) }})</span>
          <span v-else-if="cert.depositAda" class="grey--text text-caption ml-1">({{ $t('signTx.depositAmount', { amount: cert.depositAda }) }})</span>
          <span v-if="cert.drepSentinel" class="grey--text text-caption ml-1">{{ $t(`governance.${cert.drepSentinel}`) }}</span>
          <div v-if="cert.drepId" class="grey--text text-caption tx-intent-id">{{ $t('signTx.delegatesVoteTo', { drep: cert.drepId }) }}</div>
          <div v-if="cert.poolId" class="grey--text text-caption tx-intent-id">{{ cert.poolId }}</div>
          <div v-if="cert.refundAccount" class="text-caption tx-intent-id" :class="cert.refundIsOwn === false ? 'error--text' : 'grey--text'">
            {{ $t('txGuard.refundTo', { account: cert.refundAccount }) }}
          </div>
          <div v-if="cert.depositDirection === 'paid' && cert.refundIsOwn === false" class="error--text text-caption">{{ $t('txGuard.refundNotYours') }}</div>
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

      <div v-if="summary.treasuryDonationAda" class="tx-intent-row" data-testid="tx-intent-donation">
        <v-icon size="14" color="warning" class="mr-1">mdi-bank-transfer-out</v-icon>
        <span class="white--text text-caption">{{ $t('signTx.donatesToTreasury', { amount: summary.treasuryDonationAda }) }}</span>
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
          <span class="white--text text-caption">{{ $t('signTx.reservesCollateral', { count: summary.collateralCount }, summary.collateralCount) }}</span>
          <div v-if="collateralAtRisk" class="grey--text text-caption">{{ $t('signTx.totalCollateral', { amount: collateralAtRisk }) }}</div>
          <div v-if="summary.collateralReturn" class="text-caption" :class="summary.collateralReturn.isOwn ? 'grey--text' : 'error--text'">
            {{ $t('signTx.collateralReturnTo', { amount: summary.collateralReturn.ada, address: truncate(summary.collateralReturn.address) }) }}
          </div>
        </div>
      </div>

      <div v-if="summary.referenceInputCount > 0" class="tx-intent-row">
        <v-icon size="14" color="var(--g-text-3)" class="mr-1">mdi-link-variant</v-icon>
        <span class="white--text text-caption">{{ $t('signTx.referenceInputs', { count: summary.referenceInputCount }, summary.referenceInputCount) }}</span>
      </div>

      <div v-if="summary.requiredSigners.length > 0" class="tx-intent-row">
        <v-icon size="14" :color="foreignSignerCount > 0 ? 'warning' : 'var(--g-text-3)'" class="mr-1">mdi-key-chain-variant</v-icon>
        <div class="tx-intent-text">
          <span class="white--text text-caption">{{ $t('signTx.requiredSigners', { count: summary.requiredSigners.length }, summary.requiredSigners.length) }}</span>
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

      <div v-if="summary.unmatchedInputCount > 0" class="tx-intent-row" data-testid="tx-intent-unmatched-inputs">
        <v-icon size="14" color="warning" class="mr-1">mdi-help-circle-outline</v-icon>
        <span class="warning--text text-caption">{{ $t('txGuard.unmatchedInputs', { count: summary.unmatchedInputCount }, summary.unmatchedInputCount) }}</span>
      </div>
    </div>

    <!-- A listing the transaction creates that pays someone else, or whose terms cannot be read or
         are off, or a spent listing whose NFT does not come back to the wallet (blocking). A dApp
         can list the user's NFT with itself as owner and seller, so this is the user's only
         protection. The parent gates Sign on the acknowledgement. -->
    <div v-if="summary.requiresMarketAck" class="tx-network-banner mb-3" data-testid="tx-market-risk-banner">
      <v-icon color="error" size="20" class="mr-2">mdi-storefront-remove-outline</v-icon>
      <div class="tx-network-text">
        <div class="tx-network-title">{{ $t('signTx.marketRiskTitle') }}</div>
        <div class="tx-network-body">{{ $t('signTx.marketRiskBody') }}</div>
        <v-checkbox
          :model-value="marketAck"
          color="error"
          hide-details
          theme="dark"
          density="compact"
          class="mt-2"
          :label="$t('signTx.highRiskAck')"
          @update:model-value="emit('update:marketAck', !!$event)"
        />
      </div>
    </div>

    <!-- A deposit refunded to someone else, or the wallet's collateral returned
         to another address if a script fails (blocking). The parent gates Sign
         on the acknowledgement. -->
    <div v-if="summary.requiresForeignValueAck" class="tx-network-banner mb-3" data-testid="tx-foreign-value-banner">
      <v-icon color="error" size="20" class="mr-2">mdi-account-arrow-right-outline</v-icon>
      <div class="tx-network-text">
        <div class="tx-network-title">{{ $t('txGuard.foreignValueTitle') }}</div>
        <div class="tx-network-body">{{ $t('txGuard.foreignValueBody') }}</div>
        <v-checkbox
          :model-value="foreignValueAck"
          color="error"
          hide-details
          theme="dark"
          density="compact"
          class="mt-2"
          :label="$t('signTx.highRiskAck')"
          @update:model-value="emit('update:foreignValueAck', !!$event)"
        />
      </div>
    </div>

    <!-- The wallet's UTxO list (gero-sync) misstated an input this transaction
         spends; the amounts above already use the proven values (blocking).
         The parent gates Sign on the acknowledgement. -->
    <div v-if="inputsMisreported" class="tx-network-banner mb-3" data-testid="tx-inputs-misreported-banner">
      <v-icon color="error" size="20" class="mr-2">mdi-database-alert-outline</v-icon>
      <div class="tx-network-text">
        <div class="tx-network-title">{{ $t('txGuard.inputsMisreportedTitle') }}</div>
        <div class="tx-network-body">{{ $t('txGuard.inputsMisreportedBody') }}</div>
        <v-checkbox
          :model-value="inputsMisreportedAck"
          color="error"
          hide-details
          theme="dark"
          density="compact"
          class="mt-2"
          :label="$t('signTx.highRiskAck')"
          @update:model-value="emit('update:inputsMisreportedAck', !!$event)"
        />
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
          :model-value="networkAck"
          color="error"
          hide-details
          theme="dark"
          density="compact"
          class="mt-2"
          :label="$t('signTx.networkMismatchAck')"
          @update:model-value="emit('update:networkAck', !!$event)"
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
import { createdListingWarns, formatLovelace, type ApprovalCreatedListing, type ApprovalListingDatumStatus, type TxApprovalSummary } from '@/shared/utils/txApprovalSummary';
import { MAX_LISTING_DEPOSIT, MAX_ROYALTIES, ROYALTY_RATE_CAP } from '@/utils/nftMarketDeployments';

const props = withDefaults(defineProps<{
  summary: TxApprovalSummary;
  networkAck: boolean;
  foreignValueAck?: boolean;
  /** The user accepted a listing that pays someone else, or an NFT that leaves the wallet (`summary.requiresMarketAck`). */
  marketAck?: boolean;
  /** The wallet's UTxO list misstated an input this transaction spends (useProvenApprovalUtxos). */
  inputsMisreported?: boolean;
  inputsMisreportedAck?: boolean;
  primaryColor?: string;
}>(), { foreignValueAck: false, marketAck: false, inputsMisreported: false, inputsMisreportedAck: false, primaryColor: undefined });
const emit = defineEmits<{
  (e: 'update:networkAck', value: boolean): void;
  (e: 'update:foreignValueAck', value: boolean): void;
  (e: 'update:marketAck', value: boolean): void;
  (e: 'update:inputsMisreportedAck', value: boolean): void;
}>();

const { t } = useTranslation();

const networkMismatch = computed(() => props.summary.bodyNetworkMismatch || props.summary.outputNetworkMismatch);
const foreignSignerCount = computed(() => props.summary.requiredSigners.filter(s => !s.isOwn).length);
// What the wallet itself stands to lose; the declared total when its inputs can't be resolved.
const collateralAtRisk = computed(() => props.summary.collateralAtRiskAda ?? props.summary.totalCollateralAda);
// A spent listing's NFT leaves the wallet: the reassuring hint would be false for the group.
const nftLeaves = computed(() => props.summary.listedInputs.some((listed) => listed.nftLeavesWallet));
const listingWarns = (listing: ApprovalCreatedListing) => createdListingWarns(listing);
// Nothing is left for the seller: the contract can never be satisfied, so no one can buy it.
const neverSells = (listing: ApprovalCreatedListing) => listing.sellerShareLovelace !== null && listing.sellerShareLovelace <= 0n;
// The royalty cap in percent for the copy, so the number is never baked into a translation.
const ROYALTY_CAP_PERCENT = Math.round(ROYALTY_RATE_CAP * 100);
const DATUM_PROBLEM_KEYS: Record<ApprovalListingDatumStatus, string> = {
  datumHash: 'signTx.listingDatumHash',
  missing: 'signTx.listingDatumMissing',
  undecodable: 'signTx.listingDatumUnreadable',
  // Not reached (an `ok` datum carries its price), but a listing never shows without a line.
  ok: 'signTx.listingDatumUnreadable',
};
const hasIntents = computed(() => {
  const s = props.summary;
  return s.listedInputs.length > 0 || s.createsListing
    || s.certificates.length > 0 || s.withdrawals.length > 0 || s.votes.length > 0 || s.proposals.length > 0
    || !!s.treasuryDonationAda
    || s.mints.length > 0 || s.collateralCount > 0 || s.referenceInputCount > 0 || s.requiredSigners.length > 0
    || s.validityStartSlot !== null || s.hasMetadata || s.unmatchedInputCount > 0;
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
