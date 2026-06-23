<template>
  <div class="step-device">
    <div class="step-section-label mb-2 mt-4">{{ $t('welcome.hardwareWalletType') }}</div>
    <div class="hw-grid">
      <div
        v-for="item in walletTypes"
        :key="item.name"
        class="hw-tile"
        :class="{
          'hw-tile--active': localWalletType === item.name,
          'hw-tile--disabled': !item.enabled
        }"
        @click="item.enabled && selectType(item.name)"
      >
        <img
          :src="item.icon"
          class="hw-tile__logo"
          :alt="item.name"
        />
        <span class="hw-tile__label">{{ item.name }}</span>
        <v-chip v-if="!item.enabled" color="red" x-small style="height: 14px; font-size: 9px;">{{ $t('welcome.soon') }}</v-chip>
      </div>
    </div>

    <!-- Navigation buttons -->
    <div class="d-flex mt-4" style="gap: 12px;">
      <v-btn text @click="$emit('back')">{{ $t('common.back') }}</v-btn>
      <v-spacer />
      <v-btn color="primary" :disabled="!localWalletType" @click="onContinue()">{{ $t('common.continue') }}</v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import assets from '@/utils/assets';
import type { NetworkInfo } from '@/utils/networks';

const { t } = useTranslation();

defineProps<{ network: NetworkInfo }>();

const emit = defineEmits<{
  (e: 'select', walletType: string): void;
  (e: 'next'): void;
  (e: 'back'): void;
}>();

const localWalletType = ref<string | undefined>(undefined);

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
  localWalletType.value = name;
  emit('select', name);
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

.hw-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.hw-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 18px 10px 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  min-height: 100px;
  gap: 8px;
  user-select: none;

  &:hover {
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.05);
  }

  &--active {
    border-color: #{"rgb(from var(--v-primary-base) r g b / 0.55)"};
    background: #{"rgb(from var(--v-primary-base) r g b / 0.06)"};
    box-shadow: 0 0 14px #{"rgb(from var(--v-primary-base) r g b / 0.07)"};
  }

  &--disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  &__logo {
    width: 100px;
    height: 32px;
    object-fit: contain;
    filter: invert(100%) sepia(20%) saturate(2%) hue-rotate(213deg) brightness(112%) contrast(101%);
  }

  &__label {
    font-size: 11px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
  }

  &--active &__label {
    color: rgba(255, 255, 255, 0.9);
  }
}
</style>
