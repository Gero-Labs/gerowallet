<template>
  <v-layout class="governance-theme">
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <v-card class="transparent" flat>
          <v-card-title class="justify-center text-center pb-8 text-h3"> Cardano Governance </v-card-title>
          <v-card-subtitle class="justify-center text-center text-subtitle-1">
            Cardano Governance empowers ADA holders to actively participate in shaping the network's future. You can
            cast your vote directly, choose a representative to act on your behalf, or take on the role of representing
            others. Additionally, you can propose your own changes to the network, engage in discussions, and ultimately
            bring them to a vote.
          </v-card-subtitle>
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
                      <div class="white--text font-weight-semibold text-subtitle-2">Current Delegation</div>
                      <v-list-item-title class="gradient-text text-h6 font-weight-semibold">
                        {{ delegatingTo }}
                      </v-list-item-title>
                      <v-list-item-subtitle
                        v-if="currentDRep && !currentDrepTxIsPending"
                        class="white--text font-weight-semibold"
                      >
                        {{ truncate(currentDRep.drep_id) }}<CopyButton small :value="currentDRep.drep_id"></CopyButton>
                      </v-list-item-subtitle>
                      <v-list-item-subtitle
                        v-if="currentDRep && !currentDrepTxIsPending"
                        class="gradient-text text-subtitle-2 font-weight-semibold"
                      >
                        Voting Power:
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
                      <v-img :src="currentDRep['metadata'].meta_json.body.image.contentUrl" contain></v-img>/
                    </v-list-item-avatar>
                    <v-list-item-content v-if="currentDrepTxIsPending">
                      <div class="white--text font-weight-semibold text-subtitle-2">Current Delegation</div>
                      <v-list-item-title class="gradient-text text-h6 font-weight-semibold">
                        Delegating...
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
                        label="New Delegation"
                        outlined
                        :items="['Own Account (soon)', 'Gero DRep (soon)', 'Abstain', 'No Confidence']"
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
                          delegationModel === 'Own Account (soon)' ||
                          delegationModel === 'Gero DRep (soon)'
                        "
                        @click="delegate"
                        :loading="delegateLoading || currentDrepTxIsPending"
                      >
                        Delegate
                      </v-btn>
                    </div>
                  </v-card-text>
                  <v-alert
                    class="mt-4 mb-0 transparent"
                    border="left"
                    colored-border
                    color="primary"
                    type="info"
                    elevation="0"
                  >
                    Delegate to a DRep for governance actions;
                    <br />
                    It will be required to withdraw staking rewards
                  </v-alert>
                </v-card>
              </v-col>
              <!-- Right Column -->
              <v-col cols="12" xl="6" lg="6" md="6" class="px-2 pb-4">
                <v-card outlined flat class="pa-0 fill-height liquid-glass">
                  <v-card-title class="text-subtitle-2">
                    <a class="white--text" href="https://gov.tools/" target="_blank">
                      Cardano Governance Tool<v-icon class="ml-1" small>mdi-open-in-new</v-icon>
                    </a>
                  </v-card-title>
                  <v-card-subtitle class="text-body-2"> The official Cardano DApp for governance </v-card-subtitle>
                  <v-card-title class="pt-0 text-subtitle-2">
                    <a class="white--text" href="https://www.1694.io/en" target="_blank">
                      An On-Chain Decentralized Governance Mechanism for Voltaire<v-icon class="ml-1" small
                        >mdi-open-in-new</v-icon
                      >
                    </a>
                  </v-card-title>
                  <v-card-subtitle class="text-body-2">
                    Cardano decentralized governance proposal - CIP 1694
                  </v-card-subtitle>
                  <v-card-subtitle class="pt-0 text-subtitle-2 white--text">
                    To participate in governance, every stake credential must be delegated to a DRep. ADA holders will
                    typically assign their voting rights to a registered DRep who will vote on their behalf.
                    Additionally, there are two predefined DRep options available:
                  </v-card-subtitle>
                  <div class="px-4 py-0 text-center">
                    <v-tooltip bottom content-class="custom-tooltip">
                      <template v-slot:activator="{ on, attrs }">
                        <span
                          v-bind="attrs"
                          v-on="on"
                          class="mr-8 white--text text-decoration-underline cursor-pointer"
                        >
                          Abstain<v-icon class="ml-1" small>mdi-information-outline</v-icon>
                        </span>
                      </template>
                      <div class="w-250">
                        When an ADA holder delegates to Abstain, their stake is marked as not participating in
                        governance and is excluded from the active voting stake on-chain. However, it remains registered
                        for incentive purposes.
                      </div>
                    </v-tooltip>
                    <v-tooltip bottom content-class="custom-tooltip">
                      <template v-slot:activator="{ on, attrs }">
                        <span v-bind="attrs" v-on="on" class="mr-8 white--text text-decoration-underline cursor-pointer"
                          >No Confidence<v-icon class="ml-1" small>mdi-information-outline</v-icon>
                        </span>
                      </template>
                      <div class="w-250">
                        Delegating to No Confidence means an ADA holder's stake votes "no" on all governance actions
                        except "Motions of No Confidence," where it votes "yes," indicating distrust in the
                        constitutional committee. This stake is part of the active voting stake and provides an
                        auditable measure of holders' confidence.
                      </div>
                    </v-tooltip>
                  </div>
                  <v-card-actions class="justify-center">
                    My DRep Id: {{ truncate(drepId) }}<CopyButton class="ml-1" small :value="drepId" v-if="drepId" />
                  </v-card-actions>
                </v-card>
              </v-col>
              <v-col cols="12" class="px-2">
                <v-card outlined flat class="pa-0 fill-height liquid-glass">
                  <v-card-title
                    >Delegated Representatives (DReps)
                    <v-spacer></v-spacer>
                    <v-text-field
                      v-model="search"
                      dense
                      flat
                      solo
                      hide-details
                      placeholder="Search DReps"
                      prepend-inner-icon="mdi-magnify"
                      clearable
                      style="max-width: 200px"
                      class="top-level-search"
                      :loading="drepsLoading"
                    ></v-text-field>
                  </v-card-title>
                  <!-- Debug pagination info -->
                  <v-card-subtitle v-if="paginationMeta" class="text-caption">
                    Showing {{ governanceDReps?.length || 0 }} of {{ paginationMeta.total_items }} DReps (Page
                    {{ paginationMeta.page }} of {{ paginationMeta.total_pages }})
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
                    >
                      <template v-slot:[`item.name`]="{ item }">
                        <v-list-item dense class="px-0 drep-list-item" two-line>
                          <v-list-item-avatar rounded size="28">
                            <v-img v-if="item.image" :src="item.image" contain></v-img>
                          </v-list-item-avatar>
                          <v-list-item-content class="pl-12">
                            <v-list-item-title class="drep-title">
                              <span class="font-16">{{ item.name }} </span>
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
import { ref, computed, toRefs, onMounted, onUnmounted, watch } from 'vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import filters from '@/shared/utils/filters';
import governanceStoreActions from '@/stores/governanceStore';
import networks from '@/utils/networks';
import DRepDelegateDialog from '@/modules/governance/dialogs/DRepDelegateDialog.vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import snackbar from '@/plugins/snackbar';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';

const { truncate, toCurrency } = filters;

const { loggedWallet, utxos, account, keys } = toRefs(walletStore);
const { epochParams, tip } = toRefs(networkStore);

// Governance store
const { dreps: governanceDReps, loading: drepsLoading, paginationMeta } = toRefs(governanceStoreActions.state);
const { currentDRep } = toRefs(governanceStoreActions.state);
const { transactions: txs } = toRefs(walletStore);

const currentDrepTxIsPending = computed(() => {
  const pendingTx = txs.value?.find(tx => tx.pending);
  const isDrepTx = pendingTx?.body.certificates.some(
    cert => cert.__typename === Cardano.CertificateType.VoteDelegation
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
  { text: 'ID', sortable: false, align: 'transparent', value: 'id' },
  { text: 'Name', sortable: true, align: 'left', value: 'name' },
  { text: 'Delegators', sortable: true, align: 'left', value: 'delegators', width: '120' },
  { text: 'Votes', sortable: true, align: 'left', value: 'votes', width: '85' },
  { text: 'Voting Power', sortable: true, align: 'left', value: 'voting_power', width: '131' },
];

// Computed properties
const delegatingTo = computed(() => {
  let res = 'Undelegated';
  if (currentDRep.value) {
    res = 'N/A';
    if (currentDRep.value.drep_id == 'drep_always_no_confidence') {
      res = 'No Confidence';
    } else if (currentDRep.value.drep_id == 'drep_always_abstain') {
      res = 'Abstain';
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
      throw new Error('Epoch parameters not available');
    }

    const certificates: Cardano.Certificate[] = [];

    // Create stake credential from the key hash
    const stakeCredential: Cardano.Credential = {
      type: Cardano.CredentialType.KeyHash,
      hash: keys.value.stake[0].cred,
    };

    // Create DRep ID based on selection
    let dRep: Cardano.DelegateRepresentative;
    if (delegationModel.value === 'Abstain') {
      dRep = {
        __typename: 'AlwaysAbstain',
      } as Cardano.AlwaysAbstain;
    } else if (delegationModel.value === 'No Confidence') {
      dRep = {
        __typename: 'AlwaysNoConfidence',
      } as Cardano.AlwaysNoConfidence;
    } else if (delegationModel.value === 'Gero DRep') {
      delegateLoading.value = false;
      return; // TODO
    } else if (delegationModel.value === 'Own Account') {
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

    // Use the generic transaction builder
    txData.value = await buildCardanoTransaction({
      certificates,
      utxos: utxos.value,
      epochParams: epochParams.value,
      changeAddress: keys.value.payment[0].address,
      tip: tip.value,
      implicitCoin,
    });
    isDelegateDialogOpen.value = true;
    selectedDRep.value = {
      id: '',
      name: 'Abstain',
      image: '',
      delegators: 0,
      votes: 0,
      voting_power: 0,
    };
    console.log('Vote delegation transaction built successfully');
  } catch (error) {
    console.error('Error building vote delegation transaction:', error);
    snackbar.setError(`Error building transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  delegateLoading.value = false;
};

const drepDelegate = async (row: any) => {
  selectedDRep.value = row;

  try {
    const certificates: Cardano.Certificate[] = [];

    // Create stake credential from the key hash
    const stakeCredential: Cardano.Credential = {
      type: Cardano.CredentialType.KeyHash,
      hash: keys.value.stake[0].cred,
    };

    // Create DRep object from selected DRep data
    console.log('selectedDRep', selectedDRep.value);
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

    // Use the generic transaction builder
    txData.value = await buildCardanoTransaction({
      certificates,
      utxos: utxos.value,
      epochParams: epochParams.value,
      changeAddress: keys.value.payment[0].address,
      tip: tip.value,
      implicitCoin,
    });

    console.log('DRep delegation transaction built successfully');
    console.log('Transaction outputs:', txData.value.body.outputs);
    isDelegateDialogOpen.value = true;
  } catch (error) {
    console.error('Error building DRep delegation transaction:', error);
    snackbar.setError(`Error building transaction: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
  await loadDRepsPaginated(1);
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
    max-height: calc(100vh - 150px); /* Меньший отступ для мобильных */
  }
}
</style>
<style>
.dRepsTable {
  :is(tbody) {
    cursor: pointer;
  }
}
</style>
