<template>
  <v-container>
    <TreasuryCard />
    <!-- <v-row class="mt-4">
      <v-col cols="12" md="6">
        <GovernanceCard />
      </v-col>
      <v-col cols="12" md="6">
        <PostsCards />
      </v-col>
    </v-row> -->
  </v-container>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import TreasuryCard from '../Cards/TreasuryCard.vue';
//import GovernanceCard from '../Cards/GovernanceCard.vue';
//import PostsCards from '../Cards/PostsCards.vue';
</script>

<style scoped></style>
