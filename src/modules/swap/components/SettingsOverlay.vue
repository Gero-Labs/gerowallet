<template>
  <v-overlay
    absolute
    :value="value"
    opacity="0.94"
    class="settingsOverlay"
    color="black"
  >
    <v-card class="fill-height transparent">
      <v-card-title>
        <v-btn small icon @click="closeOverlay">
          <v-icon>mdi-cog</v-icon>
        </v-btn>
        <v-spacer></v-spacer>
        Settings
        <v-spacer></v-spacer>
        <v-btn small icon @click="closeOverlay">
          <v-icon>mdi-window-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-card-text class="d-flex justify-space-around justify-center flex-column" style="height: calc(100% - 64px)">
        <div class="d-flex justify-space-between justify-center">
          <span class="d-flex flex-column">
            <span style="font-size: 18px; color: white">Slippage Tolerance</span>
            <v-btn class="px-0 justify-start" text plain :ripple="false" small
                   style="text-transform: capitalize; word-break: break-word; letter-spacing: normal"
                   href="https://www.investopedia.com/terms/s/slippage.asp" target="_blank">
              Learn more
            </v-btn>
          </span>
          <v-btn-toggle mandatory active-class="geroButton" class="transparent" v-model="slippageToleranceType"
                        style="align-items: center;">
            <v-btn small color="black" :value="'auto'" rounded style="text-transform: capitalize" class="pa-2">
              AUTO
            </v-btn>
            <v-btn small color="black" :value="'custom'" rounded style="text-transform: capitalize" class="pa-2">
              CUSTOM
            </v-btn>
          </v-btn-toggle>
        </div>
        <div class="d-flex justify-center">
          <v-btn-toggle mandatory active-class="geroButton" class="transparent" v-model="slippageTolerance"
                        style="align-items: center;" @change="onSlippageToleranceChange">
            <v-btn rounded :value="0.5" class="pa-2" style="border-color: black!important;" height="48"
                   :disabled="automaticSlippage == 'on' || unlimitedSlippage == 'on'">
              0.5
            </v-btn>
            <v-btn rounded :value="1" class="pa-2" style="border-color: black!important;" height="48"
                   :disabled="automaticSlippage == 'on' || unlimitedSlippage == 'on'">
              1
            </v-btn>
            <v-btn rounded :value="2" class="pa-2" style="border-color: black!important;" height="48"
                   :disabled="automaticSlippage == 'on' || unlimitedSlippage == 'on'">
              2
            </v-btn>
            <v-btn rounded :value="5" class="pa-2" style="border-color: black!important; height: 48px"
                   :disabled="automaticSlippage == 'on' || unlimitedSlippage == 'on'">
              5
            </v-btn>
            <v-btn rounded :value="-1" class="py-2 px-0" style="border-color: black!important; height: 48px"
                   :disabled="automaticSlippage == 'on' || slippageToleranceType == 'auto' || unlimitedSlippage == 'on'">
              <v-text-field
                v-model="customSlippageTolerance"
                :disabled="automaticSlippage == 'on' || slippageToleranceType == 'auto' || unlimitedSlippage == 'on'"
                :class="slippageTolerance === -1 ? 'centered-input transparent text-black' : automaticSlippage == 'on' || slippageToleranceType == 'auto' || unlimitedSlippage == 'on' ? 'centered-input transparent text-white opacity' : 'centered-input transparent text-white'"
                dense
                solo
                hide-details
                height="47"
                style="border-top-left-radius: 0; border-bottom-left-radius: 0; height: 48px; border: 1px solid black;"
                type="number"
                hide-spin-buttons
                :min="0"
                :max="100">
                <template v-slot:append>
                  <span
                    :style="slippageTolerance === -1 ? {color: 'black'} : automaticSlippage == 'on' || slippageToleranceType == 'auto' || unlimitedSlippage == 'on' ? {color: 'white', opacity: '0.3'} : {color: 'white'}">%</span>
                </template>
              </v-text-field>
            </v-btn>
          </v-btn-toggle>
        </div>
        <div class="d-flex justify-space-between justify-center">
                        <span class="d-flex flex-column">
                          <span style="font-size: 18px; color: white">Unlimited Slippage</span>
                          <v-tooltip
                            v-model="unlimitedSlippageTooltipEnabled"
                            bottom
                          >
                            <template v-slot:activator="{ }">
                              <v-btn class="px-0 justify-start" text plain :ripple="false" small
                                     style="text-transform: capitalize; word-break: break-word; letter-spacing: normal"
                                     @click="unlimitedSlippageTooltipEnabled = true"
                                     v-click-outside="disableUnlimitedSlippageTooltip">
                                Learn more
                              </v-btn>
                            </template>
                            <div style="width: 253px; word-break: break-word">
                              The order will be filled at any price and with no limits on slippage. Due to price changes from earlier orders, this could result in an unattractive price. Use with caution.
                            </div>
                          </v-tooltip>
                        </span>
          <v-btn-toggle mandatory active-class="geroButton" class="transparent" v-model="unlimitedSlippage"
                        style="align-items: center;" @change="unlimitedSlippageChange">
            <v-btn small color="black" :value="'off'" rounded style="text-transform: capitalize" class="pa-2">
              OFF
            </v-btn>
            <v-btn small color="black" :value="'on'" rounded style="text-transform: capitalize" class="pa-2"
                   :disabled="automaticSlippage === 'on'">
              ON
            </v-btn>
          </v-btn-toggle>
        </div>
        <div class="d-flex justify-space-between justify-center">
                        <span class="d-flex flex-column">
                          <span style="font-size: 18px; color: white">Automatic Slippage</span>
                          <v-tooltip
                            v-model="automaticSlippageTooltipEnabled"
                            bottom
                          >
                            <template v-slot:activator="{ }">
                              <v-btn class="px-0 justify-start" text plain :ripple="false" small
                                     style="text-transform: capitalize; word-break: break-word; letter-spacing: normal"
                                     @click="automaticSlippageTooltipEnabled = true"
                                     v-click-outside="disableAutomaticSlippageTooltip">
                                Learn more
                              </v-btn>
                            </template>
                            <div style="width: 253px; word-break: break-word">
                              The slippage tolerance is automatically adjusted based on the size of the swap to always account for the price impact plus a 1% buffer.
                            </div>
                          </v-tooltip>
                        </span>
          <v-btn-toggle mandatory active-class="geroButton" class="transparent" v-model="automaticSlippage"
                        style="align-items: center;">
            <v-btn small color="black" :value="'off'" rounded style="text-transform: capitalize" class="pa-2">
              OFF
            </v-btn>
            <v-btn small color="black" :value="'on'" rounded style="text-transform: capitalize" class="pa-2"
                   :disabled="unlimitedSlippage === 'on'">
              ON
            </v-btn>
          </v-btn-toggle>
        </div>
      </v-card-text>
    </v-card>
  </v-overlay>
</template>
<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'SettingsOverlay',
  props: {
    value: {
      type: Boolean,
    },
  },
  computed: {
    slippage() {
      if (this.automaticSlippage === 'on') {
        return 'auto'
      } else if (this.unlimitedSlippage === 'on') {
        return 'unlimited'
      } else if (this.slippageTolerance == -1) {
        return this.customSlippageTolerance.toString()
      }
      return this.slippageTolerance.toString()
    },
    customSlippageTolerance: {
      get() {
        return this.customSlippage
      },
      set(val) {
        if (val === '') {
          val = 0
        }
        let num = Number(val)
        if (num > 100) {
          num = 100
        }
        this.customSlippage = num
      }
    },
  },
  watch: {
    slippage(val) {
      this.$emit('setSlippage', val)
    }
  },
  methods: {
    disableUnlimitedSlippageTooltip() {
      if (this.unlimitedSlippageTooltipEnabled) {
        this.unlimitedSlippageTooltipEnabled = false
      }
    },
    disableAutomaticSlippageTooltip() {
      if (this.automaticSlippageTooltipEnabled) {
        this.automaticSlippageTooltipEnabled = false
      }
    },
    onSlippageToleranceChange(val) {
      if (val != -1) {
        this.customSlippageTolerance = val
      }
    },
    unlimitedSlippageChange(val) {
      if (val === 'on') {
        this.customSlippage = -1
      } else {
        this.customSlippage = 2
      }
    },
    closeOverlay() {
      this.$emit('input', false);
    },
  },
  data() {
    return {
      customSlippage: 2,
      slippageTolerance: 2,
      slippageToleranceType: 'auto',
      unlimitedSlippage: 'off',
      automaticSlippage: 'off',
      unlimitedSlippageTooltipEnabled: false,
      automaticSlippageTooltipEnabled: false,
    };
  },
});
</script>
<style scoped>

</style>
