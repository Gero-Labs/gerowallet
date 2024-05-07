<template>
  <v-card class="transparent" flat>
    <v-card-text style="display: flex; flex-direction: column;" class="pa-0">
      <v-row no-gutters>
        <v-col cols="12" style="display: flex;">
          <span style="color: #FDA29B">Selling</span>
          <v-spacer></v-spacer>
          <span style="color: #667085">Balance: {{ maxQuantity | toCurrency(6) }}</span>
        </v-col>
      </v-row>
      <v-card class="py-1" rounded outlined color="#00DFF3">
        <v-card-text >
          <v-row
              justify="space-between"
          >
            <v-col class="text-left"> 
              <v-menu offset-y transition="scroll-y-transition" max-height="200" :close-on-click="false" :close-on-content-click="false">
                <template v-slot:activator="{ on, attrs, value }">
                  <v-list-item two-line class="px-0">
                    <v-list-item-content class="py-0">
                      <v-list-item-title class="ma-0">
                        <v-btn x-large text v-bind="attrs" v-on="on" :ripple="false" style="font-size: 24px; letter-spacing: normal" class="px-1">
                          <v-avatar size="24">
                            <v-img :src="selectedToken.img"></v-img>
                          </v-avatar>
                          &nbsp;{{selectedToken.ticker}}
                          <v-icon class="toggleUpDown" :class='{ "rotate": value }' small>mdi-chevron-down</v-icon>
                        </v-btn>
                      </v-list-item-title>
                      <v-list-item-subtitle>
                        {{selectedToken.name}}
                      </v-list-item-subtitle>
                    </v-list-item-content>
                  </v-list-item>
                </template>
                <v-text-field hide-details outlined prepend-inner-icon="mdi-magnify"></v-text-field>
                <v-list dense class="pa-0" light style="background-color: #ffffff88;">
                  <v-list-item-group v-model="selectedToken" mandatory >
                    <v-list-item v-for="(item, index) in tokens" :key="index" :value="item">
                      <v-list-item-avatar size="20">
                        <v-img :src="item.img"></v-img>
                      </v-list-item-avatar>
                      <v-list-item-title class="text-center">{{ item.name }}</v-list-item-title>
                    </v-list-item>
                  </v-list-item-group>
                </v-list>
              </v-menu>
            </v-col>
            <v-col class="text-right">
              <v-list-item two-line class="px-0">
                <v-list-item-content class="py-0">
                  <v-list-item-title>
                    <v-text-field
                        solo flat v-model="count" hide-details
                        style="text-align-last: right; text-align: right; font-size: 24px"
                        class="transparent"
                        type="number"
                        hide-spin-buttons
                    ></v-text-field>
                  </v-list-item-title>
                  <v-list-item-subtitle>
                    {{'~$'+ (count * 3.4).toLocaleString() }}
                  </v-list-item-subtitle>
                </v-list-item-content>

              </v-list-item>

<!--              <span class="text-h4 font-weight-light" v-text="count"></span>-->
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>
    </v-card-text>
  </v-card>
</template>
<script>
import filters from "@/shared/utils/filters";

export default {
  props: {
    value: {
      type: Number,
      required: true,
    },
    max: {
      type: Number,
      required: false,
      default: 0,
    },
  },
  filters,
  computed: {
    quantityRules() {
      return [
        v => (v && v >= 1) || 'Quantity Should be Above 1',
        v => (v && v <= this.maxQuantity) || 'Max Quantity Cannot be Above '+this.maxQuantity,
      ]
    },
  },
  data() {
    return {
      selectedToken: {name: 'Cardano', ticker: 'ADA', img: require('@/assets/svg/cardano.svg')},
      tokens: [
        { name: 'Cardano', ticker: 'ADA', img: require('@/assets/svg/cardano.svg') },
        { name: 'Gero', ticker: 'GERO', img: require('@/assets/svg/gero.svg') }
      ],
      count: 0,
      maxQuantity: 0,
    }
  },
  watch: {
    value(val) {
      this.count = val
    },
    max(val) {
      this.maxQuantity = val
    },
    count(val) {
      this.$emit('updateQuantity', val)
    },
    selectedToken(val) {
      console.log(val)
    }
  },
  mounted() {
    this.count = this.value
    this.maxQuantity = this.max
  },
  methods: {

  },
}
</script>
<style>
.v-text-field.v-text-field--enclosed .v-text-field__details, .v-text-field.v-text-field--enclosed:not(.v-text-field--rounded)>.v-input__control>.v-input__slot {
  padding: 0 12!important;
}
.v-text-field.v-text-field--solo:not(.v-text-field--solo-flat)>.v-input__control>.v-input__slot {
  box-shadow: none!important;
}
.large-input >>> input {
  font-size: 22px;
  font-weight: 500;
  padding: 0;
}
.v-text-field--outlined .v-input__prepend-outer, .v-text-field--outlined .v-input__append-outer {
  margin-top: 9px!important;
}
.v-application--is-ltr .v-input__prepend-outer {
  margin-right: 4px!important;
}
.v-application--is-ltr .v-input__append-outer {
  margin-left: 4px!important;
}
.theme--dark.v-text-field--solo.transparent > .v-input__control > .v-input__slot {
  background: #ffffff00!important;
}
</style>