<template>
  <v-dialog style="opacity: 0.9" max-width="1000" content-class="rounded-xxl dialogStyle transparent90" :persistent="true" v-model="welcomeScreenDialog">
    <v-carousel v-model="carousel" height="500" :continuous="false">
      <v-carousel-item>
        <v-card style="position: relative; display: grid;">
          <video :src="require('@/assets/video/welcome.mp4')" playsinline autoplay muted loop
                 style="width: 100%; min-height: 500px; grid-column: 1; z-index: 1;
  grid-row: 1; object-fit: cover; object-position: center bottom; left: 0; top: 0;">
            Your browser does not support the video tag.
          </video>

          <div style="grid-column: 1; grid-row: 1; z-index: 2; align-content: center; justify-self: center; margin-left: -190px; margin-bottom:20px">
            <div class="mb-4" style="color: white; font-size: 13px; text-shadow: #ffffff 0 0 5px;">
              Welcome to your new single pane of glass
            </div>
            <div style="max-height: 70px; height: 100%">
              <img style="height: 100%" :src="require('@/assets/gero-logo.svg')" alt="Gero Logo" />
              <img style="height: 100%" class="ml-6" :src="require('@/assets/gero-dashboard.svg')" alt="Gero Dashboard" />
            </div>
          </div>
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
                    <v-list-item link @mouseenter="setNewDesign" class="my-3 px-0" style="background-color: #0F0F0F; border-radius: 12px;">
                      <img style="height: 54px" :src="require('@/shared/assets/welcome/new_design.png')" alt="New Design">
                      <v-list-item-title class="text-center">
                        All New Design
                      </v-list-item-title>
                    </v-list-item>
                    <v-list-item link @mouseenter="setCashback" class="my-3 px-0" style="background-color: #0F0F0F; border-radius: 12px">
                      <img style="height: 54px" :src="require('@/shared/assets/welcome/cashback.png')" alt="New Design">
                      <v-list-item-title class="text-center">
                        Cashback
                      </v-list-item-title>
                    </v-list-item>
                    <v-list-item link @mouseenter="setGovernance" class="my-3 px-0" style="background-color: #0F0F0F; border-radius: 12px">
                      <img style="height: 54px" :src="require('@/shared/assets/welcome/governance.png')" alt="New Design">
                      <v-list-item-title class="text-center">
                        Governance
                      </v-list-item-title>
                    </v-list-item>
                    <v-list-item link @mouseenter="setMoreSecure" class="my-3 px-0" style="background-color: #0F0F0F; border-radius: 12px">
                      <img style="height: 54px" :src="require('@/shared/assets/welcome/cardano_shield.png')" alt="New Design">
                      <v-list-item-title class="text-center">
                        More Secure
                      </v-list-item-title>
                    </v-list-item>
                    <v-list-item link @mouseenter="setUpToDate" class="my-3 px-0" style="background-color: #0F0F0F; border-radius: 12px">
                      <img style="height: 54px" :src="require('@/shared/assets/welcome/blog.png')" alt="New Design">
                      <v-list-item-title class="text-center">
                        Stay up to date
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
          <div style="width: 300px; position: relative; text-align: center; color: white; font-size: 16px; font-weight: 500; line-height: 20px; word-wrap: break-word">
            Send, Receive, Swap & Buy are all available in the quick action menu on your main dashboard screen
          </div>
          <table class="mt-8">
            <tbody>
            <tr>
              <td class="text-right" style="width: 33%">
                <p style="color: #00DFF3; font-size: 16px; word-wrap: break-word">
                  Quick Send
                </p>
                <p style="color: white; font-size: 14px; font-weight: 300; word-wrap: break-word">
                  Send ADA or other assets to another wallet
                </p>
              </td>
              <td rowspan="2" style="max-width: 200px; min-width: 200px; place-items: center;">
                <v-card flat style="max-width: 200px; min-width: 200px;height: 250px; background-color: black!important;" class="mx-4 dialogStyle">
                  <v-card-text class="d-flex justify-space-between align-content-space-between pa-0 fill-height">
                    <v-row no-gutters>
                      <v-col cols="6" class="pa-2" style="align-content: center;">
                        <v-layout column style="align-items: center">
                          <v-btn text plain class="px-0" height="60" width="60">
                            <v-hover v-slot="{hover}">
                              <v-avatar tile :size="hover ? 60 : 50">
                                <v-img
                                  :src="require('@/assets/svg/send.svg')"
                                  alt="Send"
                                  contain
                                  style="
                      filter: invert(83%) sepia(48%) saturate(3753%) hue-rotate(133deg) brightness(92%) contrast(108%);
                    "
                                ></v-img>
                              </v-avatar>
                            </v-hover>

                          </v-btn>
                          <span>Send</span>
                        </v-layout>
                      </v-col>
                      <v-col cols="6" class="pa-2" style="align-content: center;">
                        <v-layout column style="align-items: center">
                          <v-btn text plain class="px-0" height="60" width="60">
                            <v-hover v-slot="{hover}">
                              <v-avatar tile :size="hover ? 60 : 50">
                                <v-img
                                  :src="require('@/assets/svg/qr-code.svg')"
                                  alt="Receive"
                                  contain
                                  style="
                        filter: invert(83%) sepia(16%) saturate(992%) hue-rotate(92deg) brightness(94%) contrast(92%);
                      "
                                ></v-img>
                              </v-avatar>
                            </v-hover>
                          </v-btn>
                          <span>Receive</span>
                        </v-layout>
                      </v-col>
                      <v-col cols="6" class="pa-2" style="align-content: center;">
                        <v-layout column style="align-items: center">
                          <v-btn text plain class="px-0" height="60" width="60">
                            <v-hover v-slot="{hover}">
                              <v-avatar tile :size="hover ? 60 : 50">
                                <v-img
                                  :src="require('@/assets/svg/swap.svg')"
                                  alt="Swap"
                                  contain
                                  style="
                        filter: invert(62%) sepia(76%) saturate(306%) hue-rotate(314deg) brightness(105%) contrast(98%);
                      "
                                ></v-img>
                              </v-avatar>
                            </v-hover>
                          </v-btn>
                          <span>Swap</span>
                        </v-layout>
                      </v-col>
                      <v-col cols="6" class="pa-2" style="align-content: center;">
                        <v-layout column style="align-items: center">
                          <v-btn
                            text
                            plain
                            class="px-0"
                            height="60"
                            width="60"
                          >
                            <v-hover v-slot="{hover}">
                              <v-avatar tile :size="hover ? 60 : 50">
                                <v-img :src="require('@/assets/svg/dollar-shield.svg')" alt="Buy" contain></v-img>
                              </v-avatar>
                            </v-hover>
                          </v-btn>
                          <span>Buy</span>
                        </v-layout>
                      </v-col>
                    </v-row>
                  </v-card-text>
                </v-card>
              </td>
              <td style="width: 33%">
                <p style="color: #75E0A7; font-size: 16px; word-wrap: break-word">
                  Receive
                </p>
                <p style="color: white; font-size: 14px; font-weight: 300; word-wrap: break-word">
                  Receive ADA by displaying your wallet address and QR code.
                </p>
              </td>
            </tr>
            <tr>
              <td class="text-right">
                <p style="color: #FDA29B; font-size: 16px; font-weight: 300; word-wrap: break-word">
                  Swap
                </p>
                <p style="color: white; font-size: 14px; font-weight: 300; word-wrap: break-word">
                  Effortlessly exchange tokens directly from your wallet
                </p>
              </td>
              <td>
                <p style="color: #FFF59E; font-size: 16px; word-wrap: break-word">
                  Buy ADA
                </p>
                <p style="color: white; font-size: 14px; font-weight: 300; word-wrap: break-word">
                  With Moonpay, you can buy using your credit card and receive it directly into your wallet
                </p>
              </td>
            </tr>
            </tbody>
          </table>
        </div>
      </v-carousel-item>
      <v-carousel-item>
        <v-img :src="require('@/shared/assets/welcome/background.png')" class="pa-8" style="height: 100%" >
          <div class="text-center">
            <p><strong>Our mission is to unify Web2 and Web3</strong></p>
            <p>We have many things in store, check out our blog posts for the latest news</p>
            <p>We hope you enjoy using Gero Dashboard</p>
          </div>
          <div class="text-center pt-6">
            <span>We are available on social media</span>
            <div>
              <v-btn icon href="https://twitter.com/GeroWallet" target="_blank">
                <v-avatar tile>
                  <v-img :src="require('@/assets/svg/x.svg')" width="16" height="16" alt="x" contain></v-img>
                </v-avatar>
              </v-btn>
              <v-btn icon href="https://discord.com/invite/Wj4EyjNdNb" target="_blank">
                <v-avatar tile>
                  <v-img :src="require('@/assets/svg/discord.svg')" width="16" height="16" alt="discord" contain></v-img>
                </v-avatar>
              </v-btn>
              <v-btn icon href="https://t.me/GeroWallet" target="_blank">
                <v-avatar tile>
                  <v-img :src="require('@/assets/svg/telegram.svg')" width="16" height="16" alt="x" contain></v-img>
                </v-avatar>
              </v-btn>
            </div>
            <v-btn class="geroButton mt-4" x-large style="font-size: 14px" @click="setWelcomeDone(true)">
              Get Started!
            </v-btn>
          </div>
        </v-img>
      </v-carousel-item>
    </v-carousel>
  </v-dialog>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import { mapActions, mapState } from 'pinia';
import { useStore } from '@/store';
import { Blockchain, Network } from '@/models/types';

export default defineComponent({
  name: 'WelcomeDialog',
  computed: {
    ...mapState(useStore, ['welcomeDone', 'loggedWallet']),
    welcomeScreenDialog: {
      get() {
        return !this.welcomeDone && this.loggedWallet.chain == Blockchain.CARDANO && this.loggedWallet.network === Network.MAINNET
      },
      set(value) {
        this.setWelcomeDone(!value);
      }
    },
  },
  methods: {
    ...mapActions(useStore, ['login', 'setWelcomeDone']),
    setNewDesign() {
      this.text = `<p>Experience the completely redesigned<br><strong>Gero Dashboard</strong></p>
           <p>Rebuilt from the ground up with a fresh architecture and user interface.</p>
           <p>This upgrade unlocks new opportunities and capabilities that were previously unattainable.</p>`
    },
    setCashback() {
      this.text = `<p>We've partnered with <strong>Bring</strong>, Cardan's first white-label crypto cashback provider, to integrate crypto cashback directly into the Gero Dashboard.</p>
                   <p>Earn cryptocurrency on everyday purchases from over 750 top retailers</p>`
    },
    setGovernance() {
      this.text = `<p>Engage with Cardano's decentralized governance framework that shapes how network changes and upgrades are implemented.</p>
                   <p>You can delegate to a DRep or choose other voting methods right from the dashboard.</p>`
    },
    setMoreSecure() {
      this.text = `<p>Introducing <strong>Cardano Shield</strong></p>
                   <p>Making the Gero Dashboard the most secure wallet on Cardano.</p>
                   <p>Our superior UX design helps protect even novice users, and we've integrated Xerberus's Risk Rating for added Security.</p>`
    },
    setUpToDate() {
      this.text = `<p>Stay updated with the latest blockchain and Gero news in our new Blogs section.</p>
                   <p>Access content from well known Cardano knowledge bases and top content creators.</p>`
    }
  },
  data: () => ({
    carousel: 0,
    text: `<p>Experience the completely redesigned<br><strong>Gero Dashboard</strong></p>
           <p>Rebuilt from the ground up with a fresh architecture and user interface.</p>
           <p>This upgrade unlocks new opportunities and capabilities that were previously unattainable.</p>`
  }),
});
</script>
<style scoped>

</style>
