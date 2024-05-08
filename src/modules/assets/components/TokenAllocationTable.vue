<template>
  <v-card outlined class="no-gutters fill-height ">
    <v-card-title
      >Token Allocation (3)
      <v-spacer></v-spacer>
      <v-btn-toggle mandatory active-class="highlight" @change="handleSwitchTab">
        <v-btn :value="0" rounded> Assets </v-btn>
        <v-btn :value="1" rounded> Collectibles </v-btn>
      </v-btn-toggle>
    </v-card-title>
    <v-card-text class="pa-0">
      <v-tabs-items v-model="currentTab" class="transparent">
        <v-tab-item>
          <v-data-table class="token-allocation-table transparent" :headers="assetsHeaders" :items="assetsData" @click:row="handleOnRowClick">
            <template v-slot:[`item.asset`]="{ item }">
              <v-avatar size="30" class="avatar">
                <v-img :src="require('@/assets/GeroPool.png')" :alt="item.asset + 'Icon'"></v-img>
              </v-avatar>
              <span class="table-text">{{ item.asset }}</span>
            </template>
            <template v-slot:[`item.amount`]="{ item }">
              <span class="table-text">{{ item.amount }}</span>
            </template>
            <template v-slot:[`item.last_price`]="{ item }">
              <span class="table-text">${{ item.last_price }}</span>
            </template>
            <template v-slot:[`item.change`]="{ item }">
              <v-avatar tile size="20">
                <v-img
                  :src="
                    item.change >= 0
                      ? require('@/assets/svg/trend-up-01.svg')
                      : require('@/assets/svg/trend-down-01.svg')
                  "
                  alt="trend"
                ></v-img>
              </v-avatar>
              <span class="table-text" :style="item.change >= 0 ? { color: '#47CD89' } : { color: '#F97066' }">{{
                Math.abs(item.change * 100) + "%"
              }}</span>
            </template>
            <template v-slot:[`item.cost_basis`]="{ item }">
              <div>
                <span class="table-text">${{ item.cost_basis[0].toLocaleString() }}</span>
                <span class="table-text-opacity">Â{{ item.cost_basis[1].toLocaleString() }}</span>
              </div>
            </template>
            <template v-slot:[`item.value`]="{ item }">
              <div>
                <span class="table-text">${{ item.value[0].toLocaleString() }}</span>
                <span class="table-text-opacity">Â{{ item.value[1].toLocaleString() }}</span>
              </div>
            </template>
            <template v-slot:[`item.avg_price`]="{ item }">
              <div>
                <span class="table-text">${{ item.avg_price[0].toLocaleString() }}</span>
                <span class="table-text-opacity">Â{{ item.avg_price[1].toLocaleString() }}</span>
              </div>
            </template>
            <template v-slot:[`item.pnl`]="{ item }">
              <div>
                <span :style="item.change >= 0 ? { color: '#47CD89' } : { color: '#F97066' }" class="table-text"
                  >${{ item.pnl[0].toLocaleString() }}</span
                >
                <span :style="item.change >= 0 ? { color: '#47CD89' } : { color: '#F97066' }" class="table-text-opacity"
                  >Â{{ item.pnl[1].toLocaleString() }}</span
                >
              </div>
            </template>
            <template v-slot:[`item.allocation`]="{ item }">
              <v-progress-linear
                class="progress-bar"
                height="8"
                :value="item.allocation"
                color="#00dff3"
              ></v-progress-linear>
              <span class="table-text">{{ item.allocation }}%</span>
            </template>
            <template v-slot:[`item.last_7_days`]="{ item }">
              <span>{{ item.last_7_days }}</span>
            </template>
          </v-data-table>
        </v-tab-item>
        <v-tab-item>
          <v-data-table class="token-allocation-table" :headers="collectiblesHeaders" :items="collectiblesData">
            <template v-slot:[`item.asset`]="{ item }">
              <v-avatar size="30" class="avatar">
                <v-img :src="require('@/assets/GeroPool.png')" :alt="item.asset + 'Icon'"></v-img>
              </v-avatar>
              <span class="table-text">{{ item.asset }}</span>
            </template>
            <template v-slot:[`item.amount`]="{ item }">
              <span class="table-text">{{ item.amount }}</span>
            </template>
            <template v-slot:[`item.floor`]="{ item }">
              <div>
                <span class="table-text">${{ item.floor[0].toLocaleString() }}</span>
                <span class="table-text-opacity">Â{{ item.floor[1].toLocaleString() }}</span>
              </div>
            </template>
            <template v-slot:[`item.change`]="{ item }">
              <v-avatar tile size="20">
                <v-img
                  :src="
                    item.change >= 0
                      ? require('@/assets/svg/trend-up-01.svg')
                      : require('@/assets/svg/trend-down-01.svg')
                  "
                  alt="trend"
                ></v-img>
              </v-avatar>
              <span class="table-text" :style="item.change >= 0 ? { color: '#47CD89' } : { color: '#F97066' }">{{
                Math.abs(item.change * 100) + "%"
              }}</span>
            </template>
            <template v-slot:[`item.cost_basis`]="{ item }">
              <div>
                <span class="table-text">${{ item.cost_basis[0].toLocaleString() }}</span>
                <span class="table-text-opacity">Â{{ item.cost_basis[1].toLocaleString() }}</span>
              </div>
            </template>
            <template v-slot:[`item.avg_price`]="{ item }">
              <div>
                <span class="table-text">${{ item.avg_price[0].toLocaleString() }}</span>
                <span class="table-text-opacity">Â{{ item.avg_price[1].toLocaleString() }}</span>
              </div>
            </template>
            <template v-slot:[`item.pnl`]="{ item }">
              <div>
                <span :style="item.change >= 0 ? { color: '#47CD89' } : { color: '#F97066' }" class="table-text"
                  >${{ item.pnl[0].toLocaleString() }}</span
                >
                <span :style="item.change >= 0 ? { color: '#47CD89' } : { color: '#F97066' }" class="table-text-opacity"
                  >Â{{ item.pnl[1].toLocaleString() }}</span
                >
              </div>
            </template>
            <template v-slot:[`item.allocation`]="{ item }">
              <v-progress-linear
                class="progress-bar"
                height="8"
                :value="item.allocation"
                color="#00dff3"
              ></v-progress-linear>
              <span class="table-text">{{ item.allocation }}%</span>
            </template>
            <template v-slot:[`item.last_7_days`]="{ item }">
              <span>{{ item.last_7_days }}</span>
            </template>
          </v-data-table>
        </v-tab-item>
      </v-tabs-items>
    </v-card-text>
  </v-card>
</template>
<script>
export default {
  name: "tokenAllocationTable",
  data: () => ({
    currentTab: 0,
    chartData: [],
    assetsHeaders: [
      { text: "Asset", align: "center", sortable: true, value: "asset" },
      { text: "Amount", align: "center", sortable: true, value: "amount" },
      { text: "Last Price", align: "center", sortable: true, value: "last_price" },
      { text: "Change", align: "center", sortable: true, value: "change" },
      { text: "Cost Basis", align: "center", sortable: true, value: "cost_basis" },
      { text: "Value", align: "center", sortable: true, value: "value" },
      { text: "AVG Price", align: "center", sortable: true, value: "avg_price" },
      { text: "P&L", align: "center", sortable: true, value: "pnl" },
      { text: "Allocation", align: "center", sortable: true, value: "allocation", width: "150px" },
      { text: "Last 7 Days", align: "center", sortable: true, value: "last_7_days" },
    ],
    collectiblesHeaders: [
      { text: "Asset", align: "center", sortable: true, value: "asset" },
      { text: "Amount", align: "center", sortable: true, value: "amount" },
      { text: "Floor", align: "center", sortable: true, value: "floor" },
      { text: "Cost Basis", align: "center", sortable: true, value: "cost_basis" },
      { text: "AVG Price", align: "center", sortable: true, value: "avg_price" },
      { text: "P&L", align: "center", sortable: true, value: "pnl" },
      { text: "Allocation", align: "center", sortable: true, value: "allocation", width: "150px" },
      { text: "Last 7 Days", align: "center", sortable: true, value: "last_7_days" },
    ],
    assetsData: [
      {
        asset: "ADA",
        amount: 27407,
        last_price: 4.2,
        change: 0.15,
        cost_basis: [8222.1, 27407],
        value: [115110.24, 115110.24],
        avg_price: [0.3, 100],
        pnl: [106888.14, 27407.0],
        allocation: 40,
        last_7_days: 0.2,
      },
    ],
    collectiblesData: [
      {
        asset: "ADA",
        amount: 27407,
        floor: [75, 18],
        change: 0.15,
        cost_basis: [8222.1, 27407],
        avg_price: [0.3, 100],
        pnl: [106888.14, 27407.0],
        allocation: 40,
        last_7_days: 0.2,
      },
    ],
  }),
  methods: {
    handleSwitchTab(tab) {
      this.currentTab = tab;
    },
    handleOnRowClick(row) {
      this.$emit("click", row);
    },
  },
};
</script>
<style>
.token-allocation-table {
  .v-data-table-header th {
    height: 40px !important;
    font-size: 10px !important;
    padding: 0 !important;
  }

  tbody{
    cursor: pointer;
  }

  .table-text {
    font-size: 12px;
  }

  .table-text-opacity {
    font-size: 12px;
    opacity: 0.5;
    display: block;
  }
  .progress-bar {
    border-radius: 10px;
    background-color: #333741;
    width: 50%;
    display: inline-block;
    margin-right: 10px;
  }

  .avatar {
    margin-right: 5px;
  }
}
</style>
