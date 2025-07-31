<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    title="What's New?"
    subtitle="Gero Dashboard change log"
    :loading="loading"
    :min-height="0"
    scrollable
    :persistent="persistent"
  >
    <v-card-text class="px-3 justify-center text-center pb-0" style="z-index: 1;">
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
                          <v-tooltip top >
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
  </BaseDialog>
</template>
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import time from '@/plugins/time';
import cryptoApi from '@/api/crypto-api';
import packageJson from '@/../package.json';

const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false,
  },
  persistent: {
    type: Boolean,
    default: true,
  }
});

const emit = defineEmits(['close']);

const loading = ref(false);
const panel = ref(0);
const releases = ref<any[]>([]);
const currentVersion = packageJson.version;

const normalizeVersion = (version: string) => {
  return version.startsWith('v') ? version.substring(1) : version;
};

const compareVersions = (versionA: string, versionB: string) => {
  const [majorA, minorA, patchA] = normalizeVersion(versionA)
    .split('.')
    .map(num => parseInt(num, 10));
  const [majorB, minorB, patchB] = normalizeVersion(versionB)
    .split('.')
    .map(num => parseInt(num, 10));

  if (majorA !== majorB) return majorA - majorB;
  if (minorA !== minorB) return minorA - minorB;

  return patchA - patchB;
};

onMounted(async () => {
  loading.value = true;
  try {
    const res = await cryptoApi.fetchReleases(0);
    if (res.status === 200) {
      let list = res.data.content;
      list.sort((a: any, b: any) => compareVersions(b.tagName, a.tagName));
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
