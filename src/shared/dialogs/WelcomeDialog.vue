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
            alt="Welcome to Gero Dashboard"
          />
        </v-card>
        <div style="position: absolute; bottom: 50px; justify-self: anchor-center; z-index: 2; font-size: 14px">
          Check out whats new!
        </div>
      </v-carousel-item>
      <v-carousel-item>
        <v-layout class="mx-4 mt-12">
          <v-row class="mx-10">
            <v-col cols="6">
              <v-card class="transparent">
                <v-card-title class="justify-center pb-0">
                  What's New?
                </v-card-title>
                <v-card-text>
                  <v-list class="transparent">
                    <v-list-item link @mouseenter="setImprovedPerformance" class="my-3 px-0" style="position: relative; overflow: hidden; background-color: #0F0F0F; border-radius: 12px; height: 54px;">
                      <v-img 
                        :src="assets.improvedUxSS" 
                        alt="Improved UX"
                        style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover;"
                      />
                      <v-list-item-title class="text-left" style="position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: white; font-weight: 500; z-index: 1;">
                        Improved Performance and UX
                      </v-list-item-title>
                    </v-list-item>
                    <v-list-item link @mouseenter="setGeroCard" class="my-3 px-0" style="position: relative; overflow: hidden; background-color: #0F0F0F; border-radius: 12px; height: 54px;">
                      <v-img 
                        :src="assets.geroCardSS" 
                        alt="Gero Card"
                        style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover;"
                      />
                      <v-list-item-title class="text-left" style="position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: white; font-weight: 500; z-index: 1;">
                        Gero Crypto Card
                      </v-list-item-title>
                    </v-list-item>
                    <v-list-item link @mouseenter="setPerpetuals" class="my-3 px-0" style="position: relative; overflow: hidden; background-color: #0F0F0F; border-radius: 12px; height: 54px;">
                      <v-img 
                        :src="assets.perpetualsSS" 
                        alt="Perpetuals"
                        style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover;"
                      />
                      <v-list-item-title class="text-left" style="position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: white; font-weight: 500; z-index: 1;">
                        Perpetuals
                      </v-list-item-title>
                    </v-list-item>
                    <v-list-item link @mouseenter="setMultisig" class="my-3 px-0" style="position: relative; overflow: hidden; background-color: #0F0F0F; border-radius: 12px; height: 54px;">
                      <v-img 
                        :src="assets.multisigSS" 
                        alt="Multisig"
                        style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover;"
                      />
                      <v-list-item-title class="text-left" style="position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: white; font-weight: 500; z-index: 1;">
                        Enterprise Multisig Wallet
                      </v-list-item-title>
                    </v-list-item>
                    <v-list-item link @mouseenter="setMoreCashback" class="my-3 px-0" style="position: relative; overflow: hidden; background-color: #0F0F0F; border-radius: 12px; height: 54px;">
                      <v-img 
                        :src="assets.cashbackNewSS" 
                        alt="Cashback New"
                        style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: cover;"
                      />
                      <v-list-item-title class="text-left" style="position: absolute; left: 16px; top: 50%; transform: translateY(-50%); color: white; font-weight: 500; z-index: 1;">
                        More Cashback Deals!
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
            Quick Actions
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
                  <v-img :src="assets.dollarShieldSvg" alt="Buy" contain></v-img>
                </v-avatar>
                <span style="font-size: 12px;">Buy / Sell</span>
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
                    alt="Send"
                    contain
                    style="filter: invert(83%) sepia(48%) saturate(3753%) hue-rotate(133deg) brightness(92%) contrast(108%);"
                  ></v-img>
                </v-avatar>
                <span style="font-size: 12px;">Send</span>
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
                    alt="Receive"
                    contain
                    style="filter: invert(83%) sepia(16%) saturate(992%) hue-rotate(92deg) brightness(94%) contrast(92%);"
                  ></v-img>
                </v-avatar>
                <span style="font-size: 12px;">Receive</span>
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
                    alt="Swap"
                    contain
                    style="filter: invert(62%) sepia(76%) saturate(306%) hue-rotate(314deg) brightness(105%) contrast(98%);"
                  ></v-img>
                </v-avatar>
                <span style="font-size: 12px;">Swap</span>
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
                    alt="Perpetuals"
                    contain
                    style="filter: invert(66%) sepia(41%) saturate(458%) hue-rotate(226deg) brightness(95%) contrast(96%);"
                  ></v-img>
                </v-avatar>
                <span style="font-size: 12px;">Perpetuals</span>
              </v-btn>
            </div>
          </div>

          <!-- Action Descriptions Grid -->
          <v-row justify="center" style="max-width: 1000px; margin: 0 auto;" no-gutters>
            <v-col cols="12" md="2" lg="2" class="text-center pa-2" style="flex: 1;">
              <v-avatar tile size="32" class="mb-2">
                <v-img :src="assets.dollarShieldSvg" alt="Buy" contain></v-img>
              </v-avatar>
              <p style="color: #FFF59E; font-size: 13px; font-weight: 500; margin-bottom: 6px;">
                Buy / Sell
              </p>
              <p style="color: rgba(255, 255, 255, 0.7); font-size: 11px; line-height: 14px; max-height: 42px; overflow: hidden;">
                Buy or sell ADA with credit card or bank transfer
              </p>
            </v-col>
            
            <v-col cols="12" md="2" lg="2" class="text-center pa-2" style="flex: 1;">
              <v-avatar tile size="32" class="mb-2">
                <v-img
                  :src="assets.sendSvg"
                  alt="Send"
                  contain
                  style="filter: invert(83%) sepia(48%) saturate(3753%) hue-rotate(133deg) brightness(92%) contrast(108%);"
                ></v-img>
              </v-avatar>
              <p style="color: #00DFF3; font-size: 13px; font-weight: 500; margin-bottom: 6px;">
                Send
              </p>
              <p style="color: rgba(255, 255, 255, 0.7); font-size: 11px; line-height: 14px; max-height: 42px; overflow: hidden;">
                Send ADA or other assets to any wallet address
              </p>
            </v-col>
            
            <v-col cols="12" md="2" lg="2" class="text-center pa-2" style="flex: 1;">
              <v-avatar tile size="32" class="mb-2">
                <v-img
                  :src="assets.qrCodeSvg"
                  alt="Receive"
                  contain
                  style="filter: invert(83%) sepia(16%) saturate(992%) hue-rotate(92deg) brightness(94%) contrast(92%);"
                ></v-img>
              </v-avatar>
              <p style="color: #75E0A7; font-size: 13px; font-weight: 500; margin-bottom: 6px;">
                Receive
              </p>
              <p style="color: rgba(255, 255, 255, 0.7); font-size: 11px; line-height: 14px; max-height: 42px; overflow: hidden;">
                Get your address and QR code to receive funds
              </p>
            </v-col>
            
            <v-col cols="12" md="2" lg="2" class="text-center pa-2" style="flex: 1;">
              <v-avatar tile size="32" class="mb-2">
                <v-img
                  :src="assets.swapSvg"
                  alt="Swap"
                  contain
                  style="filter: invert(62%) sepia(76%) saturate(306%) hue-rotate(314deg) brightness(105%) contrast(98%);"
                ></v-img>
              </v-avatar>
              <p style="color: #FDA29B; font-size: 13px; font-weight: 500; margin-bottom: 6px;">
                Swap
              </p>
              <p style="color: rgba(255, 255, 255, 0.7); font-size: 11px; line-height: 14px; max-height: 42px; overflow: hidden;">
                Exchange tokens directly from your wallet
              </p>
            </v-col>

            <v-col cols="12" md="2" lg="2" class="text-center pa-2" style="flex: 1;">
              <v-avatar tile size="32" class="mb-2">
                <v-img
                  :src="assets.barChart"
                  alt="Perpetuals"
                  contain
                  style="filter: invert(66%) sepia(41%) saturate(458%) hue-rotate(226deg) brightness(95%) contrast(96%);"
                ></v-img>
              </v-avatar>
              <p style="color: #B794F4; font-size: 13px; font-weight: 500; margin-bottom: 6px;">
                Perpetuals
              </p>
              <p style="color: rgba(255, 255, 255, 0.7); font-size: 11px; line-height: 14px; max-height: 42px; overflow: hidden;">
                Open long and short positions on ADA
              </p>
            </v-col>
          </v-row>

          <div style="margin-top: 40px; text-align: center; color: rgba(255, 255, 255, 0.6); font-size: 14px;">
            Access all quick actions from the toolbar at the top of your dashboard
          </div>
        </div>
      </v-carousel-item>
      <v-carousel-item>
        <div class="pa-8" :style="`height: 100%; background-image: url(${assets.cardanoBackground}); background-size: 150%; background-position: center 25%; background-repeat: no-repeat;`">
          <div class="text-center">
            <p style="font-size: 18px;"><strong>Our mission is to unify Web2 and Web3</strong></p>
            <p>We have many things in store, check out our blog posts for the latest news</p>
            <p>We hope you enjoy using Gero Dashboard</p>
          </div>
          <div class="text-center pt-6">
            <span>We are available on social media</span>
            <div>
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
            </div>
            <v-btn class="geroButton mt-4" x-large style="font-size: 14px" @click="setWelcomeDone()">
              Get Started!
            </v-btn>
          </div>
          <div style="position: absolute; bottom: 50px; justify-self: anchor-center; z-index: 2; font-size: 14px">
            Need a refresher? You can always revisit this guide via your wallet settings.
          </div>
        </div>
      </v-carousel-item>
    </v-carousel>
    </div>
  </v-dialog>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import assets from '@/utils/assets';

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  }
});

const emit = defineEmits(['close']);

const carousel = ref(0);
const text = ref(`<p><strong>Improved Performance & UX</strong></p>
           <p>We've supercharged both backend and frontend performance, making Gero Dashboard faster, smoother, and ready for the future.</p>
           <p>This upgrade lays the foundation for upcoming features like the Gero Crypto Card, Enterprise Multisig Wallet, and the Bitcoin DeFi Portal.</p>`);
watch(() => props.isOpen, (value) => {
  if (!value) {
    setTimeout(() => carousel.value = 0, 2000);
  }
});
const setWelcomeDone = () => {
  emit('close')
};

const setImprovedPerformance = () => {
  text.value = `<p><strong>Improved Performance & UX</strong></p>
           <p>We've supercharged both backend and frontend performance, making Gero Dashboard faster, smoother, and ready for the future.</p>
           <p>This upgrade lays the foundation for upcoming features like the Gero Crypto Card, Enterprise Multisig Wallet, and the Bitcoin DeFi Portal.</p>`
};

const setGeroCard = () => {
  text.value = `<p><strong>Gero Crypto Card (Launching Soon)</strong></p>
                   <p>The future of digital finance is here. Gero Dashboard is proud to bring you the first-ever Cardano non-custodial wallet with direct digital banking integration.</p>
                   <p>Enjoy our limited-time launch promotion with 0% fees on top-ups, monthly fees, and more—exclusively for early users.</p>`
};

const setPerpetuals = () => {
  text.value = `<p><strong>Perpetuals with Strike Finance</strong></p>
                   <p>Take your trading further! You can now open long and short positions on ADA and other Cardano native assets directly inside Gero Dashboard.</p>
                   <p>Powered by Strike Finance, perpetuals are now seamless, secure, and efficient.</p>`
};

const setMultisig = () => {
  text.value = `<p><strong>Enterprise Multisig Wallet</strong></p>
                   <p>Managing business funds on Cardano just got easier. Our Enterprise Multisig Wallet is built for small and medium-sized teams who value security and collaboration.</p>
                   <p>With built-in in-app messaging and an intuitive experience, handling treasury operations is finally simple, professional, and worry-free.</p>`
};

const setMoreCashback = () => {
  text.value = `<p><strong>More Cashback Deals!</strong></p>
                   <p>Shop, swap, and save! We've expanded our cashback offers, giving you even more ways to earn ADA when purchasing digitally from your favorite stores.</p>
                   <p>Explore the new Cashback Page to find deals tailored just for you.</p>`
};
</script>
<style scoped>

</style>
