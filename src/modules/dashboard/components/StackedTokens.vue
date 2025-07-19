<template>
  <div class="stackedTokens" style="max-width: 132px">
    <v-btn
      icon
      height="40"
      width="40"
      v-for="(token, index) in collect"
      :key="index"
      :class="`stackedToken_${index}`"
      @click="print(token)"
    >
      <v-avatar
        size="40"
        :color="token.img ? '' : 'black'"
      >
        <v-img v-if="token.img" :src="assts.resolveIcon(token.img)" :alt="token.asset_name"></v-img>
        <v-img v-else :src="assts.questionMarkDark" />
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
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { resolveAsset } from '@/shared/utils/resolver';
import assts from '@/utils/assets';

interface Props {
  tokens: Array<any>
}

const props = defineProps<Props>()

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
  return props.tokens.length > 4 ? props.tokens.length - 4 : 0;
})

onMounted(async () => {
  if (props.tokens.length) {
    await updateTokens(props.tokens);
  }
})
</script>

<style>
.stackedToken_1,
.stackedToken_2,
.stackedToken_3,
.stackedToken_4 {
  margin-left: -25px;
}
</style>
