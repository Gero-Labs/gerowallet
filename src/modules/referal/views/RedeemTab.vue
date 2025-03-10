<script lang="ts">
    import { inject } from 'vue';
    import { RefInfo } from '../models';
    import filters from '@/shared/utils/filters';
    import StepsDiagram from '@/shared/components/StepsDiagram.vue';
    
    export default {
        name: 'ReferrerTab',
        components: {StepsDiagram},
        setup(){
            const refInfo: RefInfo = inject('refInfo');

            const redeemerTableHeaders: any[] = [
                { text: "Eligible?", align: "start", sortable: true, value: "done", width: 50 },
                { text: "Info", align: "start", sortable: true, value: "info", width: 400 },
                { text: "Action", align: "start", sortable: false, value: "action", width: 100 },
            ];

            const steps = [
                {
                    icon: 'mdi-content-copy',
                    text: 'Redeem Code'
                },
                {
                    icon: 'mdi-coin-swap',
                    text: 'Interact with Gero Dashboard'
                },
                {
                    icon: 'mdi-check-circle-broken',
                    text: 'Claim $GERO'
                }
            ];

            return {
                refInfo,
                redeemerTableHeaders,
                filters,
                steps
            }
        },
        methods: {
            claimClick(){
                alert('you clicked!');
            },
            copyAddress(refId){
                // @ts-ignore
                this.$refs[`copyAddress-${refId}`].copy();
            }
        }
    }
   
</script>

<template>
    <div class="redeemer-view">
        <StepsDiagram :steps="steps" />
        <v-card flat color="transparent">
            <v-card-subtitle>To claim the $25 worth of $GERO, you need to meet one of the following conditions</v-card-subtitle>
        </v-card>
        <v-container>
            <v-data-table
                dense
                class="transparent"
                :items="refInfo.redeem.actions"
                :headers="redeemerTableHeaders">
                <template v-slot:[`item.done`]="{ item }">
                    <v-list-item dense>
                        <v-list-item-action class="my-0">
                            <v-badge
                                overlap
                                avatar
                                color="transparent"
                                v-if="item.done">
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
                <template v-slot:[`item.action`]="{ item }">
                    <v-list-item dense>
                        <v-list-item-action class="my-0">
                            {{ item.name }}
                        </v-list-item-action>
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