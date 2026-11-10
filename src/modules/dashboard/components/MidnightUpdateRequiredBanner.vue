<template>
  <!-- "Update required": sends and DUST registration on this network are closed
       to this build of GeroWallet (midnightWriteGate.ts); a newer build may send.
       Takes precedence over the network upgrade banner, which then hides. Reads,
       Receive and history are unaffected. Renders nothing otherwise. -->
  <div v-if="updateRequired" class="update-banner" role="status" data-test="midnight-update-banner">
    <v-icon size="20" color="warning" class="update-banner__icon" aria-hidden="true">mdi-download-circle-outline</v-icon>
    <div class="update-banner__body">
      <p class="update-banner__text t-body-sm">{{ t('midnight.errors.updateRequired') }}</p>
      <p v-if="version" class="update-banner__version t-caption g-num" data-test="midnight-update-version">
        {{ t('midnight.update.installedVersion', { version }) }}
      </p>
      <!-- An update was found: restarting installs it. The one primary action here,
           since Send is held. Focus moves to it, as it replaces the check button. -->
      <GButton
        v-if="check === 'available'"
        ref="restartButton"
        tier="primary"
        compact
        :block="block"
        class="update-banner__action"
        data-test="midnight-update-restart"
        @click="restart()"
      >
        {{ t('midnight.update.restart') }}
      </GButton>
      <GButton
        v-else-if="canCheck"
        tier="secondary"
        compact
        :loading="check === 'checking'"
        class="update-banner__action"
        data-test="midnight-update-check"
        @click="checkNow()"
      >
        {{ t('midnight.update.check') }}
      </GButton>
      <!-- The outcome of a check, said once per check. -->
      <p class="update-banner__outcome t-caption" aria-live="polite" data-test="midnight-update-outcome">
        <template v-if="check === 'none'">{{ t('midnight.update.noneYet') }}</template>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { useMidnightUpdateRequired } from '@/chains/midnight/midnightWriteGate';
import { extensionVersion } from '@/chains/midnight/midnightClientVersion';
import {
  canCheckForExtensionUpdate, checkForExtensionUpdate, restartExtensionForUpdate,
} from '@/shared/utils/extensionUpdate';

withDefaults(defineProps<{
  /** Stretch the restart button across the banner (the side panel). */
  block?: boolean;
}>(), { block: false });

const { t } = useTranslation();
const walletNetwork = computed(() => walletStore.loggedWallet?.network ?? '');
const updateRequired = useMidnightUpdateRequired(() => walletNetwork.value);

/** The installed version, from the manifest. */
const version = extensionVersion();
/** Where the browser can't be asked (no requestUpdateCheck), the banner stands without the button. */
const canCheck = canCheckForExtensionUpdate();

const check = ref<'idle' | 'checking' | 'available' | 'none'>('idle');
const restartButton = ref<{ $el?: HTMLElement } | null>(null);

async function checkNow(): Promise<void> {
  if (check.value === 'checking') return;
  check.value = 'checking';
  const outcome = await checkForExtensionUpdate();
  check.value = outcome;
  if (outcome === 'available') {
    await nextTick();
    restartButton.value?.$el?.focus?.();
  }
}

function restart(): void {
  restartExtensionForUpdate();
}
</script>

<style scoped lang="scss">
/* A banner: the warning glyph on the muted warning pair (fill and line), per the design system. */
.update-banner {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
  border-radius: var(--g-r-card);
}

.update-banner__icon {
  margin-top: 1px;
}

.update-banner__body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  max-width: 72ch;
}

.update-banner__text {
  margin: 0;
  color: var(--g-text-1);
}

.update-banner__version {
  margin: var(--g-s-1) 0 0;
  color: var(--g-text-2);
}

.update-banner__action {
  margin-top: var(--g-s-2);
}

.update-banner__action:not(.v-btn--block) {
  align-self: flex-start;
}

/* The live region stays in the tree (so it is announced) and takes no room while empty. */
.update-banner__outcome {
  margin: 0;
  color: var(--g-text-2);
}

.update-banner__outcome:not(:empty) {
  margin-top: var(--g-s-2);
}
</style>
