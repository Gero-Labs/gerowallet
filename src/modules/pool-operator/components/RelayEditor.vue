<template>
  <div>
    <div class="d-flex align-center justify-space-between mb-2">
      <label class="text-body-2 font-weight-medium">{{ $t('poolOperator.relays') }}</label>
      <v-btn x-small text color="primary" @click="addRelay">
        <v-icon x-small class="mr-1">mdi-plus</v-icon>
        {{ $t('common.add') }}
      </v-btn>
    </div>

    <div v-for="(relay, index) in localRelays" :key="index" class="mb-3">
      <v-card outlined class="pa-3">
        <div class="d-flex align-center mb-2">
          <v-select
            v-model="relay.type"
            :items="relayTypes"
            :label="$t('poolOperator.relayType')"
            outlined
            dense
            hide-details
            attach
            style="max-width: 180px"
          />
          <v-spacer />
          <v-btn icon x-small @click="removeRelay(index)">
            <v-icon small color="error">mdi-delete</v-icon>
          </v-btn>
        </div>

        <!-- DNS Relay -->
        <template v-if="relay.type === 'dns'">
          <v-text-field
            v-model="relay.hostname"
            :label="$t('poolOperator.hostname')"
            outlined dense hide-details class="mb-2"
            @input="emitUpdate"
          />
          <v-text-field
            v-model.number="relay.port"
            :label="$t('poolOperator.port')"
            type="number"
            outlined dense hide-details
            @input="emitUpdate"
          />
        </template>

        <!-- IPv4/IPv6 Relay -->
        <template v-if="relay.type === 'ipv4' || relay.type === 'ipv6'">
          <v-text-field
            v-model="relay.ip"
            :label="relay.type === 'ipv4' ? $t('poolOperator.ipv4Address') : $t('poolOperator.ipv6Address')"
            outlined dense hide-details class="mb-2"
            @input="emitUpdate"
          />
          <v-text-field
            v-model.number="relay.port"
            :label="$t('poolOperator.port')"
            type="number"
            outlined dense hide-details
            @input="emitUpdate"
          />
        </template>

        <!-- SRV Relay -->
        <template v-if="relay.type === 'srv'">
          <v-text-field
            v-model="relay.dnsName"
            :label="$t('poolOperator.srvDnsName')"
            outlined dense hide-details
            @input="emitUpdate"
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
import { ref, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

interface RelayEntry {
  type: 'dns' | 'ipv4' | 'ipv6' | 'srv';
  hostname?: string;
  ip?: string;
  port?: number;
  dnsName?: string;
}

const props = defineProps<{ value: RelayEntry[] }>();
const emit = defineEmits(['input']);

const localRelays = ref<RelayEntry[]>([]);

const relayTypes = [
  { text: 'DNS', value: 'dns' },
  { text: 'IPv4', value: 'ipv4' },
  { text: 'IPv6', value: 'ipv6' },
  { text: 'SRV', value: 'srv' },
];

watch(() => props.value, (val) => {
  if (val && val.length > 0 && localRelays.value.length === 0) {
    localRelays.value = [...val];
  }
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
  emit('input', relays);
}
</script>
