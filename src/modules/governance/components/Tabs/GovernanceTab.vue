<template>
  <v-container fluid class="pa-4">
    <v-row>
      <!-- Treasury of Tokens -->
      <v-col cols="12" md="6" lg="3">
        <v-card flat outlined class="d-flex flex-column" style="height: 200px">
          <v-card-title class="d-flex align-center">
            <v-icon color="primary" class="mr-2">mdi-treasure-chest</v-icon>
            {{ $t('governance.treasuryOfTokens') }}
          </v-card-title>
          <v-card-text class="flex-grow-1 d-flex align-center">
            <p class="text-body-2 mb-0">
              {{ $t('governance.treasuryDescription') }}
            </p>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Magic Rule Book -->
      <v-col cols="12" md="6" lg="3">
        <v-card flat outlined class="d-flex flex-column" style="height: 200px">
          <v-card-title class="d-flex align-center">
            <v-icon color="primary" class="mr-2">mdi-book-open-variant</v-icon>
            {{ $t('governance.magicRuleBook') }}
          </v-card-title>
          <v-card-text class="flex-grow-1 d-flex align-center">
            <p class="text-body-2 mb-0">
              {{ $t('governance.magicRuleBookDescription') }}
            </p>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Voting with Your ADA -->
      <v-col cols="12" md="6" lg="3">
        <v-card flat outlined class="d-flex flex-column" style="height: 200px">
          <v-card-title class="d-flex align-center">
            <v-icon color="primary" class="mr-2">mdi-vote</v-icon>
            {{ $t('governance.votingWithYourAda') }}
          </v-card-title>
          <v-card-text class="flex-grow-1 d-flex align-center">
            <p class="text-body-2 mb-0">
              {{ $t('governance.votingWithAdaDescription') }}
            </p>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Action by Agreement -->
      <v-col cols="12" md="6" lg="3">
        <v-card flat outlined class="d-flex flex-column" style="height: 200px">
          <v-card-title class="d-flex align-center">
            <v-icon color="primary" class="mr-2">mdi-handshake</v-icon>
            {{ $t('governance.actionByAgreement') }}
          </v-card-title>
          <v-card-text class="flex-grow-1 d-flex align-center">
            <p class="text-body-2 mb-0">
              {{ $t('governance.actionByAgreementDescription') }}
            </p>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <!-- Participation Requirements -->
    <v-row class="mt-4">
      <v-col cols="12">
        <v-card flat outlined>
          <v-card-title class="d-flex align-center">{{ $t('governance.whoCanParticipate') }}</v-card-title>
          <v-card-text>
            <p class="text-body-1 mb-4">
              {{ $t('governance.participationDescription') }}
            </p>
            <v-list dense>
              <v-list-item>
                <v-list-item-icon>
                  <v-icon color="success">mdi-check-circle</v-icon>
                </v-list-item-icon>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2">{{ $t('governance.proposalCreationRequirement') }}</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
              <v-list-item>
                <v-list-item-icon>
                  <v-icon color="success">mdi-check-circle</v-icon>
                </v-list-item-icon>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2"
                    >{{ $t('governance.votingPowerLabel') }}: ≥ 100,000 $GERO per wallet</v-list-item-title
                  >
                </v-list-item-content>
              </v-list-item>
              <v-list-item>
                <v-list-item-icon>
                  <v-icon color="success">mdi-check-circle</v-icon>
                </v-list-item-icon>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2">{{ $t('governance.executionQuorum') }}</v-list-item-title>
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
          <v-card-title class="d-flex align-center">{{ $t('governance.governanceMechanicsTimelines') }}</v-card-title>
          <v-card-text>
            <p class="text-body-1 mb-4">
              {{ $t('governance.mechanicsDescription') }}
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
                  <v-list-item-title class="text-subtitle-2">{{ $t('governance.totalSupply') }}</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
              <v-list-item>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2">{{ $t('governance.circulatingSupply') }}</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
              <v-list-item>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2">{{ $t('governance.teamAllocation') }}</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
            </v-list>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Getting Involved -->
      <v-col cols="12" md="6">
        <v-card flat outlined>
          <v-card-title class="d-flex align-center">{{ $t('governance.gettingInvolved') }}</v-card-title>
          <v-card-text>
            <v-list dense>
              <v-list-item>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2">{{ $t('governance.acquireHoldGero') }}</v-list-item-title>
                  <v-list-item-subtitle class="text-caption"
                    >{{ $t('governance.makesSureWalletMeetsThresholds') }}</v-list-item-subtitle
                  >
                </v-list-item-content>
              </v-list-item>
              <v-list-item>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2">{{ $t('governance.connectYourWallet') }}</v-list-item-title>
                  <v-list-item-subtitle class="text-caption"
                    >{{ $t('governance.useCardanoCompatibleWallet') }}</v-list-item-subtitle
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
import { useTranslation } from '@/shared/composables/useTranslation';
const { t } = useTranslation();

const governancePhases = [
  {
    name: String(t('governance.draftPeriod')),
    duration: String(t('governance.twentyFourHours')),
    description: String(t('governance.draftPeriodDescription')),
  },
  {
    name: String(t('governance.votingWindow')),
    duration: String(t('governance.fourteenDays')),
    description: String(t('governance.votingWindowDescription')),
  },
  {
    name: String(t('governance.followUpVoting')),
    duration: String(t('governance.upTo10Days')),
    description: String(t('governance.followUpVotingDescription')),
  },
  {
    name: String(t('governance.tokenLockup')),
    duration: String(t('governance.twentyFourHours')),
    description: String(t('governance.tokenLockupDescription')),
  },
  {
    name: String(t('governance.executionWindow')),
    duration: String(t('governance.upTo180Days')),
    description: String(t('governance.executionWindowDescription')),
  },
  {
    name: String(t('governance.cooldownBetweenVotes')),
    duration: String(t('governance.oneHourMinimum')),
    description: String(t('governance.cooldownDescription')),
  },
];
</script>
