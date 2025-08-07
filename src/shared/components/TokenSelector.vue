<template>
  <div
    class="transparent"
    flat
    v-if="selectedToken"
    style="box-shadow: unset !important; background-color: transparent !important; backdrop-filter: unset !important"
  >
    <v-card-text style="display: flex; flex-direction: column" class="pa-0">
      <v-row no-gutters class="pb-1" v-if="!bottomTitle">
        <v-col cols="12" style="display: flex; align-items: center">
          <span v-if="title" :style="{ color: titleColor }">{{ title }}</span>
          <v-spacer></v-spacer>
          <v-btn
            text
            plain
            small
            @click="setMax"
            :ripple="false"
            color="#00DFF3"
            class="px-0"
            v-if="maxButtonEnabled"
            :style="index !== 0 ? { marginRight: '30px' } : {}"
            >MAX</v-btn
          >
          <span v-else style="height: 10px"></span>
        </v-col>
      </v-row>
      <div style="display: flex; align-items: center">
        <v-card
          class="card-container px-2 py-1"
          outlined
          :style="{
            backgroundColor: backgroundColor + '!important',
            paddingTop: '0!important',
            paddingBottom: '0!important',
          }"
        >
          <!--        <v-card-subtitle class="text-right pb-0 pt-2">Balance: {{ selectedToken.balance | toCurrency(false,2,'', true, selectedToken.decimals) }}</v-card-subtitle>-->
          <v-card-subtitle class="pa-0 text-right" style="margin-bottom: -10px">
            Balance: {{ balance }}
          </v-card-subtitle>
          <v-card-text style="display: flex" class="pa-0">
            <v-list-item two-line class="px-0" style="flex-basis: min-content; text-align: left">
              <v-list-item-content class="py-0">
                <v-list-item-title class="ma-0">
                  <span v-if="tokenLock" style="font-size: 18px">
                    <v-badge
                      overlap
                      avatar
                      color="transparent"
                      :offset-y="45"
                      v-if="selectedToken.verified"
                      class="mr-1"
                    >
                      <template v-slot:badge>
                        <v-avatar color="transparent" tile>
                          <v-icon small color="primary"> mdi-check-decagram </v-icon>
                        </v-avatar>
                      </template>
                      <v-avatar size="30">
                        <img :src="selectedToken.img" :alt="`${selectedToken.ticker} Logo`" @error="handleImageError" />
                      </v-avatar>
                    </v-badge>
                    <v-avatar size="30" v-else class="mr-1">
                      <img :src="selectedToken.img" :alt="`${selectedToken.ticker} Logo`" @error="handleImageError" />
                    </v-avatar>
                    {{ selectedToken.ticker }}
                  </span>
                  <v-btn
                    v-else
                    large
                    text
                    plain
                    :ripple="false"
                    style="font-size: 18px; letter-spacing: normal"
                    class="pa-0"
                    @click="selectTokenDialog = true"
                  >
                    <v-badge
                      overlap
                      avatar
                      color="transparent"
                      :offset-y="45"
                      v-if="selectedToken.verified"
                      class="mr-1"
                    >
                      <template v-slot:badge>
                        <v-avatar color="transparent" tile>
                          <v-icon small color="primary"> mdi-check-decagram </v-icon>
                        </v-avatar>
                      </template>
                      <v-avatar size="30">
                        <img :src="selectedToken.img" :alt="`${selectedToken.ticker} Logo`" @error="handleImageError" />
                      </v-avatar>
                    </v-badge>
                    <v-avatar size="30" v-else class="mr-1">
                      <img :src="selectedToken.img" :alt="`${selectedToken.ticker} Logo`" @error="handleImageError" />
                    </v-avatar>
                    {{ selectedToken.ticker }}
                    <v-icon v-if="!tokenLock" class="toggleUpDown" :class="{ rotate: selectTokenDialog }" small
                      >mdi-chevron-down</v-icon
                    >
                  </v-btn>
                </v-list-item-title>

                <!--              <v-menu-->
                <!--                style="background-color: black"-->
                <!--                offset-y-->
                <!--                transition="scroll-y-transition"-->
                <!--                :close-on-click="true"-->
                <!--                :close-on-content-click="false"-->

                <!--              >-->
                <!--                <template v-slot:activator="{ on, attrs, value }">-->
                <!--                  -->
                <!--                </template>-->
                <!--                <v-list dense class="pa-0">-->
                <!--                  <v-subheader class="px-0">-->
                <!--                    <v-text-field dense filled hide-details prepend-inner-icon="mdi-magnify"></v-text-field>-->
                <!--                  </v-subheader>-->
                <!--                  <v-list-item-group v-model="selectedToken" mandatory>-->
                <!--                    <v-list-item v-for="(item, index) in available" :key="index" :value="item">-->
                <!--                      <v-list-item-avatar size="20">-->
                <!--                        <img :src="item.img" :alt="`${selectedToken.ticker} Logo`"/>-->
                <!--                      </v-list-item-avatar>-->
                <!--                      <v-list-item-title class="text-center">{{ item.name }}</v-list-item-title>-->
                <!--                      <v-list-item-subtitle class="text-center">{{ item.ticker }}</v-list-item-subtitle>-->
                <!--                    </v-list-item>-->
                <!--                  </v-list-item-group>-->
                <!--                </v-list>-->
                <!--              </v-menu>-->
                <v-list-item-subtitle class="light-text">
                  {{ selectedToken.name }}
                </v-list-item-subtitle>
              </v-list-item-content>
            </v-list-item>
            <v-list-item two-line class="px-0" style="flex-basis: max-content; text-align: right">
              <v-list-item-content class="py-0">
                <v-list-item-title>
                  <CurrencyTextField
                    v-model="selectedToken.quantity"
                    :decimals="selectedToken.decimals"
                    :read-only="readOnly"
                    @change="quantityChange"
                    :rules="[
                      rules.required(),
                      v => parseFloat(v) <= Number(selectedToken.balance) || 'Insufficient Funds',
                      v => parseFloat(v) > minimum || `Minimum Required ${minimum}`,
                    ]"
                    :text-right="true"
                    :is-quantity="false"
                  />
                </v-list-item-title>
                <v-list-item-subtitle class="light-text" v-if="adaShortage !== 0" style="color: #f97066 !important">
                  Insufficient Funds
                  <!--                  Shortage: {{ adaShortage | toCurrency(false, 3, '', ' '+selectedToken.ticker, true, 0) }}-->
                </v-list-item-subtitle>
                <v-list-item-subtitle
                  class="light-text"
                  v-else-if="
                    selectedToken.ticker ===
                      networks.resolveCurrencyTicker(loggedWallet?.chain, loggedWallet?.network) &&
                    minimum > selectedToken.quantity
                  "
                  style="color: #f97066 !important"
                >
                  <v-btn
                    class="pa-0"
                    :ripple="false"
                    color="error"
                    text
                    plain
                    x-small
                    style="text-transform: unset; letter-spacing: normal; font-size: 14px"
                    @click="selectedToken.quantity = minimum + ''"
                  >
                    Min. Required: {{ minimum + ' ' + selectedToken.ticker }}
                  </v-btn>
                </v-list-item-subtitle>
                <v-list-item-subtitle
                  class="light-text"
                  :style="priceImpact > 3 ? { color: '#FEC84B!important' } : {}"
                  v-else-if="!isNaN(price.replaceAll(',', ''))"
                >
                  {{ '~$' + price
                  }}<v-icon x-small style="margin-bottom: 1px; margin-left: 1px" v-if="priceImpact > 3" color="#FEC84B"
                    >mdi-alert-rhombus-outline</v-icon
                  >
                </v-list-item-subtitle>
              </v-list-item-content>
            </v-list-item>
          </v-card-text>
        </v-card>
        <v-btn icon small @click="removeTokenSelector" v-if="index !== 0" class="ml-1">
          <v-icon small color="#00DFF3">mdi-minus-box-outline</v-icon>
        </v-btn>
      </div>
    </v-card-text>
    <v-card-actions class="px-0" v-if="bottomTitle">
      <span v-if="title" :style="{ color: titleColor }">{{ title }}</span>
      <v-spacer></v-spacer>
      <span style="color: #667085">Balance: {{ balance }}</span>
    </v-card-actions>
    <SelectTokenDialog
      v-model="selectedToken"
      :is-open="selectTokenDialog"
      @close="selectTokenDialog = false"
      :available-tokens="available"
      :search-mechanism="search"
    ></SelectTokenDialog>
  </div>
</template>
<script setup lang="ts">
import { ref, watch, computed, toRefs } from 'vue';
import filters from '@/shared/utils/filters';
import CurrencyTextField from '@/shared/components/CurrencyTextField.vue';
import SelectTokenDialog from '@/shared/components/SelectTokenDialog.vue';
import networks from '@/utils/networks';
import rules from '@/utils/rules';
import { walletStore } from '@/stores/walletStore';

const props = defineProps({
  title: {
    type: String,
  },
  titleColor: {
    type: String,
    default: 'white',
  },
  value: {
    type: Object,
    required: false,
  },
  available: {
    type: Array,
  },
  index: {
    type: Number,
  },
  bottomTitle: {
    type: Boolean,
    default: false,
  },
  backgroundColor: {
    type: String,
    default: '#292929',
  },
  maxButtonEnabled: {
    type: Boolean,
    default: false,
  },
  readOnly: {
    type: Boolean,
    default: false,
  },
  price: {
    type: String,
  },
  minimum: {
    type: Number,
    default: 0,
  },
  priceImpact: {
    type: Number,
    default: 0,
  },
  adaShortage: {
    type: Number,
    default: 0,
  },
  tokenLock: {
    type: Boolean,
    default: false,
  },
  search: {
    type: Function,
  },
});
const emit = defineEmits(['input', 'change', 'setMax', 'remove']);

const { loggedWallet } = toRefs(walletStore);

const selectTokenDialog = ref<boolean>(false);
const amount = ref('');

const selectedToken: any = computed({
  get() {
    return props.value;
  },
  set(newToken) {
    emit('input', newToken);
  },
});

const balance = computed(() => {
  if (selectedToken.value.decimals) {
    return filters.toCurrency(
      selectedToken.value.balance,
      false,
      selectedToken.value.decimals,
      '',
      '',
      false,
      selectedToken.value.decimals
    );
  }
  return selectedToken.value.balance + '';
});

const errors = computed(() => {
  const errors = [];
  if (props.adaShortage !== 0) {
    errors.push(
      `Insufficient Funds. Shortage: ${filters.toCurrency(
        props.adaShortage,
        false,
        3,
        '',
        ' ' + selectedToken.value.ticker,
        true,
        0
      )}`
    );
  } else if (
    selectedToken.value.ticker ===
      networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network) &&
    props.minimum > selectedToken.value.quantity
  ) {
    errors.push(`Min. Required: ${props.minimum + ' ' + selectedToken.value.ticker}`);
  }
  return errors;
});

function quantityChange(val) {
  emit('change', val ? val.replace(/^0+/, '') : 0);
}

function setMax() {
  // emit('setMax', props.index)
  selectedToken.value.quantity = balance.value.replaceAll(',', '');
}

function removeTokenSelector() {
  emit('remove', props.index);
}

watch(props.value, val => {
  selectedToken.value = val;
});

function handleImageError(event) {
  event.target.onerror = null;
  event.target.src = selectedToken.value.fallback_img;
}
</script>
<style scoped>
.card-container {
  border-radius: 10px !important;
  border-color: #00dff3 !important;
  box-shadow: 0 0 0 5px #00dff32a !important;
}

.light-text {
  color: #61646c !important;
  height: 21px;
}

.v-text-field.v-text-field--solo:not(.v-text-field--solo-flat) > .v-input__control > .v-input__slot {
  box-shadow: none !important;
}

.large-input >>> input {
  font-size: 18px;
  font-weight: 500;
  padding: 0;
}

.v-text-field--outlined .v-input__prepend-outer,
.v-text-field--outlined .v-input__append-outer {
  margin-top: 9px !important;
}

.v-application--is-ltr .v-input__prepend-outer {
  margin-right: 4px !important;
}

.v-application--is-ltr .v-input__append-outer {
  margin-left: 4px !important;
}

.theme--dark.v-text-field--solo.transparent > .v-input__control > .v-input__slot {
  background: #ffffff00 !important;
}
</style>
