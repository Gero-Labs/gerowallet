<script lang="ts">
    import ReferralTitle from '@/modules/referal/components/ReferralTitle.vue';
    import ReferralToggle from '../components/ReferralToggle.vue';
    import ReferralBox from '../components/ReferralBox.vue';
    import RedeemTitle from '../components/RedeemTitle.vue';
    import RedeemBox from '../components/RedeemBox.vue';
    import { defineComponent } from 'vue';

    export default defineComponent({
        components: {
            ReferralTitle,
            ReferralToggle,
            ReferralBox,
            RedeemTitle,
            RedeemBox
        },
        methods: {
            toggleRefView(val){
                this.$emit('toggleRefView', val);
                this.currentView = val;
            }
        },
        data: () => ({
            currentView: 'refer'
        })
    })
</script>

<template>
    <div id="referral-header">
        <v-container class="ref-wrapper">
            <ReferralToggle @toggleRefView="toggleRefView" />
            <v-tabs-items v-model="currentView">
                <v-tab-item value="refer">
                    <ReferralTitle />
                    <ReferralBox />
                </v-tab-item>
                <v-tab-item value="redeem">
                    <RedeemTitle />
                    <RedeemBox />
                </v-tab-item>
            </v-tabs-items>
        </v-container>
    </div>
</template>

<style lang="css" scoped>
    #referral-header {
      background: url('@/assets/img/referral/ref-bg.png') rgba(0,0,0, .5);
      background-size: 100% 140%;
      background-blend-mode: hard-light;
      width: auto;
      min-height: 20vw;
      position: relative;
      border-radius: 12px;
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

    .theme--dark.v-tabs-items{
        background-color: transparent !important;
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
