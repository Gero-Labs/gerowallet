<script setup lang="ts">
    import { inject } from 'vue';
    import Badge, { BadgeType } from '@/shared/components/Badge.vue';
    import { Referral, RefInfo } from '../models';

    const refInfo: RefInfo = inject('refInfo');
    const items: Referral[] = refInfo?.referrals;

    console.log(items);

    const badges: BadgeType[] = [
        {
            icon: {
                path: 'UsersSVG',
                color: 'blue'
            },
            title: 'Total Referrals',
            value: 5,
        },
        {
            icon: {
                path: 'CurrencyDollarSVG',
                color: 'green'
            },
            title: '$GERO earned',
            value: 1024,
            translateValueToUSD: true
        }
    ];
</script>

<template>
    <div class="referrer-view">
        <div class="badges-container ma-4">
            <Badge v-for="(badge, index) in badges" :key="index" :icon="badge.icon" :title="badge.title" :value="badge.value" :translateValueToUSD="badge.translateValueToUSD" />
        </div>
        <div>
            <v-data-table :items="items"></v-data-table>
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