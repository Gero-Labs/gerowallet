<template>
  <v-expansion-panel class="accordion-container">
    <v-expansion-panel-header>
      <div class="header-container">
        <div v-if="type === 'RECEIVED'" class="received-arrow-container">
          <v-icon color="#333741">mdi-arrow-bottom-left</v-icon>
        </div>
        <div v-else class="sent-arrow-container">
          <v-icon color="#ffc2da">mdi-arrow-top-right</v-icon>
        </div>
        <h2>{{ type === 'RECEIVED' ? 'Received' : 'Sent' }} Assets (9)</h2>
      </div>
    </v-expansion-panel-header>
    <v-expansion-panel-content class="content-container">
      <div :class="amountClass">Â{{ amount }}</div>
      <TokensList :rows="2" :tokensData="[1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 15]"></TokensList>
    </v-expansion-panel-content>
  </v-expansion-panel>
</template>
<script>
import TokensList from '@/shared/components/TokensList.vue';

export default {
  name: 'transactionDetailsAccordion',
  components: { TokensList },
  props: {
    type: {
      type: String,
      default: 'RECEIVED',
    },
    amount: {
      type: Number,
      default: 0,
    },
    assets: {
      type: Array,
      default: Array,
    },
  },
  computed: {
    amountClass() {
      return this.type === 'RECEIVED' ? 'received-text' : 'sent-text';
    },
  },
  methods: {
    click() {},
  },
};
</script>
<style scoped>
.accordion-container {
  .header-container {
    display: flex;
    align-items: center;
    gap: 15px;

    .received-arrow-container,
    .sent-arrow-container {
      align-items: center;
      justify-content: center;
      display: flex;
      width: 50px;
      height: 50px;
      border-radius: 8px;
      background: linear-gradient(to right, #00c7f3, #00fad5);
    }

    .sent-arrow-container {
      background: linear-gradient(to right, #ad24a8, #df2063);
    }
  }

  .received-text {
    margin-bottom: 10px;
    color: #75e0a7;
    &::before {
      content: '+ ';
    }
  }

  .sent-text {
    margin-bottom: 10px;
    color: rgb(255, 104, 104);
    &::before {
      content: '- ';
    }
  }
}
</style>
