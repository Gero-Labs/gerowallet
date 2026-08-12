<template>
  <v-overlay :value="hardware.loading" opacity="0.9" :z-index="zIndex" class="hw-sign-prompt">
    <div class="hw-sign-prompt__card">
      <v-progress-circular indeterminate color="var(--g-accent)" size="52" width="3">
        <v-icon size="22" color="var(--g-accent)">{{ deviceIcon }}</v-icon>
      </v-progress-circular>

      <p class="t-heading hw-sign-prompt__title">{{ title }}</p>

      <!-- ledger.ts publishes a label for each stage of a signing run, and
           several of those stages are the device waiting on a button press —
           showing them is what tells the user to look at it. -->
      <p class="t-body-sm hw-sign-prompt__step">{{ hardware.text || defaultStep }}</p>

      <p class="t-caption hw-sign-prompt__hint">{{ $t('wallet.hardwarePromptHint') }}</p>
    </div>
  </v-overlay>
</template>

<script setup lang="ts">
/**
 * Global "continue on your device" prompt for hardware wallets.
 *
 * Mounted once per app entry (options, side panel, popup) and driven entirely by
 * the `hardwareLoading` singleton, so every signing path gets it by calling
 * `hardwareLoading.begin()/end()` — no per-dialog markup. Without it a Ledger or
 * Trezor sign shows only a button spinner that cannot finish until the user
 * approves on a device they were never told to pick up.
 *
 * Keystone is deliberately not driven through here: its air-gapped flow already
 * has `KeystoneSignDialog` with the QR code and its own instructions.
 */
import { computed } from 'vue';
import hardwareLoading from '@/plugins/hardwareLoading';
import { useTranslation } from '@/shared/composables/useTranslation';

// Above Vuetify's active-dialog stacking context (202) — every signing surface
// that shows this is itself a v-dialog, so a lower value renders the prompt
// behind the dialog that is waiting on it.
withDefaults(defineProps<{ zIndex?: number | string }>(), { zIndex: 300 });

const { t } = useTranslation();

// The singleton is already reactive (see plugins/hardwareLoading.ts), so the
// template tracks the writes ledger.ts makes from plain async code.
const hardware = hardwareLoading;

const DEVICE_ICONS: Record<string, string> = {
  Ledger: 'mdi-usb-flash-drive',
  Trezor: 'mdi-shield-key-outline',
  Keystone: 'mdi-qrcode-scan',
};

const deviceIcon = computed(() => DEVICE_ICONS[hardware.device || ''] || 'mdi-usb-flash-drive');

const title = computed(() =>
  hardware.device
    ? t('wallet.hardwarePromptTitle', { device: hardware.device })
    : t('wallet.hardwarePromptTitleGeneric'),
);

const defaultStep = computed(() =>
  hardware.device
    ? t('wallet.hardwarePromptStep', { device: hardware.device })
    : t('wallet.hardwarePromptStepGeneric'),
);
</script>

<style scoped lang="scss">
.hw-sign-prompt__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
  max-width: 320px;
  padding: var(--g-s-5) var(--g-s-4);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
  background: var(--g-overlay);
  text-align: center;
}

.hw-sign-prompt__title {
  margin: var(--g-s-2) 0 0;
  color: var(--g-text-1);
}

.hw-sign-prompt__step {
  margin: 0;
  color: var(--g-text-2);
  overflow-wrap: anywhere;
}

.hw-sign-prompt__hint {
  margin: 0;
  color: var(--g-text-3);
}
</style>
