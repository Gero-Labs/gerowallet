<template>
  <BaseDialog :isOpen="isOpen" @close="closeDialog" :loading="loading" :min-height="0" title="New Multisig Wallet"
    scrollable subtitle="A multisig wallet requires multiple parties signatures to authorize any transaction.">
    <v-fade-transition>
      <v-alert v-show="contactStatus.message" :type="contactStatus.type" class="text-left" dense prominient>
        {{ contactStatus.message }}
      </v-alert>
    </v-fade-transition>
    <v-card-title class="px-3">
      <v-alert border="left" color="primary" type="info" class="text-left"
        style="word-break: break-word; line-height: 1.3; font-style: italic; font-size: 14px;" prominent>
        All signers will receive a request to review and sign the transaction
        from their own wallets.<br>
        The transaction will be submitted to the blockchain only
        after all required signatures have been collected.
      </v-alert>
    </v-card-title>
    <v-card-text class="px-3 pt-1">
      <v-row>
        <v-col cols="6">
          <v-text-field label="Multisig Wallet Name" outlined dense v-model="multisigName" :error="!!multisigError"
            :error-messages="multisigError" :counter="40"
            :rules="[rules.required(), rules.minCharacters(3), rules.maxCharacters(40)]" @keyup="checkMultisigName" />
        </v-col>
        <v-col cols="6">
          <v-select label="Min. Required Signers" dense v-model="requiredSigners" :items="signersArray" required
            prepend-inner-icon="mdi-account-multiple-outline" outlined hide-details />
          <div class="helper signers-note mt-2">The minimum signers required to execute a transaction</div>
        </v-col>
      </v-row>
      <v-row no-gutters class="pt-4">
        <v-col cols="12" v-for="(signer, index) in signers" :key="index">
          <v-row no-gutters>
            <v-col cols="12" class="multisig-title text-left pa-0 mb-4">
              Signer {{ index + 1 }}<span v-if="signer.name">{{ ': ' + signer.name }}</span>
              <div class="helper signers-note">{{ index === 0 && signer.address === baseAddress ? 'Current Wallet' : ''
                }}</div>
            </v-col>
            <v-col cols="12" class="text-left pa-0 mb-2 d-flex align-center">
              <v-text-field class="no-margin-append-outer" 
                label="Singer wallet address"
                v-model="signer.address" 
                outlined dense
                :rules="[rules.required(), rules.paymentAddress(loggedWallet.value.network !== 'mainnet')]"
                :readonly="index === 0 && signer.address === baseAddress"
                :error="!!duplicateSignerError.message && duplicateSignerError.duplicateAddresses.includes(signer.address)"
                :error-messages="duplicateSignerError.message" @keyup="checkDuplicateSigner()">
              </v-text-field>
              <v-text-field v-if="index" 
                label="Singer name"
                v-model="signer.name" 
                outlined 
                dense
                :rules="[rules.required()]"
                class="ml-4 no-margin-append-outer">
                <template #append>
                  <v-menu v-model="signer.menuOpen" :close-on-content-click="false" nudge-left="226" nudge-top="100"
                    min-width="452" max-height="400">
                    <template v-slot:activator="{ on, attrs }">
                      <v-btn class="mt-1" small v-if="index" icon v-bind="attrs" v-on="on">
                        <v-icon small color="#00DFF3">
                          mdi-book-open-variant-outline
                        </v-icon>
                      </v-btn>
                    </template>
                    <v-card>
                      <v-card-title>
                        Contacts
                        <v-spacer></v-spacer>
                        <v-btn icon small @click="signer.menuOpen = false">
                          <v-icon>
                            mdi-window-close
                          </v-icon>
                        </v-btn>
                      </v-card-title>
                      <v-card-text class="pa-0">
                        <v-data-table dense class="contacts transparent" :headers="contactsHeaders"
                          :items="contacts ? Object.values(contacts) : []" hide-default-footer disable-pagination
                          @click:row="(_, contact) => selectContact(contact.item, signer)"
                          :header-props="{ 'sort-icon': 'mdi-menu-up' }">
                          <template v-slot:[`item.address`]="{ item }">
                            {{ truncate(item.address) }}
                            <CopyButton x-small :value="item.address" />
                          </template>
                          <template v-slot:[`item.actions`]="{ item }">
                            <v-btn color="error" icon x-small @click.stop="removeCont(item, signer)">
                              <v-icon x-small>
                                mdi-trash-can
                              </v-icon>
                            </v-btn>
                          </template>
                        </v-data-table>
                      </v-card-text>
                    </v-card>
                  </v-menu>
                </template>
                <template #append-outer v-if="index">
                  <v-menu v-model="signer.optionsMenuOpen" :close-on-content-click="true">
                    <template v-slot:activator="{ on, attrs }">
                      <v-btn class="mt-1" small v-show="index" icon v-bind="attrs" v-on="on">
                        <v-icon small>
                          mdi-dots-vertical
                        </v-icon>
                      </v-btn>
                    </template>
                    <v-list>
                      <v-list-item @click="saveContact(signer)" :disabled="!signer.name || !signer.address || !isFormValid">
                        <v-icon small>
                          mdi-plus
                        </v-icon>
                        Add Contact
                      </v-list-item>
                      <v-list-item v-if="index > 1" @click="deleteSigner(index)">
                        <v-icon small>
                          mdi-delete
                        </v-icon>
                        Remove
                      </v-list-item>
                    </v-list>
                  </v-menu>
                </template>
              </v-text-field>
            </v-col>
          </v-row>
        </v-col>
      </v-row>
      <v-row class="justify-center text-center">
        <v-btn dense plain class="my-2 text-capitalize font-weight-normal" @click="addSigner">
          <v-icon small color="primary" class="mr-1">mdi-plus-box</v-icon>
          Add Signer
        </v-btn>
      </v-row>
    </v-card-text>
    <v-card-actions class="my-2 text-center justify-center" :style="{ flexFlow: 'column' }">
      <v-btn class="geroButton" style="color: black!important;" outlined @click="nextStep"
        :disabled="loading || !isFormValid || multisigError" :loading="loading">
        CREATE MULTISIG WALLET
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
// import { multisigStore } from '@/stores/modules/multisig';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import networks from '@/utils/networks';
import rules from '@/utils/rules';
import filters from '@/shared/utils/filters';
import lodash from 'lodash';
import CopyButton from '@/shared/components/CopyButton.vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import db from '@/db';
import { resolvePaymentKeyHash } from '@/shared/utils/resolver';
import { isPaymentAddress } from '@/chrome/serialization';

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits(['close']);

const { loggedWallet, baseAddress } = toRefs(walletStore);
// const mStore = multisigStore();

const loading = ref(false);
const multisigName = ref('');
const requiredSigners = ref(2);
const signers = ref([
  { name: loggedWallet.value.name, address: baseAddress.value, menuOpen: false, optionsMenuOpen: false },
  { name: '', address: '', menuOpen: true, optionsMenuOpen: true }
]);

const contactsHeaders = ref([
  { text: 'Name', value: 'name' },
  { text: 'Address', value: 'address' },
  { text: '', align: 'right', sortable: false, value: 'actions' }
]);

const multisigError = ref('');
const duplicateSignerError = ref({ message: '', duplicateAddresses: [] });
const contact = ref({
  name: '',
  address: '',
  img: undefined
});
const contactStatus = ref({
  message: '',
  type: 'info'
});

const truncate = filters.truncate;

const signersArray = computed(() => [2, 3, 4, 5, 6, 7].filter(n => n <= signers.value.length));

const { contacts } = toRefs(walletStore);

const isFormValid = computed(() => {
  const invalid = signers.value.filter(s => !s.address.trim() || !isPaymentAddress(s.address));
  const valid = multisigName.value.trim() !== '' &&
    requiredSigners.value >= 1 &&
    requiredSigners.value <= signers.value.length &&
    invalid.length === 0;
  return valid;
});

watch(() => props.isOpen, val => {
  if (val) resetForm();
});

function resetForm() {
  loading.value = false;
  multisigName.value = '';
  requiredSigners.value = 2;
  contactStatus.value = { message: '', type: 'info' };
  duplicateSignerError.value = { message: '', duplicateAddresses: [] };
  signers.value = [
    { name: loggedWallet.value.name, address: baseAddress.value, menuOpen: false, optionsMenuOpen: false },
    { name: '', address: '', menuOpen: false, optionsMenuOpen: false }
  ];
}

function closeDialog() {
  emit('close');
  resetForm();
}

function addSigner() {
  if (signers.value.length < 7) {
    signers.value.push({ name: '', address: '', menuOpen: false, optionsMenuOpen: false });
    requiredSigners.value = signers.value.length;
  }
}

function deleteSigner(index: number) {
  if (confirm('Are you sure you want to remove this signer?')) {
    signers.value.splice(index, 1);
  }
  requiredSigners.value = signers.value.length;
}

function saveContact(signer: any) {
  const asset = ref(undefined);

  const address = signer.address;
  const img = asset.value ? asset.value.img : null;
  const name = signer.name;

  contact.value = {
    img,
    name,
    address
  };

  contactStatus.value = {
    message: 'Contact saved',
    type: 'success'
  };
}

function selectContact(item: any, signer: any) {
  signer.address = structuredClone(item.address);
  signer.name = structuredClone(item.name);
  signer.menuOpen = false;
}

function removeCont(item: any, signer: any) {
  if (item?.address) {
    // walletConfig.removeContact(item.address); // TODO: Implement in walletStore
    signer.menuOpen = false;
  }
  contactStatus.value = {
    message: 'Contact removed',
    type: 'error'
  };
}

const checkMultisigName = async () => {
  multisigError.value = '';
  const multisigTable = await appWallet.db.table('multisig');
  const multisig = await multisigTable.get({ name: multisigName.value });
  return multisig ? multisigError.value = 'A multisig wallet with this name already exists' : '';
}

const checkDuplicateSigner = async () => {
  duplicateSignerError.value = { message: '', duplicateAddresses: [] };
  const singersArray = signers.value.map(s => s.address);
  const duplicateSigners = singersArray.filter((s, i) => singersArray.indexOf(s) !== i);
  if (duplicateSigners.length > 0) {
    duplicateSignerError.value = {
      message: 'Duplicate signer',
      duplicateAddresses: duplicateSigners.map(s => s.address)
    };
  }
}

async function createMultisigWallet() {
  const nativeScript = Serialization.NativeScript.fromCore({
    __type: Cardano.ScriptType.Native,
    required: requiredSigners.value,
    scripts: signers.value.map(s => ({
      __type: Cardano.ScriptType.Native,
      keyHash: Ed25519KeyHashHex(resolvePaymentKeyHash(s.address)),
      kind: Cardano.NativeScriptKind.RequireSignature
    })),
    kind: Cardano.NativeScriptKind.RequireNOf
  });
  const paymentCredential: Cardano.Credential = {
    type: Cardano.CredentialType.ScriptHash,
    hash: nativeScript.hash()
  };
  const stakeCredential = paymentCredential;
  const netId = networks.resolveNetworkId(loggedWallet.value.chain, loggedWallet.value.network) === 1
    ? Cardano.NetworkId.Mainnet
    : Cardano.NetworkId.Testnet;
  const scriptBaseAddr = Cardano.BaseAddress
    .fromCredentials(netId, paymentCredential, stakeCredential)
    .toAddress()
    .toBech32();

  const multisigDBName = `multisig-${scriptBaseAddr.slice(0, 21)}-${lodash.kebabCase(multisigName.value)}`;
  const existingDb = await db.checkIfDbExists(multisigDBName);
  if (existingDb) {
    throw new Error('A multisig wallet with this name already exists');
  }

  const scriptRewardAddress = Cardano.RewardAddress
    .fromCredentials(netId, stakeCredential)
    .toAddress()
    .toBech32();
  const multisigWallet = {
    stakeAddress: scriptRewardAddress,
    paymentAddress: scriptBaseAddr,
    name: multisigName.value,
    signers: signers.value.map(s => ({ name: s.name, address: s.address })),
    cbor: nativeScript.toCbor(),
    requiredSigners: requiredSigners.value,
    createdAt: new Date().toISOString()
  };
  const multisigTable = await appWallet.db.table('multisig');
  await multisigTable.add(multisigWallet).catch(e => console.error(e));
  await db.createNewWalletDb(multisigDBName, false, false).catch(e => console.error(e));
  await appWallet.api.multiSig.createWallet(
    { stakeAddress: multisigWallet.stakeAddress, bech32Address: multisigWallet.paymentAddress, scriptCBOR: multisigWallet.cbor },
    baseAddress.value
  );
}

function nextStep() {
  createMultisigWallet()
    .catch(e => multisigError.value = e.message)
    .then(() => {
      if (multisigError.value === '') {
        closeDialog();
      }
    });
}

// Watchers
watch(contact, async (val) => {
  console.log('contact', val);
  // await walletConfig.addOrUpdateContact(val); // TODO: Implement in walletStore
}, { deep: true });

watch(contactStatus, (newVal) => {
  if (newVal.message) {
    setTimeout(() => {
      contactStatus.value = { message: '', type: 'info' };
    }, 3000);
  }
}, { deep: true });

</script>

<style lang="scss" scoped>
.titles {
  align-items: center;
  text-align: center;
  display: flex;
  flex-direction: column;
}

.arrow-left {
  cursor: pointer;
  position: absolute;
  top: 10px;
  left: 10px;
}

.continue-button {
  background: linear-gradient(to right, #00c7f3, #00fad5);
  color: black;

  &:disabled {
    opacity: 0.5;
    color: black !important;
  }
}

.left-aligned-text {
  text-align: left;
  display: block;
  /* Ensures the text-align property is applied */
}

.signers-note {
  font-weight: 500;
  font-style: italic;
  font-size: 12px !important;
  line-height: 1.5;
  letter-spacing: 0;
}

.multisig-title {
  font-size: 18px;
  color: #fff;
}

.helper {
  font-size: 12px;
  color: #ccc;
}

::v-deep .contacts .v-data-table__wrapper tbody tr {
  cursor: pointer;
}
</style>
