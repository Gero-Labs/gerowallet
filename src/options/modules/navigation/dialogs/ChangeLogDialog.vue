<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="activeTab === 0 ? t('navigation.whatsNew') : t('navigation.aboutUs')"
    :subtitle="activeTab === 0 ? t('navigation.whatsNewSubtitle') : t('navigation.aboutGeroDashboard')"
    :loading="loading"
    :min-height="0"
    scrollable
    :persistent="persistent"
    icon="mdi-lightning-bolt"
  >
    <v-card-title class="pt-0">
      <v-tabs v-model="activeTab" background-color="transparent" centered color="primary">
        <v-tab>{{ $t('navigation.whatsNew') }}</v-tab>
        <v-tab>{{ $t('navigation.aboutUs') }}</v-tab>
      </v-tabs>
    </v-card-title>
    <v-card-text class="px-0 pb-0" style="z-index: 1;">
      <v-tabs-items class="transparent" v-model="activeTab">
        <!-- What's New Tab -->
        <v-tab-item :transition="false">
          <v-card-text class="px-3 justify-center text-center pb-0">
            <v-timeline align-top dense class="pt-0 mt-4">
              <v-timeline-item small color="#00DFF3" v-for="(release, index) in releases" :key="index">
                <v-card class="transparent" flat style="background-image: linear-gradient(90deg, rgba(153, 153, 153, 0.05) 0%, rgba(163.62, 238.55, 255, 0.05) 100%); border-radius: 24px; ">
                  <v-card-text class="text-left">
                    <v-expansion-panels :value="index === 0 ? 0 : -1" flat>
                      <v-expansion-panel class="transparent" flat>
                        <v-expansion-panel-header class="pa-0">
                          <v-list-item two-line>
                            <v-list-item-content>
                              <v-list-item-title>
                                <strong>{{release.name}}</strong>
                              </v-list-item-title>
                              <v-list-item-subtitle>
                                <v-tooltip top content-class="custom-tooltip">
                                  <template v-slot:activator="{ on, attrs }">
                                <span
                                  v-bind="attrs"
                                  v-on="on"
                                >
                                  {{ time.format(new Date(release.publishedAt)) }}
                                </span>
                                  </template>
                                  <span>{{ new Date(release.publishedAt).toLocaleString() }}</span>
                                </v-tooltip>
                              </v-list-item-subtitle>
                            </v-list-item-content>
                          </v-list-item>
                          <v-card-title class="py-0"></v-card-title>
                        </v-expansion-panel-header>
                        <v-expansion-panel-content>
                          <VueShowdown :markdown="release.body" flavor="vanilla" :options="{ emoji: true }"/>
                        </v-expansion-panel-content>
                      </v-expansion-panel>
                    </v-expansion-panels>
                  </v-card-text>
                </v-card>
              </v-timeline-item>
            </v-timeline>
          </v-card-text>
        </v-tab-item>

        <!-- About Us Tab -->
        <v-tab-item :transition="false">
          <v-card-text class="px-6 pb-0">
            <!-- About Description -->
            <v-card flat class="transparent mb-6" style="background-image: linear-gradient(90deg, rgba(153, 153, 153, 0.05) 0%, rgba(163.62, 238.55, 255, 0.05) 100%); border-radius: 16px;">
              <v-card-text>
                <p class="text-body-1 white--text mb-0">{{ $t('navigation.aboutDescription') }}</p>
              </v-card-text>
            </v-card>

            <!-- Our Mission -->
            <div class="mb-6">
              <h3 class="text-h6 white--text mb-3">{{ $t('navigation.ourMissionTitle') }}</h3>
              <p class="text-body-2 text--secondary">{{ $t('navigation.ourMissionDescription') }}</p>
            </div>

            <!-- Contact Information -->
            <div class="mb-6">
              <h3 class="text-h6 white--text mb-3">{{ $t('navigation.contactInformation') }}</h3>
              <v-list class="transparent">
                <v-list-item>
                  <v-list-item-icon>
                    <v-icon large>mdi-email</v-icon>
                  </v-list-item-icon>
                  <v-list-item-content>
                    <v-list-item-subtitle>{{ $t('navigation.supportEmail') }}</v-list-item-subtitle>
                    <v-list-item-title>
                      <a href="mailto:support@gerowallet.io" target="_blank" class="primary--text">support@gerowallet.io</a>
                    </v-list-item-title>
                  </v-list-item-content>
                </v-list-item>
              </v-list>
            </div>

            <!-- Social Media -->
            <div class="mb-6">
              <h3 class="text-h6 white--text mb-3">{{ $t('navigation.followUs') }}</h3>
              <v-row dense>
                <v-col cols="6" sm="2">
                  <v-btn
                    outlined
                    block
                    href="https://www.gerowallet.io/"
                    target="_blank"
                    class="text-capitalize"
                  >
                    <v-icon left small>mdi-web</v-icon>
                    Website
                  </v-btn>
                </v-col>
                <v-col cols="6" sm="2">
                  <v-btn
                    outlined
                    block
                    href="https://twitter.com/GeroWallet"
                    target="_blank"
                    class="text-capitalize"
                  >
                    <v-avatar tile size="14" class="mr-2">
                      <v-img :src="assets.xSvg" width="14" height="14" alt="discord" contain></v-img>
                    </v-avatar>
                    Twitter
                  </v-btn>
                </v-col>
                <v-col cols="6" sm="2">
                  <v-btn
                    outlined
                    block
                    href="https://discord.gg/37bvtyvchz"
                    target="_blank"
                    class="text-capitalize"
                  >
                    <v-avatar tile size="14" class="mr-2">
                      <v-img :src="assets.discordSvg" width="14" height="14" alt="discord" contain></v-img>
                    </v-avatar>
                    Discord
                  </v-btn>
                </v-col>
                <v-col cols="6" sm="2">
                  <v-btn
                    outlined
                    block
                    href="https://t.me/GeroWallet"
                    target="_blank"
                    class="text-capitalize"
                  >
                    <v-avatar tile size="14" class="mr-2">
                      <v-img :src="assets.telegramSvg" width="14" height="14" alt="discord" contain></v-img>
                    </v-avatar>
                    Telegram
                  </v-btn>
                </v-col>
                <v-col cols="6" sm="2">
                  <v-btn
                    outlined
                    block
                    href="https://github.com/Gero-Labs/gerowallet"
                    target="_blank"
                    class="text-capitalize"
                  >
                    <v-icon left small>mdi-github</v-icon>
                    GitHub
                  </v-btn>
                </v-col>
                <v-col cols="6" sm="2">
                  <v-btn
                    outlined
                    block
                    href="https://www.youtube.com/@Gerowallet"
                    target="_blank"
                    class="text-capitalize"
                  >
                    <v-icon left small>mdi-youtube</v-icon>
                    YouTube
                  </v-btn>
                </v-col>
              </v-row>
            </div>

            <!-- Legal -->
            <div class="mb-6">
              <h3 class="text-h6 white--text mb-3">{{ $t('navigation.legal') }}</h3>
              <v-list class="transparent">
                <v-list-item href="https://www.gerowallet.io/terms" target="_blank">
                  <v-list-item-icon>
                    <v-icon>mdi-file-document-outline</v-icon>
                  </v-list-item-icon>
                  <v-list-item-content>
                    <v-list-item-title>{{ $t('navigation.termsOfService') }}</v-list-item-title>
                  </v-list-item-content>
                  <v-list-item-icon>
                    <v-icon>mdi-open-in-new</v-icon>
                  </v-list-item-icon>
                </v-list-item>
                <v-list-item href="https://www.gerowallet.io/privacy" target="_blank">
                  <v-list-item-icon>
                    <v-icon>mdi-shield-check-outline</v-icon>
                  </v-list-item-icon>
                  <v-list-item-content>
                    <v-list-item-title>{{ $t('navigation.privacyPolicy') }}</v-list-item-title>
                  </v-list-item-content>
                  <v-list-item-icon>
                    <v-icon>mdi-open-in-new</v-icon>
                  </v-list-item-icon>
                </v-list-item>
              </v-list>
            </div>

            <!-- Version & Credits -->
            <v-divider class="my-4"></v-divider>
            <div class="text-center">
              <v-img :src="assets.adLabsLogoWhite" width="50" class="mx-auto mb-3" />
              <p class="text-caption text--secondary">
                {{ (new Date().getFullYear())+' © '+$t('welcome.adLabs') }}
              </p>
            </div>
          </v-card-text>
        </v-tab-item>
      </v-tabs-items>
    </v-card-text>
  </BaseDialog>
</template>
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import time from '@/plugins/time';
import cryptoApi from '@/api/crypto-api';
import assets from '@/utils/assets';
import { useTranslation } from '@/shared/composables/useTranslation';

defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  persistent: {
    type: Boolean,
    default: true,
  }
});

defineEmits(['close']);
const { t } = useTranslation()
const loading = ref(false);
const activeTab = ref(0);
const releases = ref<Release[]>([]);

interface Release {
  body?: string,
  htmlUrl?: string,
  name?: string,
  publishedAt?: string,
  tagName?: string
}

onMounted(async () => {
  loading.value = true;
  try {
    const res = await cryptoApi.fetchReleases(0);
    if (res.status === 200) {
      let list: Release[] = res.data.content;
      list.sort((a: Release, b: Release) => {
        const dateA = new Date(a.publishedAt || 0).getTime();
        const dateB = new Date(b.publishedAt || 0).getTime();
        return dateB - dateA; // Sort descending (newest first)
      });
      releases.value = list;
    }
  } catch (e) {
    console.log(e);
  }
  loading.value = false;
});
</script>
<style>
.v-application--is-ltr .v-timeline--dense:not(.v-timeline--reverse)::before {
  left: calc(48px - 1px);
  right: initial;
  border-left: dotted 2px #65656582;
}

.theme--dark.v-timeline .v-timeline-item__dot {
  border-radius: 28px;
  background-color: rgb(16, 61, 65);
  width: 24px;
  height: 24px;
}

.v-timeline-item__dot--small .v-timeline-item__inner-dot {
  border-radius: 28px;
  background-color: #00dff3!important;
  width: 8px!important;
  height: 8px!important;
  margin: 8px auto auto!important;

}
</style>
