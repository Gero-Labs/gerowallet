<script setup lang="ts">
    import { provide } from 'vue';
    import ReferralHeader from './ReferralHeader.vue';
    import ReferrerTab from './ReferrerTab.vue';
    import RedeemTab from './RedeemTab.vue';
    import { useStore } from '@/store';
    import ReferralFAQ from './ReferralFAQ.vue';

    const store = useStore();
    store.loadReferrals();
    provide('refInfo', store.referrals);
</script>

<template>
    <div>
        <ReferralHeader />
        <ReferrerTab v-if="store.referrals.currentView === 'refer'" />
        <RedeemTab v-if="store.referrals.currentView === 'redeem'"/>
        <v-divider />
        <ReferralFAQ />
    </div>
</template>
