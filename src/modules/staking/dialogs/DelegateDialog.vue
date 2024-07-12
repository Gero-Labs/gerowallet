<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Delegate Your Stake"
              subtitle="Secure the network and earn rewards by delegating your AP3X to a stake pool.">
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1" v-if="pool">
      <v-alert
        border="left"
        color="primary"
        type="info"
        prominent
        class="text-left"
      >
        <ul>
          <li>You can only delegate to one stake pool at a time</li>
          <li>You can switch to delegate to a different stake pool at any time</li>
          <li>You can cancel your delegation at any time</li>
        </ul>
      </v-alert>
      <v-list-item three-line>
        <v-list-item-content class="text-left">
          <v-list-item-title class="text-h5 mb-1">
            {{ `[${pool.ticker}] ${pool.name}` }}
          </v-list-item-title>
          <v-list-item-subtitle>{{ pool.description }}</v-list-item-subtitle>
          <v-list-item-subtitle>{{ pool.pool_id_bech32 | truncate }}&nbsp;<copy-button :value="pool.pool_id_hex" x-small></copy-button></v-list-item-subtitle>
        </v-list-item-content>

        <v-list-item-avatar
          size="80"
          v-if="poolExtendedInfo(pool)?.info?.url_png_icon_64x64"
        >
          <img :src="poolExtendedInfo(pool).info.url_png_icon_64x64" alt="" @error="fallbackImage"/>
        </v-list-item-avatar>
      </v-list-item>
      <v-card-title class="pt-0" style="color: white">{{ pool.block_count.toLocaleString() }}</v-card-title>
      <v-card-subtitle class="text-left pb-2">Lifetime Blocks</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white">{{ pool.live_delegators }}</v-card-title>
      <v-card-subtitle class="text-left pb-2">Live Delegators</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white">{{ pool.live_stake | toCurrency}}</v-card-title>
      <v-card-subtitle class="text-left pb-2">Live Stake</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white">{{ pool.ros.toLocaleString(undefined, {maximumFractionDigits: 2}) }}%</v-card-title>
      <v-card-subtitle class="text-left pb-2">ROS</v-card-subtitle>
      <v-card-title class="pt-0" style="color: white">
        <v-progress-linear rounded :color="getColor(pool.live_saturation)" height="32" :value="pool.live_saturation" striped>
          <template v-slot:default="{ value }">
            <strong>{{ Math.ceil(value) }}%</strong>
          </template>
        </v-progress-linear>
      </v-card-title>
      <v-card-subtitle class="text-left pb-0">Live Saturation</v-card-subtitle>
    </v-card-text>
    <v-card-actions class="justify-center text-center" v-if="pool && accountInfo">
      <v-row no-gutters>
        <v-col :cols="cols">
          <h4>Amount to delegate
            <v-btn x-small icon>
              <v-icon small>mdi-information-outline</v-icon>
            </v-btn>
          </h4>
          <h4><strong>{{ accountInfo.controlled_amount | toCurrency}}</strong></h4>
        </v-col>
        <v-col cols="4">
          <h4>Approx epoch reward
            <v-btn x-small icon>
              <v-icon small>mdi-information-outline</v-icon>
            </v-btn>
          </h4>
          <h4><strong>{{ accountInfo.controlled_amount * pool.ros/100/73 | toCurrency}}</strong></h4>
        </v-col>
        <v-col cols="4">
          <h4>Fee</h4>
          <h4><strong>{{ tx.body().fee().to_str() | toCurrency }}</strong></h4>
        </v-col>
        <v-col cols="12" class="pt-6">
          <v-btn color="primary" elevation="0">
            Delegate
          </v-btn>
        </v-col>
      </v-row>
    </v-card-actions>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';
import filters from '@/shared/utils/filters';
import CopyButton from '@/shared/components/CopyButton.vue';
import { mapState } from 'pinia';
import { useStore } from '@/store';

export default {
  name: 'DelegateDialog',
  components: { CopyButton, BaseDialog },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    pool: {
      type: Object,
      default: () => {},
    },
    tx: {
      type: Object,
      default: () => {},
    }
  },
  computed: {
    ...mapState(useStore, ['accountInfo', 'loggedWallet']),
    cols() {
      let depositFee = 0;
      if (this.tx?.body()?.outputs());
        //TODO
    }
  },
  methods: {
    getColor(value) {
      if (value > 100) {
        value = 100
      }
      value = value / 100
      //value from 0 to 1
      const hue = ((1 - value) * 120).toString(10);
      return ["hsl(", hue, ",57.26%,54.12%)"].join("");
    },
    poolExtendedInfo(pool) {
      if (pool && pool.pool_extended_info) {
        return JSON.parse(pool.pool_extended_info);
      }
      return undefined
    },
    fallbackImage(e) {
      e.target.src = this.errorImage
    }
  },
  filters,
  data: () => ({
    loading: false,
  }),
}
</script>
<style scoped>

</style>
