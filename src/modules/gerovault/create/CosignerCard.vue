<template>
  <section class="glass-panel gvc-card" :aria-labelledby="titleId" :data-test="`create-cosigner-${position}`">
    <div class="gvc-card__head">
      <h3 :id="titleId" class="t-heading gvc-card__title">{{ $t('gerovault.create.cosigner.title', { n: position }) }}</h3>
      <p v-if="byInvitation" class="t-caption gvc-faint cosigner-card__who">{{ $t('gerovault.invite.card.anyone') }}</p>
      <GButton v-else-if="invitesOn" compact tier="tertiary" data-test="create-back-to-invite" @click="flow.updateDraft(draft.id, { mode: 'invite' })">
        {{ $t('gerovault.invite.card.backToInvite') }}
      </GButton>
      <div v-if="!byInvitation" class="cosigner-card__source">
        <v-btn-toggle
          :model-value="draft.source"
          mandatory
          density="compact"
          color="primary"
          :aria-label="$t('gerovault.create.cosigner.source')"
          @update:model-value="setSource"
        >
          <v-btn value="gero" data-test="create-source-gero">{{ $t('gerovault.create.cosigner.gero') }}</v-btn>
          <v-btn value="external" data-test="create-source-external">{{ $t('gerovault.create.cosigner.external') }}</v-btn>
        </v-btn-toggle>
        <InfoTooltip :label="$t('gerovault.create.cosigner.source')" :text="$t('gerovault.create.cosigner.sourceInfo')" />
      </div>
    </div>

    <InviteCosigner
      v-if="byInvitation && invite"
      :flow="flow"
      :draft="draft"
      :n="position - 2"
      :details="details"
      :wallet-id="invite.walletId"
      :contacts="invite.contacts"
      :resolve="invite.resolve"
      :now="invite.now"
      @show-qr="emit('showQr')"
    />

    <template v-if="!byInvitation">
    <v-text-field
      :model-value="draft.label"
      :label="$t('gerovault.create.cosigner.label')"
      :hint="$t('gerovault.create.cosigner.labelHint')"
      persistent-hint
      density="compact"
      variant="outlined"
      maxlength="64"
      :error-messages="labelError ? [labelError] : []"
      data-test="create-cosigner-label"
      @update:model-value="flow.updateDraft(draft.id, { label: $event })"
    />
    <v-textarea
      :model-value="draft.keys"
      :label="draft.source === 'external' ? $t('gerovault.create.cosigner.externalKeys') : $t('gerovault.create.cosigner.keys')"
      :hint="draft.source === 'external' ? $t('gerovault.create.cosigner.externalKeysHint') : $t('gerovault.create.cosigner.keysHint')"
      persistent-hint
      rows="2"
      auto-grow
      spellcheck="false"
      autocomplete="off"
      density="compact"
      variant="outlined"
      class="g-mono"
      :error-messages="keysError ? [keysError] : []"
      data-test="create-cosigner-keys"
      @update:model-value="flow.updateDraft(draft.id, { keys: $event })"
    />
    <v-text-field
      v-if="draft.source === 'external'"
      :model-value="draft.index"
      :label="$t('gerovault.create.cosigner.index')"
      :hint="$t('gerovault.create.cosigner.indexHint')"
      persistent-hint
      inputmode="numeric"
      density="compact"
      variant="outlined"
      :error-messages="indexError ? [indexError] : []"
      data-test="create-cosigner-index"
      @update:model-value="flow.updateDraft(draft.id, { index: $event })"
    />

    <div v-if="ready" class="cosigner-card__ready" data-test="create-cosigner-ready">
      <span class="gvc-chip gvc-chip--ok t-caption">
        <v-icon size="12" aria-hidden="true">mdi-check</v-icon>{{ $t('gerovault.create.cosigner.ready') }}
      </span>
      <span class="t-caption g-mono gvc-faint">{{ fingerprint(ready.hashes.payment) }}</span>
    </div>
    <dl v-if="ready && details" class="gvc-facts t-caption" data-test="create-cosigner-details">
      <dt>{{ $t('gerovault.create.cosigner.paymentKey') }}</dt>
      <dd class="g-mono">{{ ready.encoded.payment }}</dd>
      <dt>{{ $t('gerovault.create.cosigner.stakeKey') }}</dt>
      <dd class="g-mono">{{ ready.encoded.stake }}</dd>
      <dt>{{ $t('gerovault.create.own.keyHash') }}</dt>
      <dd class="g-mono">{{ ready.hashes.payment }}</dd>
    </dl>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import InfoTooltip from '@/shared/components/InfoTooltip.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import InviteCosigner, { type InviteContact } from '@/modules/gerovault/invites/InviteCosigner.vue';
import type { InviteClient } from '@/modules/gerovault/invites/inviteClient';
import { fingerprint, type CosignerProblem, type CosignerReading, type CosignerSource } from './createVault';
import { COSIGNER_PROBLEM_KEYS } from './messages';
import type { CreateVaultFlow, DraftRow } from './useCreateVault';

const props = defineProps<{
  flow: CreateVaultFlow;
  draft: DraftRow;
  reading: CosignerReading | undefined;
  /** 2 for the first cosigner: this wallet is owner 1. */
  position: number;
  details: boolean;
  /** What the invitation body needs; absent: the paste card only. */
  invite?: { walletId: number; contacts: readonly InviteContact[]; resolve: InviteClient['resolve']; now: number };
}>();

const emit = defineEmits<{ (e: 'showQr'): void }>();

/** Invitations are on and this card has not switched to keys pasted by hand. */
const invitesOn = computed(() => props.flow.inviteMode.value === 'on' && props.invite !== undefined);
const byInvitation = computed(() => invitesOn.value && props.draft.mode === 'invite');

const { t } = useTranslation();

const LABEL_PROBLEMS: readonly CosignerProblem[] = ['LABEL_REQUIRED', 'INVALID_LABEL'];
const INDEX_PROBLEMS: readonly CosignerProblem[] = ['INDEX_REQUIRED', 'INVALID_INDEX'];

const ready = computed(() => (props.reading?.ok ? props.reading.cosigner : undefined));
const problem = computed(() => (props.reading && props.reading.ok === false ? props.reading.problem : undefined));

// A field shows its problem only once it has something in it, so a fresh card is not all red.
const labelError = computed(() => (problem.value && LABEL_PROBLEMS.includes(problem.value) && (props.draft.label !== '' || props.draft.keys.trim() !== '')
  ? t(COSIGNER_PROBLEM_KEYS[problem.value]) : ''));
const indexError = computed(() => (problem.value && INDEX_PROBLEMS.includes(problem.value) && props.draft.index !== ''
  ? t(COSIGNER_PROBLEM_KEYS[problem.value]) : ''));
const keysError = computed(() => (problem.value && !LABEL_PROBLEMS.includes(problem.value) && !INDEX_PROBLEMS.includes(problem.value)
  && problem.value !== 'KEYS_REQUIRED' && props.draft.keys.trim() !== '' ? t(COSIGNER_PROBLEM_KEYS[problem.value]) : ''));

function setSource(source: CosignerSource | null): void {
  if (source === 'gero' || source === 'external') props.flow.updateDraft(props.draft.id, { source });
}

const titleId = `create-cosigner-${useId()}`;
</script>

<style scoped>
.cosigner-card__source {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
}
.cosigner-card__ready {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
}
</style>
