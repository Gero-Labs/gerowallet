<template>
  <v-card class="transparent" flat style="max-width: 100%; margin: auto; width: 100%; justify-items: center; padding-top: 20px;">
    <div style="max-width: 416px; width: 100%; height: 280px; padding: 20px; position: relative; border-radius: 16px; background-color: rgba(12, 14, 18, 0.85); flex-direction: column; justify-content: flex-start; align-items: flex-start; gap: 8px; display: flex; outline: 1px rgba(255, 255, 255, 0.10) solid; outline-offset: -1px; margin-top: 120px">
      <v-carousel
        v-model="currentSlide"
        :cycle="false"
        :interval="4000"
        height="100%"
        hide-delimiter-background
        :show-arrows="false"
        style="width: 100%; position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 16px;"
      >
        <v-carousel-item>
          <div style="position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
            <v-img :src="assets.debitCardBgImage" cover style="position: absolute; width: calc(100% - 1px); height: calc(100% - 1px); top: 1px; left: 1px; z-index: 0; border-radius: 16px;" />
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; z-index: 2;">
              <div style="font-family: 'Tenby Seven', sans-serif; font-size: 24px; font-weight: 700; color: white; line-height: 1.2; text-shadow: 0 2px 8px rgba(0,0,0,0.5);">
                <div>Gero</div>
                <div>Crypto</div>
                <div>Card</div>
              </div>
            </div>
            <img
              :src="assets.frontCardNoMcx2"
              alt="Gero Card"
              style="position: relative; max-width: 280px; width: 90%; height: auto; filter: drop-shadow(0 20px 40px rgba(0,0,0,0.5)); transform: rotateY(-5deg) rotateX(5deg); z-index: 1;"
            />
          </div>
        </v-carousel-item>
        <v-carousel-item>
          <v-img :src="assets.cashbackBg" cover alt="Cashback" style="width: 100%; height: 100%" />
        </v-carousel-item>
      </v-carousel>
      <img :src="assets.rectangle"  style="width: 72px; height: 72px; right: -40px; top: -43px; position: absolute; opacity: 0.96;" alt="">
      <img :src="assets.rectangle2" style="width: 32px; height: 32px; right: -60px; top: 13px; position: absolute;" alt="">
      <img :src="assets.rectangle" style="width: 80px; height: 80px; left: -40px; top: 227px; position: absolute; transform: rotate(180deg); opacity: 0.9;" alt="">
      <!-- Commented out animated stats card
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
            <div class="span-pair">
              <span class="label">Portfolio</span>
              <span class="value">$16.5K</span>
            </div>
          </div>
        </div>
      </div>
      -->
      <!-- Commented out quick actions card
      <div style="width: 216px; height: 118px; padding: 16px; right: -47px; bottom: -47px; position: absolute; background: rgba(12, 14, 18, 0.85); border-radius: 12px; outline: 1px rgba(255, 255, 255, 0.10) solid; outline-offset: -1px; flex-direction: column; justify-content: flex-start; align-items: center; gap: 12px; display: inline-flex">
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
      -->
    </div>
    <div style="width: 456px; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; text-align: center; gap: 16px; padding: 20px; padding-top: 100px; padding-bottom: 40px;">
      <div style="text-align: center">
        <span :class="['transition', gradientClass]" style="color: #00C7F3; font-size: 28px; font-weight: 600; line-height: 36px; word-wrap: break-word">Unifying</span>
        <span style="font-size: 28px; font-weight: 600; line-height: 36px; word-wrap: break-word"> Web2 & Web3</span>
      </div>
      <div style="text-align: center; font-size: 16px; font-weight: 500; line-height: 24px; word-wrap: break-word; max-width: 400px;">We are building the ultimate blockchain platform that bridges web2 and web3 with multi-chain compatibility.</div>
    </div>
  </v-card>
</template>
<script setup lang="ts">
import assets from '@/utils/assets';
import { computed, ref, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
const currentSlide = ref(0)

const { loggedWallet } = toRefs(walletStore);

const gradientClass = computed(() => {
  if (loggedWallet.value?.chain?.includes('Apex')) {
    return 'apex-gradient-text'
  }
  return 'gradient-text'
});
</script>
<style scoped>
.stats-viewport {
  width: 100%;
  height: 58px;
  overflow: hidden;
  position: relative;
  background: rgba(12,14,18,0.5);
  border-radius: 12px;
  outline: 2px solid rgba(255,255,255,0.1);
}

.stats-list {
  /* animate the whole stack */
  animation: scroll 5600ms infinite;
  animation-timing-function: cubic-bezier(0.68, -0.55, 0.265, 1.55);
}

.span-pair {
  display: flex;
  flex-flow: column;
  justify-content: space-between;
  height: 58px;
  padding: 0 0 9px 16px;
  box-sizing: border-box;
  justify-self: left;
}

/* keyframes:
   - show for 800ms pause
   - slide up over 600ms slide
   - repeat for each of the 4 items */
@keyframes scroll {
  /* 1) item 1 static */
  0%                              { transform: translateY(0); }
  /* pause 800ms → 800/5600 = 14.2857% */
  14.2857%                        { transform: translateY(0); }

  /* 2) slide to item 2 over 600ms → next 10.7143% */
  25%                             { transform: translateY(-58px); }

  /* 3) item 2 static */
  39.2857%                        { transform: translateY(-58px); }

  /* 4) slide to item 3 */
  50%                             { transform: translateY(-116px); }

  /* 5) item 3 static */
  64.2857%                        { transform: translateY(-116px); }

  /* 6) slide to item 4 */
  75%                             { transform: translateY(-174px); }

  /* 7) item 4 static */
  89.2857%                        { transform: translateY(-174px); }

  /* 8) slide to duplicated item 1 */
  100%                            { transform: translateY(-232px); }
}

/* typography */
.label {
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  color: rgba(255, 255, 255, 0.7);
}

.value {
  font-size: 32px;
  font-weight: 700;
  line-height: 24px;
  color: white;
}

</style>
