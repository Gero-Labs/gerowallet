<template>
  <v-card class="transparent" flat style="min-height: calc(100vh - 128px)">
    <v-card-title class="justify-center text-center pb-0 text-h3"> Gero DAO </v-card-title>
    <v-card-subtitle class="justify-center text-center" style="display: inline-flex; width: 100%">
      Powered by
      <v-img
        class="ml-1"
        :src="assets.clarityLogo"
        alt="Clarity Logo"
        width="48"
        max-width="48"
        style="margin-top: 1px"
        contain
      />
    </v-card-subtitle>

    <!-- Launch & Foundation Section -->
    <v-card-text class="text-center">
      <div class="text-body-1 mb-4">
        Gero DAO is a Decentralized Autonomous Organization (DAO) running on the Cardano blockchain and powered by the
        Clarity smart-contract framework. It was officially launched on November 12, 2024 (and updated February 27) to
        bring truly community-driven governance to the Gero Dashboard ecosystem.
      </div>
    </v-card-text>

    <v-tabs v-model="tab" centered icons-and-text background-color="transparent">
      <v-tab> Governance </v-tab>

      <v-tab> Treasury </v-tab>
      <v-tab> Members </v-tab>
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
      By pooling $GERO tokens into on-chain governance, the Gero community collectively steers product development,
      treasury allocations, and feature roadmaps—making the evolution of the Gero Dashboard truly decentralized and
      transparent.
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
