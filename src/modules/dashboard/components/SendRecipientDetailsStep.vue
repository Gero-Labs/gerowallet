<template>
  <v-form ref="form" v-model="valid">
    <div class="send-recipient-details-container">
      <div class="item-container">
        <v-row>
          <v-col cols="12" class="py-0 px-2">
            <Select
              :value="sendData.selectedWallet"
              :items="[sendData.selectedWallet]"
              :label="t('wallet.wallet')"
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
              transition="fade-transition"
            >
              <template v-slot:activator="{ on, attrs }">
                <v-btn outlined block color="#272930" style="background-color: #0F0F0F;" class="pl-0" v-bind="attrs" v-on="on" @click="saveContact" :disabled="loading || !isValidAddress">
                  <v-list-item dense class="px-0">
                    <v-avatar size="34" class="mx-0">
                      <v-icon small color="#00DFF3">
                        {{ contacts && contacts[paymentAddress] != null ? 'mdi-bookmark' : 'mdi-bookmark-plus-outline'}}
                      </v-icon>
                    </v-avatar>
                    <v-list-item-content>
                      <v-list-item-title style="color: white; font-size: 11px">
                        {{ contacts && contacts[paymentAddress] != null ? $t('wallet.editContact') : $t('wallet.saveContact')}}
                      </v-list-item-title>
                    </v-list-item-content>
                  </v-list-item>
                </v-btn>
              </template>
              <v-card outlined style="background: #0c0e12 !important; border: 1px solid rgba(255, 255, 255, 0.15) !important; border-radius: 16px !important; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.12) !important;">
                <v-card-title>
                  {{ $t('wallet.contactAdded') }}
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
                          :label="$t('wallet.name')"
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
                          :label="$t('wallet.address')"
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
                    {{ $t('wallet.done') }}
                  </v-btn>
                  <v-btn color="primary" text @click="removeCont">
                    {{ $t('wallet.remove') }}
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
              transition="fade-transition"
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
                        {{ $t('wallet.contacts') }}
                      </v-list-item-title>
                    </v-list-item-content>
                  </v-list-item>
                </v-btn>
              </template>
              <v-card outlined style="background: #0c0e12 !important; border: 1px solid rgba(255, 255, 255, 0.15) !important; border-radius: 16px !important; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.12) !important;">
                <v-card-title>
                  {{ $t('wallet.contacts') }}
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
            <v-btn outlined block color="#272930" style="background-color: #0F0F0F" class="pl-0" @click="qrScanDialog = true">
              <v-list-item dense class="px-0">
                <v-avatar size="34" class="mx-0">
                  <v-icon small color="#00DFF3">
                    mdi-qrcode
                  </v-icon>
                </v-avatar>
                <v-list-item-content>
                  <v-list-item-title style="color: white; font-size: 11px">
                    {{ $t('wallet.qrScan') }}
                  </v-list-item-title>
                </v-list-item-content>
              </v-list-item>
            </v-btn>
            <QRAddressScannerDialog
              :isOpen="qrScanDialog"
              :chain="loggedWallet?.chain"
              :network="loggedWallet?.network"
              @close="qrScanDialog = false"
              @scan="onQRScan"
            />
          </v-col>
          <v-col cols="12" class="py-0 px-2">
            <v-textarea
              v-if="loggedWallet"
              v-model="recipientAddress"
              :label="$t('wallet.recipientAddress')"
              :placeholder="loggedWallet.network === Network.MAINNET && loggedWallet.chain === Blockchain.CARDANO ? $t('wallet.enterRecipientOrHandle') : $t('wallet.enterRecipientAddress')"
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
            <v-alert
              v-if="handleMismatch.show"
              type="warning"
              dense
              outlined
              border="left"
              class="mb-2"
              style="font-size: 12px"
              dismissible
              @input="handleMismatch.show = false"
            >
              <strong>{{ handleMismatch.handle }}</strong> {{ $t('wallet.contactHandleAddressChanged') }}
              <div style="font-size: 11px; margin-top: 4px; opacity: 0.8">
                {{ $t('wallet.contactSavedAddress') }}: {{ filters.truncate(handleMismatch.savedAddress) }}
              </div>
              <div style="font-size: 11px; opacity: 0.8">
                {{ $t('wallet.contactCurrentAddress') }}: {{ filters.truncate(handleMismatch.freshAddress) }}
              </div>
              <v-btn x-small color="warning" class="mt-2" @click="updateContactAddress">
                {{ $t('wallet.contactUpdateAddress') }}
              </v-btn>
            </v-alert>
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
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, toRefs, watch, nextTick } from 'vue';
import Select from '@/shared/components/Select.vue';
import rules from "@/utils/rules";
import { Blockchain, Network, SendData } from '@/models/types';
import debounce from 'lodash/debounce';
import CopyButton from '@/shared/components/CopyButton.vue';
import adaHandleApi from '@/api/ada-handle.api';
import { walletStore } from '@/stores/walletStore';
import { addOrUpdateContact, removeContact } from '@/db/wallet-db';
import assets from '@/utils/assets';
import filters from '@/shared/utils/filters';
import QRAddressScannerDialog from '@/modules/dashboard/dialogs/QRAddressScannerDialog.vue';
import { debugLog } from '@/utils/debug';
import { isPaymentAddress } from '@/chrome/serialization';

interface Props {
  sendData: SendData;
}

const props = defineProps<Props>();
const emit = defineEmits(['updateRecipientAddress'])

const { loggedWallet, contacts } = toRefs(walletStore)

const form = ref(null);
const valid = ref<boolean>(false);
const paymentAddress = ref<string>('');
const recipientAddress = ref<string>('');
const resolved = ref<boolean>(undefined);
const loading = ref<boolean>(false);
const contactsMenu = ref<boolean>(false);
let selectContactCounter = 0;
const saveContactMenu = ref<boolean>(false);
const qrScanDialog = ref<boolean>(false);
const asset = ref(undefined);
const contact = ref<{ name: string; address: string; img?: string; handle?: string }>({
  name: '',
  address: '',
  img: undefined,
  handle: undefined
});
const handleMismatch = ref({ show: false, handle: '', savedAddress: '', freshAddress: '', contactName: '' });

const { t } = useTranslation();

const isValidAddress = computed(() => {
  if (!paymentAddress.value) return false
  const rule = rules.recipientRules(loggedWallet.value?.chain, loggedWallet.value?.network)
  return rule(paymentAddress.value) === true
})

const contactsHeaders = ref([
  { text: t('common.name') as string, value: 'name' },
  { text: t('common.address') as string, value: 'address' },
  { text: '', align: 'right', sortable: false, value: 'actions' },
]);

const selectContact = async (item) => {
  contactsMenu.value = false;
  handleMismatch.value.show = false;
  const currentSelection = ++selectContactCounter;

  if (item.handle && loggedWallet.value.network === Network.MAINNET && loggedWallet.value.chain === Blockchain.CARDANO) {
    loading.value = true;
    try {
      const res = await adaHandleApi.resolve(item.handle.replace('$', ''));
      if (currentSelection !== selectContactCounter) return; // stale response
      if (res.status === 200 && res.data?.resolved_addresses?.ada) {
        const freshAddress = res.data.resolved_addresses.ada;
        if (!isPaymentAddress(freshAddress)) {
          // Invalid address from API — fall back to stored
          paymentAddress.value = item.address;
          recipientAddress.value = item.address;
          emit('updateRecipientAddress', item.address);
          return;
        }
        asset.value = { name: res.data.name, img: assets.resolveIcon(res.data.image) };
        resolved.value = true;
        recipientAddress.value = item.handle;

        if (freshAddress !== item.address) {
          handleMismatch.value = { show: true, handle: item.handle, savedAddress: item.address, freshAddress, contactName: item.name };
          paymentAddress.value = freshAddress;
        } else {
          paymentAddress.value = item.address;
        }
        emit('updateRecipientAddress', paymentAddress.value);
      } else {
        paymentAddress.value = item.address;
        recipientAddress.value = item.address;
        emit('updateRecipientAddress', item.address);
      }
    } catch {
      if (currentSelection !== selectContactCounter) return;
      paymentAddress.value = item.address;
      recipientAddress.value = item.address;
      emit('updateRecipientAddress', item.address);
    } finally {
      if (currentSelection === selectContactCounter) loading.value = false;
    }
  } else {
    recipientAddress.value = item.address;
    paymentAddress.value = item.address;
    emit('updateRecipientAddress', item.address);
  }
}

const onQRScan = (address: string) => {
  recipientAddress.value = address
  paymentAddress.value = address
  emit('updateRecipientAddress', address)
  qrScanDialog.value = false
}

const saveContact = () => {
  debugLog('save contact')
  contact.value = { address: '', img: undefined, name: '', handle: undefined }
  let name
  const address = paymentAddress.value
  const img = asset.value?.img
  const handle = recipientAddress.value.startsWith('$') ? recipientAddress.value : undefined
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
    address,
    handle
  }
}

const updateContactAddress = async () => {
  const mismatch = handleMismatch.value;
  delete contacts.value[mismatch.savedAddress];
  await removeContact(loggedWallet.value.id, mismatch.savedAddress);
  const updated = { name: mismatch.contactName, address: mismatch.freshAddress, handle: mismatch.handle };
  contacts.value[mismatch.freshAddress] = updated;
  await addOrUpdateContact(loggedWallet.value.id, updated);
  handleMismatch.value.show = false;
};

const resolveAddress = (val) => {
  const address = val || ''
  if (address.startsWith('$') && loggedWallet.value.network === Network.MAINNET && loggedWallet.value.chain === Blockchain.CARDANO) {
    resolveAdaHandle(address)
  } else {
    resolved.value = undefined
    paymentAddress.value = address
    emit('updateRecipientAddress', address)
  }
}

const removeCont = async (item) => {
  if (item && item.address) {
    delete contacts.value[item.address]
    await removeContact(loggedWallet.value.id, item.address)
    contactsMenu.value = false
  } else {
    delete contacts.value[contact.value.address]
    await removeContact(loggedWallet.value.id, contact.value.address)
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
      console.debug(res)
      if (res.status === 200 && res.data?.resolved_addresses?.ada) {
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

watch(contact, async (val) => {
  debugLog('contact', val)
  if (!val.address) return
  const existing = contacts.value[val.address]
  if (existing == null || existing.name != val.name || existing.handle != val.handle) {
    contacts.value[val.address] = val
    await addOrUpdateContact(loggedWallet.value.id, val)
  }
}, { deep: true })

// Watch for parent resetting recipientAddress and sync local state
watch(() => props.sendData.recipientAddress, async (newAddress) => {
  // When parent clears the address (dialog reset), clear local state
  if (!newAddress) {
    recipientAddress.value = ''
    paymentAddress.value = ''
    resolved.value = undefined
    asset.value = undefined
    loading.value = false
    contact.value = { name: '', address: '', img: undefined }

    // Clean up any empty-address contact that may have been saved
    if (contacts.value && contacts.value[''] != null) {
      delete contacts.value['']
      await removeContact(loggedWallet.value.id, '')
    }

    // Reset validation only (not form values — avoids clearing the wallet Select)
    await nextTick()
    if (form.value) {
      form.value.resetValidation()
    }
  }
  // When parent sets an address (e.g., from contact selection), sync it
  // Don't overwrite recipientAddress if it holds a handle that resolved to this address
  else if (newAddress !== recipientAddress.value && !recipientAddress.value.startsWith('$')) {
    recipientAddress.value = newAddress
    paymentAddress.value = newAddress
  }
}, { immediate: true })
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
