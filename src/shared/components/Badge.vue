<script lang="ts" setup>
import { defineProps, onBeforeMount } from 'vue';
import { appWallet } from '@/store';

export type BadgeType = {
    icon: {
        path: string;
        color: string;
    };
    title: string;
    value?: number;
    translateValueToUSD?: boolean;
}
const props = defineProps<BadgeType>();
const SVGComponent = () => import(`@/assets/icons/${props.icon.path}.vue`);

let convertedToUSD = 0;
onBeforeMount( async () => { 
    let cardanoLastPrice;
    const data = await appWallet?.api?.fetchADAStatistics();
    cardanoLastPrice = Number(data?.lastPrice).toFixed(4);

    if(props.translateValueToUSD === true) {
        convertedToUSD = props.value / cardanoLastPrice;
    }

    console.log('cardanoLastPrice', cardanoLastPrice);
} );

</script>

<template>
    <v-container class="badge">
        <v-row>
            <v-col class="main-col">
                <component :is="SVGComponent" />
            </v-col>
            <v-col class="main-col">
                <v-row>
                    <v-col class="badge-title">{{ title }}</v-col>
                    <v-col class="badge-value">
                        {{ value }}
                        <span v-if="translateValueToUSD">{{ convertedToUSD }}</span>
                    </v-col>
                </v-row>
            </v-col>
        </v-row>
    </v-container>
</template>

<style scoped lang="scss">
    .badge{
        width: 188px;
        padding: 12px 0px 0px 0px;
        border-radius: var(--radius-10);
        border: solid 1px #22262F;
        margin: 0;
    }
    .badge-title{
        color: #94979C;
        font-size: 14px;
    }

    .badge-value{
        font-size: 20px;
        font-weight: 600;
    }

    .col.main-col{
        flex: 0 1 auto;
        width: fit-content;
        padding: 1rem;

        .row{
            flex-direction: column;
            
            .col{
                padding: 0;
            }
        }
    }

</style>