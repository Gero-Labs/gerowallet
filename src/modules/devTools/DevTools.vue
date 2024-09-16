<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
          <v-card-title class="row no-gutters d-flex justify-space-between">
            Tx Cbor Hex to JSON Converter
          </v-card-title>
          <v-card-text>
            <v-row no-gutters>
              <v-col cols="6">
                <v-textarea
                  v-model="txCborHex"
                  outlined
                  hide-details
                >
                </v-textarea>
              </v-col>
              <v-col cols="6" class="px-3">
                {{txJson}}
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" class="pa-2">
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
          <v-card-title class="row no-gutters d-flex justify-space-between">
            WitnsessSet Cbor Hex to JSON Converter
          </v-card-title>
          <v-card-text>
            <v-row no-gutters>
              <v-col cols="6">
                <v-textarea
                  v-model="witnessSetCborHex"
                  outlined
                  hide-details
                >
                </v-textarea>
              </v-col>
              <v-col cols="6" class="px-3">
                {{ witnessSetJson }}
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-layout>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import { Transaction, TransactionWitnessSet } from '@emurgo/cardano-serialization-lib-browser';

export default defineComponent({
  name: 'DevTools',
  computed: {
    txJson() {
      let res = ''
      if (this.tx) {
        return this.tx.to_json()
      }
      return res
    },
    witnessSetJson() {
      let res = ''
      if (this.witnesses) {
        return this.witnesses.to_json()
      }
      return res
    }
  },
  watch: {
    txCborHex(val) {
      this.tx = Transaction.from_hex(val)
    },
    witnessSetCborHex(val) {
      this.witnesses = TransactionWitnessSet.from_hex(val)
    }
  },
  data() {
      return {
        txCborHex: '',
        tx: null,
        witnessSetCborHex: '',
        witnesses: null,
      };
  },
});
</script>

<style scoped>

</style>
