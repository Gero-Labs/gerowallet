<template>
  <div class="stackedTokens" style="max-width: 132px">
    <v-btn
      icon
      height="40"
      width="40"
      v-for="(token, index) in collect"
      :key="index"
      :class="`stackedToken_${index}`"
    >
      <v-avatar
        size="40"
        :color="token.img ? '' : 'black'"
      >
        <v-img v-if="token.img" :src="token.img" :alt="token.asset_name"></v-img>
        <span v-else class="white--text">{{ token.asset_name }}</span>
      </v-avatar>
    </v-btn>
    <v-btn
      icon
      height="40"
      width="40"
      v-if="residue > 0"
      style="margin-left: -25px"
    >
      <v-avatar
        size="40"
        color="black"
      >
        <span class="white--text">{{'+' + residue}}</span>
      </v-avatar>
    </v-btn>
  </div>
</template>
<script>
import { mapState } from 'pinia';
import { useStore } from '@/store';
import { resolveAsset } from '@/shared/utils/resolver';

export default {
  name: "StackedTokens",
  props: {
    tokens: {
      type: Array,
      default: () => [],
    },
  },
  watch: {
    tokens: {
      handler(newVal) {
        if (newVal) {
          this.updateTokens(newVal);
        }
      },
      deep: true,
    },
  },
  methods: {
    async updateTokens(tokens) {
      this.collect = await Promise.all(tokens.slice(0, 4).map(token => resolveAsset(this.assets, token)));
    },
  },
  computed: {
    ...mapState(useStore, ['assets']),
    residue() {
      return this.tokens.length > 4 ? this.tokens.length - 4 : 0;
    },
  },
  data() {
    return {
      collect: [],
    };
  },
  async created() {
    if (this.tokens.length) {
      await this.updateTokens(this.tokens);
    }
  },
};
</script>

<style>
.stackedToken_1,
.stackedToken_2,
.stackedToken_3,
.stackedToken_4 {
  margin-left: -25px;
}
</style>
