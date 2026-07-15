<template>
  <v-layout class="governance-theme">
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <v-card class="transparent" flat>
          <v-card-text>
            <v-row no-gutters>
              <!-- Left Column -->
              <v-col cols="12" xl="6" lg="6" md="6" class="px-2 pb-4">
                <v-card
                  outlined
                  flat
                  class="pa-4 fill-height d-flex flex-column justify-space-evenly liquid-glass delegation-card"
                  style="z-index: 1"
                >
                  <v-list-item three-line>
                    <v-list-item-content v-if="!currentDrepTxIsPending">
                      <div class="white--text font-weight-semibold text-subtitle-2">{{ $t('governance.currentDelegation') }}</div>
                      <v-list-item-title class="gradient-text text-h6 font-weight-semibold">
                        {{ delegatingTo }}
                      </v-list-item-title>
                      <v-list-item-subtitle
                        v-if="currentDRep && !currentDrepTxIsPending && currentDRep.drep_id !== 'drep_always_abstain' && currentDRep.drep_id !== 'drep_always_no_confidence'"
                        class="white--text font-weight-semibold"
                      >
                        {{ truncate(currentDRep.drep_id) }}<CopyButton small :value="currentDRep.drep_id"></CopyButton>
                      </v-list-item-subtitle>
                      <v-list-item-subtitle
                        v-if="currentDRep && !currentDrepTxIsPending && currentDRep.drep_id !== 'drep_always_abstain' && currentDRep.drep_id !== 'drep_always_no_confidence'"
                        class="gradient-text text-subtitle-2 font-weight-semibold"
                      >
                        {{ $t('governance.votingPowerLabel') }}:
                        {{
                          toCurrency(
                            currentDRep.amount,
                            false,
                            2,
                            networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network),
                            '',
                            true
                          )
                        }}
                      </v-list-item-subtitle>
                    </v-list-item-content>
                    <v-list-item-avatar
                      v-if="
                        currentDRep &&
                        currentDRep['metadata']?.meta_json?.body?.image?.contentUrl &&
                        !currentDrepTxIsPending
                      "
                      size="80"
                      rounded
                    >
                      <v-img :src="currentDRep['metadata'].meta_json.body.image.contentUrl" contain></v-img>
                    </v-list-item-avatar>
                    <v-list-item-content v-if="currentDrepTxIsPending">
                      <div class="white--text font-weight-semibold text-subtitle-2">{{ $t('governance.currentDelegation') }}</div>
                      <v-list-item-title class="gradient-text text-h6 font-weight-semibold">
                        {{ $t('governance.delegating') }}
                      </v-list-item-title>
                    </v-list-item-content>
                    <v-list-item-avatar v-if="currentDrepTxIsPending" size="80" rounded>
                      <v-progress-circular indeterminate color="white"></v-progress-circular>
                    </v-list-item-avatar>
                  </v-list-item>
                  <v-card-text class="px-0 pb-0">
                    <div class="d-flex">
                      <v-select
                        v-model="delegationModel"
                        :label="$t('governance.newDelegation')"
                        outlined
                        :items="[$t('governance.ownAccount'), $t('governance.abstain'), $t('governance.noConfidence')]"
                        dense
                        hide-details
                        :menu-props="{ offsetY: true }"
                        attach
                      />
                      <v-btn
                        class="geroButton ml-3"
                        style="color: black !important"
                        height="40"
                        :disabled="
                          delegationModel === undefined ||
                          delegateLoading ||
                          delegationModel === $t('governance.ownAccount') ||
                          currentDrepTxIsPending
                        "
                        @click="delegate"
                        :loading="delegateLoading"
                      >
                        {{ $t('governance.delegate') }}
                      </v-btn>
                    </div>
                  </v-card-text>
                  <!-- CIP-0149: Compensation Status Banner -->
                  <v-sheet
                    v-if="currentCompensationBps && currentDRep && currentDRep.drep_id !== 'drep_always_abstain' && currentDRep.drep_id !== 'drep_always_no_confidence'"
                    rounded="lg"
                    color="#1a2332"
                    class="pa-3 mt-3 d-flex align-center"
                  >
                    <v-icon small color="primary" class="mr-2">mdi-gift-outline</v-icon>
                    <div>
                      <span class="text-subtitle-2 white--text">
                        {{ $t('governance.supportingDrep') }}
                        <v-chip x-small color="primary" outlined class="ml-1">{{ compensationPercentDisplay }}</v-chip>
                        {{ $t('governance.ofRewards') }}
                      </span>
                      <div class="text-caption text--secondary">
                        {{ $t('governance.cip149') }}
                      </div>
                    </div>
                  </v-sheet>

                  <v-alert
                    class="mt-4 mb-0 transparent"
                    border="left"
                    colored-border
                    color="primary"
                    type="info"
                    elevation="0"
                  >
                    {{ $t('governance.delegateToDRep') }};
                    <br />
                    {{ $t('governance.requiredToWithdrawRewards') }}
                  </v-alert>
                </v-card>
              </v-col>
              <!-- Right Column -->
              <v-col cols="12" xl="6" lg="6" md="6" class="px-2 pb-4">
                <v-card outlined flat class="pa-0 fill-height liquid-glass">
                  <v-card-title class="text-subtitle-2">
                    <a class="white--text" href="https://gov.tools/" target="_blank">
                      {{ $t('governance.cardanoGovernanceTool') }}<v-icon class="ml-1" small>mdi-open-in-new</v-icon>
                    </a>
                  </v-card-title>
                  <v-card-subtitle class="text-body-2"> {{ $t('governance.officialDApp') }} </v-card-subtitle>
                  <v-card-title class="pt-0 text-subtitle-2">
                    <a class="white--text" href="https://www.1694.io/en" target="_blank">
                      {{ $t('governance.onChainGovernance') }}<v-icon class="ml-1" small
                        >mdi-open-in-new</v-icon
                      >
                    </a>
                  </v-card-title>
                  <v-card-subtitle class="text-body-2">
                    {{ $t('governance.cip1694') }}
                  </v-card-subtitle>
                  <v-card-subtitle class="pt-0 text-subtitle-2 white--text">
                    {{ $t('governance.governanceParticipation') }}
                  </v-card-subtitle>
                  <div class="px-4 py-0 text-center">
                    <v-tooltip bottom content-class="custom-tooltip">
                      <template v-slot:activator="{ on, attrs }">
                        <span
                          v-bind="attrs"
                          v-on="on"
                          class="mr-8 white--text text-decoration-underline cursor-pointer"
                        >
                          {{ $t('governance.abstain') }}<v-icon class="ml-1" small>mdi-information-outline</v-icon>
                        </span>
                      </template>
                      <div class="w-250">
                        {{ $t('governance.abstainInfo') }}
                      </div>
                    </v-tooltip>
                    <v-tooltip bottom content-class="custom-tooltip">
                      <template v-slot:activator="{ on, attrs }">
                        <span v-bind="attrs" v-on="on" class="mr-8 white--text text-decoration-underline cursor-pointer"
                          >{{ $t('governance.noConfidence') }}<v-icon class="ml-1" small>mdi-information-outline</v-icon>
                        </span>
                      </template>
                      <div class="w-250">
                        {{ $t('governance.noConfidenceInfo') }}
                      </div>
                    </v-tooltip>
                  </div>
                  <v-card-actions class="justify-center">
                    {{ $t('governance.myDRepId') }}: {{ truncate(drepId) }}<CopyButton class="ml-1" small :value="drepId" v-if="drepId" />
                  </v-card-actions>
                </v-card>
              </v-col>
              <v-col cols="12" class="px-2">
                <v-card outlined flat class="pa-0 fill-height liquid-glass">
                  <v-card-title
                    >{{ t('governance.delegatedRepresentatives') }}
                    <v-spacer></v-spacer>
                    <v-text-field
                      v-model="search"
                      dense
                      flat
                      solo
                      hide-details
                      :placeholder="t('governance.searchDReps')"
                      prepend-inner-icon="mdi-magnify"
                      clearable
                      style="max-width: 200px"
                      class="top-level-search"
                      :loading="drepsLoading"
                    ></v-text-field>
                  </v-card-title>
                  <!-- Debug pagination info -->
                  <v-card-subtitle v-if="paginationMeta" class="text-caption">
                    {{ t('governance.showingDReps', {
                      showing: governanceDReps?.length || 0,
                      total: paginationMeta.total_items,
                      page: paginationMeta.page,
                      totalPages: paginationMeta.total_pages
                    }) }}
                  </v-card-subtitle>
                  <v-card-text class="px-0">
                    <v-data-table
                      class="dRepsTable transparent"
                      dense
                      :items="drepsList"
                      :headers="drepsHeaders"
                      :header-props="{ 'sort-icon': 'mdi-menu-up' }"
                      :sort-by.sync="sortBy"
                      :sort-desc.sync="sortDesc"
                      :must-sort="true"
                      @click:row="drepDelegate"
                      :loading="drepsLoading"
                      loading-text="Loading DReps..."
                      :items-per-page="itemsPerPage"
                      :page.sync="currentPage"
                      :server-items-length="paginationMeta?.total_items || 0"
                      :disable-sort="false"
                      @update:page="onPageChange"
                      @update:items-per-page="onItemsPerPageChange"
                      no-data-text="No DReps found"
                      no-results-text="No DReps match your search"
                      :item-class="(item) => isCurrentDRep(item.id) ? 'current-drep-row' : ''"
                    >
                      <template v-slot:[`item.name`]="{ item }">
                        <v-list-item dense class="px-0 drep-list-item" two-line>
                          <v-list-item-avatar rounded size="28" color="var(--g-raised)">
                            <v-img v-if="item.image" :src="item.image" contain>
                              <template v-slot:error>
                                <div class="d-flex align-center justify-center" style="width: 100%; height: 100%">
                                  <v-icon size="18" color="var(--g-text-3)">mdi-account</v-icon>
                                </div>
                              </template>
                            </v-img>
                            <v-icon v-else size="18" color="var(--g-text-3)">mdi-account</v-icon>
                          </v-list-item-avatar>
                          <v-list-item-content class="pl-12">
                            <v-list-item-title class="drep-title">
                              <span class="font-16">{{ item.name }} </span>
                              <v-chip
                                v-if="isCurrentDRep(item.id)"
                                x-small
                                color="primary"
                                class="ml-2"
                                style="pointer-events: none"
                              >
                                <v-icon x-small left>mdi-check-circle</v-icon>
                                {{ $t('governance.currentDelegation') }}
                              </v-chip>
                              <v-tooltip bottom v-if="currentCompensationBps && isCurrentDRep(item.id)">
                                <template v-slot:activator="{ on, attrs }">
                                  <v-icon x-small color="primary" v-bind="attrs" v-on="on" class="ml-1">mdi-gift-outline</v-icon>
                                </template>
                                <span>{{ $t('governance.youAreSupportingThisDrep', { percent: compensationPercentDisplay }) }}</span>
                              </v-tooltip>
                              <template v-for="(link, index) in item.links">
                                <v-btn
                                  icon
                                  x-small
                                  :key="index"
                                  :href="link.uri"
                                  target="_blank"
                                  v-if="link.uri && typeof link.uri === 'string'"
                                  :class="index == 0 ? 'ml-2' : ''"
                                >
                                  <v-avatar
                                    tile
                                    size="14"
                                    v-if="
                                      String(link.uri).includes('https://x.com') ||
                                      String(link.uri).includes('https://twitter.com')
                                    "
                                  >
                                    <v-img :src="xLogo" alt="x"></v-img>
                                  </v-avatar>
                                  <v-avatar tile size="14" v-else-if="String(link.uri).includes('https://t.me')">
                                    <v-img :src="telegramLogo" alt="x"></v-img>
                                  </v-avatar>
                                  <v-icon v-else>
                                    {{ getIconByURI(link.uri) }}
                                  </v-icon>
                                </v-btn>
                              </template>
                            </v-list-item-title>
                            <v-list-item-subtitle class="drep-subtitle">
                              {{ truncate(item.id)
                              }}<CopyButton class="ml-1" x-small :value="item.id" v-if="item"></CopyButton>
                            </v-list-item-subtitle>
                          </v-list-item-content>
                        </v-list-item>
                      </template>
                      <template v-slot:[`item.voting_power`]="{ item }">
                        {{
                          toCurrency(
                            item.voting_power,
                            false,
                            2,
                            networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network),
                            '',
                            true
                          )
                        }}
                      </template>
                    </v-data-table>
                  </v-card-text>
                </v-card>
              </v-col>
            </v-row>
          </v-card-text>
          <DRepDelegateDialog
            :isOpen="isDelegateDialogOpen"
            @close="isDelegateDialogOpen = false"
            :drep="selectedDRep"
            :tx="txData"
          ></DRepDelegateDialog>
        </v-card>
      </v-col>
    </v-row>
  </v-layout>
</template>
<script setup lang="ts">
import { ref, computed, toRefs, onMounted, onUnmounted, watch, getCurrentInstance } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import CopyButton from '@/shared/components/CopyButton.vue';
import filters from '@/shared/utils/filters';

const { t } = useTranslation();
const instance = getCurrentInstance();
import governanceStoreActions from '@/stores/governanceStore';
import networks from '@/utils/networks';
import DRepDelegateDialog from '@/modules/governance/dialogs/DRepDelegateDialog.vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { buildCardanoTransaction, extractCip149Compensation } from '@/shared/utils/builder';
import snackbar from '@/plugins/snackbar';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { debugLog } from '@/utils/debug';

const { truncate, toCurrency } = filters;

const { loggedWallet, utxos, account, keys } = toRefs(walletStore);
const { epochParams, tip } = toRefs(networkStore);

// Governance store
const { dreps: governanceDReps, loading: drepsLoading, paginationMeta } = toRefs(governanceStoreActions.state);
const { currentDRep, currentCompensationBps } = toRefs(governanceStoreActions.state);
const { transactions: txs } = toRefs(walletStore);

// CIP-0149: Compensation display
const compensationPercentDisplay = computed(() => {
  if (!currentCompensationBps.value) return '';
  return (currentCompensationBps.value / 10).toFixed(1) + '%';
});

const currentDrepTxIsPending = computed(() => {
  const pendingTx = txs.value?.find(tx => tx.pending);
  const isDrepTx = pendingTx?.body.certificates?.some(
    cert =>
      cert.__typename === Cardano.CertificateType.VoteDelegation ||
      cert.__typename === Cardano.CertificateType.VoteRegistrationDelegation
  );
  return !!isDrepTx;
});

// Create a computed property for dreps that combines governance data
const dreps = computed(() => {
  const drepsMap = {};
  if (governanceDReps.value?.length > 0) {
    governanceDReps.value.forEach(drep => {
      drepsMap[drep.drep_id] = drep;
    });
  }
  return drepsMap;
});

// Get drepId from loggedWallet
const drepId = computed(() => keys.value?.drep129[0].address);

// Data refs
const delegateLoading = ref(false);
const txData = ref(undefined);
const isDelegateDialogOpen = ref(false);
const selectedDRep = ref(undefined);
const delegationModel = ref(undefined);
const xLogo = assets.xSvg;
const telegramLogo = assets.telegramSvg;
const sortBy = ref('voting_power');
const sortDesc = ref(true);
const search = ref('');
const drepsHeaders = [
  { text: t('common.id'), sortable: false, align: 'transparent', value: 'id' },
  { text: t('common.name'), sortable: true, align: 'left', value: 'name' },
  { text: t('governance.delegators'), sortable: true, align: 'left', value: 'delegators', width: '120' },
  { text: t('governance.votes'), sortable: true, align: 'left', value: 'votes', width: '85' },
  { text: t('governance.votingPower'), sortable: true, align: 'left', value: 'voting_power', width: '131' },
];

// Computed properties
const delegatingTo = computed(() => {
  let res = String(t('governance.undelegated'));
  if (currentDRep.value) {
    if (currentDRep.value.drep_id == 'drep_always_no_confidence') {
      res = String(t('governance.noConfidence'));
    } else if (currentDRep.value.drep_id == 'drep_always_abstain') {
      res = String(t('governance.abstain'));
    } else {
      const drep = currentDRep.value;
      if (drep && drep['metadata']?.meta_json?.body?.givenName) {
        if (drep['metadata'].meta_json.body.givenName['@value']) {
          res = drep['metadata'].meta_json.body.givenName['@value'];
        } else {
          res = drep['metadata'].meta_json.body.givenName;
        }
      }
    }
  }
  return res;
});

const drepsList = computed(() => {
  // Use paginated governance data if available
  if (governanceDReps.value?.length > 0) {
    return governanceDReps.value.map(drep => {
      let name = 'N/A';
      if (drep['metadata']?.meta_json?.body?.givenName) {
        if (drep['metadata'].meta_json.body.givenName['@value']) {
          name = drep['metadata'].meta_json.body.givenName['@value'];
        } else {
          name = drep['metadata'].meta_json.body.givenName;
        }
      }
      let image;
      if (drep['metadata']?.meta_json?.body?.image?.contentUrl) {
        image = drep['metadata'].meta_json.body.image.contentUrl;
      }
      return {
        id: drep['drep_id'],
        name,
        image,
        delegators: drep['delegators']?.length || 0,
        votes: drep['votes']?.length || 0,
        voting_power: Number(drep['amount'] || 0),
        links: drep['metadata']?.meta_json?.body?.references,
        hex: drep['hex'],
        registered: drep['registered'],
        has_script: drep['has_script'],
        active: drep['active'],
        more: drep,
      };
    });
  }

  // Fallback to governance store data
  if (Object.keys(dreps.value).length > 0) {
    return Object.values(dreps.value)
      .filter(drep => drep != null)
      .map(drep => {
        let name = 'N/A';
        if (drep['metadata']?.meta_json?.body?.givenName) {
          if (drep['metadata'].meta_json.body.givenName['@value']) {
            name = drep['metadata'].meta_json.body.givenName['@value'];
          } else {
            name = drep['metadata'].meta_json.body.givenName;
          }
        }
        let image;
        if (drep['metadata']?.meta_json?.body?.image?.contentUrl) {
          image = drep['metadata'].meta_json.body.image.contentUrl;
        }
        return {
          id: drep['drep_id'],
          name,
          image,
          delegators: drep['delegators']?.length || 0,
          votes: drep['votes']?.length || 0,
          voting_power: Number(drep['amount'] || 0),
          links: drep['metadata']?.meta_json?.body?.references,
          hex: drep['hex'],
          registered: drep['registered'],
          has_script: drep['has_script'],
          active: drep['active'],
          more: drep,
        };
      });
  }

  return [];
});

// Methods
const getIconByURI = (uri: string) => {
  if (String(uri).includes('https://github.com')) {
    return 'mdi-github';
  } else if (String(uri).includes('youtube.com') || String(uri).includes('youtu.be')) {
    return 'mdi-youtube';
  } else if (String(uri).includes('linkedin.com')) {
    return 'mdi-linkedin';
  } else if (String(uri).includes('instagram.com')) {
    return 'mdi-instagram';
  } else if (String(uri).includes('discord.com')) {
    return 'mdi-discord';
  }
  return 'mdi-link';
};

const delegate = async () => {
  delegateLoading.value = true;

  try {
    if (!epochParams.value) {
      throw new Error(t('common.epochParametersNotAvailable'));
    }

    const certificates: Cardano.Certificate[] = [];

    // Create stake credential from the key hash
    const stakeCredential: Cardano.Credential = {
      type: Cardano.CredentialType.KeyHash,
      hash: keys.value.stake[0].cred,
    };

    // Create DRep ID based on selection
    let dRep: Cardano.DelegateRepresentative;
    if (delegationModel.value === String(t('governance.abstain'))) {
      dRep = {
        __typename: 'AlwaysAbstain',
      } as Cardano.AlwaysAbstain;
    } else if (delegationModel.value === String(t('governance.noConfidence'))) {
      dRep = {
        __typename: 'AlwaysNoConfidence',
      } as Cardano.AlwaysNoConfidence;
    } else if (delegationModel.value === String(t('governance.ownAccount'))) {
      delegateLoading.value = false;
      return; // TODO
    } else {
      delegateLoading.value = false;
      return;
    }

    // Use proper deposit from epoch parameters - ensure BigInt conversion
    const stakeKeyDepositLovelace = BigInt(epochParams.value.stakeKeyDeposit);
    let implicitCoin = BigInt(0);
    let certificate: Cardano.Certificate;

    if (!account.value?.active) {
      // Need to register a stake key first, then delegate
      certificate = {
        __typename: Cardano.CertificateType.VoteRegistrationDelegation,
        stakeCredential,
        dRep,
        deposit: stakeKeyDepositLovelace,
      } as Cardano.VoteRegistrationDelegationCertificate;
      implicitCoin = stakeKeyDepositLovelace; // Deposit required
    } else {
      // Just delegate, no registration needed
      certificate = {
        __typename: Cardano.CertificateType.VoteDelegation,
        stakeCredential,
        dRep,
      } as Cardano.VoteDelegationCertificate;
    }
    certificates.push(certificate);

    // Set the selected DRep info first
    if (delegationModel.value === String(t('governance.abstain'))) {
      selectedDRep.value = {
        id: '',
        name: String(t('governance.abstain')),
        image: '',
        delegators: 0,
        votes: 0,
        voting_power: 0,
      };
    } else if (delegationModel.value === String(t('governance.noConfidence'))) {
      selectedDRep.value = {
        id: '',
        name: String(t('governance.noConfidence')),
        image: '',
        delegators: 0,
        votes: 0,
        voting_power: 0,
      };
    }

    // Use the generic transaction builder with wallet context for accurate fee calculation
    txData.value = await buildCardanoTransaction({
      certificates,
      utxos: utxos.value,
      epochParams: epochParams.value,
      changeAddress: keys.value.payment[0].address,
      tip: tip.value,
      implicitCoin,
      walletContext: {
        keys: keys.value,
        stakeAddress: loggedWallet.value.stakeAddress,
        accountIndex: 0
      }
    });

    debugLog('Vote delegation transaction built successfully');
    isDelegateDialogOpen.value = true;
  } catch (error) {
    console.error('Error building vote delegation transaction:', error);
    snackbar.setError(`${t('errors.buildTransactionFailed')}: ${error instanceof Error ? error.message : t('errors.unknownError')}`);
  }

  delegateLoading.value = false;
};

const isCurrentDRep = (drepId: string) => {
  return currentDRep.value && currentDRep.value.drep_id === drepId;
};

const drepDelegate = async (row: any) => {
  // Don't allow re-delegating to the currently delegated DRep
  if (isCurrentDRep(row.id)) return;

  selectedDRep.value = row;

  try {
    const certificates: Cardano.Certificate[] = [];

    // Create stake credential from the key hash
    const stakeCredential: Cardano.Credential = {
      type: Cardano.CredentialType.KeyHash,
      hash: keys.value.stake[0].cred,
    };

    // Create DRep object from selected DRep data
    debugLog('selectedDRep', selectedDRep.value);
    const dRep = selectedDRep.value.has_script
      ? Serialization.DRep.newScriptHash(selectedDRep.value.hex)
      : Serialization.DRep.newKeyHash(selectedDRep.value.hex);

    // Use proper deposit from epoch parameters - ensure BigInt conversion
    const stakeKeyDepositLovelace = BigInt(epochParams.value.stakeKeyDeposit);
    let implicitCoin = BigInt(0);
    let certificate: Cardano.Certificate;

    if (!account.value?.active) {
      // Need to register a stake key first, then delegate
      certificate = {
        __typename: Cardano.CertificateType.VoteRegistrationDelegation,
        stakeCredential,
        dRep: dRep.toCore(),
        deposit: stakeKeyDepositLovelace,
      } as Cardano.VoteRegistrationDelegationCertificate;
      implicitCoin = stakeKeyDepositLovelace; // Deposit required
    } else {
      // Just delegate, no registration needed
      certificate = {
        __typename: Cardano.CertificateType.VoteDelegation,
        stakeCredential,
        dRep: dRep.toCore(),
      } as Cardano.VoteDelegationCertificate;
    }
    certificates.push(certificate);

    // Use the generic transaction builder with wallet context for accurate fee calculation
    txData.value = await buildCardanoTransaction({
      certificates,
      utxos: utxos.value,
      epochParams: epochParams.value,
      changeAddress: keys.value.payment[0].address,
      tip: tip.value,
      implicitCoin,
      walletContext: {
        keys: keys.value,
        stakeAddress: loggedWallet.value.stakeAddress,
        accountIndex: 0
      }
    });

    isDelegateDialogOpen.value = true;
  } catch (error) {
    console.error('Error building DRep delegation transaction:', error);
    snackbar.setError(`${t('errors.buildTransactionFailed')}: ${error instanceof Error ? error.message : t('errors.unknownError')}`);
  }
};

const currentPage = ref(1);
const itemsPerPage = ref(15);

const loadDRepsPaginated = async (page: number = 1) => {
  currentPage.value = page;

  const wallet = loggedWallet.value;
  if (!wallet) {
    console.error('❌ No wallet found');
    return;
  }

  await governanceStoreActions.loadDRepsPaginated(wallet, {
    page,
    per_page: itemsPerPage.value,
    search: search.value,
    sort_by: sortBy.value,
    sort_direction: sortDesc.value ? 'desc' : 'asc',
  });
};

const onPageChange = (page: number) => {
  loadDRepsPaginated(page);
};

const onItemsPerPageChange = (newItemsPerPage: number) => {
  itemsPerPage.value = newItemsPerPage;
  currentPage.value = 1;
  loadDRepsPaginated(1);
};

const onSearchChange = (searchTerm: string) => {
  governanceStoreActions.updateFilters({ search: searchTerm });
  loadDRepsPaginated(1);
};

let sortTimeout: NodeJS.Timeout;
const onSortChange = () => {
  if (sortTimeout) clearTimeout(sortTimeout);
  sortTimeout = setTimeout(() => {
    loadDRepsPaginated(1);
  }, 100);
};

// Watch search changes
let searchTimeout: NodeJS.Timeout;
watch(search, newSearch => {
  if (searchTimeout) clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    onSearchChange(newSearch);
  }, 500);
});

watch([sortBy, sortDesc], ([newSortBy, newSortDesc]) => {
  if (newSortBy !== undefined && newSortDesc !== undefined) {
    onSortChange();
  }
});

onMounted(async () => {
  // Handle ?drep=<id> deep-link from Global Search — pre-fill search
  const drepQuery = instance?.proxy?.$route?.query?.drep;
  if (drepQuery && typeof drepQuery === 'string') {
    search.value = drepQuery;
  }
  await loadDRepsPaginated(1);

  // CIP-0149: Detect existing compensation from the latest vote delegation transaction
  if (txs.value?.length > 0) {
    const latestDelegationTx = txs.value
      .filter(tx => !tx.pending && tx.body?.certificates?.some(
        cert => cert.__typename === Cardano.CertificateType.VoteDelegation ||
                cert.__typename === Cardano.CertificateType.VoteRegistrationDelegation
      ))
      .sort((a, b) => (b.block_height || 0) - (a.block_height || 0))[0];

    if (latestDelegationTx) {
      const bps = extractCip149Compensation(latestDelegationTx.auxiliaryData);
      governanceStoreActions.setCompensationBps(bps);
    }
  }
});

watch(
  account,
  async () => {
    if (account.value?.drep_id) {
      await governanceStoreActions.loadDRepById(loggedWallet.value, account.value.drep_id);
    }
  },
  { immediate: true }
);

onUnmounted(() => {
  // Clean up timeouts
  if (searchTimeout) clearTimeout(searchTimeout);
  if (sortTimeout) clearTimeout(sortTimeout);
});
</script>
<style scoped>
/* Simple utility classes */
.flex-center {
  display: flex;
  align-items: center;
}
.pl-12 {
  padding-left: 12px !important;
}
.font-16 {
  font-size: 16px;
}
.w-250 {
  width: 250px;
}
.ml-1 {
  margin-left: 1px;
}
.mb-2 {
  margin-bottom: 2px;
}

.top-level-search.v-text-field {
  background: transparent !important;
}

.top-level-search >>> .v-input__slot {
  background: transparent !important;
  box-shadow: none !important;
}

.top-level-search >>> .v-input__control {
  background: transparent !important;
}

.top-level-search >>> .v-text-field__slot {
  background: transparent !important;
}

.top-level-search >>> .v-input__slot:before {
  border: none !important;
}

.top-level-search >>> .v-input__slot:after {
  border: none !important;
}

.top-level-search.v-text-field--solo > .v-input__control > .v-input__slot {
  background: transparent !important;
}

@media (max-width: 600px) {
  .top-level-search {
    order: 2 !important;
    margin-left: 0 !important;
    flex: 1 1 auto !important;
  }

  .table-container {
    max-height: calc(100vh - 150px);
  }
}
</style>
<style>
.dRepsTable {
  :is(tbody) {
    cursor: pointer;
  }

  .current-drep-row {
    cursor: default !important;
    opacity: 0.65;
  }

  .current-drep-row:hover {
    background: transparent !important;
  }
}
</style>
