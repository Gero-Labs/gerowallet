<template>
  <v-dialog
    style="opacity: 0.9"
    max-width="1000"
    content-class="rounded-xxl dialogStyle"
    :persistent="true"
    :value="isOpen"
  >
    <div style="position: relative; overflow: hidden;">
      <!-- Background Image for Third Slide Only -->
      <div
        v-if="carousel === 2"
        :style="{
          position: 'absolute',
          top: 'calc(-90% + 10px)',
          left: '50%',
          width: '100vw',
          height: '100vh',
          zIndex: 0,
          backgroundImage: `url(${assets.cardanoBackground})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          transform: 'translateX(-50%) scaleY(-0.7) scaleX(-1.2)',
          opacity: '0.6'
        }"
      />
    <v-carousel v-model="carousel" height="500" :continuous="false" style="position: relative; z-index: 1;">
      <v-carousel-item>
        <v-card style="position: relative; display: grid;">
          <v-img
            :src="assets.welcomeImage"
            style="width: 100%; min-height: 500px; grid-column: 1; z-index: 1; grid-row: 1; object-fit: cover; object-position: center bottom;"
            :alt="$t('common.welcomeToGeroDashboard')"
          />
        </v-card>
        <div style="position: absolute; bottom: 50px; justify-self: anchor-center; z-index: 2; font-size: 14px">
          {{ $t('navigation.checkOutWhatsNew') }}
        </div>
      </v-carousel-item>
      <v-carousel-item>
        <v-layout class="mx-4 mt-12">
          <v-row class="mx-10">
            <v-col cols="6">
              <v-card class="transparent">
                <v-card-title class="justify-center pb-0">
                  {{ $t('navigation.whatsNew') }}
                </v-card-title>
                <v-card-text>
                  <v-list class="transparent">
                    <v-list-item link @mouseenter="setImprovedPerformance" class="my-3 px-0" style="position: relative; overflow: hidden; background-color: #0F0F0F; border-radius: 12px; height: 54px;">
                      <v-img
                        :src="assets.improvedUxSS"
                        :alt="$t('navigation.improvedUx')"
                        style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover;"
                      />
                      <v-list-item-title class="text-left" style="position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: white; font-weight: 500; z-index: 1;">
                        {{ $t('navigation.improvedPerformanceAndUX') }}
                      </v-list-item-title>
                    </v-list-item>
                    <v-list-item link @mouseenter="setGeroCard" class="my-3 px-0" style="position: relative; overflow: hidden; background-color: #0F0F0F; border-radius: 12px; height: 54px;">
                      <v-img
                        :src="assets.geroCardSS"
                        :alt="$t('card.geroCard')"
                        style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover;"
                      />
                      <v-list-item-title class="text-left" style="position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: white; font-weight: 500; z-index: 1;">
                        {{ $t('card.geroCryptoCard') }}
                      </v-list-item-title>
                    </v-list-item>
                    <v-list-item link @mouseenter="setPerpetuals" class="my-3 px-0" style="position: relative; overflow: hidden; background-color: #0F0F0F; border-radius: 12px; height: 54px;">
                      <v-img
                        :src="assets.perpetualsSS"
                        :alt="$t('perpetuals.perpetuals')"
                        style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover;"
                      />
                      <v-list-item-title class="text-left" style="position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: white; font-weight: 500; z-index: 1;">
                        {{ $t('perpetuals.perpetuals') }}
                      </v-list-item-title>
                    </v-list-item>
                    <v-list-item link @mouseenter="setPassKey" class="my-3 px-0" style="position: relative; overflow: hidden; background-color: #0F0F0F; border-radius: 12px; height: 54px;">
                      <v-img
                        :src="assets.passKeySS"
                        :alt="$t('navigation.passKeySecurityFeature')"
                        style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover;"
                      />
                      <v-list-item-title class="text-left" style="position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: white; font-weight: 500; z-index: 1;">
                        {{ $t('navigation.passKeySecurityFeature') }}
                      </v-list-item-title>
                    </v-list-item>
                    <v-list-item link @mouseenter="setMoreCashback" class="my-3 px-0" style="position: relative; overflow: hidden; background-color: #0F0F0F; border-radius: 12px; height: 54px;">
                      <v-img
                        :src="assets.cashbackNewSS"
                        :alt="$t('cashback.cashbackNew')"
                        style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover;"
                      />
                      <v-list-item-title class="text-left" style="position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: white; font-weight: 500; z-index: 1;">
                        {{ $t('cashback.moreCashbackDeals') }}
                      </v-list-item-title>
                    </v-list-item>
                  </v-list>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="6">
              <v-card class="fill-height transparent">
                <v-card-title style="height: 46px"></v-card-title>
                <v-card-text class="fill-height pb-0 mt-5" style="height:322px; color: white; font-size: 16px; text-align: center; align-content: center; background-color: #0f0f0f; border-radius: 12px; font-weight: 300" v-html="text">
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>
        </v-layout>
      </v-carousel-item>
      <v-carousel-item style="justify-items: center;">
        <div class="pa-8" style="justify-items: center;">
          <div style="max-width: 600px; position: relative; text-align: center; color: white; font-size: 18px; font-weight: 500; line-height: 24px; word-wrap: break-word; margin-bottom: 32px;">
            {{ $t('navigation.quickActions') }}
          </div>

          <!-- Quick Action Button Preview -->
          <div style="display: flex; justify-content: center; margin-bottom: 40px;">
            <div style="background-color: rgba(0, 0, 0, 0.4); padding: 8px 16px; border-radius: 20px; display: inline-flex; gap: 8px; align-items: center; backdrop-filter: blur(10px);">
              <!-- Buy/Sell Button -->
              <v-btn
                class="expandable-button"
                color="#FFF59E1A"
                height="28"
                style="min-width: 100px; text-transform: none;"
                depressed
              >
                <v-avatar tile size="14" class="mr-1">
                  <v-img :src="assets.dollarShieldSvg" :alt="$t('common.buy')" contain></v-img>
                </v-avatar>
                <span style="font-size: 12px;">{{ $t('navigation.buySell') }}</span>
              </v-btn>

              <!-- Send Button -->
              <v-btn
                class="expandable-button"
                color="#00DFF31A"
                height="28"
                style="min-width: 80px; text-transform: none;"
                depressed
              >
                <v-avatar tile size="14" class="mr-1">
                  <v-img
                    :src="assets.sendSvg"
                    :alt="$t('common.send')"
                    contain
                    style="filter: invert(83%) sepia(48%) saturate(3753%) hue-rotate(133deg) brightness(92%) contrast(108%);"
                  ></v-img>
                </v-avatar>
                <span style="font-size: 12px;">{{ $t('wallet.send') }}</span>
              </v-btn>

              <!-- Receive Button -->
              <v-btn
                class="expandable-button"
                color="#75E0A71A"
                height="28"
                style="min-width: 80px; text-transform: none;"
                depressed
              >
                <v-avatar tile size="14" class="mr-1">
                  <v-img
                    :src="assets.qrCodeSvg"
                    :alt="$t('common.receive')"
                    contain
                    style="filter: invert(83%) sepia(16%) saturate(992%) hue-rotate(92deg) brightness(94%) contrast(92%);"
                  ></v-img>
                </v-avatar>
                <span style="font-size: 12px;">{{ $t('wallet.receive') }}</span>
              </v-btn>

              <!-- Swap Button -->
              <v-btn
                class="expandable-button"
                color="#FDA29B1A"
                height="28"
                style="min-width: 80px; text-transform: none;"
                depressed
              >
                <v-avatar tile size="14" class="mr-1">
                  <v-img
                    :src="assets.swapSvg"
                    :alt="$t('swap.swap')"
                    contain
                    style="filter: invert(62%) sepia(76%) saturate(306%) hue-rotate(314deg) brightness(105%) contrast(98%);"
                  ></v-img>
                </v-avatar>
                <span style="font-size: 12px;">{{ $t('swap.swap') }}</span>
              </v-btn>

              <!-- Perpetuals Button -->
              <v-btn
                class="expandable-button"
                color="#B794F41A"
                height="28"
                style="min-width: 90px; text-transform: none;"
                depressed
              >
                <v-avatar tile size="14" class="mr-1">
                  <v-img
                    :src="assets.barChart"
                    :alt="$t('perpetuals.perpetuals')"
                    contain
                    style="filter: invert(66%) sepia(41%) saturate(458%) hue-rotate(226deg) brightness(95%) contrast(96%);"
                  ></v-img>
                </v-avatar>
                <span style="font-size: 12px;">{{ $t('perpetuals.perpetuals') }}</span>
              </v-btn>
            </div>
          </div>

          <!-- Action Descriptions Grid -->
          <v-row justify="center" style="max-width: 1000px; margin: 0 auto;" no-gutters>
            <v-col cols="12" md="2" lg="2" class="text-center pa-2" style="flex: 1;">
              <v-avatar tile size="32" class="mb-2">
                <v-img :src="assets.dollarShieldSvg" :alt="$t('common.buy')" contain></v-img>
              </v-avatar>
              <p style="color: #FFF59E; font-size: 13px; font-weight: 500; margin-bottom: 6px;">
                {{ $t('navigation.buySell') }}
              </p>
              <p style="color: rgba(255, 255, 255, 0.7); font-size: 11px; line-height: 14px; max-height: 42px; overflow: hidden;">
                {{ $t('navigation.buyOrSellDescription') }}
              </p>
            </v-col>

            <v-col cols="12" md="2" lg="2" class="text-center pa-2" style="flex: 1;">
              <v-avatar tile size="32" class="mb-2">
                <v-img
                  :src="assets.sendSvg"
                  :alt="$t('common.send')"
                  contain
                  style="filter: invert(83%) sepia(48%) saturate(3753%) hue-rotate(133deg) brightness(92%) contrast(108%);"
                ></v-img>
              </v-avatar>
              <p style="color: #00DFF3; font-size: 13px; font-weight: 500; margin-bottom: 6px;">
                {{ $t('common.send') }}
              </p>
              <p style="color: rgba(255, 255, 255, 0.7); font-size: 11px; line-height: 14px; max-height: 42px; overflow: hidden;">
                {{ $t('navigation.sendDescription') }}
              </p>
            </v-col>

            <v-col cols="12" md="2" lg="2" class="text-center pa-2" style="flex: 1;">
              <v-avatar tile size="32" class="mb-2">
                <v-img
                  :src="assets.qrCodeSvg"
                  :alt="$t('common.receive')"
                  contain
                  style="filter: invert(83%) sepia(16%) saturate(992%) hue-rotate(92deg) brightness(94%) contrast(92%);"
                ></v-img>
              </v-avatar>
              <p style="color: #75E0A7; font-size: 13px; font-weight: 500; margin-bottom: 6px;">
                {{ $t('common.receive') }}
              </p>
              <p style="color: rgba(255, 255, 255, 0.7); font-size: 11px; line-height: 14px; max-height: 42px; overflow: hidden;">
                {{ $t('navigation.receiveDescription') }}
              </p>
            </v-col>

            <v-col cols="12" md="2" lg="2" class="text-center pa-2" style="flex: 1;">
              <v-avatar tile size="32" class="mb-2">
                <v-img
                  :src="assets.swapSvg"
                  :alt="$t('swap.swap')"
                  contain
                  style="filter: invert(62%) sepia(76%) saturate(306%) hue-rotate(314deg) brightness(105%) contrast(98%);"
                ></v-img>
              </v-avatar>
              <p style="color: #FDA29B; font-size: 13px; font-weight: 500; margin-bottom: 6px;">
                {{ $t('swap.swap') }}
              </p>
              <p style="color: rgba(255, 255, 255, 0.7); font-size: 11px; line-height: 14px; max-height: 42px; overflow: hidden;">
                {{ $t('navigation.swapDescription') }}
              </p>
            </v-col>

            <v-col cols="12" md="2" lg="2" class="text-center pa-2" style="flex: 1;">
              <v-avatar tile size="32" class="mb-2">
                <v-img
                  :src="assets.barChart"
                  :alt="$t('perpetuals.perpetuals')"
                  contain
                  style="filter: invert(66%) sepia(41%) saturate(458%) hue-rotate(226deg) brightness(95%) contrast(96%);"
                ></v-img>
              </v-avatar>
              <p style="color: #B794F4; font-size: 13px; font-weight: 500; margin-bottom: 6px;">
                {{ $t('perpetuals.perpetuals') }}
              </p>
              <p style="color: rgba(255, 255, 255, 0.7); font-size: 11px; line-height: 14px; max-height: 42px; overflow: hidden;">
                {{ $t('navigation.perpetualsDescription') }}
              </p>
            </v-col>
          </v-row>

          <div style="margin-top: 40px; text-align: center; color: rgba(255, 255, 255, 0.6); font-size: 14px;">
            {{ $t('navigation.accessQuickActions') }}
          </div>
        </div>
      </v-carousel-item>
      <v-carousel-item>
        <div class="pa-8" :style="`height: 100%; background-image: url(${assets.cardanoBackground}); background-size: 150%; background-position: center 25%; background-repeat: no-repeat;`">
          <div class="text-center">
            <p style="font-size: 18px;"><strong>{{ $t('navigation.ourMission') }}</strong></p>
            <p>{{ $t('navigation.checkOutBlog') }}</p>
            <p>{{ $t('navigation.enjoyGeroDashboard') }}</p>
          </div>
          <div class="text-center pt-6">
            <span>{{ $t('navigation.availableOnSocial') }}</span>
            <div>
              <v-btn icon href="https://gerowallet.io" target="_blank" class="mx-2">
                <v-avatar size="36" tile>
                  <v-icon style="font-size: 28px;">mdi-web</v-icon>
                </v-avatar>
              </v-btn>
              <v-btn icon href="https://twitter.com/GeroWallet" target="_blank" class="mx-2">
                <v-avatar tile>
                  <v-img :src="assets.xSvg" width="24" height="24" alt="x" contain></v-img>
                </v-avatar>
              </v-btn>
              <v-btn icon href="https://discord.gg/37bvtyvchz" target="_blank" class="mx-2">
                <v-avatar tile>
                  <v-img :src="assets.discordSvg" width="24" height="24" alt="discord" contain></v-img>
                </v-avatar>
              </v-btn>
              <v-btn icon href="https://t.me/GeroWallet" target="_blank" class="mx-2">
                <v-avatar tile>
                  <v-img :src="assets.telegramSvg" width="24" height="24" alt="x" contain></v-img>
                </v-avatar>
              </v-btn>
              <v-btn icon href="https://www.youtube.com/@Gerowallet" target="_blank" class="mx-2">
                <v-avatar size="36" tile>
                  <v-icon style="font-size: 30px;">mdi-youtube</v-icon>
                </v-avatar>
              </v-btn>
              <v-btn icon href="https://gerowallet.medium.com/" target="_blank" class="mx-2">
                <v-avatar tile>
                  <v-img :src="assets.mediumSvg" width="24" height="24" alt="x" contain></v-img>
                </v-avatar>
              </v-btn>
              <v-btn icon href="https://github.com/Gero-Labs/gerowallet" target="_blank" class="mx-2">
                <v-avatar size="36" tile>
                  <v-icon style="font-size: 30px;">mdi-github</v-icon>
                </v-avatar>
              </v-btn>
            </div>
            <v-btn class="geroButton mt-4" x-large style="font-size: 14px" @click="setWelcomeDone">
              {{ $t('navigation.getStarted') }}
            </v-btn>
          </div>
          <div style="position: absolute; bottom: 50px; justify-self: anchor-center; z-index: 2; font-size: 14px">
            {{ $t('navigation.needRefresher') }}
          </div>
        </div>
      </v-carousel-item>
    </v-carousel>
    </div>
  </v-dialog>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import assets from '@/utils/assets';

const { t } = useTranslation();

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  }
});

const emit = defineEmits(['close']);

const carousel = ref(0);
const text = ref(`<p><strong>${t('navigation.improvedPerformanceAndUX')}</strong></p>
           <p>${t('navigation.improvedPerformanceDesc1')}</p>
           <p>${t('navigation.improvedPerformanceDesc2')}</p>`);
watch(() => props.isOpen, (value) => {
  if (!value) {
    setTimeout(() => carousel.value = 0, 2000);
  }
});
const setWelcomeDone = () => {
  emit('close')
};

const setImprovedPerformance = () => {
  text.value = `<p><strong>${t('navigation.improvedPerformanceAndUX')}</strong></p>
           <p>${t('navigation.improvedPerformanceDesc1')}</p>
           <p>${t('navigation.improvedPerformanceDesc2')}</p>`
};

const setGeroCard = () => {
  text.value = `<p><strong>${t('navigation.geroCryptoCardLaunching')}</strong></p>
                   <p>${t('navigation.geroCryptoCardDesc1')}</p>
                   <p>${t('navigation.geroCryptoCardDesc2')}</p>`
};

const setPerpetuals = () => {
  text.value = `<p><strong>${t('navigation.perpetualsWithStrike')}</strong></p>
                   <p>${t('navigation.perpetualsDesc1')}</p>
                   <p>${t('navigation.perpetualsDesc2')}</p>`
};

const setPassKey = () => {
  text.value = `<p><strong>${t('navigation.passKeySecurityFeature')}</strong></p>
                   <p>${t('navigation.passKeyDesc1')}</p>
                   <p>${t('navigation.passKeyDesc2')}</p>`
};

const setMoreCashback = () => {
  text.value = `<p><strong>${t('navigation.moreCashbackDeals')}</strong></p>
                   <p>${t('navigation.moreCashbackDesc1')}</p>
                   <p>${t('navigation.moreCashbackDesc2')}</p>`
};
</script>
<style scoped>

</style>
