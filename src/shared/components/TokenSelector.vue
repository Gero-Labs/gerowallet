<template>
  <v-card class="transparent" flat v-if="selectedToken">
    <v-card-text style="display: flex; flex-direction: column" class="pa-0">
      <v-row no-gutters class="pb-1">
        <v-col cols="12" style="display: flex">
          <v-spacer></v-spacer>
          <span style="color: #667085">Balance: {{ balance }}</span>
        </v-col>
      </v-row>
      <v-card class="card-container px-2 py-1" outlined>
<!--        <v-card-subtitle class="text-right pb-0 pt-2">Balance: {{ selectedToken.balance | toCurrency(false,2,'', true, selectedToken.decimals) }}</v-card-subtitle>-->
        <v-card-text style="display: flex" class="pa-0">
          <v-list-item two-line class="px-0" style="flex-basis: min-content; text-align: left;">
            <v-list-item-content class="py-0">
              <v-menu
                style="background-color: black"
                offset-y
                transition="scroll-y-transition"
                :close-on-click="true"
                :close-on-content-click="false"

              >
                <template v-slot:activator="{ on, attrs, value }">
                  <v-list-item-title class="ma-0">
                    <v-btn
                      x-large
                      text
                      plain
                      :ripple="false"
                      v-bind="attrs"
                      v-on="on"
                      style="font-size: 22px; letter-spacing: normal"
                      class="pa-0"
                    >
                      <v-avatar size="24">
                        <img :src="selectedToken.img" :alt="`${selectedToken.ticker} Logo`"/>
                      </v-avatar>
                      &nbsp;{{ selectedToken.ticker }}&nbsp;
                      <v-icon class="toggleUpDown" :class="{ rotate: value }" small>mdi-chevron-down</v-icon>
                    </v-btn>
                  </v-list-item-title>
                </template>
                <v-list dense class="pa-0">
                  <v-subheader class="px-0">
                    <v-text-field dense filled hide-details prepend-inner-icon="mdi-magnify"></v-text-field>
                  </v-subheader>
                  <v-list-item-group v-model="selectedToken" mandatory>
                    <v-list-item v-for="(item, index) in available" :key="index" :value="item">
                      <v-list-item-avatar size="20">
                        <img :src="item.img" :alt="`${selectedToken.ticker} Logo`"/>
                      </v-list-item-avatar>
                      <v-list-item-title class="text-center">{{ item.name }}</v-list-item-title>
                      <v-list-item-subtitle class="text-center">{{ item.ticker }}</v-list-item-subtitle>
                    </v-list-item>
                  </v-list-item-group>
                </v-list>
              </v-menu>
              <v-list-item-subtitle class="light-text">
                {{ selectedToken.name }}
              </v-list-item-subtitle>
            </v-list-item-content>
          </v-list-item>
          <v-list-item two-line class="px-0" style="flex-basis: max-content; text-align: right;">
            <v-list-item-content class="py-0">
              <v-list-item-title>
                <CurrencyTextField v-model="selectedToken.quantity" :maximum="selectedToken.decimals === 0 ? selectedToken.balance : selectedToken.balance / Math.pow(10, selectedToken.decimals)"></CurrencyTextField>
              </v-list-item-title>
              <v-list-item-subtitle class="light-text">
                {{ '~$' + (selectedToken.ticker === 'ADA' ? (Number(selectedToken.quantity) * price.lastPrice).toLocaleString() : 'N/A') }}
              </v-list-item-subtitle>
            </v-list-item-content>
          </v-list-item>
        </v-card-text>
      </v-card>
    </v-card-text>
    <v-card-actions class="px-0">
      <v-btn text small @click="removeTokenSelector" v-if="index !== 0">
        <v-icon color="#00DFF3">mdi-minus-box-outline</v-icon>&nbsp;Remove
      </v-btn>
      <v-spacer></v-spacer>
      <v-btn text small @click="setMax" color="#00DFF3">MAX</v-btn>
    </v-card-actions>
  </v-card>
</template>
<script>
import filters from '@/shared/utils/filters';
import CurrencyTextField from '@/shared/components/CurrencyTextField.vue';
import { mapState } from 'pinia';
import { useStore } from '@/store';

export default {
  name: 'TokenSelector',
  components: { CurrencyTextField },
  props: {
    value: {
      type: Object,
      required: false,
    },
    available: {
      type: Array,
    },
    index: {
      type: Number,
    }
  },
  filters,
  computed: {
    ...mapState(useStore, ['price']),
    balance() {
      return this.selectedToken.decimals ? (filters.toCurrency(this.selectedToken.balance, false,this.selectedToken.decimals,'', false, this.selectedToken.decimals)) : this.selectedToken.balance+''
    },
    selectedToken: {
      get() {
        return this.value
      },
      set(newToken) {
        this.$emit('input', newToken)
      }
    },
  },
  data() {
    return {
    };
  },
  mounted() {
  },
  methods: {
    setMax() {
      this.selectedToken.quantity = this.balance.replaceAll(",","")
    },
    removeTokenSelector() {
      this.$emit('remove', this.index)
    }
  },
};
</script>
<style scoped>
.card-container {
  background-color: #292929 !important;
  border-radius: 10px !important;
  border-color: #00DFF3 !important;
  box-shadow: 0 0 0 5px #00dff32a !important;

}

.light-text {
  color: #61646C !important;
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
