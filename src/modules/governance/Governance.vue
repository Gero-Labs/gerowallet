<template>
  <v-card class="transparent" flat>
    <v-card-title class="justify-center text-center pb-8 text-h3">
      Cardano Governance
    </v-card-title>
    <v-card-subtitle class="justify-center text-center text-subtitle-1">
      Cardano Governance empowers ADA holders to actively participate in shaping the network's future.
      You can cast your vote directly, choose a representative to act on your behalf, or take on the role of representing others.
      Additionally, you can propose your own changes to the network, engage in discussions, and ultimately bring them to a vote.
    </v-card-subtitle>
    <v-card-text>
      <v-row no-gutters>
        <!-- Left Column -->
        <v-col cols="12" xl="6" lg="6" md="6" class="px-2">
          <v-card outlined flat class="pa-4 fill-height d-flex flex-column justify-space-evenly">
            <v-card-text class="pa-2 current-delegation-card">
              <div class="white--text font-weight-semibold text-subtitle-2">
                Current Delegation
              </div>
              <div class="gradient-text text-h5 font-weight-semibold">
                Undelegated
              </div>
              <div class="gradient-text text-subtitle-2 font-weight-semibold">
                Vote Power: 0% (₳ 0.00)
              </div>
            </v-card-text>
            <v-card-text class="px-0 pb-0">
              <div class="d-flex">
                <v-select
                  label="New Delegation"
                  outlined
                  :items="['Own Account', 'Gero DRep', 'Abstain', 'No Confidence']"
                  dense
                  hide-details
                  :menu-props="{ offsetY: true }"
                  attach
                />
                <v-btn class="geroButton ml-3" height="40">
                  Delegate
                </v-btn>
              </div>
            </v-card-text>
            <v-alert
              class="mt-4 mb-0"
              border="left"
              colored-border
              color="primary"
              type="info"
              elevation="2"
            >
              Delegate to a DRep for governance actions;
              <br />
              It will be required to withdraw staking rewards
            </v-alert>
          </v-card>
        </v-col>
        <!-- Right Column -->
        <v-col cols="12" xl="6" lg="6" md="6" class="px-2">
          <v-card outlined flat class="pa-0 fill-height">
            <v-card-title class="text-subtitle-2">
              <a class="white--text" href="https://gov.tools/" target="_blank">
                Cardano Governance Tool<v-icon class="ml-1" small>mdi-open-in-new</v-icon>
              </a>
            </v-card-title>
            <v-card-subtitle class="text-body-2">
              The official Cardano DApp for governance
            </v-card-subtitle>
            <v-card-title class="pt-0 text-subtitle-2">
              <a class="white--text" href="https://www.1694.io/en" target="_blank">
                An On-Chain Decentralized Governance Mechanism for Voltaire<v-icon class="ml-1" small>mdi-open-in-new</v-icon>
              </a>
            </v-card-title>
            <v-card-subtitle class="text-body-2">
              Cardano decentralized governance proposal - CIP 1694
            </v-card-subtitle>
            <v-card-subtitle class="pt-0 text-subtitle-2 white--text">
              To participate in governance, every stake credential must be delegated to a DRep. ADA holders will typically assign their voting rights to a registered DRep who will vote on their behalf. Additionally, there are two predefined DRep options available:
            </v-card-subtitle>
            <div class="pa-4 pt-0 text-center">
              <v-tooltip bottom>
                <template v-slot:activator="{ on, attrs }">
                  <span
                    v-bind="attrs"
                    v-on="on"
                    class="mr-8 white--text text-decoration-underline cursor-pointer"
                  >
                    Abstain<v-icon class="ml-1" small>mdi-information-outline</v-icon>
                  </span>
                </template>
                <div style="width: 250px">
                  When an ADA holder delegates to Abstain, their stake is marked as not participating in governance and is excluded from the active voting stake on-chain. However, it remains registered for incentive purposes.
                </div>
              </v-tooltip>
              <v-tooltip bottom>
                <template v-slot:activator="{ on, attrs }">
                  <span
                    v-bind="attrs"
                    v-on="on"
                    class="mr-8 white--text text-decoration-underline cursor-pointer"
                  >No Confidence<v-icon class="ml-1" small>mdi-information-outline</v-icon>
                  </span>
                </template>
                <div style="width: 250px">
                  Delegating to No Confidence means an ADA holder's stake votes "no" on all governance actions except "Motions of No Confidence," where it votes "yes," indicating distrust in the constitutional committee. This stake is part of the active voting stake and provides an auditable measure of holders' confidence.
                </div>
              </v-tooltip>
            </div>
          </v-card>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>
<script lang="ts">
import { defineComponent } from 'vue';

export default defineComponent({
  name: 'Governance',
});
</script>

<style scoped>
/* Typography */
.text-h3 {
  font-size: 32px;
}

.text-h5 {
  font-size: 24px;
  line-height: 38px;
}

.text-subtitle-2 {
  font-size: 16px;
  line-height: 24px;
}

.text-body-2 {
  font-size: 14px;
}

/* Custom Styles */
.current-delegation-card {
  width: 100%;
  padding-top: 12px !important;
  padding-bottom: 12px !important;
  background: linear-gradient(90deg, rgb(0, 14, 17), rgb(0, 19, 16));
  box-shadow: 0px 1px 2px rgba(16, 24, 40, 0.05);
  border: 1px #00dff3 solid;
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
}

/* Gradient Text */
.gradient-text {
  text-transform: capitalize !important;
  background: linear-gradient(to right, #00c7f3, #00fad5);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

/* Utility Classes */
.word-break {
  word-break: break-word !important;
}

.text-decoration-underline {
  text-decoration: underline !important;
}

.cursor-pointer {
  cursor: pointer !important;
}
</style>
