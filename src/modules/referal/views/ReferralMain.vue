<script setup lang="ts">
    import { provide, ref, watch } from 'vue';
    import ReferralHeader from './ReferralHeader.vue';
    import ReferrerTab from './ReferrerTab.vue';
    import RedeemTab from './RedeemTab.vue';
    import ReferralFAQ from './ReferralFAQ.vue';
    import { useStore } from '@/store';

    const referralsStore = useStore();
    referralsStore.initReferrals();
    provide('refInfo', referralsStore.referral);

    let currentViewRefer = ref(false);
    let currentViewRedeem = ref(false);

    watch(currentViewRefer, () => {});
    watch(currentViewRedeem, () => {});

    const toggleRedeemerReferrerView = () => {

    }

</script>

<template>
    <div>
        <ReferralHeader @toggleRefView="toggleRedeemerReferrerView" />
        <ReferrerTab v-model="currentViewRefer" />
        <RedeemTab v-model="currentViewRedeem"/>
        <hr />
        <ReferralFAQ />
    </div>
</template>
