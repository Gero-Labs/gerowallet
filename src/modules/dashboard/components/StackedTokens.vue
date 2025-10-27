<template>
  <div class="stackedTokens" style="max-width: 132px">
    <v-btn
      icon
      :height="props.tokenSize"
      :width="props.tokenSize"
      v-for="(token, index) in collect"
      :key="index"
      :class="`stackedToken_${index}`"
      :style="index > 0 ? { marginLeft: `-${Math.floor(props.tokenSize * 0.625)}px` } : {}"
      @click="print(token)"
    >
      <v-avatar
        :size="props.tokenSize"
        :color="token.img ? '' : 'black'"
      >
        <v-img v-if="token.img" :src="token.img" :alt="token.asset_name"></v-img>
        <v-img v-else :src="assts.questionMarkDark" />
      </v-avatar>
    </v-btn>
    <v-btn
      icon
      :height="props.tokenSize"
      :width="props.tokenSize"
      v-if="residue > 0"
      :style="{ marginLeft: `-${Math.floor(props.tokenSize * 0.625)}px` }"
    >
      <v-avatar
        :size="props.tokenSize"
        color="black"
      >
        <span class="white--text" :style="{ fontSize: `${Math.floor(props.tokenSize * 0.3)}px` }">{{'+' + residue}}</span>
      </v-avatar>
    </v-btn>
  </div>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, onMounted, ref, watch, withDefaults } from 'vue';
import { resolveAsset } from '@/shared/utils/resolver';
import assts from '@/utils/assets';

interface Props {
  tokens?: Array<any>
  tokenSize?: number
}

const props = withDefaults(defineProps<Props>(), {
  tokens: () => [],
  tokenSize: 40
})

const collect = ref([])

const print = (token) => {
  console.log(resolveAsset(token))
}

const updateTokens = async (tokens) => {
  collect.value = tokens.slice(0, 4).map(token => {
    return resolveAsset(token)


    // if (!token.policy_id || !assets.value) {
    //   return token
    // }
    // // if (token['policy_id'] !== '' && !assets[token['policy_id']+token['asset_name']]) {
    // //   appWallet.syncAssets([token['policy_id']+token['asset_name']], true)
    // // }
    // let tok
    // if (token.unit) {
    //   tok = token.unit
    // } else {
    //   tok = token['policy_id']+token['asset_name']
    // }
    // return resolveAsset(, token)
  });
}

watch(() => props.tokens, (newVal) => {
  if (newVal) {
    updateTokens(newVal)
  }
})

const residue = computed(() => {
  return props.tokens?.length > 4 ? props.tokens.length - 4 : 0;
})

onMounted(async () => {
  if (props.tokens?.length) {
    await updateTokens(props.tokens);
  }
})
</script>

<style>
/* Dynamic stacking is now handled inline via props */
</style>
