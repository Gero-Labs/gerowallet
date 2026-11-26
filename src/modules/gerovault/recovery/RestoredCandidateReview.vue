<template>
  <!-- The quarantine review of a restored vault (spec 6.8): the exact scripts and address, the
       threshold, every participant marked as a claim from the package, the backup terms, this
       wallet's position, and the chain state as information. Nothing here is funded or signed. -->
  <div class="restored-review" data-test="restored-review">
    <div class="restored-review__head">
      <v-chip size="small" variant="outlined" color="var(--g-warning)" data-test="restored-review-candidate">
        {{ $t('gerovault.detail.candidate.chip') }}
      </v-chip>
      <InfoTooltip :label="$t('gerovault.detail.candidate.aboutLabel')" :text="$t('gerovault.detail.recovery.quarantine')" />
    </div>

    <GNote v-if="candidate.depositsBlocked" icon="mdi-cash-lock" role="status" data-test="restored-review-deposits">
      {{ $t('gerovault.detail.recovery.depositsBlocked') }}
    </GNote>

    <dl class="restored-review__rows glass-tier">
      <div class="restored-review__row">
        <dt class="t-body-sm">{{ $t('gerovault.detail.policy.threshold') }}</dt>
        <dd class="t-body-lg g-num" data-test="restored-review-threshold">
          {{ $t('gerovault.detail.policy.thresholdValue', { threshold: template.threshold, owners: ownerCount }) }}
        </dd>
      </div>
      <div v-if="candidate.backup" class="restored-review__row" data-test="restored-review-backup">
        <dt class="t-body-sm">{{ $t('gerovault.detail.policy.backupPath') }}</dt>
        <dd class="t-body-sm">
          {{ $t('gerovault.detail.policy.backupValue', { threshold: candidate.backup.threshold, holders: backupCount }) }}
          <span class="t-caption restored-review__sub">
            {{ candidate.backup.opensAtMs !== undefined
              ? $t('gerovault.detail.policy.backupOpens', { date: formatDate(candidate.backup.opensAtMs) })
              : $t('gerovault.detail.policy.backupSlot', { slot: candidate.backup.afterSlot }) }}
          </span>
        </dd>
      </div>
      <div class="restored-review__row">
        <dt class="t-body-sm">{{ $t('gerovault.detail.recovery.yourPosition') }}</dt>
        <dd class="t-body-sm" data-test="restored-review-position">
          {{ $t(candidate.self.role === 'owner' ? 'gerovault.detail.participants.roleOwner' : 'gerovault.detail.participants.roleBackup') }}
          <span class="t-caption restored-review__sub g-mono">{{ $t('gerovault.detail.recovery.yourIndex', { index: candidate.self.index, path: ownPath }) }}</span>
        </dd>
      </div>
      <div class="restored-review__row restored-review__row--block">
        <dt class="t-body-sm">{{ $t('gerovault.detail.address.title') }}</dt>
        <dd><ChunkedValue :value="candidate.addresses.base" bech32 copy testid="restored-review-address" /></dd>
      </div>
    </dl>

    <section class="restored-review__section">
      <h3 class="t-label">{{ $t('gerovault.detail.participants.title') }}</h3>
      <ul class="restored-review__people">
        <li v-for="(p, i) in candidate.participants" :key="i" class="restored-review__person" data-test="restored-review-participant">
          <span class="t-body-sm">
            {{ p.label ? displayLabel(p.label) : $t('gerovault.detail.recovery.noLabel') }}
            <span v-if="i === candidate.self.position" class="t-caption">{{ $t('gerovault.detail.participants.you') }}</span>
          </span>
          <span class="t-caption">
            {{ $t(p.role === 'owner' ? 'gerovault.detail.participants.roleOwner' : 'gerovault.detail.participants.roleBackup') }}
          </span>
          <span class="t-caption restored-review__key">
            {{ $t('gerovault.detail.participants.keyHash') }} <ChunkedValue :value="keyHashOf(p.payment)" />
          </span>
          <span v-if="i === candidate.self.position" class="t-caption" data-test="restored-review-own-key">
            {{ $t('gerovault.detail.recovery.ownKeyChecked') }}
          </span>
          <!-- Every other key, and every label (this wallet's own included), is the package's word. -->
          <span v-if="i !== candidate.self.position || p.label" class="t-caption restored-review__claim" data-test="restored-review-claim">
            {{ $t('gerovault.detail.recovery.claim') }}
          </span>
        </li>
      </ul>
    </section>

    <section class="restored-review__section">
      <h3 class="t-label">{{ $t('gerovault.detail.recovery.paymentScript') }}</h3>
      <ScriptRule :script="candidate.scripts.payment.script" :own-key-hashes="ownKeyHashes" />
      <p v-if="!candidate.canonicalOrder" class="t-caption" data-test="restored-review-order">{{ $t('gerovault.detail.recovery.otherOrder') }}</p>
      <template v-if="detailsVisible">
        <h3 class="t-label">{{ $t('gerovault.detail.recovery.stakeScript') }}</h3>
        <ScriptRule :script="candidate.scripts.stake.script" :own-key-hashes="ownKeyHashes" />
        <p class="t-caption">{{ $t('gerovault.vault.id') }} <ChunkedValue :value="candidate.vaultId" /></p>
      </template>
    </section>

    <section class="restored-review__section" data-test="restored-review-chain">
      <div class="restored-review__head">
        <h3 class="t-label">{{ $t('gerovault.detail.recovery.chainState') }}</h3>
        <InfoTooltip :label="$t('gerovault.detail.recovery.chainStateLabel')" :text="$t('gerovault.detail.recovery.chainStateAbout')" />
      </div>
      <ul class="restored-review__facts t-body-sm">
        <li>{{ $t(chainKey('funded', candidate.chainState.funded, chain?.utxosRead !== false)) }}</li>
        <li>{{ $t(chainKey('used', candidate.chainState.used, chain?.historyRead !== false)) }}</li>
        <li>{{ $t('gerovault.detail.recovery.chain.registrationNotChecked') }}</li>
      </ul>
      <p v-if="candidate.conflicts.length > 0" class="t-caption" data-test="restored-review-conflicts">
        {{ $t('gerovault.detail.recovery.conflicts', { count: candidate.conflicts.length }) }}
      </p>
    </section>

    <p class="t-body-sm" data-test="restored-review-attestation">{{ $t(attestation.key, attestation.params) }}</p>
    <p v-if="leftOut > 0" class="t-caption" data-test="restored-review-left-out">{{ $t('gerovault.detail.recovery.packageLeftOut', { count: leftOut }) }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import GNote from '@/shared/components/GNote.vue';
import InfoTooltip from '@/shared/components/InfoTooltip.vue';
import { ROLE, displayLabel, formatVaultKeyPath, parseVaultScript, type RecoveryPackage, type RestoredNativeCandidate } from '@/shared/gerovault';
import ChunkedValue from '@/modules/gerovault/detail/components/ChunkedValue.vue';
import type { CandidateChainView } from './useRecoveryImport';
import { keyHashOf } from './packageContents';
import ScriptRule from './ScriptRule.vue';

defineOptions({ name: 'RestoredCandidateReview' });

const props = defineProps<{
  candidate: RestoredNativeCandidate;
  pkg: RecoveryPackage | undefined;
  chain: CandidateChainView | undefined;
  detailsVisible: boolean;
}>();

const template = computed(() => props.candidate.scripts.template);
const parsed = computed(() => parseVaultScript(props.candidate.scripts.payment.script));
const ownerCount = computed(() => parsed.value?.owners.length ?? props.candidate.participants.filter(p => p.role === 'owner').length);
const backupCount = computed(() => (parsed.value?.kind === 'backup' ? parsed.value.backups.length : 0));
const me = computed(() => props.candidate.participants[props.candidate.self.position]);
const ownKeyHashes = computed(() => [keyHashOf(me.value?.payment), keyHashOf(me.value?.stake)].filter(Boolean));
const ownPath = computed(() => formatVaultKeyPath(ROLE.PAYMENT, props.candidate.self.index));
const leftOut = computed(() => (props.pkg ? props.pkg.proposalsDropped + props.pkg.addressBookDropped : 0));

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
function formatDate(ms: number): string {
  return dateFormatter.format(new Date(ms));
}

/** One chain fact: yes, no, or unknown when the reader could not answer. Never a requirement. */
function chainKey(fact: 'funded' | 'used', value: boolean, read: boolean): string {
  if (!read) return `gerovault.detail.recovery.chain.${fact}Unknown`;
  return `gerovault.detail.recovery.chain.${fact}${value ? 'Yes' : 'No'}`;
}

/** The restorer's own acceptance: a recorded date, never shown as a proven one. */
const attestation = computed<{ key: string; params?: Record<string, string> }>(() => {
  const own = props.candidate.ownAttestation;
  if (own.verified !== true) return { key: 'gerovault.detail.recovery.noOwnAttestation' };
  if (own.attestingDeviceRemoved) return { key: 'gerovault.detail.recovery.attestingDeviceRemoved' };
  return { key: 'gerovault.detail.recovery.ownAttestation', params: { date: formatDate(own.recordedAtMs) } };
});
</script>

<style scoped>
.restored-review {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}
.restored-review p,
.restored-review h3,
.restored-review__rows,
.restored-review__rows dd {
  margin: 0;
}
.restored-review__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}
.restored-review__rows {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
}
.restored-review__row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--g-s-3);
}
.restored-review__row dd {
  text-align: right;
  min-width: 0;
}
.restored-review__row--block {
  flex-direction: column;
  align-items: stretch;
}
.restored-review__row--block dd {
  text-align: left;
}
.restored-review__sub {
  display: block;
}
.restored-review__section {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.restored-review__people,
.restored-review__facts {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.restored-review__person {
  display: flex;
  flex-direction: column;
  padding-top: var(--g-s-2);
  border-top: 1px solid var(--g-hairline-1);
}
.restored-review__key {
  overflow-wrap: anywhere;
}
.restored-review__claim {
  color: var(--g-warning);
}
</style>
