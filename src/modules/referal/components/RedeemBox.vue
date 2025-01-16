<script setup lang="ts">
    import { inject } from 'vue';
    import { RefInfo } from '../models';
    import CopyButton from '@/shared/components/CopyButton.vue';

    const refInfo: RefInfo = inject('refInfo');
</script>

<template>
  <v-container class="deep-blue border-gradient-gero-teal">
    <v-row class="gero-dark rounded mt-2" style="height: 32px">
      <v-col class="black--text py-0" style="align-content: center;">
        <span style="color: #7ED8FF; font-size: 12px;">{{ refInfo.refAddress }}</span>
      </v-col>
      <v-col class="text-right py-0"  style="align-content: center;">
        <CopyButton :value="refInfo.refAddress" small />
      </v-col>
    </v-row>
  </v-container>
</template>

<style lang="css" scoped>
    .row{
        font-size: 14px;
        margin: unset;
        justify-content: space-between;
    }
    .col{
        width: fit-content;
        flex: 0 1 auto;
        padding: 5px;
        position: relative;
    }
    .v-chip{
        font-size: 12px;
    }
</style>
