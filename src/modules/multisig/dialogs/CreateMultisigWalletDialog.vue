<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    title="New Multisig Wallet"
    :loading="loading"
    :min-height="0"
    :subtitle="`A multisig wallet requires multiple parties' signatures to authorize any transaction.`"
  >
    <v-card-text
      class="px-3 justify-center"
      style="z-index: 1; min-height: 0; height: 490px; align-content: center"
    >
      <v-row no-gutters class="py-2">
        <v-col cols="3" class="text-left">
          <h3>Name</h3>
          <span class="helper my-0">Multisig wallet name</span>
        </v-col>
        <v-col cols="9">
          <v-text-field outlined dense v-model="multisigName" hide-details></v-text-field>
        </v-col>
      </v-row>
      <v-row>
        <span class="text-left d-block"
          >Note: All signers will receive a request to review and sign the transaction
          from their own wallets. The transaction will be submitted to the blockchain only
          after all required signatures have been collected.</span
        >
      </v-row>
      <v-row class="pt-3">
        <v-col cols="6">
          <v-select
            label="Minimum Signers"
            v-model="requiredSigners"
            :items="signersArray"
            outlined
            hide-details
          >
            <template v-slot:prepend>
              <img
                src="@/assets/svg/account-multiple-outline-custom.svg"
                alt="Icon"
                width="24"
                height="24"
              />
            </template>
          </v-select>
          <span class="text-left d-block"
            >The minimum number of signers required to execute a transaction</span
          >
        </v-col>
      </v-row>
      <v-row no-gutters class="pt-4">
        <v-col cols="12" v-for="(signer, index) in signers" :key="index">
          <v-row no-gutters>
            <v-col cols="12" class="text-left pa-0" outlined>
              Signer {{ index + 1
              }}{{ signer.isThisWallet ? " (This Wallet): " + signer.name : "" }}
            </v-col>
            <v-col cols="12" class="text-left pa-0" outlined>
              <v-text-field
                v-model="signer.address"
                outlined
                hide-details
                dense
                :readonly="signer.isThisWallet"
              ></v-text-field>
            </v-col>
          </v-row>
        </v-col>
      </v-row>
      <v-row class="justify-center text-center">
        <v-btn dense plain class="text-capitalize font-weight-normal" @click="addSigner">
          <img src="@/assets/svg/plus-square.svg" alt="Icon" width="15" height="15" />
          Add Signer
        </v-btn>
      </v-row>
    </v-card-text>
    <v-card-actions class="text-center justify-center" :style="{ flexFlow: 'column' }">
      <div>
        <v-btn
          class="continue-button text-capitalize"
          @click="nextStep"
          :disabled="loading"
          :loading="loading"
          >Create
          <v-icon style="color: black !important" small class="ml-1"
            >mdi-arrow-right</v-icon
          >
        </v-btn>
      </div>
    </v-card-actions>
  </BaseDialog>
</template>

<script>
import { Network, WalletType } from "@/models/types";
import BaseDialog from "@/shared/components/BaseDialog.vue";
import networks from "@/shared/utils/networks";
import { appWallet, useStore } from "@/store";
import { mapState } from "pinia";
import { multisigJsonToBech32, addressBech32ToKeyHash } from "@/shared/utils/converter";
import { buildTx } from "@/shared/utils/builder";
import rules from "@/shared/utils/rules";
import db from "@/db";
import Dexie from "dexie";
import { walletConfigStore } from "@/store/modules/walletConfig";
import { Wallet } from "@/models/wallet";
import { Api } from "@/api/api";

export default {
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
    // ...mapState(useStore, ['loggedWallet']),
    ...mapState(useStore, [
      "loggedWallet",
      "resolvedAssets",
      "baseAddress",
      "latestTip",
      "pinnedTokens",
    ]),
    
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
    signers: [],
    multisigName: "",
    minSigners: 2,
    requiredSigners: 2, //default, initial
    signersArray: [1, 2, 3, 4, 5],
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
      this.signers;

      const multisigScriptJson = {
        type: "atLeast",
        scripts: this.signers.map((signer) => ({
          type: "sig",
          keyHash: addressBech32ToKeyHash(signer.address),
        })),
        required: this.requiredSigners,
      };

      const multisigaddress = multisigJsonToBech32(multisigScriptJson, 0);
      const multisigWallet = {
        id: multisigaddress.bech32Address,
        name: this.multisigName,
        signers: this.signers,
        requiredSigners: this.requiredSigners,
        createdAt: new Date().toISOString(),
        multisigScriptCBOR: multisigaddress.scriptCBOR,
      };
      console.log("MultiSIG object::::", multisigWallet);
      console.log("this loggedin wallet db", this.loggedWallet);
      this.provider = networks.resolveDefaultProvider(this.loggedWallet?.chain, this.loggedWallet?.network);
      const loggedInWalletInstance = Wallet.class(this.loggedWallet, this.provider);
      // loggedInWalletInstance.
      console.log("this loggedin wallet baseaddress", loggedInWalletInstance.baseAddress());
      console.log("this loggedin wallet baseaddress address", loggedInWalletInstance.baseAddress().to_address().to_bech32());

      console.log("instance of this loggedin wallet:::", loggedInWalletInstance instanceof Wallet);

      // Create Wallet in browser
      // wal.db = new Dexie('multisig-' + wallet.publicKey.slice(0,21)); //xpub1lnyv9yu3gjge6stulu3ed0ns6pc2e6253rzx3wnklgflfdnqtnlpgptc4drpx2ry4502jd4wdc7aev3m8pzxdfjp08atjatppqwgtgc7n2tun
      const parentWalletPubkey =
        "xpub1lnyv9yu3gjge6stulu3ed0ns6pc2e6253rzx3wnklgflfdnqtnlpgptc4drpx2ry4502jd4wdc7aev3m8pzxdfjp08atjatppqwgtgc7n2tun";
      const multisigDBName =
        "multisig-" + parentWalletPubkey.slice(0, 21) + "-" + this.multisigName;
      console.log("dbname:::::", multisigDBName);
      const parentWalletName = "wallet-"+this.loggedWallet.id;
      await appWallet.api.createMultisigWallet(multisigaddress, appWallet.baseAddress().to_address().to_bech32()); // creates the wallet on Backend.
      await db.createNewWalletDb(this.loggedWallet.id); // incase of upgraded wallet schema
      const dbParent = new Dexie('wallet-'+this.loggedWallet.id); //parent wallet
      await dbParent.open();
      console.log("Whererhereh Before");
      const exists = await dbParent.table('multisig').get(multisigWallet.id); //.where("id").equals(multisigWallet.id); //.count();
      console.log("Whererhereh After:::", exists);
      if(exists) {
        // update
        const {id, ...walletValues} = multisigWallet;
        const updated = await dbParent.table('multisig').update(multisigWallet.id, { ...walletValues });
        if(updated) { 
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

      await db.createNewWalletDb(multisigDBName, true).then(value => {
        console.log("Multisig database created::", multisigDBName);

      }).catch(error => {
        console.error("Error creating multisig Database::", multisigDBName);
      });
      await appWallet.api.createMultisigWallet(multisigaddress, appWallet.baseAddress().to_address().to_bech32()); // creates the wallet on Backend. 
      
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
    
    addSigner() {
      if (this.signers.length < 7) {
        this.signers.push({
          name: "",
          address: "",
          isThisWallet: false,
        });
      }
    },
    close() {
      this.resetForm();
      this.dialog = false;
    },
    resetForm() {
      this.loading = false;
      this.multisigName = "";
      this.minSigners = 1;
      this.signers = [
        {
          name: "My wallet", // current signed in wallet
          address: "addr_test1qreu3crfp24jrxtxpvdlkcpakk3u59ldgajxwfzmm3rx2vacjma654mexefdgznteckzdcylpygakqt8hg8nhmm4tq8q2pezev",//this.loggedWallet.baseAddress.to_address().to_bech32(), //'addr_test1qreu3crfp24jrxtxpvdlkcpakk3u59ldgajxwfzmm3rx2vacjma654mexefdgznteckzdcylpygakqt8hg8nhmm4tq8q2pezev', // current signed wallet
          isThisWallet: true,
        },
      ];
    },
    nextStep() {
      this.createMultisigWallet();
      this.$emit('close');
    },
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
};
</script>
<style>
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
  display: block; /* Ensures the text-align property is applied */
}
</style>
