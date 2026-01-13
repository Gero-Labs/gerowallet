<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader :title="$t('navigation.warningContinueCaution')" ref="popupHeader" :show-website="!($route.query['website'] === 'undefined' || Object.keys($route.query || {}).length === 0)" :show-wallet="false">
      <v-card-subtitle class="sub-title text-center my-2 py-2" style="color: #00221c; font-size: 19px">{{ $t('navigation.websiteBlacklisted') }}</v-card-subtitle>
      <v-card-text class="d-flex flex-column justify-center py-0 px-3" id="main-content" style="flex: 1 1 auto; overflow-y: auto; max-height: 100%; height:0;">
        {{ $t('navigation.acknowledgeFollowing') }}
        <div class="checkboxes">
          <v-checkbox
            v-model="checkbox1"
            :label="$t('navigation.websiteBlacklistedWarning')"
            hide-details
            required
            :rules="[v => !!v || $t('navigation.mustAgreeToContinue')]"
          />
          <v-checkbox
            v-model="checkbox2"
            :label="$t('navigation.websiteMayStealFunds')"
            hide-details
            required
            :rules="[v => !!v || $t('navigation.mustAgreeToContinue')]"
          />
        </div>
      </v-card-text>
      <v-card-actions class="d-flex flex-column">
        <div class="my-2">
          <v-btn id="report-btn" @click="reportSite">{{ $t('navigation.reportSiteAsSafe') }}</v-btn>
        </div>
        <div class="my-2 d-flex" style="justify-content: space-between; width: 100%">
          <v-btn outlined @click="safety">
            <v-icon small class="mr-1">
              mdi-arrow-left
            </v-icon>
            {{ $t('navigation.backToSafety') }}
          </v-btn>
          <v-btn class="geroButton" @click="proceed" :disabled="!valid" style="text-transform: uppercase; color: black!important;">
            {{ $t('navigation.continueToSite') }}
            <v-icon small class="mr-1" style="color: black!important;">
              mdi-arrow-right
            </v-icon>
          </v-btn>
        </div>
      </v-card-actions>
    </PopupHeader>
  </v-form>
</template>
<script setup lang="ts">
import { ref, onMounted, getCurrentInstance } from 'vue';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import { Messaging } from '@/chrome/messaging';

const valid = ref(false);
const checkbox1 = ref(false);
const checkbox2 = ref(false);
const suspiciousUrl = ref<string | null>(null);
const controller = Messaging.createInternalController();

const proceed = async () => {
  await controller.returnData({ data: 'proceed', error: {} });
  window.close();
};

const safety = async () => {
  await controller.returnData({ data: 'safety', error: {} });
  window.close();
};

const reportSite = async () => {
  await controller.returnData({ data: 'report', error: {} });
  window.close();
};

const vmProxy = getCurrentInstance()!.proxy as any

onMounted(async () => {
  const queryParams = vmProxy.$route.query;
  if (Object.keys(queryParams).length > 0) {
    suspiciousUrl.value = queryParams['website'] as string;
  } else {
    console.warn('No website query parameter found');
  }
});
</script>
<style scoped>
.sub-title {
  color: #00221c;
  background-color: #ff8e8e;
  font-size: 19px;
  font-weight: 500;
}

.checkboxes {
  display: flex;
  align-items: flex-start;
  flex-flow: column;
}

#report-btn {
  background-color: #002a23;
  color: white;
  border: 2px solid #00f6d7;
}
#main-content {
  color: #ffffff;
  font-size: 1rem;
  font-weight: 400;
  text-align: left;
}
</style>
