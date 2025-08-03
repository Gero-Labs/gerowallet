<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between liquid-glass">
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
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between liquid-glass">
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
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between liquid-glass">
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
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between liquid-glass">
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
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between liquid-glass">
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
      <v-col cols="12" class="pa-2">
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between liquid-glass">
          <v-card-title class="row no-gutters d-flex justify-space-between">
            Utxo Cbor to Json
          </v-card-title>
          <v-card-text>
            <v-row no-gutters>
              <v-col cols="6">
                <v-textarea
                  v-model="utxoCbor"
                  outlined
                  hide-details
                >
                </v-textarea>
              </v-col>
              <v-col cols="6" class="px-3">
                {{ utxoJson }}
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" class="pa-2">
        <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between liquid-glass">
          <v-card-title class="row no-gutters d-flex justify-space-between">
            Lovelace to Value
          </v-card-title>
          <v-card-text>
            <v-row no-gutters>
              <v-col cols="6">
                <v-textarea
                  v-model="lovelace"
                  outlined
                  hide-details
                >
                </v-textarea>
              </v-col>
              <v-col cols="6" class="px-3">
                {{ value }}
              </v-col>
            </v-row>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-layout>
</template>
<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Cardano, Serialization, util } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';

const txCborHex = ref<string>('')
const tx = ref<Serialization.Transaction>(null)
const witnessSetCborHex = ref<string>('')
const witnesses = ref<Serialization.TransactionWitnessSet>(null)
const addressHex = ref<string>('')
const address = ref<string>('')
const addressBech32 = ref<string>('')
const addressInHex = ref(null)
const messageDataText = ref<string>('')
const messageDataHex = ref(null)
const utxoCbor = ref<string>('')
const utxoJson = ref<[Cardano.TxIn, Cardano.TxOut]>()
const lovelace = ref<string>('')
const value = ref<string>('')

const txJson = computed(() => {
  let res = ''
  if (tx.value) {
    return tx.value.toCore()
  }
  return res
})

const witnessSetJson = computed(() => {
  let res = ''
  if (witnesses.value) {
    return witnesses.value.toCore();
  }
  return res
})

watch(txCborHex, (val: string) => {
  tx.value = Serialization.Transaction.fromCbor(Serialization.TxCBOR(val))
})

watch(witnessSetCborHex, (val: string) => {
  witnesses.value = Serialization.TransactionWitnessSet.fromCbor(HexBlob(val))
})

watch(addressHex, (val: string) => {
  address.value = Cardano.Address.fromBytes(HexBlob(val)).toBech32()
})

watch(addressBech32, (val: string) => {
  addressInHex.value = Cardano.Address.fromBech32(val).toBytes().toString()
})

watch(messageDataText, (val: string) => {
  messageDataHex.value = util.utf8ToHex(val).toString()
})

watch(utxoCbor, (val: string) => {
  utxoJson.value = Serialization.TransactionUnspentOutput.fromCbor(HexBlob(val)).toCore()
})

watch(lovelace, (val: string) => {
  if (val === '') {
    value.value = ''
    return
  }
  value.value = Serialization.Value.fromCore({
    coins: BigInt(val),
  }).toCbor().toString()
})
</script>
<style scoped>

</style>
