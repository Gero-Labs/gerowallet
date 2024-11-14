<template>
  <v-form ref="form" v-model="valid">
    <div class="send-recipient-details-container">
      <div class="item-container">
        <v-row>
          <v-col cols="12" class="py-0 px-2">
            <Select
              :value="sendData.selectedWallet"
              :items="[sendData.selectedWallet]"
              label="Wallet"
              :readonly="true"
            ></Select>
          </v-col>
          <v-col cols="12" style="color: #61646C; min-height: 52px; font-style: italic; align-content: center;" class="py-0 px-2">
          </v-col>
          <v-col cols="4" class="px-2 pt-0">
            <v-menu
              v-model="saveContactMenu"
              :close-on-content-click="false"
              offset-y
              max-width="452"
            >
              <template v-slot:activator="{ on, attrs }">
                <v-btn outlined block color="#272930" style="background-color: #0F0F0F;" class="pl-0" :disabled="!valid" v-bind="attrs" v-on="on" @click="saveContact">
                  <v-list-item dense class="px-0">
                    <v-avatar size="34" class="mx-0">
                      <v-icon small color="#00DFF3">
                        {{ contacts && contacts[paymentAddress] != null ? 'mdi-bookmark' : 'mdi-bookmark-plus-outline'}}
                      </v-icon>
                    </v-avatar>
                    <v-list-item-content>
                      <v-list-item-title style="color: white; font-size: 11px">
                        {{ contacts && contacts[paymentAddress] != null ? 'Edit Contact' : 'Save Contact'}}
                      </v-list-item-title>
                    </v-list-item-content>
                  </v-list-item>
                </v-btn>
              </template>
              <v-card>
                <v-card-title>
                  Contact Added
                  <v-spacer></v-spacer>
                  <v-btn icon small @click="saveContactMenu = false">
                    <v-icon>
                      mdi-window-close
                    </v-icon>
                  </v-btn>
                </v-card-title>
                <v-card-text class="py-0">
                  <v-list-item dense class="px-0">
                    <v-list-item-avatar size="100" v-if="contact?.img" rounded>
                      <v-img :src="contact?.img" contain :alt="`${asset.name} Logo`">
                        <template v-slot:placeholder>
                          <v-row
                            class="fill-height ma-0"
                            align="center"
                            justify="center"
                          >
                            <v-progress-circular
                              indeterminate
                              color="grey lighten-5"
                            ></v-progress-circular>
                          </v-row>
                        </template>
                      </v-img>
                    </v-list-item-avatar>
                    <v-list-item-content>
                      <v-list-item-title class="py-2">
                        <v-text-field v-model="contact.name" dense outlined label="Name" hide-details :maxlength="40" counter="40"></v-text-field>
                      </v-list-item-title>
                      <v-list-item-title class="py-2">
                        <v-text-field v-model="contact.address" dense outlined label="Address" hide-details :disabled="contacts && contacts[contact.address] != null"></v-text-field>
                      </v-list-item-title>
                    </v-list-item-content>
                  </v-list-item>
                </v-card-text>
                <v-card-actions class="justify-center">
                  <v-btn text @click="saveContactMenu = false">
                    Done
                  </v-btn>
                  <v-btn color="primary" text @click="removeCont">
                    Remove
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-menu>
          </v-col>
          <v-col cols="4" class="px-2 pt-0">
            <v-menu
              v-model="contactsMenu"
              :close-on-content-click="false"
              offset-y
              nudge-left="156"
              min-width="452"
              max-height="400"
            >
              <template v-slot:activator="{ on, attrs }">
                <v-btn outlined block color="#272930" style="background-color: #0F0F0F;" class="pl-0" v-bind="attrs" v-on="on" :disabled="contacts && Object.values(contacts)?.length === 0">
                  <v-list-item dense class="px-0">
                    <v-avatar size="34" class="mx-0">
                      <v-icon small color="#00DFF3">
                        mdi-book-open-variant-outline
                      </v-icon>
                    </v-avatar>
                    <v-list-item-content>
                      <v-list-item-title style="color: white; font-size: 11px">
                        Contacts
                      </v-list-item-title>
                    </v-list-item-content>
                  </v-list-item>
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
                  <v-data-table dense class="transparent token-allocation-table" :headers="contactsHeaders" :items="contacts ? Object.values(contacts) : []" hide-default-footer disable-pagination @click:row="selectContact" :header-props="{ 'sort-icon': 'mdi-menu-up' }">
                    <template v-slot:[`item.address`]="{ item }">
                      {{ item.address | truncate }}<CopyButton x-small :value="item.address" />
                    </template>
                  </v-data-table>
                </v-card-text>
              </v-card>
            </v-menu>
          </v-col>
          <v-col cols="4" class="px-2 pt-0">
            <v-btn outlined block color="#272930" style="background-color: #0F0F0F" class="pl-0" disabled>
              <v-list-item dense class="px-0">
                <v-avatar size="34" class="mx-0">
                  <v-icon small color="#00DFF3">
                    mdi-qrcode
                  </v-icon>
                </v-avatar>
                <v-list-item-content>
                  <v-list-item-title style="color: white; font-size: 11px">
                    QR Scan
                  </v-list-item-title>
                </v-list-item-content>
              </v-list-item>
            </v-btn>
          </v-col>
          <v-col cols="12" class="py-0 px-2">
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
          </v-col>
          <v-col cols="12" style="color: #61646C; min-height: 52px; font-style: italic; align-content: center;" class="py-0">
            <span v-if="resolved">{{paymentAddress}}</span>
          </v-col>
        </v-row>
      </div>
    </div>
  </v-form>
</template>
<script>
import Select from '@/shared/components/Select.vue';
import rules from "@/shared/utils/rules";
import { mapActions, mapState } from 'pinia';
import { appWallet, useStore } from '@/store';
import { Blockchain, Network } from '@/models/types';
import debounce from 'lodash/debounce';
import { resolveAsset } from '@/shared/utils/resolver';
import { walletConfigStore } from '@/store/modules/walletConfig';
import CopyButton from '@/shared/components/CopyButton.vue';
import filters from '@/shared/utils/filters';

export default {
  components: { CopyButton, Select },
  name: 'SendRecipientDetailsStep',
  props: {
    sendData: {
      type: Object,
      required: true,
    },
  },
  watch: {
    contact: {
      async handler(val) {
        await this.addOrUpdateContact(val)
      },
      deep: true,
    },
    sendData: {
      handler(val) {
        if (val && !val.recipientAddress) {
          this.recipientAddress = ''
        }
      },
      deep: true,
    }
  },
  filters,
  computed: {
    ...mapState(useStore, ['loggedWallet']),
    ...mapState(walletConfigStore, ['contacts']),
    recipientRules() {
      if (this.loggedWallet.network === Network.MAINNET) {
        if (this.loggedWallet.chain === Blockchain.CARDANO) {
          if (this.recipientAddress?.startsWith('$')) {
            return [rules.required, rules.paymentAddressOrAdaHandle(), !!this.resolved]
          } else {
            return [rules.required, rules.paymentAddressOrAdaHandle()]
          }
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
  },
  methods: {
    ...mapActions(walletConfigStore, ['addOrUpdateContact', 'removeContact']),
    selectContact(item) {
      this.recipientAddress = item.address
      this.$emit('updateRecipientAddress', this.recipientAddress)
      this.contactsMenu = false
    },
    saveContact() {
      this.contact = {}
      let name
      const address = this.paymentAddress
      const img = this.asset ? this.asset.img : null
      if (this.contacts[this.paymentAddress] == null) {
        name = ''
      } else {
        name = this.contacts[this.paymentAddress].name
      }
      this.contact = {
        img,
        name,
        address
      }
    },
    removeCont() {
      this.removeContact(this.contact.address)
      this.saveContactMenu = false
    },
    resolveAddress(val) {
      if (val && val.startsWith('$') && this.loggedWallet.network === Network.MAINNET && this.loggedWallet.chain === Blockchain.CARDANO) {
        this.resolveAdaHandle(val)
      } else {
        this.resolved = undefined
        this.paymentAddress = val
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
        .then(async address => {
          console.log(address)
          this.paymentAddress = address.payment_address
          const assetInfo = await appWallet.api.getDetailedAssetsInfo('f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a', Buffer.from(val.replace('$', '')).toString('hex'))
          this.asset = await resolveAsset(assetInfo, assetInfo)
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
    }, 2000),
  },
  data: () => ({
    valid: false,
    paymentAddress: '',
    recipientAddress: '',
    resolved: undefined,
    loading: false,
    rules,
    contactsMenu: false,
    saveContactMenu: false,
    asset: undefined,
    contact: {
      name: '',
      address: '',
      img: undefined
    },
    contactsHeaders: [
      { text: 'Name', value: 'name', width: '20%' },
      { text: 'Address', value: 'address', width: '80%' },
    ]
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
