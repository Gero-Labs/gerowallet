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
    <v-list dense class="pa-0" dark style="background-color: #00000088;">
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
<script>
import {mapState} from "pinia";
import {useStore} from "@/store";
import networks from "@/utils/networks";

export default {
  name: "NetworkSelector",
  computed: {
    ...mapState(useStore, ['network']),
  },
  watch: {
    selectedNetwork(val) {
      this.store.setNetwork(val)
    }
  },
  data: () => ({
    networks,
    selectedNetwork: undefined,
    store: useStore()
  }),
  async mounted() {
    if (this.network) {
      this.selectedNetwork = this.network
    } else {
      this.selectedNetwork = this.networks.networks[0]
    }
  }
}
</script>
<style>
.toggleUpDown {
  transition: transform .2s ease-in-out !important;
}

.toggleUpDown.rotate {
  transform: rotate(180deg);
}
</style>