<template>
  <div class="send-recipient-details-container">
    <div class="item-container pb-6">
      <Select
        :value="sendData.selectedWallet"
        :items="[sendData.selectedWallet]"
        label="Wallet"
        :readonly="true"
      ></Select>
    </div>

    <div class="item-container">
      <v-textarea
        v-if="loggedWallet"
        v-model="recipientAddress"
        label="Recipient Address"
        :placeholder="`Enter a Recipient Address${loggedWallet.network === Network.MAINNET && loggedWallet.chain === Blockchain.CARDANO ? ' or an ADA Handle' : ''}`"
        rows="3"
        outlined
        :rules="recipientRules"
        class="recipient-address"
        @input="resolveAddress"
        :loading="loading"
        hide-details
        dense
        clearable
      >
        <template v-slot:append>
          <v-progress-circular color="white" v-if="loading" size="24" indeterminate></v-progress-circular>
          <v-icon color="#F97066" v-else-if="!loading && resolved === false">
            mdi-alert
          </v-icon>
        </template>
      </v-textarea>
    </div>
  </div>
</template>

<script>
import Select from '@/shared/components/Select.vue';
import rules from "@/shared/utils/rules";
import {mapState} from "pinia";
import { appWallet, useStore } from '@/store';
import { Blockchain, Network } from '@/models/types';
import debounce from 'lodash/debounce';

export default {
  components: { Select },
  name: 'SendRecipientDetailsStep',
  props: {
    sendData: {
      type: Object,
      required: true,
    },
  },
  computed: {
    recipientRules() {
      if (this.loggedWallet.network === Network.MAINNET) {
        if (this.loggedWallet.chain === Blockchain.CARDANO) {
          return [rules.required, rules.paymentAddressOrAdaHandle(), !!this.resolved]
        } else {
          return [rules.required, rules.paymentAddress(false)]
        }
      } else {
        return [rules.required, rules.paymentAddress(true)]
      }
    },
    Blockchain() {
      return Blockchain
    },
    Network() {
      return Network
    },
    ...mapState(useStore, ['loggedWallet']),
  },
  methods: {
    resolveAddress(val) {
      if (val && val.startsWith('$') && this.loggedWallet.network === Network.MAINNET && this.loggedWallet.chain === Blockchain.CARDANO) {
        this.resolveAdaHandle(val)
      } else {
        this.resolved = undefined
        this.$emit('updateRecipientAddress', val)
      }
    },
    resolveAdaHandle: debounce(async function(val) {
      if (val.length === 1) {
        this.resolved = false
        return
      }
      this.loading = true
      appWallet.api.getAssetNFTAddress('f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a', Buffer.from(val.replace('$','')).toString('hex'))
        .then(address => {
          console.log(address)
          this.$emit('updateRecipientAddress', address.payment_address)
          this.resolved = true
        })
        .catch(() => {
          this.$emit('updateRecipientAddress', '')
          this.resolved = false
        })
        .finally(() => {
          this.loading = false
        })
    }, 300),
  },
  data: () => ({
    recipientAddress: '',
    resolved: undefined,
    loading: false,
    rules,
  })
};
</script>

<style>
.send-recipient-details-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 16px;

  & .item-container {
    width: 60%;
    text-align: left;
  }

  .recipient-address > .v-input__control > .v-input__slot {
    background-color: #292929;
    border-radius: 6px;
    padding: 5px 10px;

    & textarea {
      resize: none;
    }
  }

}
</style>
