<template>
  <section class="glass-panel gvc-card" :aria-labelledby="titleId">
    <h2 :id="titleId" class="t-heading gvc-card__title">{{ $t('gerovault.create.template.title') }}</h2>

    <v-text-field
      v-model="template.name"
      :label="$t('gerovault.create.template.name')"
      :hint="$t('gerovault.create.template.nameHint')"
      persistent-hint
      density="compact"
      variant="outlined"
      maxlength="64"
      :error-messages="templateIssue === 'INVALID_NAME' ? [$t(TEMPLATE_PROBLEM_KEYS.INVALID_NAME)] : []"
      data-test="create-name"
    />

    <div class="create-template__kind">
      <v-icon size="small" color="primary" aria-hidden="true">mdi-shield-check-outline</v-icon>
      <div>
        <div class="t-label">{{ $t('gerovault.create.template.standard') }}</div>
        <p class="t-body-sm gvc-muted">
          {{ $t('gerovault.create.template.standardText', { threshold: template.threshold, owners: template.owners }) }}
        </p>
      </div>
    </div>

    <CountStepper
      :label="$t('gerovault.create.template.owners')"
      :info="$t('gerovault.create.template.ownersInfo')"
      :value="template.owners"
      :min="MIN_OWNERS"
      :max="MAX_OWNERS"
      :decrease-label="$t('gerovault.create.template.removeOwner')"
      :increase-label="$t('gerovault.create.template.addOwner')"
      data-test="create-owners"
      @update="setOwners"
    />
    <CountStepper
      :label="$t('gerovault.create.template.threshold')"
      :info="$t('gerovault.create.template.thresholdInfo')"
      :value="template.threshold"
      :min="MIN_THRESHOLD"
      :max="template.owners"
      :display="`${template.threshold} / ${template.owners}`"
      :decrease-label="$t('gerovault.create.template.lowerThreshold')"
      :increase-label="$t('gerovault.create.template.raiseThreshold')"
      data-test="create-threshold"
      @update="setThreshold"
    />

    <template v-if="warnings.length > 0">
      <GNote icon="mdi-alert-outline" role="status">{{ $t('gerovault.create.template.allOwnersWarning') }}</GNote>
      <v-checkbox
        v-model="template.acknowledged"
        :label="$t('gerovault.create.template.acknowledge')"
        density="compact"
        hide-details
        data-test="create-acknowledge"
      />
    </template>
    <p v-if="shownIssue" class="t-caption gvc-error" role="alert">{{ $t(TEMPLATE_PROBLEM_KEYS[shownIssue]) }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';
import GNote from '@/shared/components/GNote.vue';
import { MAX_OWNERS, MIN_OWNERS, MIN_THRESHOLD } from '@/shared/gerovault';
import CountStepper from './CountStepper.vue';
import { TEMPLATE_PROBLEM_KEYS } from './messages';
import type { CreateVaultFlow } from './useCreateVault';

const props = defineProps<{ flow: CreateVaultFlow }>();
const { template, templateIssue, warnings, setOwners, setThreshold } = props.flow;

// The name's problem sits under its field and the acknowledgement is the checkbox itself.
const shownIssue = computed(() => (templateIssue.value === 'INVALID_NAME' || templateIssue.value === 'NOT_ACKNOWLEDGED' ? undefined : templateIssue.value));

const titleId = `create-template-${useId()}`;
</script>

<style scoped>
.create-template__kind {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
}
.create-template__kind p {
  margin: 0;
}
</style>
