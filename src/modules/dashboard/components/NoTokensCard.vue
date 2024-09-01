<template>
  <v-card outlined class="card-container justify-center">
    <v-card-title class="subtitle-1">Welcome to Gero Dashboard</v-card-title>

    <section v-if="!hasAssets" class="mb-10">
      <p class="display-1">Let's start by getting some {{ assetType }} into your wallet!</p>
      <p class="subtitle-1" v-if="assetType === Blockchain.APEX_PRIME">Claim your {{ assetType }} tokens with your Wallet by using the DApp below</p>
      <v-btn class="claim-apex-button" v-if="assetType === Blockchain.APEX_PRIME"></v-btn>
    </section>

    <section
      class="text-center d-flex align-center justify-center flex-column stake-apex-section"
      :class="{ 'no-apex': !hasAssets }"
    >
      <div class="stake-apex-info">
        <h1 class="display-1">Stake Your {{assetType}} and Earn Rewards</h1>
        <v-card-text class="subtitle-1" v-if="loggedWallet"
          >Earn rewards by staking your {{assetType}} tokens with {{loggedWallet.chain}}'s extensive network of stake pools.</v-card-text
        >
        <p class="subtitle-1 support-us-text" v-if="geroPoolExists">
          Consider supporting us by delegating your stake to GERO and start earning as soon as current epoch!
        </p>

        <div class="d-flex align-center justify-center flex-column">
          <v-btn class="stake-button-gero" v-if="geroPoolExists" @click="delegateToGero">Stake with GERO</v-btn>
          <v-btn class="stake-button-pools" to="/staking">Browse Stake Pools</v-btn>
        </div>
      </div>

      <h2 class="error-message">You need to have {{assetType}} in your wallet before staking!</h2>
    </section>
    <DelegateDialog :isOpen="isDelegateDialogOpen" @close="isDelegateDialogOpen = false" :pool="selectedPool" :tx="txData"></DelegateDialog>
  </v-card>
</template>
<script>
import {mapState} from "pinia";
import { appWallet, useStore } from '@/store';
import {Blockchain} from "@/models/types";
import networks from "@/shared/utils/networks";
import {
  Certificate, Ed25519KeyHash,
  Credential,
  StakeDelegation,
  StakeRegistration, Transaction, TransactionUnspentOutputs, TransactionWitnessSet,
} from '@emurgo/cardano-serialization-lib-browser';
import { toUTxO } from '@/shared/utils/converter';
import { buildTx } from '@/shared/utils/builder';
import DelegateDialog from '@/modules/staking/dialogs/DelegateDialog.vue';

export default {
  name: "NoTokensCard",
  components: { DelegateDialog },
  computed: {
    geroPoolExists() {
      if (this.loggedWallet) {
        return !!networks.resolvePool(this.loggedWallet.chain, this.loggedWallet.network)
      }
      return false
    },
    assetType() {
      if (!this.loggedWallet) {
        return ''
      }
      return networks.resolveCurrencyTicker(this.loggedWallet.chain, this.loggedWallet.network)
    },
    hasAssets() {
      return !!this.accountInfo
    },
    Blockchain() {
      return Blockchain
    },
    ...mapState(useStore, ['accountInfo', 'loggedWallet', 'pools', 'utxos', 'latestTip', 'baseAddress']),
  },
  methods: {
    delegateToGero() {
      const poolId = networks.resolvePool(this.loggedWallet.chain, this.loggedWallet.network)
      this.selectedPool = this.pools.find(pool => pool.pool_id_bech32 === poolId)
      if (!this.selectedPool) {
        console.log('Pool Not Found')
        return;
      }
      const wallet = appWallet;
      // Registration Certificate
      const certificates = [];
      if (!this.accountInfo?.active) {
        const registrationCertificate = Certificate.new_stake_registration(StakeRegistration.new(Credential.from_keyhash(wallet.stakeKey().hash())))
        certificates.push(registrationCertificate);
      }
      // Delegation Certificate
      const delegationCertificate = Certificate.new_stake_delegation(StakeDelegation.new(Credential.from_keyhash(wallet.stakeKey().hash()), Ed25519KeyHash.from_bech32(poolId)));
      certificates.push(delegationCertificate);
      // UTxOs
      const transactionUnspentOutputs = TransactionUnspentOutputs.new();
      this.utxos.forEach((utxo) => transactionUnspentOutputs.add(toUTxO(utxo)));
      const txBody = buildTx(this.loggedWallet, undefined, transactionUnspentOutputs, this.latestTip.slot, this.baseAddress, certificates, [])
      this.txData = Transaction.new(txBody, TransactionWitnessSet.new())
      console.log(txBody.to_json())
      console.log(this.txData)
      this.isDelegateDialogOpen = true
    }
  },
  data: () => ({
    isDelegateDialogOpen: false,
    selectedPool: undefined,
    txData: undefined,
  })
};
</script>
<style scoped>
.card-container {
  display: flex;
  align-items: center;
  text-align: center;
  flex-direction: column;
  padding: 0 20px;
  height: 100%;

  .claim-apex-button {
    width: 320px;
    opacity: 0.7;
    height: 110px;
    transition: 0.2s all ease-in-out;
    background-image: url('../assets/claim_ap3x_button.png');
    background-size: contain;

    &:hover {
      opacity: 1;
    }

    & img {
      box-shadow: 0px 5px 10px 7px rgba(0, 0, 0, 0.5);
      height: 100%;
      width: 100%;
    }
  }

  .stake-apex-section {
    .support-us-text {
      color: #00dff3;
    }

    .stake-button-gero,
    .stake-button-pools {
      margin: 10px 0;
      width: 200px;
      font-family: Inter;
      font-size: 12px;
    }

    .stake-button-gero {
      background: linear-gradient(to right, #00c7f3, #00ffd1);
      color: black;
    }

    .stake-button-pools {
      border: 1px solid #ffffff;
      background-color: transparent !important;
    }

    .error-message {
      position: absolute;
      color: #ff7777;
      padding: 10px;
      display: none;
      &:hover {
        display: block;
      }
    }

    &.no-apex {
      .stake-apex-info {
        opacity: 0.2;
        pointer-events: none;
      }

      &:hover {
        .stake-apex-info {
          filter: blur(4px);
        }

        & > .error-message {
          display: block;
        }
      }
    }
  }
}
</style>
