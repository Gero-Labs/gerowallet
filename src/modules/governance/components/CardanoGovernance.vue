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
        <v-col cols="12" xl="6" lg="6" md="6" class="px-2 pb-4">
          <v-card outlined flat class="pa-4 fill-height d-flex flex-column justify-space-evenly">
            <v-card-text class="pa-2 current-delegation-card">
              <div class="white--text font-weight-semibold text-subtitle-2">
                Current Delegation
              </div>
              <div class="gradient-text text-h6 font-weight-semibold">
                {{delegatingTo}}
              </div>
              <div style="display: flex;align-items: center;" v-if="dreps[account?.drep_id]">
                <div class="white--text text-h6 font-weight-semibold" >
                  {{ truncate(account?.drep_id) }}
                </div><CopyButton small :value="account?.drep_id"></CopyButton>
              </div>
              <div class="gradient-text text-subtitle-2 font-weight-semibold" v-if="dreps[account?.drep_id]">
                Vote Power: {{toCurrency(dreps[account?.drep_id].amount, false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true)}}
              </div>
            </v-card-text>
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
                <v-btn class="geroButton ml-3" style="color: black!important;" height="40" :disabled="delegationModel === undefined || delegateLoading || delegationModel === 'Own Account (soon)' || delegationModel === 'Gero DRep (soon)'" @click="delegate" :loading="delegateLoading">
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
        <v-col cols="12" xl="6" lg="6" md="6" class="px-2 pb-4">
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
            <div class="px-4 py-0 text-center">
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
            <v-card-actions class="justify-center">
              My DRep Id: {{ truncate(drepId) }}<CopyButton class="ml-1" small :value="drepId" v-if="drepId" />
            </v-card-actions>
          </v-card>
        </v-col>
        <v-col cols="12" class="px-2">
          <v-card outlined flat class="pa-0 fill-height">
            <v-card-title>Delegated Representatives (DReps)
              <v-spacer></v-spacer>
              <v-text-field
                label="Search"
                outlined
                hide-details
                dense
                v-model="search"
              >
              </v-text-field>
            </v-card-title>
            <v-card-text class="px-0">
              <v-data-table
                class="dRepsTable transparent"
                dense
                :items="drepsList"
                :headers="drepsHeaders"
                :header-props="{ 'sort-icon': 'mdi-menu-up' }"
                :sort-by.sync="sortBy"
                :sort-desc.sync="sortDesc"
                @click:row="drepDelegate"
                :search="search"
              >
                <template v-slot:[`item.name`]="{ item }">
                  <v-list-item dense class="px-0" two-line>
                    <v-list-item-avatar rounded size="28">
                      <v-img v-if="item.image" :src="item.image" contain></v-img>
                    </v-list-item-avatar>
                    <v-list-item-content>
                      <v-list-item-title style="display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: horizontal; overflow: hidden; text-overflow: ellipsis; white-space: normal;">
                        <span style="font-size: 16px">{{ item.name }}</span>
                        <template v-for="(link, index) in item.links">
                          <v-btn icon x-small  :key="index" :href="link.uri" target="_blank" v-if="link.uri && typeof link.uri === 'string'" :class=" index == 0 ? 'ml-2' : ''">
                            <v-avatar tile size="14" v-if="String(link.uri).includes('https://x.com') || String(link.uri).includes('https://twitter.com')">
                              <v-img :src="xLogo" alt="x"></v-img>
                            </v-avatar>
                            <v-avatar tile size="14" v-else-if="String(link.uri).includes('https://t.me')">
                              <v-img :src="telegramLogo" alt="x"></v-img>
                            </v-avatar>
                            <v-icon v-else>
                              {{ getIconByURI(link.uri)}}
                            </v-icon>
                          </v-btn>
                        </template>
                      </v-list-item-title>
                      <v-list-item-subtitle style="display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: horizontal; overflow: hidden; text-overflow: ellipsis; white-space: normal;">
                        {{ truncate(item.id) }}<CopyButton style="margin-left: 1px; margin-bottom: 2px" x-small :value="item.id" v-if="item"></CopyButton>
                      </v-list-item-subtitle>
                    </v-list-item-content>
                  </v-list-item>
                </template>
                <template v-slot:[`item.voting_power`]="{ item }">
                  {{ toCurrency(item.voting_power, false, 2, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', true)}}
                </template>
              </v-data-table>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-card-text>
    <DRepDelegateDialog :isOpen="isDelegateDialogOpen" @close="isDelegateDialogOpen = false" :drep="selectedDRep" :tx="txData"></DRepDelegateDialog>
  </v-card>
</template>
<script setup lang="ts">
import { ref, computed, toRefs, onMounted } from 'vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import filters from '@/shared/utils/filters';

const { truncate, toCurrency } = filters;
import networks from '@/utils/networks';
import DRepDelegateDialog from '@/modules/governance/dialogs/DRepDelegateDialog.vue';
import {
  Certificate,
  Credential, DRep,
  Ed25519KeyHash, ScriptHash,
  StakeRegistration, Transaction, TransactionUnspentOutputs, TransactionWitnessSet, VoteDelegation,
} from '@emurgo/cardano-serialization-lib-browser';
import { toUTxO } from '@/shared/utils/converter';
import { buildTx } from '@/shared/utils/builder';
import { Messaging } from '@/chrome/messaging';
import { METHOD } from '@/chrome/config';
import snackbar from '@/plugins/snackbar';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';

const { loggedWallet, utxos, account, keys } = toRefs(walletStore);
const { dreps, tip } = toRefs(networkStore);

// Get drepId and baseAddress from loggedWallet
const drepId = computed(() => keys.value?.drep129[0].address);
const baseAddress = computed(() => loggedWallet.value?.baseAddress);

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
  {text: 'ID', sortable: false, align: 'transparent', value: 'id'},
  {text: 'Name', sortable: true, align: 'left', value: 'name'},
  {text: 'Delegators', sortable: true, align: 'left', value: 'delegators', width: '120' },
  {text: 'Votes', sortable: true, align: 'left', value: 'votes', width: '80'},
  {text: 'Voting Power', sortable: true, align: 'left', value: 'voting_power', width: '120'},
];

// Computed properties
const delegatingTo = computed(() => {
  let res = 'Undelegated'
  if (account.value?.drep_id) {
    res = 'N/A'
    if (account.value?.drep_id == 'drep_always_no_confidence') {
      res = 'No Confidence'
    } else if (account.value?.drep_id == 'drep_always_abstain') {
      res = 'Abstain'
    } else {
      const drep = dreps.value[account.value.drep_id]
      if (drep && drep['metadata']?.meta_json?.body?.givenName) {
        if (drep['metadata'].meta_json.body.givenName['@value']) {
          res = drep['metadata'].meta_json.body.givenName['@value']
        } else {
          res = drep['metadata'].meta_json.body.givenName
        }
      }
    }
  }
  return res
});

const drepsList = computed(() => {
  let drepsList = []
  if (dreps.value) {
    console.log(Object.values(dreps.value))
    drepsList = Object.values(dreps.value)
      .filter(drep => drep != null)
      .map(drep => {
        let name = 'N/A'
        if (drep['metadata']?.meta_json?.body?.givenName) {
          if (drep['metadata'].meta_json.body.givenName['@value']) {
            name = drep['metadata'].meta_json.body.givenName['@value']
          } else {
            name = drep['metadata'].meta_json.body.givenName
          }
        }
        let image
        if (drep['metadata']?.meta_json?.body?.image?.contentUrl) {
          image = drep['metadata'].meta_json.body.image.contentUrl
        }
        return {
          id: drep['drep_id'],
          name,
          image,
          delegators: drep['delegators'].length,
          votes: drep['votes'].length,
          voting_power: Number(drep['amount']),
          links: drep['metadata']?.meta_json?.body?.references,
          hex: drep['hex'],
          registered: drep['registered'],
          has_script: drep['has_script'],
          active: drep['active'],
          more: drep,
        }
      })
  }
  return drepsList
});

// Methods
const getIconByURI = (uri: string) => {
  if (String(uri).includes('https://github.com')) {
    return 'mdi-github'
  } else if (String(uri).includes('youtube.com') || String(uri).includes('youtu.be')) {
    return 'mdi-youtube'
  } else if (String(uri).includes('linkedin.com')) {
    return 'mdi-linkedin'
  } else if (String(uri).includes('instagram.com')) {
    return 'mdi-instagram'
  } else if (String(uri).includes('discord.com')) {
    return 'mdi-discord'
  }
  return 'mdi-link'
};

const delegate = async () => {
  delegateLoading.value = true
  console.log('delegate', delegationModel.value)
  const wallet = loggedWallet.value;
  const certificates = [];
  if (!account.value?.active) {
    const registrationCertificate = Certificate.new_stake_registration(StakeRegistration.new(Credential.from_keyhash(Ed25519KeyHash.from_hex(wallet.stakeKey().hash().hex()))))
    certificates.push(registrationCertificate);
  }
  let dRep: DRep
  if (delegationModel.value == 'Abstain') {
    dRep = DRep.new_always_abstain()
  } else if (delegationModel.value == 'No Confidence') {
    dRep = DRep.new_always_no_confidence()
  } else if (delegationModel.value == 'Gero DRep') {
    delegateLoading.value = false
    return // TODO
  } else if (delegationModel.value == 'Own Account') {
    delegateLoading.value = false
    return // TODO
  }
  const delegationCertificate = Certificate.new_vote_delegation(VoteDelegation.new(Credential.from_keyhash(Ed25519KeyHash.from_hex(wallet.stakeKey().hash().hex())), dRep));
  certificates.push(delegationCertificate);

  try {
    const transactionUnspentOutputs = TransactionUnspentOutputs.new();
    utxos.value.forEach((utxo) => transactionUnspentOutputs.add(toUTxO(utxo)));
    const txBody = buildTx(loggedWallet.value, undefined, transactionUnspentOutputs, tip.value.slot, baseAddress.value, certificates, [])
    const tx: Transaction = Transaction.new(txBody, TransactionWitnessSet.new())
    const txCbor = tx.to_hex()
    const partialSign = true
    const signaturesRes: any = await Messaging.sendToBackground({
      method: METHOD.signTx,
      data: { tx: txCbor, partialSign },
    });
    if (signaturesRes.error) {
      snackbar.setError(signaturesRes.error.info)
    } else {
      console.log(signaturesRes)
      const signedTx = Transaction.new(
        txBody,
        TransactionWitnessSet.from_bytes(Buffer.from(signaturesRes.data, "hex")),
        undefined
      );
      console.log(signedTx.to_json())
      const txId = await loggedWallet.value.submitTx(signedTx, utxos.value);
      console.log(txId)
      snackbar.fireSuccess(`Tx Submitted Successfully. Tx ID: ${txId}`)
    }
  } catch (e) {
    snackbar.setError(String(e))
    console.log(e)
  }
  delegateLoading.value = false
};

const drepDelegate = (row: any) => {
  console.log('delegate', row)
  selectedDRep.value = row
  const wallet = loggedWallet.value;
  const certificates = [];
  if (!account.value?.active) {
    const registrationCertificate = Certificate.new_stake_registration(StakeRegistration.new(Ed25519KeyHash.from_hex(Credential.from_keyhash(Ed25519KeyHash.from_hex(wallet.stakeKey().hash().hex())))))
    certificates.push(registrationCertificate);
  }
  // Delegation Certificate
  const drepHash = selectedDRep.value.has_script ? ScriptHash.from_hex(selectedDRep.value.hex) : Ed25519KeyHash.from_hex(selectedDRep.value.hex);
  const dRep = selectedDRep.value.has_script ? DRep.new_script_hash(drepHash) : DRep.new_key_hash(drepHash);
  const delegationCertificate = Certificate.new_vote_delegation(VoteDelegation.new(Credential.from_keyhash(Ed25519KeyHash.from_hex(wallet.stakeKey().hash().hex())), dRep));
  certificates.push(delegationCertificate);

  const transactionUnspentOutputs = TransactionUnspentOutputs.new();
  utxos.value.forEach((utxo) => transactionUnspentOutputs.add(toUTxO(utxo)));
  const txBody = buildTx(loggedWallet.value, undefined, transactionUnspentOutputs, tip.value.slot, baseAddress.value, certificates, [])
  txData.value = Transaction.new(txBody, TransactionWitnessSet.new())
  console.log(txBody.to_json())
  isDelegateDialogOpen.value = true
};
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
<style>
.dRepsTable {
  :is(tbody) {
    cursor: pointer;
  }
}
</style>
