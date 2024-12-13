<script setup lang="ts">
    import ReferralTitle from '@/modules/referal/components/ReferralTitle.vue';
    import ReferralToggle from '../components/ReferralToggle.vue';
    import ReferralBox from '../components/ReferralBox.vue';
</script>

<template>
    <div id="referral-header">
        <v-container class="ref-wrapper">
            <ReferralToggle />
            <ReferralTitle />
            <ReferralBox />
        </v-container>
    </div>
</template>

<style lang="scss" scoped>
    #referral-header{
        background: url('@/assets/img/referral/ref-bg.png') rgba(0,0,0, .5);
        background-size: 100% 140%;
        background-blend-mode: hard-light;
        width: auto;
        height: 20vw;
        position: relative;
    }
    .ref-wrapper{
        max-width: 50%;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        justify-content: space-around;
        height: 100%;
        position: absolute;
        left: 25%
    }

    /* mobile simulation */
    @media screen and (max-width: 1200px) {
        #referral-header{
            height: 40vw;
        }
        .ref-wrapper{
            max-width: unset;
        }
    }
</style>