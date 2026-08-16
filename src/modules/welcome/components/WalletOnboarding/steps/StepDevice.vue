<template>
  <div class="step-device">
    <div class="step-scroll">
    <div class="step-section-label mb-2">{{ $t('welcome.hardwareWalletType') }}</div>
    <div class="hw-list">
      <button
        v-for="item in walletTypes"
        :key="item.name"
        type="button"
        class="hw-card"
        :class="{
          'hw-card--active': localWalletType === item.name,
          'hw-card--disabled': !item.enabled,
        }"
        :disabled="!item.enabled"
        @click="item.enabled && selectType(item.name)"
      >
        <img :src="item.icon" class="hw-card__logo" :alt="item.name" />
        <span class="hw-card__text">
          <span class="hw-card__name">{{ item.name }}</span>
          <span class="hw-card__desc">{{ item.description }}</span>
        </span>
        <v-icon class="hw-card__check" size="20">{{ localWalletType === item.name ? 'mdi-check-circle' : 'mdi-circle-outline' }}</v-icon>
      </button>
    </div>
    </div>

    <!-- Navigation buttons -->
    <div class="onboarding-actions d-flex" style="gap: 12px;">
      <v-btn text @click="$emit('back')">{{ $t('common.back') }}</v-btn>
      <v-spacer />
      <v-btn class="onb-btn onb-continue" depressed color="primary" :disabled="!localWalletType" @click="onContinue()">{{ $t('common.continue') }}</v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import assets from '@/utils/assets';
import type { NetworkInfo } from '@/utils/networks';
import type { WalletTypeValue } from '@/models/types';

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
.step-section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: white;
}

.onb-btn {
  border-radius: 8px !important;
  box-shadow: none !important;
}

.hw-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hw-card {
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  min-height: 86px;
  text-align: left;
  padding: 16px 18px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;

  &:hover:not(.hw-card--disabled) {
    border-color: rgba(255, 255, 255, 0.24);
    background: rgba(255, 255, 255, 0.05);
  }

  &--active {
    border-color: var(--v-primary-base);
    background: #{"rgb(from var(--v-primary-base) r g b / 0.1)"};
    box-shadow: 0 0 16px #{"rgb(from var(--v-primary-base) r g b / 0.08)"};
  }

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

  &__name {
    font-size: 15px;
    font-weight: 600;
    color: #fff;
    line-height: 1.25;
  }

  &__desc {
    font-size: 12.5px;
    color: #94979c;
    margin-top: 2px;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  &__check {
    color: rgba(255, 255, 255, 0.25) !important;
  }

  &--active &__check {
    color: var(--v-primary-base) !important;
  }
}
</style>
