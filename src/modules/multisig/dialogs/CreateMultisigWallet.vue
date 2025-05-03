<template>
  <BaseDialog :isOpen="isOpen" @close="emitCloseDialog" :loading="loading" :min-height="0" :title="`New Multisig Wallet`"
    :subtitle="`A multisig wallet requires multiple parties' signatures to authorize any transaction.`">
      <v-row no-gutters class="py-2 align-center">
        <v-col cols="3" class="text-left">
          <div class="multisig-title">Name</div>
          <span class="helper my-0">Multisig wallet name</span>
        </v-col>
        <v-col cols="9">
          <v-text-field label="Enter Name" outlined dense v-model="multisigName" hide-details></v-text-field>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="12">
          <span class="helper signers-note">
            Note: All signers will receive a request to review and sign the transaction
            from their own wallets. The transaction will be submitted to the blockchain only
            after all required signatures have been collected.
          </span>
        </v-col>
      </v-row>
      <v-row>
        <v-col cols="6">
          <div class="multisig-title text-left mb-2">Minimum Signers</div>
          <v-select dense v-model="requiredSigners" :items="signersArray"
            prepend-inner-icon="mdi-account-multiple-outline" outlined hide-details>
          </v-select>
          <div class="helper signers-note mt-2">The minimum number of signers required to execute a transaction</div>
        </v-col>
      </v-row>
      <v-row no-gutters class="pt-4 mt-4">
        <v-col cols="12" v-for="(signer, index) in signers" :key="index">
          <v-row no-gutters>
            <v-col cols="12" class="multisig-title text-left pa-0 mb-2" outlined>
              Signer {{ index + 1 }}<span v-if="signer.isThisWallet">{{ ': ' + signer.name }}</span>
              <div class="helper signers-note">{{ signer.isThisWallet ? 'Current Wallet' : '' }}</div>
            </v-col>
            <v-col cols="12" class="text-left pa-0 mb-2 d-flex align-center" outlined>
              <v-text-field 
                v-model="signer.address" 
                outlined 
                hide-details 
                dense
                :readonly="signer.isThisWallet" />
                <v-btn v-if="!signer.isThisWallet" icon @click="deleteSigner(index)">
                  <v-icon>mdi-delete</v-icon>
                </v-btn>
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
      <v-card-actions class="my-2 text-center justify-center" :style="{ flexFlow: 'column' }">
          <v-btn outlined @click="nextStep" :disabled="loading || !isFormValid" :loading="loading">
            Create
            <v-icon small class="ml-1">mdi-arrow-right</v-icon>
          </v-btn>
      </v-card-actions>
  </BaseDialog>
</template>

<script lang="ts">
import { WalletType } from "@/models/types";
import BaseDialog from "@/shared/components/BaseDialog.vue";
import networks from "@/shared/utils/networks";
import { appWallet, useStore } from "@/store";
import { mapState } from "pinia";
import { multisigJsonToBech32, addressBech32ToKeyHash } from "@/shared/utils/converter";
import db from "@/db";
import Dexie from "dexie";
import { walletConfigStore } from "@/store/modules/walletConfig";
import { Wallet } from "@/models/wallet";
import lodash from "lodash";
import { multisigStore } from "@/store/modules/multisig";

export default defineComponent({
  name: "CreateMultisignWalletDialog",
  components: {
    BaseDialog,
  },

  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
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
    ...mapState(walletConfigStore, ["utxos", "addresses"]),
    isFormValid() {
      const invalidSigners = this.signers.filter(iSigner => !iSigner.address.trim());
      console.log("invalidSigners:::::", invalidSigners);
      const isValid =
        this.multisigName.trim() !== "" &&
        this.requiredSigners >= 1 &&
        this.requiredSigners <= this.signers.length &&
        !invalidSigners.length;

      console.log("form is: " + isValid ? "validxx" : "invalid");
      return isValid;
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
  }),
  methods: {
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
      await db.createNewWalletDb(this.loggedWallet.id); // incase of upgraded wallet schema
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

      await db.createNewWalletDb(multisigDBName).then(value => {
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
    const loggedInWalletInstance = Wallet.class(this.loggedWallet, this.provider);
    console.log("instance of thi.log:::", loggedInWalletInstance instanceof Wallet);

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
  letter-spacing: 0%;
}
.multisig-title{
  font-size: 18px;
  color: #fff;
}
.helper{
  font-size: 12px;
  color: #ccc;
}
</style>