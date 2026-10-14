<template>
  <div class="d-flex flex-wrap flex-grow-1">
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <DAO />
      </v-col>
    </v-row>
  </div>
</template>

<script setup lang="ts">
import DAO from '@/modules/governance/components/DAO.vue';
</script>
