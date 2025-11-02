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
                <v-card outlined class="my-1" v-if="txJson">
                  <v-card-title class="pa-1" style="position: absolute; right: 0">
                    <CopyButton :value="txJson" small></CopyButton>
                  </v-card-title>
                  <v-card-text class="text-left pa-2" style="font-size: 12px; font-family: monospace !important">
                    <pre style="white-space: pre-wrap; word-break: break-all; font-size: 12px; max-height: 400px; overflow-y: auto;">{{txJson}}</pre>
                  </v-card-text>
                </v-card>
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
                <pre style="white-space: pre-wrap; word-break: break-all; font-size: 12px; max-height: 400px; overflow-y: auto;">{{ witnessSetJson }}</pre>
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
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import CopyButton from '@/shared/components/CopyButton.vue';

const txCborHex = ref<string>('')
const tx = ref<Cardano.Tx>(null)
const witnessSetCborHex = ref<string>('')
const witnesses = ref<Serialization.TransactionWitnessSet>(null)
const addressHex = ref<string>('')
const address = ref<string>('')
const addressBech32 = ref<string>('')
const addressInHex = ref(null)
const messageDataText = ref<string>('')
const messageDataHex = ref(null)
const utxoCbor = ref<string>('')
const utxo = ref<[Cardano.TxIn, Cardano.TxOut]>()
const lovelace = ref<string>('')
const value = ref<string>('')

const txJson = computed(() => {
  let res = ''
  if (tx.value) {
    return JSON.stringify(tx.value, (key, value) => {
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Map) return Object.fromEntries(value);
      if (value instanceof Set) return Array.from(value);
      return value;
    }, 2)
  }
  return res
})

const witnessSetJson = computed(() => {
  let res = ''
  if (witnesses.value) {
    return JSON.stringify(witnesses.value.toCore(), (key, value) => {
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Map) return Object.fromEntries(value);
      if (value instanceof Set) return Array.from(value);
      return value;
    }, 2)
  }
  return res
})

const utxoJson = computed(() => {
  let res = ''
  if (utxo.value) {
    return JSON.stringify(utxo.value, (key, value) => {
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Map) return Object.fromEntries(value);
      if (value instanceof Set) return Array.from(value);
      return value;
    }, 2)
  }
  return res
})

watch(txCborHex, (val: string) => {
  try {
    if (val) {
      tx.value = deserializeCardanoJsSdkTx(val)
    } else {
      tx.value = null
    }
  } catch (error) {
    console.error('Error deserializing tx CBOR:', error)
    tx.value = null
  }
})

watch(witnessSetCborHex, (val: string) => {
  try {
    if (val) {
      witnesses.value = Serialization.TransactionWitnessSet.fromCbor(HexBlob(val))
    } else {
      witnesses.value = null
    }
  } catch (error) {
    console.error('Error deserializing witness set CBOR:', error)
    witnesses.value = null
  }
})

watch(addressHex, (val: string) => {
  try {
    if (val) {
      address.value = Cardano.Address.fromBytes(HexBlob(val)).toBech32()
    } else {
      address.value = ''
    }
  } catch (error) {
    console.error('Error converting address hex:', error)
    address.value = ''
  }
})

watch(addressBech32, (val: string) => {
  try {
    if (val) {
      addressInHex.value = Cardano.Address.fromBech32(val).toBytes().toString()
    } else {
      addressInHex.value = ''
    }
  } catch (error) {
    console.error('Error converting bech32 address:', error)
    addressInHex.value = ''
  }
})

watch(messageDataText, (val: string) => {
  try {
    if (val) {
      messageDataHex.value = util.utf8ToHex(val).toString()
    } else {
      messageDataHex.value = ''
    }
  } catch (error) {
    console.error('Error converting text to hex:', error)
    messageDataHex.value = ''
  }
})

watch(utxoCbor, (val: string) => {
  try {
    if (val) {
      utxo.value = Serialization.TransactionUnspentOutput.fromCbor(HexBlob(val)).toCore()
    } else {
      utxo.value = undefined
    }
  } catch (error) {
    console.error('Error deserializing UTXO CBOR:', error)
    utxo.value = undefined
  }
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
