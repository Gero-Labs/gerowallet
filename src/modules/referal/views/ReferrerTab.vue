<script setup lang="ts">
    import { inject } from 'vue';
    import Badge, { BadgeType } from '@/shared/components/Badge.vue';
    import { RefInfo } from '../models';
    const refInfo: RefInfo = inject('refInfo');

    const badges: BadgeType[] = [
        {
            icon: {
                path: 'UsersSVG'
            },
            title: 'Total Referrals',
            value: refInfo.referrals?.length,
        },
        {
            icon: {
                path: 'CurrencyDollarSVG'
            },
            title: '$GERO earned',
            value: refInfo.totalRewards,
            valueInADA: refInfo.totalRewardsInADA
        }
    ];
</script>

<template>
    <div class="referrer-view">
        <div class="badges-container ma-4">
            <Badge v-for="(badge, index) in badges" :key="index" :icon="badge.icon" :title="badge.title" :value="badge.value" :translateValueToUSD="badge.translateValueToUSD" />
        </div>
        <div>
            <v-data-table :items="refInfo.referrals"></v-data-table>
        </div>
    </div>
</template>

<style lang="css" scoped>
    .badges-container{
        display: flex;
        justify-content: center;
        gap: 24px;
    }
</style>