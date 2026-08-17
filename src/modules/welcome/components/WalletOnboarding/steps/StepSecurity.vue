<template>
  <div class="step-security">
    <div class="step-scroll">
    <v-form ref="nameForm" v-model="nameValid" style="width: 100%;">

      <!-- Wallet name field -->
      <div class="step-section-label mb-2">{{ $t('welcome.walletName') }}</div>
      <v-text-field
        v-model="name"
        dense
        filled
        :label="$t('welcome.walletName')"
        :placeholder="$t('welcome.walletNamePlaceholder')"
        :rules="[rules.required(), rules.minCharacters(1), rules.maxCharacters(50)]"
        class="mb-3"
      ></v-text-field>

      <!-- Security Method — side-by-side compact tiles. While the PRF probe
           is still pending (null) the PassKey tile shows a checking state
           instead of falsely claiming "not supported": on Windows the first
           capability call can take seconds while Windows Hello spins up. -->
      <template v-if="prfSupported !== false">
        <v-divider class="my-4" style="border-color: rgba(255, 255, 255, 0.08);" />
        <div class="step-section-label mb-2">{{ $t('welcome.securityMethod') }}</div>
        <div class="security-row">

          <!-- PassKey tile -->
          <div
            class="security-tile"
            :class="{
              'security-tile--active': selectedSecurityMethod === 'prf',
              'security-tile--pending': prfSupported === null,
            }"
            @click="prfSupported && pickMethod('prf')"
          >
            <div class="security-tile__head">
              <v-icon size="15" color="primary">mdi-shield-key</v-icon>
              <span class="security-tile__name">{{ $t('welcome.passKeyMethod') }}</span>
              <v-tooltip bottom max-width="260" content-class="custom-tooltip">
                <template v-slot:activator="{ on }">
                  <v-icon x-small class="ml-auto" color="grey lighten-1" v-on="on" @click.stop>mdi-information-outline</v-icon>
                </template>
                <span class="text-body-2">{{ $t('welcome.passKeyLearnMoreFull') }}</span>
              </v-tooltip>
            </div>
            <div class="d-flex align-center mt-1">
              <v-progress-circular v-if="prfSupported === null" indeterminate size="12" width="2" color="primary" class="mr-1" />
              <v-chip v-else color="primary" x-small class="mr-1">{{ $t('welcome.recommended') }}</v-chip>
            </div>
            <span class="security-tile__sub mt-1">{{ prfSupported === null ? $t('welcome.prfChecking') : $t('welcome.passKeyBenefit2') }}</span>
          </div>

          <!-- Password tile -->
          <div
            class="security-tile"
            :class="{ 'security-tile--active': selectedSecurityMethod === 'password' }"
            @click="pickMethod('password')"
          >
            <div class="security-tile__head">
              <v-icon size="15" color="grey lighten-1">mdi-key-variant</v-icon>
              <span class="security-tile__name">{{ $t('welcome.passwordMethod') }}</span>
            </div>
            <span class="security-tile__sub mt-2">{{ $t('welcome.passwordMethodDesc') }}</span>
          </div>

        </div>
      </template>

      <!-- PRF not supported — compact inline notice -->
      <div v-else class="prf-notice mt-3">
        <v-icon x-small color="warning" class="mr-1 flex-shrink-0">mdi-alert-outline</v-icon>
        <span>{{ $t('welcome.prfNotSupported') }}</span>
      </div>

    </v-form>
    </div>

    <!-- Navigation buttons -->
    <div class="onboarding-actions d-flex" style="gap: 12px;">
      <v-btn text @click="$emit('back')">{{ $t('common.back') }}</v-btn>
      <v-spacer />
      <v-btn
        class="onb-continue"
        color="primary"
        :disabled="!canContinue"
        @click="handleContinue()"
      >
        {{ $t('common.continue') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import rules from '@/utils/rules';
import { generateWalletName } from '@/shared/utils/walletNameGenerator';
import { NetworkInfo } from '@/utils/networks';

defineProps<{ network: NetworkInfo }>();

const emit = defineEmits<{
  (e: 'select', method: 'prf' | 'password', name: string): void;
  (e: 'next'): void;
  (e: 'back'): void;
}>();

// Form
const nameForm = ref<{ resetValidation: () => void } | null>(null);
const nameValid = ref(false);

// Wallet name
const name = ref(generateWalletName());

// Security method. null = probe still pending (never claim "not supported"
// while checking — the first Windows Hello capability call can take seconds).
const prfSupported = ref<boolean | null>(null);
const selectedSecurityMethod = ref<'prf' | 'password'>('password');
let userPicked = false;

const pickMethod = (method: 'prf' | 'password'): void => {
  userPicked = true;
  selectedSecurityMethod.value = method;
};

const canContinue = computed(() => nameValid.value && !!selectedSecurityMethod.value);

// Check PRF support on mount (memoized + prefetched by WalletOnboarding, so
// this usually resolves instantly).
onMounted(async () => {
  try {
    const { isPrfSupported } = await import('@/shared/utils/webauthn-prf');
    prfSupported.value = await isPrfSupported();

    // Default to PassKey when supported — unless the user already made a
    // choice while the probe was pending.
    if (prfSupported.value && !userPicked) {
      selectedSecurityMethod.value = 'prf';
    }
  } catch (error) {
    console.error('Error checking PRF support:', error);
    prfSupported.value = false;
  }
});

const handleContinue = (): void => {
  emit('select', selectedSecurityMethod.value, name.value);
  emit('next');
};
</script>

<style scoped lang="scss">
// ─── Section labels ───────────────────────────────────────────────────────────
.step-section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: white
}

// ─── Security method row ──────────────────────────────────────────────────────
.security-row {
  display: flex;
  gap: 8px;
}

.security-tile {
  flex: 1;
  min-width: 0;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;

  &:hover {
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.05);
  }

  &--active {
    border-color: #{"rgb(from var(--v-primary-base) r g b / 0.55)"};
    background: #{"rgb(from var(--v-primary-base) r g b / 0.06)"};
    box-shadow: 0 0 14px #{"rgb(from var(--v-primary-base) r g b / 0.07)"};
  }

  // PRF probe still pending: visibly "checking", not selectable yet
  &--pending {
    opacity: 0.75;
    cursor: progress;
  }

  &__head {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  &__name {
    font-size: 11.5px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.75);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__sub {
    display: block;
    font-size: 10px;
    color: var(--g-text-3);
    line-height: 1.35;
  }

  &--active &__name {
    color: rgba(255, 255, 255, 0.95);
  }

  &--active &__sub {
    color: var(--g-text-2);
  }
}

// ─── PRF notice (compact inline) ──────────────────────────────────────────────
.prf-notice {
  display: flex;
  align-items: flex-start;
  font-size: 11px;
  color: rgba(255, 196, 0, 0.65);
  line-height: 1.4;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid rgba(255, 196, 0, 0.18);
  background: rgba(255, 196, 0, 0.04);
}

// Remove checkbox hover highlight
::v-deep .v-input--checkbox {
  .v-input--selection-controls__ripple {
    display: none;
  }
}
</style>
