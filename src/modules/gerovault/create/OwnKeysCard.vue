<template>
  <section class="glass-panel gvc-card" :aria-labelledby="titleId" data-test="create-own">
    <div class="gvc-card__head">
      <h2 :id="titleId" class="t-heading gvc-card__title">
        {{ $t('gerovault.create.own.title') }}
        <InfoTooltip :label="$t('gerovault.create.own.title')" :text="$t('gerovault.create.own.shareInfo')" />
      </h2>
      <span v-if="own" class="gvc-chip t-caption g-mono">{{ fingerprint(own.hashes.payment) }}</span>
    </div>

    <template v-if="!own">
      <p class="t-body-sm gvc-muted">{{ $t('gerovault.create.own.unlockText') }}</p>
      <form class="own-keys__unlock" @submit.prevent="submit()">
        <v-text-field
          v-if="keySource === 'password'"
          v-model="password"
          type="password"
          autocomplete="current-password"
          :label="$t('wallet.spendingPassword')"
          density="compact"
          variant="outlined"
          hide-details="auto"
          :disabled="unlocking"
          data-test="create-password"
        />
        <GButton
          tier="secondary"
          type="submit"
          :loading="unlocking"
          :disabled="keySource === 'password' && !password"
          data-test="create-unlock"
        >
          {{ keySource === 'passkey' ? $t('gerovault.create.own.unlockPassKey') : $t('gerovault.create.own.unlock') }}
        </GButton>
      </form>
      <GNote v-if="unlockProblem" tone="error" icon="mdi-alert-circle-outline" role="alert">{{ $t(UNLOCK_PROBLEM_KEYS[unlockProblem]) }}</GNote>
    </template>

    <template v-else>
      <div class="own-keys__share">
        <span class="t-label">{{ $t('gerovault.create.own.share') }}</span>
        <CopyButton :value="shareText(own.encoded)" small :title="$t('gerovault.create.own.copy')" />
      </div>
      <pre class="gvc-mono-block g-mono t-caption" data-test="create-own-keys">{{ shareText(own.encoded) }}</pre>
      <dl v-if="details" class="gvc-facts t-caption" data-test="create-own-details">
        <dt>{{ $t('gerovault.create.own.index') }}</dt>
        <dd class="g-mono">{{ own.index }}</dd>
        <dt>{{ $t('gerovault.create.own.paymentPath') }}</dt>
        <dd class="g-mono">{{ own.paths.payment }}</dd>
        <dt>{{ $t('gerovault.create.own.stakePath') }}</dt>
        <dd class="g-mono">{{ own.paths.stake }}</dd>
        <dt>{{ $t('gerovault.create.own.keyHash') }}</dt>
        <dd class="g-mono">{{ own.hashes.payment }}</dd>
      </dl>
    </template>
  </section>
</template>

<script setup lang="ts">
import { ref, useId } from 'vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import InfoTooltip from '@/shared/components/InfoTooltip.vue';
import { fingerprint, shareText } from './createVault';
import type { KeySource } from './eligibility';
import { UNLOCK_PROBLEM_KEYS } from './messages';
import type { CreateVaultFlow } from './useCreateVault';

const props = defineProps<{ flow: CreateVaultFlow; keySource: KeySource; details: boolean }>();
const { own, unlocking, unlockProblem, unlock } = props.flow;

// The spending password lives here only until the unlock call returns.
const password = ref('');

async function submit(): Promise<void> {
  if (props.keySource === 'password' && !password.value) return;
  try {
    await unlock(password.value);
  } finally {
    password.value = '';
  }
}

const titleId = `create-own-${useId()}`;
</script>

<style scoped>
.own-keys__unlock {
  display: flex;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: var(--g-s-3);
}
.own-keys__unlock :deep(.v-input) {
  flex: 1 1 220px;
}
.own-keys__share {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}
</style>
