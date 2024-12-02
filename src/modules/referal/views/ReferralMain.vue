<script setup lang="ts">
    import { provide } from 'vue';
    import ReferralHeader from './ReferralHeader.vue';
    import { useStore } from '@/store';

    const store = useStore();
    store.loadReferrals();
    provide('refInfo', store.referrals);
</script>

<template>
    <div>
        <ReferralHeader/>
    </div>
</template>