<script setup lang="ts">
    import Badge, { BadgeType } from '@/shared/components/Badge.vue';
    import { inject, ref } from 'vue';
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
    <div class="badges-container ma-4">
        <Badge v-for="(badge, index) in badges" :key="index" :icon="badge.icon" :title="badge.title" :value="badge.value" :valueInADA="badge.valueInADA" />
    </div>
</template>

<style lang="css" scoped>
    .badges-container{
        display: flex;
        justify-content: center;
        gap: 24px;
    }
</style>