<template>
  <v-card class="transparent" flat v-if="selectedToken">
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
        <v-card class="card-container px-2 py-1" outlined :style="{ backgroundColor: backgroundColor + '!important' }">
          <v-card-subtitle class="pa-0 text-right" style="margin-bottom: -10px">
            Balance: {{ balance }}
          </v-card-subtitle>
          <v-card-text style="display: flex" class="pa-0">
            <v-list-item two-line class="px-0" style="flex-basis: min-content; text-align: left">
              <v-list-item-content class="py-0">
                <v-list-item-title class="ma-0">
                  <span v-if="tokenLock" style="font-size: 22px">
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
                      <v-avatar size="40">
                        <img :src="selectedToken.img" :alt="`${selectedToken.ticker} Logo`" />
                      </v-avatar>
                    </v-badge>
                    <v-avatar size="40" v-else class="mr-1">
                      <img :src="selectedToken.img" :alt="`${selectedToken.ticker} Logo`" />
                    </v-avatar>
                    {{ selectedToken.ticker }}
                  </span>
                  <v-btn
                    v-else
                    x-large
                    text
                    plain
                    :ripple="false"
                    style="font-size: 22px; letter-spacing: normal"
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
                      <v-avatar size="40">
                        <img :src="selectedToken.img" :alt="`${selectedToken.ticker} Logo`" />
                      </v-avatar>
                    </v-badge>
                    <v-avatar size="40" v-else class="mr-1">
                      <img :src="selectedToken.img" :alt="`${selectedToken.ticker} Logo`" />
                    </v-avatar>
                    {{ selectedToken.ticker }}
                    <v-icon v-if="!tokenLock" class="toggleUpDown" :class="{ rotate: selectTokenDialog }" small
                      >mdi-chevron-down</v-icon
                    >
                  </v-btn>
                </v-list-item-title>
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
                    :maximum="Number(selectedToken.balance)"
                    :decimals="selectedToken.decimals"
                    :minimum="minimum"
                    :read-only="readOnly"
                    @change="quantityChange"
                  ></CurrencyTextField>
                </v-list-item-title>
                <v-list-item-subtitle class="light-text error-text" v-if="adaShortage !== 0">
                  Insufficient Funds
                </v-list-item-subtitle>
                <v-list-item-subtitle
                  class="light-text"
                  :style="priceImpact > 3 ? 'color: #FEC84B !important' : ''"
                  v-else-if="!isNaN(+price.replaceAll(',', ''))"
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
    ></SelectTokenDialog>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import filters from '@/shared/utils/filters';
import CurrencyTextField from '@/shared/components/CurrencyTextField.vue';
import SelectTokenDialog from '@/shared/components/SelectTokenDialog.vue';
import { useDebounceFn } from '@vueuse/core';
import { Token } from '@/shared/models/tokens';

interface Props {
  title?: string;
  titleColor?: string;
  value?: Token;
  available?: Token[];
  index?: number;
  bottomTitle?: boolean;
  backgroundColor?: string;
  maxButtonEnabled?: boolean;
  readOnly?: boolean;
  price?: string;
  minimum?: number;
  priceImpact?: number;
  adaShortage?: number;
  tokenLock?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  titleColor: 'white',
  bottomTitle: false,
  backgroundColor: '#292929',
  maxButtonEnabled: false,
  readOnly: false,
  minimum: 0,
  priceImpact: 0,
  adaShortage: 0,
  tokenLock: false,
});

const emit = defineEmits<{
  (e: 'input', value: Token): void;
  (e: 'change', value: string | number): void;
  (e: 'setMax', index: number): void;
  (e: 'remove', index: number): void;
}>();

const selectTokenDialog = ref(false);

const balance = computed(() => {
  if (props.value?.decimals) {
    return filters.toCurrency(props.value.balance, false, props.value.decimals, '', '', false, props.value.decimals);
  }
  return props.value?.balance ? String(props.value.balance) : '';
});

const selectedToken = computed({
  get: () => props.value,
  set: (newToken: Token | undefined) => {
    if (newToken) {
      if (props.minimum > +newToken.quantity) {
        newToken.quantity = props.minimum;
      }
      emit('input', newToken);
    }
  },
});

const quantityChange = (val: string | number) => {
  emit('change', val ? String(val).replace(/^0+/, '') : '0');
};

const setMax = () => {
  if (selectedToken.value) {
    selectedToken.value.quantity = Number(balance.value.replaceAll(',', ''));
  }
};

const removeTokenSelector = () => {
  emit('remove', props.index ?? 0);
};

const setMinValue = () => {
  const debouncedSetMinValue = useDebounceFn(() => {
    if (selectedToken.value) {
      selectedToken.value.quantity = props.minimum || 0;
    }
  }, 300);
  debouncedSetMinValue();
};

watch(
  () => props.value,
  val => {
    if (val && props.minimum > Number(val.quantity || 0)) {
      setMinValue();
    }
  }
);

watch(
  () => props.minimum,
  val => {
    if (val && props.value && val > Number(props.value.quantity || 0)) {
      setMinValue();
    }
  }
);
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

.error-text {
  color: #f97066 !important;
}

.v-text-field.v-text-field--solo:not(.v-text-field--solo-flat) > .v-input__control > .v-input__slot {
  box-shadow: none !important;
}

.large-input >>> input {
  font-size: 22px;
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
