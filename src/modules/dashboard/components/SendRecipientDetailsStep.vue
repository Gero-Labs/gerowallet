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
              :close-on-click="valid"
              offset-y
              max-width="452"
            >
              <template v-slot:activator="{ on, attrs }">
                <v-btn outlined block color="#272930" style="background-color: #0F0F0F;" class="pl-0" v-bind="attrs" v-on="on" @click="saveContact" :disabled="!valid || loading || !paymentAddress">
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
                  <v-btn icon small @click="saveContactMenu = false" :disabled="!valid">
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
                        <v-text-field
                          v-model="contact.name"
                          dense
                          outlined
                          label="Name"
                          hide-details
                          :maxlength="40"
                          counter="40"
                          :rules="[rules.required(), rules.maxCharacters(40), rules.minCharacters(3)]"
                        ></v-text-field>
                      </v-list-item-title>
                      <v-list-item-title class="py-2">
                        <v-text-field
                          v-model="contact.address"
                          dense
                          outlined
                          label="Address"
                          hide-details
                          :disabled="contacts && contacts[contact.address] != null"
                          :rules="[rules.recipientRules(loggedWallet?.chain, loggedWallet?.network)]"
                        ></v-text-field>
                      </v-list-item-title>
                    </v-list-item-content>
                  </v-list-item>
                </v-card-text>
                <v-card-actions class="justify-center">
                  <v-btn text @click="saveContactMenu = false" :disabled="!valid">
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
                      {{ filters.truncate(item.address) }}<CopyButton x-small :value="item.address" />
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
              :rules="[rules.recipientRules(loggedWallet?.chain, loggedWallet?.network)]"
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
          <v-col cols="12" style="color: #61646C; min-height: 96px; font-style: italic; align-content: center;" class="py-0">
            <v-list-item v-if="resolved" class="px-0">
              <v-list-item-avatar v-if="asset.img" size="80" rounded>
                <v-img :src="asset.img" contain>
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
              <v-list-item-subtitle style="white-space: normal">
                {{paymentAddress}}
              </v-list-item-subtitle>
            </v-list-item>
          </v-col>
        </v-row>
      </div>
    </div>
  </v-form>
</template>
<script setup lang="ts">
import { ref, toRefs, watch } from 'vue';
import Select from '@/shared/components/Select.vue';
import rules from "@/utils/rules";
import { Blockchain, Network } from '@/models/types';
import debounce from 'lodash/debounce';
import CopyButton from '@/shared/components/CopyButton.vue';
import adaHandleApi from '@/api/ada-handle.api';
import { walletStore } from '@/stores/walletStore';
import { addOrUpdateContact, removeContact } from '@/db/wallet-db';
import assets from '@/utils/assets';
import filters from '@/shared/utils/filters';

interface Props {
  sendData: any;
}

const props = defineProps<Props>();
const emit = defineEmits(['updateRecipientAddress'])

const { loggedWallet, contacts } = toRefs(walletStore)

const valid = ref<boolean>(false);
const paymentAddress = ref<string>('');
const recipientAddress = ref<string>('');
const resolved = ref<boolean>(undefined);
const loading = ref<boolean>(false);
const contactsMenu = ref<boolean>(false);
const saveContactMenu = ref<boolean>(false);
const asset = ref<any>(undefined);
const contact = ref<any>({
  name: '',
  address: '',
  img: undefined
});
const contactsHeaders = ref<any[]>([
  { text: 'Name', value: 'name' },
  { text: 'Address', value: 'address' },
  { text: '', align: 'right', sortable: false, value: 'actions' },
]);

const selectContact = (item) => {
  recipientAddress.value = item.address
  paymentAddress.value = item.address
  emit('updateRecipientAddress', recipientAddress.value)
  contactsMenu.value = false
}

const saveContact = () => {
  console.log('save contact')
  contact.value = {}
  let name
  const address = paymentAddress.value
  const img = asset.value?.img
  if (contacts.value[paymentAddress.value] == null) {
    name = ''
  } else {
    name = contacts.value[paymentAddress.value].name
  }
  if (!name && asset.value?.name) {
    name = asset.value.name
  }
  contact.value = {
    img,
    name,
    address
  }
}

const resolveAddress = (val) => {
  if (val && val.startsWith('$') && loggedWallet.value.network === Network.MAINNET && loggedWallet.value.chain === Blockchain.CARDANO) {
    resolveAdaHandle(val)
  } else {
    resolved.value = undefined
    paymentAddress.value = val
    emit('updateRecipientAddress', val)
  }
}

const removeCont = (item) => {
  if (item && item.address) {
    delete contacts.value[item.address]
    removeContact(loggedWallet.value.id, item.address)
    contactsMenu.value = false
  } else {
    delete contacts.value[contact.value.address]
    removeContact(loggedWallet.value.id, contact.value.address)
    saveContactMenu.value = false
  }
}

const resolveAdaHandle = debounce(async function(val) {
    if (val.length === 1) {
      resolved.value = false
      return
    }
    loading.value = true
    adaHandleApi.resolve(val.replace('$','')).then(async res => {
      console.log(res)
      if (res.status === 200 && res.data?.resolved_addresses?.ada) {
        const assetRes = {
          unit: res.data.policy + res.data.hex,
          img: res.data.image,
          metadata: {
            logo: res.data.image,
          }
        }
        asset.value = {
          name: res.data.name,
          img: assets.resolveIcon(res.data.image),
        }
        paymentAddress.value = res.data.resolved_addresses.ada
        emit('updateRecipientAddress', res.data.resolved_addresses.ada)
        resolved.value = true
      } else {
        resolved.value = false
      }
    }).catch(() => {
      emit('updateRecipientAddress', '')
      resolved.value = false
    }).finally(() => {
      loading.value = false
    })
  }, 1000);

watch(contact, (val) => {
  console.log('contact', val)
  if (contacts.value[val.address] == null || contacts.value[val.address].name != val.name) {
    contacts.value[val.address] = val
    addOrUpdateContact(loggedWallet.value.id, val)
  }
}, { deep: true })

watch(props.sendData, (val) => {
  if (val && !val.recipientAddress) {
    recipientAddress.value = ''
  }
}, { deep: true })
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
