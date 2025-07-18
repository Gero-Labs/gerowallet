<template>
  <v-card class="transparent" flat>
    <v-tabs v-model="tab" centered icons-and-text background-color="transparent">
      <v-tab>
        Gero DAO (soon)
        <v-avatar size="24">
          <v-img
            :src="assets.dao"
            :style="
              tab === 0
                ? {
                    filter:
                      'brightness(0) saturate(100%) invert(53%) sepia(8%) saturate(3265%) hue-rotate(140deg) brightness(98%) contrast(93%)',
                  }
                : {
                    filter:
                      'brightness(0) saturate(100%) invert(100%) sepia(0%) saturate(0%) hue-rotate(93deg) brightness(103%) contrast(103%)',
                    opacity: 0.6,
                  }
            "
            alt=""
          />
        </v-avatar>
      </v-tab>
      <v-tab>
        Cardano Governance
        <v-avatar size="24">
          <v-img
            :src="assets.cardanoSvg"
            :style="
              tab === 1
                ? {
                    filter:
                      'brightness(0) saturate(100%) invert(53%) sepia(8%) saturate(3265%) hue-rotate(140deg) brightness(98%) contrast(93%)',
                  }
                : {
                    filter:
                      'brightness(0) saturate(100%) invert(100%) sepia(0%) saturate(0%) hue-rotate(93deg) brightness(103%) contrast(103%)',
                    opacity: 0.6,
                  }
            "
            alt=""
          />
        </v-avatar>
      </v-tab>
    </v-tabs>
    <v-tabs-items v-model="tab" class="transparent">
      <v-tab-item>
        <DAO />
      </v-tab-item>
      <v-tab-item>
        <CardanoGovernance />
      </v-tab-item>
    </v-tabs-items>
  </v-card>
</template>
<script setup lang="ts">
import assets from '@/utils/assets';
import DAO from '@/modules/governance/components/DAO.vue';
import CardanoGovernance from '@/modules/governance/components/CardanoGovernance.vue';

const tab = ref(1);
</script>
<style scoped></style>
