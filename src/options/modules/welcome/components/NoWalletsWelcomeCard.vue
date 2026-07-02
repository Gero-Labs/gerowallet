<template>
  <v-card
    class="transparent-override liquid-glass-card"
    flat
    style="max-width: 100%; margin: auto; width: 100%; justify-items: center; padding-top: 1px;"
  >
    <div
      style="
        max-width: 416px;
        width: 100%;
        height: 210px;
        padding: 16px;
        position: relative;
        border-radius: 16px;
        background-color: rgba(12, 14, 18, 0.85);
        flex-direction: column;
        justify-content: flex-start;
        align-items: flex-start;
        gap: 8px;
        display: flex;
        outline: 1px rgba(255, 255, 255, 0.1) solid;
        outline-offset: -1px;
        margin-top: 24px;
      "
    >
      <v-carousel
        v-model="currentSlide"
        :cycle="true"
        :interval="4000"
        height="100%"
        hide-delimiter-background
        :show-arrows="false"
        style="width: 100%; position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 16px"
      >
        <v-carousel-item>
          <div style="position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
            <v-img :src="assets.debitCardBgImage" cover style="position: absolute; width: calc(100% - 1px); height: calc(100% - 1px); top: 1px; left: 1px; z-index: 0; border-radius: 16px;" />
            <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); text-align: center; z-index: 2;">
              <div style="font-family: 'Tenby Seven', sans-serif; font-size: 22px; font-weight: 700; color: white; line-height: 1.2; text-shadow: 0 2px 8px rgba(0,0,0,0.5);">
                <div>Gero</div>
                <div>Crypto</div>
                <div>Card</div>
              </div>
            </div>
            <img
              :src="assets.frontCardNoMcx2"
              :alt="$t('card.geroCard')"
              style="position: relative; max-width: 230px; width: 82%; height: auto; filter: drop-shadow(0 20px 40px rgba(0,0,0,0.5)); transform: rotateY(-5deg) rotateX(5deg); z-index: 1;"
            />
          </div>
        </v-carousel-item>
        <v-carousel-item>
          <v-img :src="assets.cashbackBg" cover :alt="$t('cashback.cashback')" style="width: 100%; height: 100%" />
        </v-carousel-item>
      </v-carousel>
      <img :src="assets.rectangle"  style="width: 60px; height: 60px; right: -30px; top: -33px; position: absolute; opacity: 0.96;" alt="">
      <img :src="assets.rectangle2" style="width: 28px; height: 28px; right: -46px; top: 10px; position: absolute;" alt="">
      <img :src="assets.rectangle" style="width: 64px; height: 64px; left: -30px; top: 150px; position: absolute; transform: rotate(180deg); opacity: 0.9;" alt="">
    </div>
    <div
      style="
        width: 100%;
        max-width: 456px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        align-items: center;
        text-align: center;
        gap: 10px;
        padding: 16px 20px 52px;
      "
    >
      <div style="text-align: center">
        <span
          :class="['transition', gradientClass]"
          style="color: #00c7f3; font-size: 26px; font-weight: 600; line-height: 34px; word-wrap: break-word"
          >Unifying</span
        >
        <span style="font-size: 26px; font-weight: 600; line-height: 34px; word-wrap: break-word"> Web2 & Web3</span>
      </div>
      <div
        style="
          text-align: center;
          font-size: 15px;
          font-weight: 500;
          line-height: 22px;
          word-wrap: break-word;
          max-width: 400px;
        "
      >
        We are building the ultimate blockchain platform that bridges web2 and web3 with multi-chain compatibility.
      </div>
    </div>
  </v-card>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import assets from '@/utils/assets';
import { computed, ref, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';


const { t } = useTranslation();

const currentSlide = ref(0)

const { loggedWallet } = toRefs(walletStore);

const gradientClass = computed(() => {
  if (loggedWallet.value?.chain?.includes('Apex')) {
    return 'apex-gradient-text';
  }
  return 'gradient-text';
});
</script>
<style scoped>
/* Ensure all parent elements are transparent for backdrop-filter to work */
.transparent-override,
.transparent-override .v-card__title,
.transparent-override .v-card__subtitle,
.transparent-override .v-card__text {
  background: transparent !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;

}
.stats-viewport {
  width: 100%;
  height: 58px;
  overflow: hidden;
  position: relative;
  background: rgba(12, 14, 18, 0.5);
  border-radius: 12px;
  outline: 2px solid rgba(255, 255, 255, 0.1);
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
  0% {
    transform: translateY(0);
  }
  /* pause 800ms → 800/5600 = 14.2857% */
  14.2857% {
    transform: translateY(0);
  }

  /* 2) slide to item 2 over 600ms → next 10.7143% */
  25% {
    transform: translateY(-58px);
  }

  /* 3) item 2 static */
  39.2857% {
    transform: translateY(-58px);
  }

  /* 4) slide to item 3 */
  50% {
    transform: translateY(-116px);
  }

  /* 5) item 3 static */
  64.2857% {
    transform: translateY(-116px);
  }

  /* 6) slide to item 4 */
  75% {
    transform: translateY(-174px);
  }

  /* 7) item 4 static */
  89.2857% {
    transform: translateY(-174px);
  }

  /* 8) slide to duplicated item 1 */
  100% {
    transform: translateY(-232px);
  }
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
.liquid-glass-card {
  background: linear-gradient(135deg, rgba(19, 22, 27, 0.6) 0%, rgba(19, 22, 27, 0.5) 100%),
    radial-gradient(circle at 20% 50%, rgba(45, 240, 247, 0.04) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, rgba(255, 255, 255, 0.03) 0%, transparent 50%) !important;
  backdrop-filter: blur(20px) saturate(1.5) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.5) !important;

  border-right: 1px solid rgba(255, 255, 255, 0.15) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), inset -1px 0 0 rgba(45, 240, 247, 0.08),
    4px 0 24px rgba(0, 0, 0, 0.4) !important;
}
</style>
