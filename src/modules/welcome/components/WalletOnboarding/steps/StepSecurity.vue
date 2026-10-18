<template>
  <div class="step-security">
    <div class="step-scroll">
    <v-form ref="nameForm" v-model="nameValid" style="width: 100%;">

      <!-- Wallet name field -->
      <div class="t-label mb-2">{{ $t('welcome.walletName') }}</div>
      <v-text-field
        v-model="name"
        density="compact"
        variant="filled"
        :label="$t('welcome.walletName')"
        :placeholder="$t('welcome.walletNamePlaceholder')"
        :rules="nameRules"
        class="mb-3"
      ></v-text-field>

      <!-- Security Method — side-by-side compact tiles. While the PRF probe
           is still pending (null) the PassKey tile shows a checking state
           instead of falsely claiming "not supported": on Windows the first
           capability call can take seconds while Windows Hello spins up. -->
      <template v-if="prfSupported !== false">
        <v-divider class="my-4" style="border-color: var(--g-hairline-1);" />
        <div class="t-label mb-2">{{ $t('welcome.securityMethod') }}</div>
        <div class="security-row">

          <!-- PassKey tile -->
          <div
            class="security-tile glass-tier"
            :class="{
              'security-tile--active': selectedSecurityMethod === 'prf',
              'security-tile--pending': prfSupported === null,
            }"
            @click="prfSupported && pickMethod('prf')"
          >
            <div class="security-tile__head">
              <v-icon size="15" color="primary">mdi-shield-key</v-icon>
              <span class="security-tile__name t-body-sm">{{ $t('welcome.passKeyMethod') }}</span>
              <v-tooltip location="bottom"  max-width="260" content-class="custom-tooltip">
                <template v-slot:activator="{ props: activatorProps }">
                  <v-icon v-bind="activatorProps" size="x-small" class="ml-auto" color="grey lighten-1"  @click.stop>mdi-information-outline</v-icon>
                </template>
                <span class="t-body-sm">{{ $t('welcome.passKeyLearnMoreFull') }}</span>
              </v-tooltip>
            </div>
            <div class="d-flex align-center mt-1">
              <v-progress-circular v-if="prfSupported === null" indeterminate size="12" width="2" color="primary" class="mr-1" />
              <v-chip v-else-if="prfMode === 'security-key'" color="warning" variant="outlined" size="x-small" class="mr-1">{{ $t('welcome.securityKeyRequired') }}</v-chip>
              <v-chip v-else color="primary" size="x-small" class="mr-1">{{ $t('welcome.recommended') }}</v-chip>
            </div>
            <span class="security-tile__sub t-caption mt-1">{{ passKeySubText }}</span>
          </div>

          <!-- Password tile -->
          <div
            class="security-tile glass-tier"
            :class="{ 'security-tile--active': selectedSecurityMethod === 'password' }"
            @click="pickMethod('password')"
          >
            <div class="security-tile__head">
              <v-icon size="15" color="grey lighten-1">mdi-key-variant</v-icon>
              <span class="security-tile__name t-body-sm">{{ $t('welcome.passwordMethod') }}</span>
            </div>
            <span class="security-tile__sub t-caption mt-2">{{ $t('welcome.passwordMethodDesc') }}</span>
          </div>

        </div>
      </template>

      <!-- PRF not supported — compact inline notice -->
      <div v-else class="prf-notice t-caption mt-3">
        <v-icon size="x-small" color="warning" class="mr-1 flex-shrink-0">mdi-alert-outline</v-icon>
        <span>{{ $t('welcome.prfNotSupported') }}</span>
      </div>

    </v-form>
    </div>

    <!-- Navigation buttons -->
    <div class="onboarding-actions d-flex">
      <GButton tier="tertiary" @click="$emit('back')">{{ $t('common.back') }}</GButton>
      <v-spacer />
      <GButton
        tier="primary"
        :disabled="!canContinue"
        @click="handleContinue()"
        class="step-next"
      >
        {{ $t('common.continue') }}
      </GButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, getCurrentInstance } from 'vue';
import rules from '@/utils/rules';
import { generateWalletName } from '@/shared/utils/walletNameGenerator';
import { NetworkInfo } from '@/utils/networks';
import type { PrfSupportMode } from '@/shared/utils/webauthn-prf';
import GButton from '@/shared/components/GButton/GButton.vue';

const vmProxy = getCurrentInstance()!.proxy;

defineProps<{ network: NetworkInfo }>();

const emit = defineEmits<{
  (e: 'select', method: 'prf' | 'password', name: string): void;
  (e: 'next'): void;
  (e: 'back'): void;
}>();
const nameValid = ref(false);
const nameRules = [(value: string) => rules.required()(value.trim()), rules.maxCharacters(50)];

// Wallet name
const name = ref(generateWalletName());

// Security method. null = probe still pending (never claim "not supported"
// while checking — the first Windows Hello capability call can take seconds).
// 'security-key' (Brave): PassKey works but only through an external hardware
// key, so the tile is offered without being preselected (issue 987).
const prfMode = ref<PrfSupportMode | null>(null);
const prfSupported = computed<boolean | null>(() =>
  prfMode.value === null ? null : prfMode.value !== 'none'
);
const passKeySubText = computed(() => {
  if (prfMode.value === null) return vmProxy.$t('welcome.prfChecking');
  if (prfMode.value === 'security-key') return vmProxy.$t('welcome.passKeySecurityKeyHint');
  return vmProxy.$t('welcome.passKeyBenefit2');
});
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
    const { getPrfSupportMode } = await import('@/shared/utils/webauthn-prf');
    prfMode.value = await getPrfSupportMode();

    // Default to PassKey only for platform authenticators — unless the user
    // already made a choice while the probe was pending. In 'security-key'
    // mode the user may not own a hardware key, so password stays default.
    if (prfMode.value === 'platform' && !userPicked) {
      selectedSecurityMethod.value = 'prf';
    }
  } catch (error) {
    console.error('Error checking PRF support:', error);
    prfMode.value = 'none';
  }
});

const handleContinue = (): void => {
  if (!canContinue.value || !name.value.trim()) return;
  emit('select', selectedSecurityMethod.value, name.value.trim());
  emit('next');
};
</script>

<style scoped lang="scss">
// ─── Security method row ──────────────────────────────────────────────────────
.security-row {
  display: flex;
  gap: var(--g-s-2);
}

.security-tile {
  flex: 1;
  min-width: 0;
  padding: var(--g-s-3);
  cursor: pointer;
  transition: border-color var(--g-dur-fast) ease, background-color var(--g-dur-fast) ease;

  // A choice tile nested in the onboarding panel: the glass-tier material, its
  // hover lift and its selected tint, never an accent repaint or a glow.
  &:hover { @include g-glass-tier-hover; }

  &--active,
  &--active:hover { @include g-glass-tier-active; }

  // PRF probe still pending: visibly "checking", not selectable yet
  &--pending {
    opacity: 0.75;
    cursor: progress;
  }

  &__head {
    display: flex;
    align-items: center;
    gap: var(--g-s-1);
  }

  // Type comes from the ramp classes in the markup; these rules only set the
  // name's weight and each line's selected tone.
  &__name {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &__sub {
    display: block;
    line-height: 1.35;
  }

  &--active &__name {
    color: var(--g-text-1);
  }

  &--active &__sub {
    color: var(--g-text-2);
  }
}

// ─── PRF notice (compact inline) ──────────────────────────────────────────────
.prf-notice {
  display: flex;
  align-items: flex-start;
  color: var(--g-warning);
  line-height: 1.4;
  padding: var(--g-s-2) var(--g-s-3);
  border-radius: 8px;
  border: 1px solid rgba(255, 196, 0, 0.18);
  background: rgba(255, 196, 0, 0.04);
}

// Remove checkbox hover highlight
:deep(.v-input--checkbox) {
  .v-input--selection-controls__ripple {
    display: none;
  }
}
</style>
