<template>
  <v-menu offset-y transition="scroll-y-transition" max-height="200">
    <template v-slot:activator="{ on, attrs, value }">
      <v-btn large plain v-bind="attrs" v-on="on" :ripple="false" style="font-weight: 600" :loading="!selectedNetwork">
        <v-avatar size="20" v-if="selectedNetwork">
          <v-img :src="selectedNetwork.icon"></v-img>
        </v-avatar>
        &nbsp;&nbsp;{{ selectedNetwork ? selectedNetwork.title : ''}}&nbsp;
        <v-icon class="toggleUpDown" :class='{ "rotate": value }' small>mdi-chevron-down</v-icon>
      </v-btn>
    </template>
    <v-list dense class="pa-0" dark style="background-color: #000000EE;">
      <v-list-item-group v-model="selectedNetwork" mandatory>
        <v-list-item v-for="(item, index) in networks.networks" :key="index" :value="item">
          <v-list-item-avatar size="20" v-if="item.icon">
            <v-img :src="item.icon"></v-img>
          </v-list-item-avatar>
          <v-list-item-title class="text-center">{{ item.title }}</v-list-item-title>
        </v-list-item>
      </v-list-item-group>
    </v-list>
  </v-menu>
</template>
<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import networks, { NetworkInfo } from '@/utils/networks';
import { updateVuetifyTheme } from '@/plugins/vuetify';

interface Props {
  modelValue?: NetworkInfo;
}

const props = defineProps<Props>();

const emit = defineEmits(['update:modelValue', 'network-changed']);

const selectedNetwork = ref<NetworkInfo>(undefined);

watch(selectedNetwork, (val) => {
  if (val) {
    emit('update:modelValue', val);
    emit('network-changed', val);
    // Update Vuetify theme based on selected network
    const isApex = val.blockchain?.includes('Apex');
    updateVuetifyTheme(isApex, true);
  }
});

onMounted(() => {
  if (props.modelValue) {
    selectedNetwork.value = props.modelValue;
  } else {
    selectedNetwork.value = networks.networks[0];
    emit('network-changed', selectedNetwork.value);
  }
});
</script>
<style>
.toggleUpDown {
  transition: transform .2s ease-in-out !important;
}

.toggleUpDown.rotate {
  transform: rotate(180deg);
}
</style>
