<script>
    import { provide } from 'vue';
    import ReferralHeader from './ReferralHeader.vue';
    import ReferrerTab from './ReferrerTab.vue';
    import RedeemTab from './RedeemTab.vue';
    import ReferralFAQ from './ReferralFAQ.vue';
    import { useStore } from '@/store';

    export default {
        name: "ReferralMain",
        setup(){
            const referralsStore = useStore();
            referralsStore.initReferrals();
            provide('refInfo', referralsStore.referral);
        },
        components: {ReferralHeader, ReferrerTab, RedeemTab, ReferralFAQ},
        methods: {
            toggleRedeemerReferrerView(val){ this.currentView = val; }
        },
        data: () => ({
            currentView: 'refer'
        })
    }

</script>

<template>
    <div>
        <ReferralHeader @toggleRefView="toggleRedeemerReferrerView" />
        <v-tabs-items v-model="currentView">
            <v-tab-item value="refer">
                <ReferrerTab />
            </v-tab-item>
            <v-tab-item value="redeem">
                <RedeemTab />
            </v-tab-item>
        </v-tabs-items>
        <ReferralFAQ />
    </div>
</template>

<style lang="css" scoped>
    .theme--dark.v-tabs-items{
        background-color: transparent !important;
    }
</style>