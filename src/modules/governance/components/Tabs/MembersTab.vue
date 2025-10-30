<template>
  <v-container class="d-flex flex-column gap-4">
    <v-row>
      <v-col cols="12" md="12">
        <OverviewCard />
      </v-col>
    </v-row>
    <v-row>
      <v-col cols="12" md="6">
        <MembersCard />
      </v-col>
      <v-col cols="12" md="6">
        <ActionPermissionsCard />
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import MembersCard from '../Cards/MembersCard.vue';
import OverviewCard from '../Cards/OverviewCard.vue';
import ActionPermissionsCard from '../Cards/ActionPermissionsCard.vue';
</script>

<style scoped></style>
