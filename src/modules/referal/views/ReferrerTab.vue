<script setup lang="ts">
    import Badge, { BadgeType } from '@/shared/components/Badge.vue';

    const badges: BadgeType[] = [
        {
            icon: {
                path: 'UsersSVG'
            },
            title: 'Total Referrals',
            value: 5,
        },
        {
            icon: {
                path: 'CurrencyDollarSVG'
            },
            title: '$GERO earned',
            value: 1024,
            valueInADA: 10
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