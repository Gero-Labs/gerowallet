<template>
  <BaseDialog :isOpen="isDialogVisible" class="tokens-dialog" @close="$emit('close')"
              :img="tokensData ? tokensData[0].img : null"
              :title="modalData ? `${modalData.name} (${Number(modalData.quantity).toLocaleString('en-US')})` : ''"
              :subtitle="description" :subtitle2="tokensData ? tokensData[0].policy_id : ''" :width="696" :min-height="646" :height="646">
    <v-card-text class="pa-3 justify-center text-center" style="z-index: 1">
        <v-row v-if="pickedToken === null">
          <v-col cols="6" xl="3" lg="3" md="3" sm="4" v-for="(token, index) in displayedTokens" :key="index" class="pa-1">
            <v-card outlined class="pa-0 token-image" @click="handleTokenClick(token)"
                    :style="{ backgroundImage: `linear-gradient(#ffffff00, #000000b3), url(${token.img})`,border: '1px solid #444', backgroundSize: 'cover', backgroundPosition: 'center', borderRadius: '8px' }">
              <div style="top: 0; position: absolute; display: flex" v-if="token.isScam">
                <v-chip x-small color="#F97066" class="px-2 ma-2">
                  <v-icon color="white" x-small style="margin-right: 3px">
                    mdi-alert-decagram
                  </v-icon>Scam Token
                </v-chip>
              </div>
              <div class="collectible-text-container">
                <span class="collectible-text">{{ token.name }}</span>
              </div>
            </v-card>
          </v-col>
        </v-row>
      <AssetDetails :asset="pickedToken" v-else />
    </v-card-text>
    <v-card-actions class="justify-center py-0">
      <v-btn text elevation="0" color="primary" v-if="pickedToken != null" @click="pickedToken = null">Back</v-btn>
    </v-card-actions>
  </BaseDialog>
</template>
<script>
import BaseDialog from "@/shared/components/BaseDialog.vue";
import filters from '@/shared/utils/filters';
import AssetDetails from '@/modules/assets/components/AssetDetails.vue';

export default {
  name: "tokensDialog",
  components: { AssetDetails,  BaseDialog },
  props: {
    modalData: {
      type: Object,
      default: null,
    },
  },
  watch: {
    isDialogVisible(val) {
      if (val) {
        this.pickedToken = null
      }
    }
  },
  filters,
  computed: {
    description() {
      let description = ''
      if (this.modalData) {
        if (Array.isArray(this.modalData.description)) {
          description = this.modalData.description.join(" ")
        } else {
          description = this.modalData.description
        }
      }
      return description
    },
    tokensData() {
      return this.modalData?.items
    },
    displayedTokens() {
      return this.tokensData;
    },
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
  line-height: 0;
}

.token-image {
  max-width: 152px;
  height: 152px;
  background-position: center;
  align-content: end;
  background-size: cover;
}
.tokens-container {
  display: flex;
  flex-wrap: wrap;

  & .token-image {
    cursor: pointer;
    transition: transform 0.3s ease-in-out, opacity 0.3s ease-in-out;

    &:hover {
      transform: scale(1.05);
      opacity: 0.8;
    }
  }
}

.white-grey {
  color: #cecfd2;
}

.arrow-button {
  color: black;
  background-color: #161b26;
  border-radius: 8px;
  border: 1px solid #333741;
  margin: 0 50px;
}

.collectible-text-container {
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: normal;
  padding-bottom: 6px;
}
.collectible-text {
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  line-height: 1.00;
  letter-spacing: -0.7px;
  display: block;
}
</style>
