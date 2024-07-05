<template>
  <BaseDialog :isOpen="isDialogVisible" class="tokens-dialog" @close="$emit('close')"
              :img="collectionImg.toString()"
              title="MusicBox Dimensions (21)"
              subtitle="Policy: 85152e10643c1440ba2ba817e3dd1faf7bd7296a8b605efd0f0f2d18">
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1">
      <TokensList :tokensData="[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]" v-if="pickedToken === null" @token-click="handleTokenClick" />
      <TokenPreviewCarousel v-else />
    </v-card-text>
  </BaseDialog>
</template>
<script>
import TokensList from "@/shared/components/TokensList.vue";
import TokenPreviewCarousel from "../components/TokenPreviewCarousel.vue";
import BaseDialog from "@/shared/components/BaseDialog.vue";

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
    collectionImg: require('../assets/flag-05.png'),
    tokens: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
    pickedToken: null,
  }),
  methods: {
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
