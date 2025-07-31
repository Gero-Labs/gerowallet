<template>
  <v-card class="transparent-override" flat style="max-width: 100%; margin: auto; width: 100%; justify-items: center;">
    <div style="max-width: 416px; width: 100%; height: 280px; padding: 20px; position: relative; border-radius: 16px; backdrop-filter: blur(4px); background-color: #0C0E12; flex-direction: column; justify-content: flex-start; align-items: flex-start; gap: 8px; display: flex; outline: 1px rgba(255, 255, 255, 0.10) solid; outline-offset: -1px; margin-top: 60px">
      <v-img :src="assets.cashbackBg" cover alt="Cashback" style="width: 100%" />
      <img :src="assets.rectangle"  style="width: 72px; height: 72px; right: -40px; top: -43px; position: absolute; opacity: 0.96;" alt="">
      <img :src="assets.rectangle2" style="width: 32px; height: 32px; right: -60px; top: 13px; position: absolute;" alt="">
      <img :src="assets.rectangle" style="width: 80px; height: 80px; left: -40px; top: 227px; position: absolute; transform: rotate(180deg); opacity: 0.9;" alt="">
      <div style="width: 148px; height: 59px; left: -45px; top: -31px; position: absolute;">
        <div class="stats-viewport">
          <div class="stats-list">
            <div class="span-pair">
              <span class="label">Portfolio</span>
              <span class="value">$16.5K</span>
            </div>
            <div class="span-pair">
              <span class="label">Assets</span>
              <span class="value">$22.3K</span>
            </div>
            <div class="span-pair">
              <span class="label">Collectibles</span>
              <span class="value">$1.8K</span>
            </div>
            <div class="span-pair">
              <span class="label">Liquidity</span>
              <span class="value">$761</span>
            </div>
            <!-- duplicate first for a seamless loop -->
            <div class="span-pair">
              <span class="label">Portfolio</span>
              <span class="value">$16.5K</span>
            </div>
          </div>
        </div>
      </div>
      <div style="width: 216px; height: 118px; padding: 16px; right: -47px; bottom: -47px; position: absolute; background: rgba(12, 14, 18, 0.50); border-radius: 12px; outline: 1px rgba(255, 255, 255, 0.10) solid; outline-offset: -1px; backdrop-filter: blur(8px); flex-direction: column; justify-content: flex-start; align-items: center; gap: 12px; display: inline-flex">
        <div style="align-self: stretch; flex-direction: column; justify-content: flex-start; align-items: flex-start; gap: 16px; display: flex">
          <div style="align-self: stretch; font-size: 16px; font-weight: 600; line-height: 14px; word-wrap: break-word">{{ hoveredText }}</div>
        </div>
        <div style="height: 60px; padding: 8px; border-radius: 12px; justify-content: flex-start; align-items: center; gap: 12px; display: inline-flex">
          <div @mouseenter="onHover('Buy / Sell Crypto')" style="padding: 8px; background: rgba(255, 245.33, 158.31, 0.10); border-radius: 8px; justify-content: center; align-items: center; gap: 8px; display: flex">
            <v-avatar tile :size="hoveredText === 'Buy / Sell Crypto' ? 28 : 20">
              <v-img :src="assets.dollarShieldSvg" alt="Buy" contain></v-img>
            </v-avatar>
          </div>
          <div @mouseenter="onHover('Quick Send')" style="padding: 8px; background: rgba(0, 223, 243, 0.10); border-radius: 8px; justify-content: center; align-items: center; gap: 8px; display: flex">
            <v-avatar tile :size="hoveredText === 'Quick Send' ? 28 : 20">
              <v-img
                :src="assets.sendSvg"
                alt="Send"
                contain
                style="
                    filter: invert(83%) sepia(48%) saturate(3753%) hue-rotate(133deg) brightness(92%) contrast(108%);
                  "
              ></v-img>
            </v-avatar>
          </div>
          <div @mouseenter="onHover('Receive')" style="padding: 8px; background: rgba(117.27, 223.73, 166.95, 0.10); border-radius: 8px; justify-content: center; align-items: center; gap: 8px; display: flex">
            <v-avatar tile :size="hoveredText === 'Receive' ? 28 : 20">
              <v-img
                :src="assets.qrCodeSvg"
                alt="Receive"
                contain
                style="
                    filter: invert(83%) sepia(16%) saturate(992%) hue-rotate(92deg) brightness(94%) contrast(92%);
                  "
              ></v-img>
            </v-avatar>
          </div>
          <div @mouseenter="onHover('Swap')" style="padding: 8px; background: rgba(252.96, 161.57, 155.04, 0.10); border-radius: 8px; justify-content: center; align-items: center; gap: 8px; display: flex">
            <v-avatar tile :size="hoveredText === 'Swap' ? 28 : 20">
              <v-img
                :src="assets.swapSvg"
                alt="Swap"
                contain
                style="
                    filter: invert(62%) sepia(76%) saturate(306%) hue-rotate(314deg) brightness(105%) contrast(98%);
                  "
              ></v-img>
            </v-avatar>
          </div>
        </div>
      </div>
    </div>
    <div style="width: 456px; height: 100%; padding-top:66px; flex-direction: column; justify-content: flex-start; align-items: center; gap: 8px; display: inline-flex">
      <div style="align-self: stretch; text-align: center">
        <span :class="['transition', gradientClass]" style="color: #00C7F3; font-size: 24px; font-weight: 600; line-height: 32px; word-wrap: break-word">Unifying</span>
        <span style="font-size: 24px; font-weight: 600; line-height: 32px; word-wrap: break-word"> Web2 & Web3</span>
      </div>
      <div style="align-self: stretch; text-align: center; font-size: 16px; font-weight: 500; line-height: 24px; word-wrap: break-word">We are building the ultimate blockchain platform that bridges web2 and web3 with multi-chain compatibility.</div>
    </div>
  </v-card>
</template>
<script setup lang="ts">
import assets from '@/utils/assets';
import { computed, ref, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import networks from '@/utils/networks';

const hoveredText = ref<string>('Buy / Sell Crypto')
function onHover(text: string) {
  hoveredText.value = text
}

const { loggedWallet } = toRefs(walletStore);

const gradientClass = computed(() => {
  if (loggedWallet.value?.chain?.includes('Apex')) {
    return 'apex-gradient-text'
  }
  return 'gradient-text'
});
</script>
<style scoped>

</style>
