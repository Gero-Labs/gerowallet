<template>
  <v-menu v-model="menuOpen" transition="scroll-y-transition" max-height="200">
    <template v-slot:activator="{ props: activatorProps }">
      <v-btn size="large" variant="plain" v-bind="activatorProps"  :ripple="false" style="font-weight: 600" :loading="!selectedNetwork">
        <v-avatar size="20" v-if="selectedNetwork">
          <v-img :src="selectedNetwork.icon"></v-img>
        </v-avatar>
        &nbsp;&nbsp;{{ selectedNetwork ? selectedNetwork.title : ''}}&nbsp;
        <v-icon class="toggleUpDown" :class='{ "rotate": menuOpen }' size="small">mdi-chevron-down</v-icon>
      </v-btn>
    </template>
    <v-list density="compact" class="pa-0" theme="dark" style="background-color: #000000EE;">

        <v-list-item v-for="(item, index) in networks.networks" :key="index" :active="selectedNetwork === item" @click="selectedNetwork = item">
          <template #prepend><v-avatar size="20" v-if="item.icon">
            <v-img :src="item.icon"></v-img>
          </v-avatar>
          </template><v-list-item-title class="text-center">{{ item.title }}</v-list-item-title>
        </v-list-item>

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

const menuOpen = ref(false);
const selectedNetwork = ref<NetworkInfo>();
watch(() => props.modelValue, (value) => { if (value) selectedNetwork.value = value; });

watch(selectedNetwork, (val) => {
  if (val) {
    emit('update:modelValue', val);
    emit('network-changed', val);
    // Update Vuetify theme based on selected network
    updateVuetifyTheme(val.blockchain);
  }
});

onMounted(() => {
  if (props.modelValue) {
    selectedNetwork.value = props.modelValue;
  } else {
    selectedNetwork.value = networks.networks[0];

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
