<script setup lang="ts">
    import { inject } from 'vue';
    import { RefInfo } from '../models';
    import CopyButton from '@/shared/components/CopyButton.vue';

    const refInfo: RefInfo = inject('refInfo');
</script>

<template>
  <v-container class="deep-blue border-gradient-gero-teal">
    <v-row class="bg-blue rounded" style="height: 32px">
      <v-col class="black--text py-0" style="align-content: center;">
        {{ 'Limited offer - Get $25 worth of $GERO for each referral!' }}
      </v-col>
      <v-col class="text-right py-0"  style="align-content: center;">
        <v-chip color="#00000033" style="color:#000; font-weight: bold" small>30 days remaining</v-chip>
      </v-col>
    </v-row>
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
    .copy-container{
        position: absolute;
        right: 0.2rem;
        top: 0.2rem;
    }
</style>
