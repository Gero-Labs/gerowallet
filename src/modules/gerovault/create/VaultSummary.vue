<template>
  <section class="glass-panel gvc-card" :aria-labelledby="titleId" data-test="create-summary">
    <h2 :id="titleId" class="t-heading gvc-card__title">{{ $t('gerovault.create.summary.title') }}</h2>
    <dl class="gvc-facts t-body-sm">
      <dt>{{ $t('common.name') }}</dt>
      <dd>{{ name ? displayLabel(name) : $t('gerovault.create.summary.unnamed') }}</dd>
      <dt>{{ $t('common.type') }}</dt>
      <dd>{{ $t('gerovault.create.summary.typeValue') }}</dd>
      <dt>{{ $t('common.network') }}</dt>
      <dd class="g-mono">{{ networkName }}</dd>
      <dt>{{ $t('gerovault.create.summary.signatures') }}</dt>
      <dd>{{ $t('gerovault.create.summary.signaturesValue', { threshold: template.threshold, owners: template.owners }) }}</dd>
      <template v-if="details">
        <dt>{{ $t('gerovault.create.own.index') }}</dt>
        <dd class="g-mono" data-test="create-summary-index">{{ own ? own.index : '-' }}</dd>
        <dt>{{ $t('gerovault.create.summary.registration') }}</dt>
        <dd class="g-mono">{{ $t('gerovault.create.summary.registrationValue') }}</dd>
      </template>
    </dl>
  </section>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';
import { displayLabel } from '@/shared/gerovault';
import type { CreateVaultFlow } from './useCreateVault';

const props = defineProps<{ flow: CreateVaultFlow; networkName: string; details: boolean }>();
const { template, own } = props.flow;

const name = computed(() => template.name.trim());

const titleId = `create-summary-${useId()}`;
</script>
