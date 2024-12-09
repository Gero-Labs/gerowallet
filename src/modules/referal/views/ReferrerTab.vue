<script setup lang="ts">
    import Badge, { BadgeType } from '@/shared/components/Badge.vue';

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
    <div class="badges-container ma-4">
        <Badge v-for="(badge, index) in badges" :key="index" :icon="badge.icon" :title="badge.title" :value="badge.value" :translateValueToUSD="badge.translateValueToUSD" />
    </div>
</template>

<style lang="css" scoped>
    .badges-container{
        display: flex;
        justify-content: center;
        gap: 24px;
    }
</style>