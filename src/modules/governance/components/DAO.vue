<template>
  <v-card class="transparent" flat style="min-height: calc(100vh - 128px)">
    <v-card-title class="justify-center text-center pb-0 text-h3"> {{ $t('governance.geroDAO') }} </v-card-title>
    <v-card-subtitle class="justify-center text-center" style="display: inline-flex; width: 100%">
      {{ $t('common.poweredBy') }}
      <v-img
        class="ml-1"
        :src="assets.clarityLogo"
        :alt="$t('governance.clarityLogo')"
        width="48"
        max-width="48"
        style="margin-top: 1px"
        contain
      />
    </v-card-subtitle>

    <!-- Launch & Foundation Section -->
    <v-card-text class="text-center">
      <div class="text-body-1 mb-4">
        {{ $t('governance.geroDAODescription') }}
      </div>
    </v-card-text>

    <v-tabs v-model="tab" centered icons-and-text background-color="transparent">
      <v-tab> {{ $t('governance.governance') }} </v-tab>

      <v-tab> {{ $t('governance.treasury') }} </v-tab>
      <v-tab> {{ $t('governance.members') }} </v-tab>
    </v-tabs>

    <v-tabs-items v-model="tab" class="transparent">
      <v-tab-item>
        <GovernanceTab />
      </v-tab-item>
      <v-tab-item>
        <TreasuryTab />
      </v-tab-item>
      <v-tab-item>
        <MembersTab />
      </v-tab-item>
    </v-tabs-items>

    <v-card-subtitle class="justify-center pt-0 text-center text-subtitle-1 mt-auto">
      {{ $t('governance.communityGovernanceDescription') }}
    </v-card-subtitle>
    <v-card-text> </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import assets from '@/utils/assets';

import TreasuryTab from './Tabs/TreasuryTab.vue';
import MembersTab from './Tabs/MembersTab.vue';
import GovernanceTab from './Tabs/GovernanceTab.vue';

const tab = ref(0);

onMounted(() => {});
</script>

<style scoped></style>
