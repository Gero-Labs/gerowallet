<script setup lang="ts">
    import { inject } from 'vue';
    import { RefInfo } from '../models';
    import CopyButton from '@/shared/components/CopyButton.vue';

    const refInfo: RefInfo = inject('refInfo');
</script>

<template>
    <v-container class="deep-blue border-gradient-gero-teal">
        <v-row class="bg-blue rounded">
            <v-col class="text-black">{{ $t('Limited offer - Get $25 worth of $GERO for each referral!') }}</v-col>
            <v-col class="text-right">
                <v-chip variant="tonal" x-small>30 days remaining</v-chip>
            </v-col>
        </v-row>
        <v-row>
            <v-col class="w-full gero-dark rounded mt-2" style="width: 100%; border: 1px solid #98A2B324">
                <v-input class="pa-1" style="color: #7ED8FF; font-size: 12px;" hide-details="true">{{ refInfo.refAddress }}</v-input>
                <div class="copy-container">
                    <CopyButton :value="refInfo.refAddress" small />
                </div>
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