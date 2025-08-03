<template>
  <v-container fluid class="pa-4">
    <v-row>
      <!-- Treasury of Tokens -->
      <v-col cols="12" md="6" lg="3">
        <v-card flat outlined class="d-flex flex-column" style="height: 200px">
          <v-card-title class="d-flex align-center">
            <v-icon color="primary" class="mr-2">mdi-treasure-chest</v-icon>
            Treasury of Tokens
          </v-card-title>
          <v-card-text class="flex-grow-1 d-flex align-center">
            <p class="text-body-2 mb-0">
              Everyone who joins puts some ADA (Cardano's coins) into the DAO's "chest." This creates a shared treasury
              that the community can govern together.
            </p>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Magic Rule Book -->
      <v-col cols="12" md="6" lg="3">
        <v-card flat outlined class="d-flex flex-column" style="height: 200px">
          <v-card-title class="d-flex align-center">
            <v-icon color="primary" class="mr-2">mdi-book-open-variant</v-icon>
            Magic Rule Book
          </v-card-title>
          <v-card-text class="flex-grow-1 d-flex align-center">
            <p class="text-body-2 mb-0">
              The rules for how to spend or move those ADA are written down in computer code on the Cardano blockchain.
              Once the rules are set, they run by themselves—no teacher or boss can secretly change them.
            </p>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Voting with Your ADA -->
      <v-col cols="12" md="6" lg="3">
        <v-card flat outlined class="d-flex flex-column" style="height: 200px">
          <v-card-title class="d-flex align-center">
            <v-icon color="primary" class="mr-2">mdi-vote</v-icon>
            Voting with Your ADA
          </v-card-title>
          <v-card-text class="flex-grow-1 d-flex align-center">
            <p class="text-body-2 mb-0">
              When someone has an idea (like "let's spend 10 ADA on a party!"), they make a proposal. Everyone who
              contributed ADA can vote by pointing their tokens at the proposal they like. More tokens = more voting
              power.
            </p>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Action by Agreement -->
      <v-col cols="12" md="6" lg="3">
        <v-card flat outlined class="d-flex flex-column" style="height: 200px">
          <v-card-title class="d-flex align-center">
            <v-icon color="primary" class="mr-2">mdi-handshake</v-icon>
            Action by Agreement
          </v-card-title>
          <v-card-text class="flex-grow-1 d-flex align-center">
            <p class="text-body-2 mb-0">
              If enough friends vote "yes," the rule book automatically follows the instructions—moving the ADA, sending
              it somewhere, or doing whatever the proposal said.
            </p>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Participation Requirements -->
    <v-row class="mt-4">
      <v-col cols="12">
        <v-card flat outlined>
          <v-card-title class="d-flex align-center"> Who Can Participate </v-card-title>
          <v-card-text>
            <p class="text-body-1 mb-4">
              Any holder of the native governance token, $GERO, can take part—either by creating proposals or casting
              votes—once they meet the on-chain thresholds:
            </p>
            <v-list dense>
              <v-list-item>
                <v-list-item-icon>
                  <v-icon color="success">mdi-check-circle</v-icon>
                </v-list-item-icon>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2"
                    >Proposal Creation: ≥ 3,000,000 $GERO per wallet</v-list-item-title
                  >
                </v-list-item-content>
              </v-list-item>
              <v-list-item>
                <v-list-item-icon>
                  <v-icon color="success">mdi-check-circle</v-icon>
                </v-list-item-icon>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2"
                    >Voting Power: ≥ 100,000 $GERO per wallet</v-list-item-title
                  >
                </v-list-item-content>
              </v-list-item>
              <v-list-item>
                <v-list-item-icon>
                  <v-icon color="success">mdi-check-circle</v-icon>
                </v-list-item-icon>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2"
                    >Execution Quorum: ≥ 20,000,000 $GERO "Yes" votes for a proposal to pass</v-list-item-title
                  >
                </v-list-item-content>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Governance Mechanics -->
    <v-row class="mt-4">
      <v-col cols="12">
        <v-card flat outlined>
          <v-card-title class="d-flex align-center"> Governance Mechanics & Timelines </v-card-title>
          <v-card-text>
            <p class="text-body-1 mb-4">
              Proposals and votes unfold on a predictable schedule, enforced automatically by the Clarity contracts:
            </p>
            <v-simple-table dense class="transparent">
              <template v-slot:default>
                <thead>
                  <tr>
                    <th class="text-left text-caption font-weight-medium">Phase</th>
                    <th class="text-left text-caption font-weight-medium">Duration</th>
                    <th class="text-left text-caption font-weight-medium">Description</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="phase in governancePhases" :key="phase.name">
                    <td class="text-left text-caption font-weight-medium">{{ phase.name }}</td>
                    <td class="text-left text-caption">{{ phase.duration }}</td>
                    <td class="text-left text-caption">{{ phase.description }}</td>
                  </tr>
                </tbody>
              </template>
            </v-simple-table>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Tokenomics -->
    <v-row class="mt-4">
      <v-col cols="12" md="6">
        <v-card flat outlined>
          <v-card-title class="d-flex align-center"> Tokenomics </v-card-title>
          <v-card-text>
            <v-list dense>
              <v-list-item>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2">Total Supply: 500,000,000 $GERO</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
              <v-list-item>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2">Circulating Supply: 348,881,527 $GERO</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
              <v-list-item>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2">Team Allocation: ~20% of total supply</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Getting Involved -->
      <v-col cols="12" md="6">
        <v-card flat outlined>
          <v-card-title class="d-flex align-center"> Getting Involved </v-card-title>
          <v-card-text>
            <v-list dense>
              <v-list-item>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2">Acquire & Hold $GERO</v-list-item-title>
                  <v-list-item-subtitle class="text-caption"
                    >Make sure your wallet meets the proposal/voting thresholds</v-list-item-subtitle
                  >
                </v-list-item-content>
              </v-list-item>
              <v-list-item>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2">Connect Your Wallet</v-list-item-title>
                  <v-list-item-subtitle class="text-caption"
                    >Use a Cardano-compatible wallet via the Gero Dashboard</v-list-item-subtitle
                  >
                </v-list-item-content>
              </v-list-item>
              <v-list-item>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2">Join on Clarity</v-list-item-title>
                  <v-list-item-subtitle class="text-caption"
                    >Visit the Gero DAO page and opt into membership</v-list-item-subtitle
                  >
                </v-list-item-content>
              </v-list-item>
              <v-list-item>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2">Govern & Grow</v-list-item-title>
                  <v-list-item-subtitle class="text-caption"
                    >Draft proposals, cast votes, and help steer the future</v-list-item-subtitle
                  >
                </v-list-item-content>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup lang="ts">
import { ref } from 'vue';

interface GovernancePhase {
  name: string;
  duration: string;
  description: string;
}

const governancePhases = ref<GovernancePhase[]>([
  {
    name: 'Draft Period',
    duration: '24 hours',
    description: 'To prepare a proposal',
  },
  {
    name: 'Voting Window',
    duration: '14 days',
    description: 'Main voting period',
  },
  {
    name: 'Measure-Level Votes',
    duration: 'Up to 10 days',
    description: 'Within the main voting period for secondary questions',
  },
  {
    name: 'Token Lockup',
    duration: '24 hours',
    description: 'Tokens used for voting are locked',
  },
  {
    name: 'Execution Window',
    duration: 'Up to 180 days',
    description: 'To carry out a passed proposal',
  },
  {
    name: 'Cooldown Between Votes',
    duration: '1 hour minimum',
    description: 'Between successive votes',
  },
]);
</script>
