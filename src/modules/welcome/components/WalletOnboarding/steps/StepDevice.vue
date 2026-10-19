<template>
  <div class="step-device">
    <div class="step-scroll">
    <div class="t-label mb-2">{{ $t('welcome.hardwareWalletType') }}</div>
    <div class="hw-list">
      <button
        v-for="item in walletTypes"
        :key="item.name"
        type="button"
        class="hw-card glass-tier"
        :class="{
          'hw-card--active': localWalletType === item.name,
          'hw-card--disabled': !item.enabled,
        }"
        :disabled="!item.enabled"
        @click="item.enabled && selectType(item.name)"
      >
        <img :src="item.icon" class="hw-card__logo" :alt="item.name" />
        <span class="hw-card__text">
          <span class="hw-card__name t-body-lg">{{ item.name }}</span>
          <span class="hw-card__desc t-body-sm">{{ item.description }}</span>
        </span>
        <v-icon class="hw-card__check" size="20">{{ localWalletType === item.name ? 'mdi-check-circle' : 'mdi-circle-outline' }}</v-icon>
      </button>
    </div>
    </div>

    <!-- Navigation buttons -->
    <div class="onboarding-actions d-flex">
      <GButton tier="tertiary" @click="$emit('back')">{{ $t('common.back') }}</GButton>
      <v-spacer />
      <GButton tier="primary" :disabled="!localWalletType" @click="onContinue()" class="step-next">{{ $t('common.continue') }}</GButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import assets from '@/utils/assets';
import type { NetworkInfo } from '@/utils/networks';
import type { WalletTypeValue } from '@/models/types';
import GButton from '@/shared/components/GButton/GButton.vue';

const { t } = useTranslation();

defineProps<{ network: NetworkInfo }>();

const emit = defineEmits<{
  (e: 'select', walletType: WalletTypeValue): void;
  (e: 'next'): void;
  (e: 'back'): void;
}>();

const localWalletType = ref<WalletTypeValue | undefined>(undefined);

const walletTypes = [
  {
    name: t('wallet.ledger') as string,
    description: t('wallet.ledgerDescription') as string,
    enabled: true,
    icon: assets.ledgerLogoSvg,
    support: t('wallet.ledgerSupport') as string,
  },
  {
    name: t('wallet.trezor') as string,
    description: t('wallet.trezorDescription') as string,
    enabled: true,
    icon: assets.trezorLogoSvg,
    support: t('wallet.trezorSupport') as string,
  },
  {
    name: t('wallet.keystone') as string,
    description: t('wallet.keystoneDescription') as string,
    enabled: true,
    icon: assets.keystoneLogoSvg,
    support: t('wallet.keystoneSupport') as string,
  },
];

const selectType = (name: string): void => {
  localWalletType.value = name as WalletTypeValue;
  emit('select', name as WalletTypeValue);
};

const onContinue = (): void => {
  if (!localWalletType.value) return;
  emit('next');
};
</script>

<style scoped lang="scss">
.hw-list {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.hw-card {
  display: flex;
  align-items: center;
  gap: var(--g-s-4);
  width: 100%;
  min-height: 86px;
  text-align: left;
  padding: var(--g-s-4);
  cursor: pointer;
  transition: border-color var(--g-dur-fast) var(--g-ease), background-color var(--g-dur-fast) var(--g-ease);

  // A choice card nested in the onboarding panel: the glass-tier material, its
  // hover lift and its selected tint, never an accent repaint or a glow.
  &:hover:not(.hw-card--disabled) { @include g-glass-tier-hover; }

  &--active,
  &--active:hover:not(.hw-card--disabled) { @include g-glass-tier-active; }

  &--disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &__logo {
    width: 120px;
    min-width: 120px;
    height: 41px;
    object-fit: contain;
    object-position: left center;
    filter: invert(100%) sepia(20%) saturate(2%) hue-rotate(213deg) brightness(112%) contrast(101%);
  }

  &__text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
  }

  // Type comes from the ramp classes in the markup; these rules only space.
  &__name {
    line-height: 1.25;
  }

  &__desc {
    margin-top: 2px;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &__check {
    color: var(--g-text-3);
  }

  &--active &__check {
    color: var(--g-accent);
  }
}
</style>
