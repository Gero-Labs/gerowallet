<template>
  <span class="notify-assets" :class="{ 'notify-assets--stack': shown.length > 1 }" aria-hidden="true">
    <span v-for="(asset, i) in shown" :key="asset.unit ?? asset.label" class="notify-assets__icon" :class="{ 'notify-assets__icon--behind': i > 0 }">
      <img v-if="imageFor(asset)" :src="imageFor(asset)" :alt="asset.label" class="notify-assets__img" />
      <span v-else class="notify-assets__letter">{{ asset.label.replace(/^\$/, '').slice(0, 1) }}</span>
    </span>
  </span>
</template>

<script setup lang="ts">
// The icon of what a receipt brought, in the bell row and the snackbar: the first token before
// ADA (the token is the news), a second one peeking from behind when there are more. Images come
// from what the page already knows: the open wallet's tokens, then the network's asset registry,
// and the chain's currency image for ADA; an unknown token shows its first letter.
import { computed } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { geroStore } from '@/stores/geroStore';
import networks from '@/utils/networks';

interface NotifyAsset { unit?: string; label: string }
const props = defineProps<{ assets: NotifyAsset[]; walletId?: number | null }>();

const shown = computed(() => {
  const tokens = props.assets.filter((a) => a.unit !== 'lovelace');
  const ada = props.assets.filter((a) => a.unit === 'lovelace');
  return [...tokens, ...ada].slice(0, 2);
});

type WithImage = { img?: string } | undefined;

function adaImage(): string {
  const wallet = (props.walletId !== null && props.walletId !== undefined ? geroStore.wallets?.[props.walletId] : null) ?? walletStore.loggedWallet;
  const held = (walletStore.tokens as Record<string, WithImage>)['lovelace']?.img;
  return held || (wallet ? networks.resolveCurrencyImage(wallet.chain, wallet.network) : '');
}

function imageFor(asset: NotifyAsset): string {
  if (!asset.unit) return '';
  if (asset.unit === 'lovelace') return adaImage();
  const held = (walletStore.tokens as Record<string, WithImage>)[asset.unit]?.img;
  const known = (networkStore.assets as Record<string, WithImage>)?.[asset.unit]?.img;
  return held || known || '';
}
</script>

<style lang="scss" scoped>
.notify-assets {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
.notify-assets__icon {
  width: 22px;
  height: 22px;
  border-radius: var(--g-r-pill);
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  // A control on a glass tile: solid so a transparent logo stays legible over any backdrop.
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
}
.notify-assets--stack .notify-assets__icon {
  position: absolute;
  width: 18px;
  height: 18px;
  top: 1px;
  left: 1px;
  &--behind { top: auto; left: auto; right: 1px; bottom: 1px; z-index: 0; }
}
.notify-assets--stack .notify-assets__icon:first-child { z-index: 1; }
.notify-assets__img { width: 100%; height: 100%; object-fit: contain; }
.notify-assets__letter { font-size: 11px; font-weight: 600; color: var(--g-text-2); line-height: 1; }
</style>
