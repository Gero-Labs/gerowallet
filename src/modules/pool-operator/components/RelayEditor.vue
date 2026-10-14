<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-2">
      <label class="text-body-2 font-weight-medium">{{ $t('poolOperator.relays') }}</label>
      <v-btn size="x-small" variant="text" color="primary" @click="addRelay">
        <v-icon size="x-small" class="mr-1">mdi-plus</v-icon>
        {{ $t('common.add') }}
      </v-btn>
    </div>

    <div v-for="(relay, index) in localRelays" :key="index" class="mb-3">
      <v-card variant="outlined" class="pa-3">
        <div class="d-flex align-center mb-2">
          <v-select item-title="text"
            v-model="relay.type"
            @update:model-value="emitUpdate"
            :items="relayTypes"
            :label="$t('poolOperator.relayType')"
            variant="outlined"
            density="compact"
            hide-details
            attach
            style="max-width: 180px"
          />
          <v-spacer />
          <v-btn icon variant="text" size="x-small" @click="removeRelay(index)">
            <v-icon size="small" color="error">mdi-delete</v-icon>
          </v-btn>
        </div>

        <!-- DNS Relay -->
        <template v-if="relay.type === 'dns'">
          <v-text-field
            v-model="relay.hostname"
            :label="$t('poolOperator.hostname')"
            variant="outlined" density="compact" hide-details class="mb-2"
            @update:model-value="emitUpdate"
          />
          <v-text-field
            v-model.number="relay.port"
            :label="$t('poolOperator.port')"
            type="number"
            variant="outlined" density="compact" hide-details
            @update:model-value="emitUpdate"
          />
        </template>

        <!-- IPv4/IPv6 Relay -->
        <template v-if="relay.type === 'ipv4' || relay.type === 'ipv6'">
          <v-text-field
            v-model="relay.ip"
            :label="relay.type === 'ipv4' ? $t('poolOperator.ipv4Address') : $t('poolOperator.ipv6Address')"
            variant="outlined" density="compact" hide-details class="mb-2"
            @update:model-value="emitUpdate"
          />
          <v-text-field
            v-model.number="relay.port"
            :label="$t('poolOperator.port')"
            type="number"
            variant="outlined" density="compact" hide-details
            @update:model-value="emitUpdate"
          />
        </template>

        <!-- SRV Relay -->
        <template v-if="relay.type === 'srv'">
          <v-text-field
            v-model="relay.dnsName"
            :label="$t('poolOperator.srvDnsName')"
            variant="outlined" density="compact" hide-details
            @update:model-value="emitUpdate"
          />
        </template>
      </v-card>
    </div>

    <div v-if="localRelays.length === 0" class="text-center py-3 grey--text text-caption">
      {{ $t('poolOperator.noRelays') }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Cardano } from '@cardano-sdk/core';
import { ref, toRaw, watch } from 'vue';


interface RelayEntry {
  type: 'dns' | 'ipv4' | 'ipv6' | 'srv';
  hostname?: string;
  ip?: string;
  port?: number;
  dnsName?: string;
}

const props = defineProps<{ modelValue: Cardano.Relay[] }>();
const emit = defineEmits<{ (event: 'update:modelValue', value: Cardano.Relay[]): void }>();

const localRelays = ref<RelayEntry[]>([]);

const relayTypes = [
  { text: 'DNS', value: 'dns' },
  { text: 'IPv4', value: 'ipv4' },
  { text: 'IPv6', value: 'ipv6' },
  { text: 'SRV', value: 'srv' },
];

// The parent's echo of our own emit carries no relay type for an empty address;
// rebuilding from it would turn a new IPv6 entry back into IPv4.
let lastEmitted: unknown = null;

watch(() => props.modelValue, (val) => {
  if (toRaw(val) === lastEmitted) return;
  localRelays.value = (val || []).map((relay): RelayEntry => {
    if (relay.__typename === 'RelayByName') return { type: 'dns', hostname: relay.hostname, port: relay.port };
    if (relay.__typename === 'RelayByNameMultihost') return { type: 'srv', dnsName: relay.dnsName };
    return { type: relay.ipv6 ? 'ipv6' : 'ipv4', ip: relay.ipv6 || relay.ipv4, port: relay.port };
  });
}, { immediate: true });

function addRelay() {
  localRelays.value.push({ type: 'dns', hostname: '', port: 3001 });
  emitUpdate();
}

function removeRelay(index: number) {
  localRelays.value.splice(index, 1);
  emitUpdate();
}

function emitUpdate() {
  // Convert local relay entries to Cardano SDK Relay format
  const relays = localRelays.value.map(r => {
    if (r.type === 'dns') {
      return { __typename: 'RelayByName' as const, hostname: r.hostname || '', port: r.port };
    } else if (r.type === 'ipv4') {
      return { __typename: 'RelayByAddress' as const, ipv4: r.ip, port: r.port };
    } else if (r.type === 'ipv6') {
      return { __typename: 'RelayByAddress' as const, ipv6: r.ip, port: r.port };
    } else {
      return { __typename: 'RelayByNameMultihost' as const, dnsName: r.dnsName || '' };
    }
  });
  lastEmitted = relays;
  emit('update:modelValue', relays);
}
</script>
