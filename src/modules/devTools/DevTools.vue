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
      <v-col cols="12" class="pa-2">
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
          <v-card-title class="row no-gutters d-flex justify-space-between">
            Address Cbor Hex to Bech32
          </v-card-title>
          <v-card-text>
            <v-row no-gutters>
              <v-col cols="6">
                <v-textarea
                  v-model="addressHex"
                  outlined
                  hide-details
                >
                </v-textarea>
              </v-col>
              <v-col cols="6" class="px-3">
                {{ address }}
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" class="pa-2">
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
          <v-card-title class="row no-gutters d-flex justify-space-between">
            Address Bech32 to Hex
          </v-card-title>
          <v-card-text>
            <v-row no-gutters>
              <v-col cols="6">
                <v-textarea
                  v-model="addressBech32"
                  outlined
                  hide-details
                >
                </v-textarea>
              </v-col>
              <v-col cols="6" class="px-3">
                {{ addressInHex }}
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" class="pa-2">
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
          <v-card-title class="row no-gutters d-flex justify-space-between">
            String to Hex
          </v-card-title>
          <v-card-text>
            <v-row no-gutters>
              <v-col cols="6">
                <v-textarea
                  v-model="messageDataText"
                  outlined
                  hide-details
                >
                </v-textarea>
              </v-col>
              <v-col cols="6" class="px-3">
                {{ messageDataHex }}
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
import { Address, Transaction, TransactionWitnessSet } from '@emurgo/cardano-serialization-lib-browser';
import { stringToHex } from '@/shared/utils/converter';

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
    },
  },
  watch: {
    txCborHex(val) {
      this.tx = Transaction.from_hex(val)
    },
    witnessSetCborHex(val) {
      this.witnesses = TransactionWitnessSet.from_hex(val)
    },
    addressHex(val) {
      this.address = Address.from_hex(val).to_bech32()
    },
    addressBech32(val) {
      this.addressInHex = Address.from_bech32(val).to_hex()
    },
    messageDataText(val) {
      this.messageDataHex = stringToHex(val)
    }
  },
  data() {
      return {
        txCborHex: '',
        tx: null,
        witnessSetCborHex: '',
        witnesses: null,
        addressHex: '',
        address: null,
        addressBech32: '',
        addressInHex: null,
        messageDataText: '',
        messageDataHex: null,
      };
  },
});
</script>

<style scoped>

</style>
