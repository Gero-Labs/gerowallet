<script lang="ts" setup>
  import { computed, defineProps } from 'vue';
  import { useStore } from '@/store';
  import filters from '@/shared/utils/filters';

  export type BadgeType = {
      icon: {
          path: string;
      };
      title: string;
      value?: number;
      valueInADA?: number;
  }
  const props = defineProps<BadgeType>();
  const SVGComponent = () => import(`@/assets/icons/${props.icon.path}.vue`);
  const lastPrice = Number(computed(() => useStore().price.lastPrice).value);
</script>

<template>
  <v-container class="badge">
    <v-list-item>
      <v-list-item-avatar>
        <component :is="SVGComponent" />
      </v-list-item-avatar>
      <v-list-item-content>
        <v-list-item-title class="badge-title">
          {{ title }}
        </v-list-item-title>
        <v-list-item-subtitle class="badge-value">
          {{ filters.toCurrency(value, false, 2, '', '', true, 0)  }}
          <span class="badge-currency-value" v-if="valueInADA">{{ filters.toCurrency(valueInADA * lastPrice, false, 2, '$', '', true, 0) }}</span>
        </v-list-item-subtitle>
      </v-list-item-content>
    </v-list-item>
  </v-container>
</template>

<style scoped lang="scss">
    .badge{
        width: 188px;
        padding: 0;
        border-radius: var(--radius-10);
        border: solid 1px #22262F;
        margin: 0;
    }
    .badge-title{
        color: #94979C;
        font-size: 14px;
        text-overflow: unset !important;
    }

    .badge-value{
        font-size: 20px;
        font-weight: 600;
        color: #FFFFFF !important;
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
    .badge-currency-value{
        font-size: 12px;
        font-weight: 600;
        color: #94979C;
    }

</style>