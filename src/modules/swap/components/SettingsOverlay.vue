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
        {{ $t('swap.settings') }}
        <v-spacer></v-spacer>
        <v-btn small icon @click="closeOverlay">
          <v-icon>mdi-window-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-card-text class="d-flex justify-space-around justify-center flex-column" style="height: calc(100% - 48px)">
        <div class="d-flex justify-space-between justify-center">
          <span class="d-flex flex-column">
            <span style="font-size: 13px; color: white">{{ $t('swap.slippageTolerance') }}</span>
            <v-btn class="px-0 justify-start" text plain :ripple="false" small
                   style="text-transform: capitalize; word-break: break-word; letter-spacing: normal; font-size: 10px; min-height: 18px;"
                   href="https://www.investopedia.com/terms/s/slippage.asp" target="_blank">
              {{ $t('swap.learnMore') }}
            </v-btn>
          </span>
          <v-btn-toggle mandatory active-class="geroButton" class="transparent" v-model="slippageToleranceType"
                        style="align-items: center;">
            <v-btn small color="black" :value="'auto'" rounded style="text-transform: capitalize; font-size: 10px; min-height: 24px;" class="pa-1">
              {{ $t('swap.auto') }}
            </v-btn>
            <v-btn small color="black" :value="'custom'" rounded style="text-transform: capitalize; font-size: 10px; min-height: 24px;" class="pa-1">
              {{ $t('swap.custom') }}
            </v-btn>
          </v-btn-toggle>
        </div>
        <div class="d-flex justify-center">
          <v-btn-toggle mandatory active-class="geroButton" class="transparent" v-model="slippageTolerance"
                        style="align-items: center;" @change="onSlippageToleranceChange">
            <v-btn rounded :value="0.5" class="pa-1" style="border-color: black!important; font-size: 11px;" height="36"
                   :disabled="automaticSlippage == 'on' || unlimitedSlippage == 'on'">
              0.5
            </v-btn>
            <v-btn rounded :value="1" class="pa-1" style="border-color: black!important; font-size: 11px;" height="36"
                   :disabled="automaticSlippage == 'on' || unlimitedSlippage == 'on'">
              1
            </v-btn>
            <v-btn rounded :value="2" class="pa-1" style="border-color: black!important; font-size: 11px;" height="36"
                   :disabled="automaticSlippage == 'on' || unlimitedSlippage == 'on'">
              2
            </v-btn>
            <v-btn rounded :value="5" class="pa-1" style="border-color: black!important; height: 36px; font-size: 11px;"
                   :disabled="automaticSlippage == 'on' || unlimitedSlippage == 'on'">
              5
            </v-btn>
            <v-btn rounded :value="-1" class="py-1 px-0" style="border-color: black!important; overflow: hidden; height: 36px"
                   :disabled="automaticSlippage == 'on' || slippageToleranceType == 'auto' || unlimitedSlippage == 'on'">
              <v-text-field
                v-model="customSlippageTolerance"
                :disabled="automaticSlippage == 'on' || slippageToleranceType == 'auto' || unlimitedSlippage == 'on'"
                :class="slippageTolerance === -1 ? 'centered-input transparent text-black' : automaticSlippage == 'on' || slippageToleranceType == 'auto' || unlimitedSlippage == 'on' ? 'centered-input transparent text-white opacity' : 'centered-input transparent text-white'"
                dense
                solo
                hide-details
                height="32"
                style="border-top-left-radius: 0; border-bottom-left-radius: 0; height: 34px; border: 1px solid black; font-size: 11px;"
                type="number"
                hide-spin-buttons
                :min="0"
                :max="100">
                <template v-slot:append>
                  <span
                    :style="slippageTolerance === -1 ? {color: 'black', fontSize: '11px'} : automaticSlippage == 'on' || slippageToleranceType == 'auto' || unlimitedSlippage == 'on' ? {color: 'white', opacity: '0.3', fontSize: '11px'} : {color: 'white', fontSize: '11px'}">%</span>
                </template>
              </v-text-field>
            </v-btn>
          </v-btn-toggle>
        </div>
        <div class="d-flex justify-space-between justify-center">
                        <span class="d-flex flex-column">
                          <span style="font-size: 13px; color: white">{{ $t('swap.unlimitedSlippage') }}</span>
                          <v-tooltip
                            v-model="unlimitedSlippageTooltipEnabled"
                            bottom
                          >
                            <template v-slot:activator="{ }">
                              <v-btn class="px-0 justify-start" text plain :ripple="false" small
                                     style="text-transform: capitalize; word-break: break-word; letter-spacing: normal; font-size: 10px; min-height: 18px;"
                                     @click="unlimitedSlippageTooltipEnabled = true"
                                     v-click-outside="disableUnlimitedSlippageTooltip">
                                {{ $t('swap.learnMore') }}
                              </v-btn>
                            </template>
                            <div style="width: 190px; word-break: break-word; font-size: 10px;">
                              {{ $t('swap.unlimitedSlippageWarning') }}
                            </div>
                          </v-tooltip>
                        </span>
          <v-btn-toggle mandatory active-class="geroButton" class="transparent" v-model="unlimitedSlippage"
                        style="align-items: center;" @change="unlimitedSlippageChange">
            <v-btn small color="black" :value="'off'" rounded style="text-transform: capitalize; font-size: 10px; min-height: 24px;" class="pa-1">
              OFF
            </v-btn>
            <v-btn small color="black" :value="'on'" rounded style="text-transform: capitalize; font-size: 10px; min-height: 24px;" class="pa-1"
                   :disabled="automaticSlippage === 'on'">
              ON
            </v-btn>
          </v-btn-toggle>
        </div>
        <div class="d-flex justify-space-between justify-center">
                        <span class="d-flex flex-column">
                          <span style="font-size: 13px; color: white">Automatic Slippage</span>
                          <v-tooltip
                            v-model="automaticSlippageTooltipEnabled"
                            bottom
                          >
                            <template v-slot:activator="{ }">
                              <v-btn class="px-0 justify-start" text plain :ripple="false" small
                                     style="text-transform: capitalize; word-break: break-word; letter-spacing: normal; font-size: 10px; min-height: 18px;"
                                     @click="automaticSlippageTooltipEnabled = true"
                                     v-click-outside="disableAutomaticSlippageTooltip">
                                {{ $t('common.learnMore') }}
                              </v-btn>
                            </template>
                            <div style="width: 190px; word-break: break-word; font-size: 10px;">
                              {{ $t('swap.slippageToleranceDescription') }}
                            </div>
                          </v-tooltip>
                        </span>
          <v-btn-toggle mandatory active-class="geroButton" class="transparent" v-model="automaticSlippage"
                        style="align-items: center;">
            <v-btn small color="black" :value="'off'" rounded style="text-transform: capitalize; font-size: 10px; min-height: 24px;" class="pa-1">
              OFF
            </v-btn>
            <v-btn small color="black" :value="'on'" rounded style="text-transform: capitalize; font-size: 10px; min-height: 24px;" class="pa-1"
                   :disabled="unlimitedSlippage === 'on'">
              ON
            </v-btn>
          </v-btn-toggle>
        </div>
      </v-card-text>
    </v-card>
  </v-overlay>
</template>
<script setup lang="ts">
import { ref, computed, watch } from 'vue';

interface Props {
  value?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  input: [value: boolean];
  setSlippage: [value: string];
}>();

const customSlippage = ref(2);
const slippageTolerance = ref(2);
const slippageToleranceType = ref('auto');
const unlimitedSlippage = ref('off');
const automaticSlippage = ref('off');
const unlimitedSlippageTooltipEnabled = ref(false);
const automaticSlippageTooltipEnabled = ref(false);

const slippage = computed(() => {
  if (automaticSlippage.value === 'on') {
    return 'auto';
  } else if (unlimitedSlippage.value === 'on') {
    return 'unlimited';
  } else if (slippageTolerance.value == -1) {
    return customSlippageTolerance.value.toString();
  }
  return slippageTolerance.value.toString();
});

const customSlippageTolerance = computed({
  get() {
    return customSlippage.value;
  },
  set(val: any) {
    if (val === '') {
      val = 0;
    }
    let num = Number(val);
    if (num > 100) {
      num = 100;
    }
    customSlippage.value = num;
  }
});

const disableUnlimitedSlippageTooltip = () => {
  if (unlimitedSlippageTooltipEnabled.value) {
    unlimitedSlippageTooltipEnabled.value = false;
  }
};

const disableAutomaticSlippageTooltip = () => {
  if (automaticSlippageTooltipEnabled.value) {
    automaticSlippageTooltipEnabled.value = false;
  }
};

const onSlippageToleranceChange = (val: number) => {
  if (val != -1) {
    customSlippageTolerance.value = val;
  }
};

const unlimitedSlippageChange = (val: string) => {
  if (val === 'on') {
    customSlippage.value = -1;
  } else {
    customSlippage.value = 2;
  }
};

const closeOverlay = () => {
  emit('input', false);
};

watch(slippage, (val) => {
  emit('setSlippage', val);
});
</script>
<style scoped>

</style>
