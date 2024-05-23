<template>
  <BaseDialog :isOpen="isDialogVisible" class="tokens-dialog" @close="$emit('close')">
    {{modalData}}
    <img :src="require('../assets/flag-05.png')" alt="token-bundle-image" />

    <v-card-title class="pa-0 card-title">
      <button class="breadcrumbs" @click="handleBreadcrumbClick">MusicBox Dimensions (21)</button>
      <span v-if="pickedToken" class="breadcrumbs"> > </span>
      <button v-if="pickedToken" class="breadcrumbs">{{ pickedToken }}</button>
      <v-spacer></v-spacer>
      <span v-if="pickedToken === null" class="white-grey policy"
        >Policy: 85152e10643c1440ba2ba817e3dd1faf7bd7296a8b605efd0f0f2d18</span
      >
    </v-card-title>
    <v-card-subtitle class="pa-0 mt-2 mb-3"
      >Music touches us emotionally, where images and words alone can't</v-card-subtitle
    >
    <TokensList v-if="pickedToken === null" @token-click="handleTokenClick" />
    <TokenPreviewCarousel v-else />
  </BaseDialog>
</template>
<script>
import TokensList from "../components/TokensList.vue";
import TokenPreviewCarousel from "../components/TokenPreviewCarousel.vue";
import BaseDialog from "@/shared/components/BaseDialog.vue";
import {model} from "@angular/core";

export default {
  name: "tokensDialog",
  components: { TokensList, TokenPreviewCarousel, BaseDialog },
  props: {
    modalData: {
      type: Object,
      default: null,
    },
  },
  computed: {
    isDialogVisible: {
      get() {
        return !!this.modalData;
      },
    },
    page: {
      get() {
        return 1;
      },
      set(value) {
        console.log(value);
      },
    },
  },
  data: () => ({
    tokens: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    pickedToken: null,
  }),
  methods: {
    model,
    handleTokenClick(token) {
      this.pickedToken = token;
    },
    handleBreadcrumbClick() {
      this.pickedToken = null;
    },
  },
};
</script>
<style scoped>
.close-button {
  position: absolute;
  top: 10px;
  right: 10px;
}

.card-title {
  position: relative;
  font-size: 10px;
}

.white-grey {
  color: #cecfd2;
}

.breadcrumbs {
  font-size: 18px;
  white-space: pre-wrap;
}

.policy {
  font-size: 10px;
  font-weight: 300;
  letter-spacing: -0.8px;
  line-height: 0px;
}
</style>
