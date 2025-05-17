<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="emitCloseDialog"
    :loading="loading"
    :min-height="0"
    title="New Multisig Wallet"
    scrollable
    subtitle="A multisig wallet requires multiple parties signatures to authorize any transaction."
  >
    <v-card-title class="px-0">
      <v-alert
        border="left"
        color="primary"
        type="info"
        class="text-left"
        style="word-break: break-word; line-height: 1.3; font-style: italic; font-size: 14px;"
        prominent
      >
        All signers will receive a request to review and sign the transaction
        from their own wallets.<br>
        The transaction will be submitted to the blockchain only
        after all required signatures have been collected.
      </v-alert>
    </v-card-title>
    <v-card-text class="px-0">
      <v-row>
        <v-col cols="6">
          <v-text-field
            label="Multisig Wallet Name"
            outlined
            dense
            v-model="multisigName"
            :counter="40"
            :rules="[rules.required(), rules.minCharacters(3), rules.maxCharacters(40)]"
          />
        </v-col>
        <v-col cols="6">
          <v-select
            label="Min. Required Signers"
            dense
            v-model="requiredSigners"
            :items="signersArray"
            prepend-inner-icon="mdi-account-multiple-outline"
            outlined
            hide-details
          />
          <div class="helper signers-note mt-2">The minimum signers required to execute a transaction</div>
        </v-col>
      </v-row>
      <v-row no-gutters class="pt-4 mt-4">
        <v-col cols="12" v-for="(signer, index) in signers" :key="index">
          <v-row no-gutters>
            <v-col cols="12" class="multisig-title text-left pa-0 mb-2">
              Signer {{ index + 1 }}<span v-if="signer.isThisWallet">{{ ': ' + signer.name }}</span>
              <div class="helper signers-note">{{ signer.isThisWallet ? 'Current Wallet' : '' }}</div>
            </v-col>
            <v-col cols="12" class="text-left pa-0 mb-2 d-flex align-center">
              <v-text-field
                class="no-margin-append-outer"
                v-model="signer.address"
                outlined
                hide-details
                dense
                :readonly="signer.isThisWallet"
              >
                <template #append>
                  <v-menu  :close-on-content-click="false" nudge-left="226" nudge-top="100" min-width="452"
                          max-height="400">
                    <template v-slot:activator="{ on, attrs }">
                      <v-btn class="mt-1" small v-if="!signer.isThisWallet" icon v-bind="attrs" v-on="on">
                        <v-icon small color="#00DFF3">
                          mdi-book-open-variant-outline
                        </v-icon>
                      </v-btn>
                    </template>
                    <v-card>
                      <v-card-title>
                        Contacts
                        <v-spacer></v-spacer>
                        <v-btn icon small @click="contactsMenu = false">
                          <v-icon>
                            mdi-window-close
                          </v-icon>
                        </v-btn>
                      </v-card-title>
                      <v-card-text class="pa-0">
                        <v-data-table dense class="transparent token-allocation-table" :headers="contactsHeaders"
                                      :items="contacts ? Object.values(contacts) : []" hide-default-footer disable-pagination
                                      @click:row="selectContact" :header-props="{ 'sort-icon': 'mdi-menu-up' }">
                          <template v-slot:[`item.address`]="{ item }">
                            {{ truncate(item.address) }}
                            <CopyButton x-small :value="item.address" />
                          </template>
                          <template v-slot:[`item.actions`]="{ item }">
                            <v-btn color="error" icon x-small @click="removeCont(item)">
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
                <template #append-outer>
                  <v-btn v-if="!signer.isThisWallet" icon @click="deleteSigner(index)">
                    <v-icon>mdi-delete</v-icon>
                  </v-btn>
                </template>
              </v-text-field>

            </v-col>
          </v-row>
        </v-col>
      </v-row>
      <v-row class="justify-center text-center">
        <v-btn dense plain class="my-2 text-capitalize font-weight-normal" @click="addSigner">
          <v-icon color="primary">mdi-plus-box</v-icon>
          Add Signer
        </v-btn>
      </v-row>
    </v-card-text>
    <v-card-actions class="my-2 text-center justify-center" :style="{ flexFlow: 'column' }">
        <v-btn outlined @click="nextStep" :disabled="loading || !isFormValid" :loading="loading">
          Create
          <v-icon small class="ml-1">mdi-arrow-right</v-icon>
        </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>
<script lang="ts">
import { WalletType } from '@/models/types';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import networks from '@/utils/networks';
import { appWallet, useStore } from '@/stores';
import { mapState } from 'pinia';
import { addressBech32ToKeyHash, multisigJsonToBech32 } from '@/shared/utils/converter';
import db from '@/db';
import Dexie from 'dexie';
import { walletConfigStore } from '@/stores/modules/walletConfig';
import { Wallet } from '@/models/wallet';
import lodash from 'lodash';
import { multisigStore } from '@/stores/modules/multisig';
import rules from '@/utils/rules';
import CopyButton from '@/shared/components/CopyButton.vue';
import filters from '@/shared/utils/filters';

export default defineComponent({
  name: "CreateMultisignWalletDialog",
  components: {
    CopyButton,
    BaseDialog,
  },

  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    rules() {
      return rules
    },
    WalletType() {
      return WalletType;
    },
    networks() {
      return networks;
    },
    ...mapState(useStore, [
      "loggedWallet",
      "resolvedAssets",
      "baseAddress",
      "latestTip",
      "pinnedTokens",
    ]),
    ...mapState(multisigStore, ["multiSigWallets"]),
    ...mapState(walletConfigStore, ["utxos", "addresses", 'contacts']),
    isFormValid() {
      const invalidSigners = this.signers.filter(iSigner => !iSigner.address.trim());
      return this.multisigName.trim() !== "" &&
        this.requiredSigners >= 1 &&
        this.requiredSigners <= this.signers.length &&
        !invalidSigners.length;
    },
  },
  watch: {
    isOpen(val) {
      if (val) this.resetForm();
    },
  },
  data: () => ({
    loading: false,
    signers: [], // initial data
    multisigName: "",
    minSigners: 2,
    requiredSigners: 2, //default, initial
    signersArray: [2, 3, 4, 5],
    address: undefined,
    multisigPolicy: undefined,
    provider: undefined,
    multisigWalletInstance: undefined,
    appWalletInstance: undefined,
    contactsMenu: false,
    contactsHeaders: [
      { text: 'Name', value: 'name' },
      { text: 'Address', value: 'address' },
      { text: '', align: 'right', sortable: false, value: 'actions' },
    ],
    truncate: filters.truncate,
  }),
  methods: {
    selectContact(item) {
      // this.recipientAddress = item.address;
      // this.$emit('updateRecipientAddress', this.recipientAddress);
      // this.contactsMenu = false
    },
    removeCont(item) {
      // if (item && item.address) {
      //   this.removeContact(item.address)
      //   this.contactsMenu = false
      // } else {
      //   this.removeContact(this.contact.address)
      //   this.saveContactMenu = false
      // }
    },
    /**
     *
     * @param multisigScript
     * const addr = Address.from_bech32(signer.address);
      const pubKey = PublicKey.from_bech32(signer.address);
      const keyHash = Ed25519KeyHash.from_bytes(pubKey.as_bytes());
      const scriptPubKey = NativeScript.new_script_pubkey(keyHash);

      multisigScript.add(scriptPubKey);
    * @param networkId
    */
    // multisigScriptToBech32Address(multisigScript, networkId) {
    // Create a script hash from the multisig script
    //const scriptHash = multisigScript.hash();

    // Create a payment credential from the script hash
    // const paymentCredential = StakeCredential.from_script_hash(scriptHash);

    // Create a base address from the payment credential and network ID
    // const address = Address.new_from_script_hash(paymentCredential, networkId);

    // Convert the address to Bech32 format
    //return ""; //address.to_bech32();
    // },

    async createMultisigWallet() {
      console.log("create wallet started");
      if (!this.isFormValid) {
        console.log("Invalid");
        return;
      }
      console.log(this.signers);

      const multisigScriptJson = {
        type: "atLeast",
        scripts: this.signers.map((signer) => ({
          type: "sig",
          keyHash: addressBech32ToKeyHash(signer.address),
        })),
        required: this.requiredSigners,
      };

      const { bech32Address, scriptCBOR, stakeAddress } = multisigJsonToBech32(multisigScriptJson, 0);
      const multisigWallet = {
        id: bech32Address,
        name: this.multisigName,
        signers: this.signers,
        requiredSigners: this.requiredSigners,
        createdAt: new Date().toISOString(),
        multisigScriptCBOR: scriptCBOR,
        stakeAddress: stakeAddress,
      };
      console.log("MultiSIG object::::", multisigWallet);
      console.log("this loggedin wallet db", this.loggedWallet);
      this.provider = networks.resolveDefaultProvider(this.loggedWallet?.chain, this.loggedWallet?.network);
      const loggedInWalletInstance = Wallet.class(this.loggedWallet, this.provider);
      console.log("this loggedin wallet baseaddress", loggedInWalletInstance.baseAddress());
      console.log("instance of this loggedin wallet:::", loggedInWalletInstance instanceof Wallet);

      // Create Wallet in browser
      // wal.db = new Dexie('multisig-' + wallet.publicKey.slice(0,21)); //xpub1lnyv9yu3gjge6stulu3ed0ns6pc2e6253rzx3wnklgflfdnqtnlpgptc4drpx2ry4502jd4wdc7aev3m8pzxdfjp08atjatppqwgtgc7n2tun
      const parentWalletPubkey = this.parentWalletPubkey();
      const multisigDBName = this.generateMultisigDBName(parentWalletPubkey, this.multisigName);
      console.log("dbname:::::", multisigDBName);
      await appWallet.api.multiSig.createWallet({ stakeAddress, bech32Address, scriptCBOR }, this.baseAddress); // creates the wallet on Backend.
      await db.createNewWalletDb(this.loggedWallet.id, false, false); // incase of upgraded wallet schema
      const dbParent = new Dexie('wallet-' + this.loggedWallet.id); //parent wallet
      await dbParent.open();
      console.log("Whererhereh Before");
      const exists = await dbParent.table('multisig').get(multisigWallet.id); //.where("id").equals(multisigWallet.id); //.count();
      console.log("Whererhereh After:::", exists);
      if (exists) {
        // update
        const { id, ...walletValues } = multisigWallet;
        const updated = await dbParent.table('multisig').update(multisigWallet.id, { ...walletValues });
        if (updated) {
          console.log("Successfully updated multisig record::", multisigWallet.id);
        }
        else {
          console.error("Failed to update multisig record::", multisigWallet.id);
        }
      } else {
        //add
        dbParent.table('multisig').add(multisigWallet).catch(error => {
          console.error("Error adding multisig to parent multisig table::", error);
        });
      }
      await dbParent.close();

      await db.createNewWalletDb(multisigDBName, false, false).then(value => {
        console.log("Multisig database created::", multisigDBName);

      }).catch(error => {
        console.error("Error creating multisig Database::", multisigDBName);
      });
      await appWallet.api.multiSig.createWallet({ stakeAddress, bech32Address, scriptCBOR }, appWallet.baseAddress().toBech32()); // creates the wallet on Backend.

      /*const dbM = new Dexie(multisigDBName);

      await dbM.open();
      console.log("Whererhereh 2 Before");
      const keyExists = await dbM.table('config').where('key').equals(multisigWallet.id).count();
      console.log("Whererhereh 2 After");
      if(!keyExists) {
        await dbM.table("config").add({
          key: multisigWallet.id,
          value: multisigWallet,
        });
      }
      dbM.close();*/
    },
    generateMultisigDBName(parentWalletPubkey: string, multisigName: string) {
      return `multisig-${parentWalletPubkey.slice(0,21)}-${lodash.kebabCase(multisigName)}`;
    },
    parentWalletPubkey() {
      // TODO(@KirillTaylor): Remove this after testing
      return 'xpub1lnyv9yu3gjge6stulu3ed0ns6pc2e6253rzx3wnklgflfdnqtnlpgptc4drpx2ry4502jd4wdc7aev3m8pzxdfjp08atjatppqwgtgc7n2tun';
      return this.loggedWallet.baseAddress.to_address().to_bech32();
    },
    currentWalletAddress() {
      // TODO(@KirillTaylor): Remove this after testing
      return 'addr_test1qreu3crfp24jrxtxpvdlkcpakk3u59ldgajxwfzmm3rx2vacjma654mexefdgznteckzdcylpygakqt8hg8nhmm4tq8q2pezev';
      return this.baseAddress;
    },
    currentWalletName() {
      return this.loggedWallet.name;
    },
    addSigner() {
      if (this.signers.length < 7) {
        this.signers.push({
          name: "",
          address: "",
          isThisWallet: false,
        });
      }
    },
    deleteSigner(index) {
      if(confirm("Are you sure you want to remove this signer?")) {
        this.signers.splice(index, 1);
      }
    },
    close() {
      this.resetForm();
      this.$emit('close');
    },
    resetForm() {
      console.log("resetting form", this.baseAddress);
      this.loading = false;
      this.multisigName = "";
      this.minSigners = 2;
      this.signers = [
        {
          name: this.currentWalletName(), // current signed in wallet
          address: this.currentWalletAddress(),
          isThisWallet: true,
        },
        {
          name: "",
          address: "",
          isThisWallet: false,
        }
      ];
    },
    nextStep() {
      this.createMultisigWallet();
      this.$emit('close');
    },
    emitCloseDialog() {
      console.log("emit close dialog");
      this.$emit('close');
    }
  },
  mounted() {
    this.provider = networks.resolveDefaultProvider(this.loggedWallet?.chain, this.loggedWallet?.network);

    if (this.resolvedAssets) {
      this.signers[0] = {
        address: "", //this.loggedWallet.baseAddress().to_address().to_bech32(),
      };
    }
  },
});
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
</style>
