<script setup lang="ts">
    import { computed, inject } from 'vue';
    import Badge, { BadgeType } from '@/shared/components/Badge.vue';
    import { RefInfo } from '../models';
    import filters from '@/shared/utils/filters';
    import { useStore } from '@/store';
    
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

    const referralsTableHeaders: any[] = [
        { text: "Wallets that redeemed the code", align: "start", sortable: false, value: "walletAddress" },
        { text: "Contact Name", align: "start", sortable: false, value: "name" },
        { text: "Date Redeemed", align: "start", sortable: true, value: "dateRedeemed" },
        { text: "Eligible?", align: "start", sortable: true, value: "eligible" },
        { text: "Reward", align: "start", sortable: true, value: "reward" },
        { text: "Claim", align: "start", sortable: false, value: "claim" },
    ];

    const claimClick = () => {
        alert('you clicked!');
    }

    const lastPrice = Number(computed(() => useStore().price.lastPrice).value);
</script>

<template>
    <div class="referrer-view">
        <div class="badges-container ma-4">
            <Badge v-for="(badge, index) in badges" :key="index" :icon="badge.icon" :title="badge.title" :value="badge.value" :valueInADA="badge.valueInADA" />
        </div>
        <v-container>
            <v-data-table
                dense
                class="transparent"
                :items="refInfo.referrals"
                :headers="referralsTableHeaders">
                <template v-slot:[`item.eligible`]="{ item }">
                    <v-list-item dense>
                        <v-list-item-action class="my-0">
                            <v-badge
                                overlap
                                avatar
                                color="transparent"
                                v-if="item.eligible">
                                    <template v-slot:badge>
                                        <v-avatar color="transparent" tile >
                                            <v-icon color="green">
                                            mdi-check-circle-outline
                                            </v-icon>
                                        </v-avatar>
                                    </template>
                            </v-badge>
                            <v-badge 
                                overlap
                                avatar
                                color="transparent"
                                v-else>
                                <template v-slot:badge>
                                    <v-avatar color="transparent" tile >
                                        <v-icon color="red">
                                            mdi-close-circle-outline
                                        </v-icon>
                                    </v-avatar>
                                </template>
                            </v-badge>
                        </v-list-item-action>
                    </v-list-item>
                </template>
                <template v-slot:[`item.dateRedeemed`]="{ item }">
                    <v-list-item dense class="pa-0">
                        <v-list-item-content>
                            <v-list-item-title>{{ new Date(item.dateRedeemed).toLocaleDateString().trim() }}</v-list-item-title>
                            <v-list-item-subtitle>{{ new Date(item.dateRedeemed).toLocaleTimeString().trim() }}</v-list-item-subtitle>
                        </v-list-item-content>
                    </v-list-item>
                </template>
                <template v-slot:[`item.claim`]="{ item }">
                    <v-list-item dense class="pa-0" v-if="item.eligible">
                        <v-chip small class="transparent" outlined color="green" @click="claimClick">
                            Claim
                        </v-chip>
                    </v-list-item>
                    <v-list-item dense class="pa-0" v-else>
                        <v-chip small class="transparent" outlined style="opacity: .4;" color="green">
                            Claim
                        </v-chip>
                    </v-list-item>
                </template>
                <template v-slot:[`item.reward`]="{ item }">
                    <v-list-item dense class="pa-0">
                        <v-list-item-content>
                            <v-list-item-title>{{ filters.toCurrency(item.reward, false, 2, '', ' $GERO', true, 0) }}</v-list-item-title>
                            <v-list-item-subtitle>{{ filters.toCurrency(item.rewardInADA * lastPrice, false, 2, '$', '', true, 0) }}</v-list-item-subtitle>
                        </v-list-item-content>
                    </v-list-item>
                </template>
            </v-data-table>
        </v-container>
    </div>
</template>

<style lang="css" scoped>
    .container{
        max-width: 80%;
    }
    .badges-container{
        display: flex;
        justify-content: center;
        gap: 24px;
    }
</style>