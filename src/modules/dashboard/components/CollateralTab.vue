<template>

  <v-container>
    <v-row no-gutters>
      <v-col cols="9" class="pa-2">
          <p class="title">Set collateral to interact with DApps</p>
          <p class="subtitle">5 ADA will be locked, but you can unlock them at any time</p>
      </v-col>
      <v-col cols="3" class="pa-2">
        <v-container align="end">
          <v-btn large
                 style="text-transform: capitalize; background: linear-gradient(45deg, #00c7f3, #00ffd1); color: black">
            Set Collateral
          </v-btn>
        </v-container>
      </v-col>
    </v-row>

    <v-row no-gutters v-if="transaction">
      <v-col cols="12" class="pa-2">
        <p class="title">Transaction ID</p>
        <p class="subtitle">{{transaction}}</p>
      </v-col>
    </v-row>
  </v-container>

</template>

<script >
export default {
  name: 'CollateralTab',
  data: () => ({
    transaction: '62b6f02a8be5ccdd40c1d89068f9f0de05dc2fe67c7eda52dc6c673b7ee309e6',
  }),
}
</script>

<style scoped>

.title {
  font-size: 18px;
  font-weight: 600;
  line-height: 28px;
  text-align: left;
}

.subtitle {
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  text-align: left;
  color: #94969C;
}

</style>
