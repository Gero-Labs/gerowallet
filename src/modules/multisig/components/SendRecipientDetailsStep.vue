<template>
  <v-form ref="form" v-model="valid">
    <div class="send-recipient-details-container">
      <div class="item-container">
        <v-row>
          <v-col cols="12" class="py-0 px-2">
            <span>{{ isMultisigFunding ? $t('multisig.fromWallet') : $t('multisig.fromMultisigWallet') }}</span>
            <v-select
              :disabled="true"
              dense
              v-model="senderWallet"
              :items="availableWallets"
              item-text="name"
              item-value="addressBech32"
              prepend-inner-icon="mdi-account-multiple-outline"
              outlined
              hide-details>
            </v-select>
          </v-col>
          <v-col cols="12" style="color: var(--g-text-3); min-height: 52px; font-style: italic; align-content: center;"
            class="py-0 px-2">
          </v-col>
          <v-col cols="4" class="px-2 pt-0">
            <v-menu v-model="saveContactMenu" :close-on-content-click="false" offset-y max-width="452">
              <template v-slot:activator="{ on, attrs }">
                <v-btn outlined block color="var(--g-raised)" style="background-color: var(--g-canvas);" class="pl-0" :disabled="!valid"
                  v-bind="attrs" v-on="on" @click="saveContact">
                  <v-list-item dense class="px-0">
                    <v-avatar size="34" class="mx-0">
                      <v-icon small color="var(--g-accent)">
                        {{ contacts && contacts[paymentAddress] != null ? 'mdi-bookmark' : 'mdi-bookmark-plus-outline' }}
                      </v-icon>
                    </v-avatar>
                    <v-list-item-content>
                      <v-list-item-title style="color: var(--g-text-1); font-size: 11px">
                        {{ contacts && contacts[paymentAddress] != null ? 'Edit Contact' : 'Save Contact' }}
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
                      <v-img :src="contact?.img" contain :alt="`${asset?.name} Logo`">
                        <template v-slot:placeholder>
                          <v-row class="fill-height ma-0" align="center" justify="center">
                            <v-progress-circular indeterminate color="grey lighten-5"></v-progress-circular>
                          </v-row>
                        </template>
                      </v-img>
                    </v-list-item-avatar>
                    <v-list-item-content>
                      <v-list-item-title class="py-2">
                        <v-text-field v-model="contact.name" dense outlined :label="$t('common.name')" hide-details :maxlength="40"
                          counter="40"></v-text-field>
                      </v-list-item-title>
                      <v-list-item-title class="py-2">
                        <v-text-field v-model="contact.address" dense outlined :label="$t('common.address')" hide-details
                          :disabled="contacts && contacts[contact.address] != null"></v-text-field>
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
            <v-menu v-model="contactsMenu" :close-on-content-click="false" offset-y nudge-left="156" min-width="452"
              max-height="400">
              <template v-slot:activator="{ on, attrs }">
                <v-btn outlined block color="var(--g-raised)" style="background-color: var(--g-canvas);" class="pl-0" v-bind="attrs"
                  v-on="on" :disabled="contacts && Object.values(contacts)?.length === 0">
                  <v-list-item dense class="px-0">
                    <v-avatar size="34" class="mx-0">
                      <v-icon small color="var(--g-accent)">
                        mdi-book-open-variant-outline
                      </v-icon>
                    </v-avatar>
                    <v-list-item-content>
                      <v-list-item-title style="color: var(--g-text-1); font-size: 11px">
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
          </v-col>
          <v-col cols="4" class="px-2 pt-0">
            <v-btn outlined block color="var(--g-raised)" style="background-color: var(--g-canvas)" class="pl-0" disabled>
              <v-list-item dense class="px-0">
                <v-avatar size="34" class="mx-0">
                  <v-icon small color="var(--g-accent)">
                    mdi-qrcode
                  </v-icon>
                </v-avatar>
                <v-list-item-content>
                  <v-list-item-title style="color: var(--g-text-1); font-size: 11px">
                    QR Scan
                  </v-list-item-title>
                </v-list-item-content>
              </v-list-item>
            </v-btn>
          </v-col>
          <v-col cols="12" class="py-0 px-2">
            <v-textarea v-if="loggedWallet" v-model="recipientAddress" :label="$t('common.recipientAddress')"
              :placeholder="`Enter a Recipient Address${loggedWallet.network === Network.MAINNET && loggedWallet.chain === Blockchain.CARDANO ? ' or an ADA Handle' : ''}`"
              rows="3" outlined :rules="recipientRules" class="recipient-address" @input="resolveAddress"
              :loading="loading" hide-details dense clearable>
              <template v-slot:append>
                <v-progress-circular color="var(--g-text-1)" v-if="loading" size="24" indeterminate></v-progress-circular>
                <v-icon color="error" v-else-if="!loading && resolved === false">
                  mdi-alert
                </v-icon>
              </template>
            </v-textarea>
          </v-col>
          <v-col cols="12" style="color: var(--g-text-3); min-height: 52px; font-style: italic; align-content: center;"
            class="py-0">
            <span v-if="resolved">{{ paymentAddress }}</span>
          </v-col>
        </v-row>
      </div>
    </div>
  </v-form>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, watch, onMounted, onBeforeMount, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
// import { multisigStore } from '@/stores/modules/multisig';
import { Blockchain, Network } from '@/models/types';
import rules from "@/utils/rules";
import debounce from 'lodash/debounce';
import { resolveAsset } from '@/shared/utils/resolver';
import CopyButton from '@/shared/components/CopyButton.vue';
import filters from '@/shared/utils/filters';
import type { Asset, Contact } from '@/modules/multisig/types/MultiSigTypes';

// Props
const props = defineProps<{
  sendData: {
    recipientAddress?: string;
    selectedWallet?: string;
    isMultisigFunding?: boolean;
    availableWallets?: any[];
  };
}>();

// Emits
const emit = defineEmits<{
  (e: 'updateRecipientAddress', address: string): void;
}>();

const { t } = useTranslation();

// Store setup
const { loggedWallet, contacts } = toRefs(walletStore);
// const multisig = multisigStore();

// Refs
const form = ref<HTMLFormElement | null>(null);
const valid = ref(false);
const paymentAddress = ref('');
const recipientAddress = ref('');
const senderWallet = ref('');
const availableWallets = ref<any[]>([]);
const resolved = ref<boolean | undefined>(undefined);
const loading = ref(false);
const contactsMenu = ref(false);
const saveContactMenu = ref(false);
const isMultisigFunding = ref(false);
const asset = ref<Asset | undefined>(undefined);
const contact = ref<Contact>({
  name: '',
  address: '',
  img: undefined
});

// Computed
// const multiSigWallet = computed(() => multisig.multiSigWallet);
// const multiSigWallets = computed(() => multisig.multiSigWallets);
const multiSigWallet = computed(() => ({}));
const _multiSigWallets = computed(() => []);

const recipientRules = computed(() => {
  if (loggedWallet.value?.network === Network.MAINNET) {
    if (loggedWallet.value?.chain === Blockchain.CARDANO) {
      if (recipientAddress.value?.startsWith('$')) {
        return [rules.required, rules.paymentAddressOrAdaHandle(), !!resolved.value];
      } else {
        return [rules.required, rules.paymentAddressOrAdaHandle()];
      }
    } else {
      return [rules.required, rules.paymentAddress(false)];
    }
  } else {
    return [rules.required, rules.paymentAddress(true)];
  }
});

// Methods
const _getMultiSigWallet = () => {
  return multiSigWallet.value;
};

const selectContact = (item: Contact) => {
  recipientAddress.value = item.address;
  emit('updateRecipientAddress', item.address);
  contactsMenu.value = false;
};

const saveContact = () => {
  asset.value = undefined;
  contact.value = {
    name: '',
    address: '',
    img: undefined
  };
  
  const address = paymentAddress.value;
  const img = asset.value ? asset.value.img : null;
  const name = contacts.value?.[paymentAddress.value]?.name ?? '';
  
  contact.value = {
    img,
    name,
    address
  };
};

const removeCont = (item?: Contact) => {
  if (item?.address) {
    // walletConfig.removeContact(item.address); // TODO: Implement contact removal in walletStore
    contactsMenu.value = false;
  } else {
    // walletConfig.removeContact(contact.value.address); // TODO: Implement contact removal in walletStore
    saveContactMenu.value = false;
  }
};

const resolveAddress = (val: string) => {
  if (val !== '') {
    if (val?.startsWith('$') && loggedWallet.value?.network === Network.MAINNET && loggedWallet.value?.chain === Blockchain.CARDANO) {
      return resolveAdaHandle(val);
    } else {
      resolved.value = undefined;
      paymentAddress.value = val;
      emit('updateRecipientAddress', val);
      return '';
    }
  }
};

const resolveAdaHandle = debounce(async (val: string) => {
  if (val.length === 1) {
    resolved.value = false;
    return;
  }
  
  loading.value = true;
  
  try {
    const address = await loggedWallet.value.api.getAssetNFTAddress(
      'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a',
      Buffer.from(val.replace('$', '')).toString('hex')
    );
    
    paymentAddress.value = address.payment_address;
    const res = await loggedWallet.value.api.getDetailedAssetsInfo(
      'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a',
      Buffer.from(val.replace('$', '')).toString('hex')
    );
    
    if (res.status === 200) {
      asset.value = await resolveAsset(res.data, res.data);
      emit('updateRecipientAddress', address.payment_address);
      resolved.value = true;
    } else {
      resolved.value = false;
    }
  } catch (error) {
    emit('updateRecipientAddress', '');
    resolved.value = false;
  } finally {
    loading.value = false;
  }
}, 1000);

// Watchers
watch(contact, async (_val) => {
  // await walletConfig.addOrUpdateContact(val); // TODO: Implement contact add/update in walletStore
}, { deep: true });

watch(() => props.sendData, (val) => {
  if (val && !val.recipientAddress) {
    recipientAddress.value = '';
  }
}, { deep: true });

// Lifecycle hooks
onBeforeMount(() => {
  recipientAddress.value = props.sendData.recipientAddress ?? '';
  senderWallet.value = props.sendData.selectedWallet ?? '';
  availableWallets.value = props.sendData.availableWallets ?? [];
  isMultisigFunding.value = props.sendData.isMultisigFunding ?? false;
  resolveAddress(recipientAddress.value);
});

onMounted(() => {
  recipientAddress.value = props.sendData.recipientAddress ?? '';
  senderWallet.value = props.sendData.selectedWallet ?? '';
  availableWallets.value = props.sendData.availableWallets ?? [];
  isMultisigFunding.value = props.sendData.isMultisigFunding ?? false;
  resolveAddress(recipientAddress.value);
});

// Constants
const contactsHeaders = [
  { text: t('common.name'), value: 'name' },
  { text: t('common.address'), value: 'address' },
  { text: '', align: 'right', sortable: false, value: 'actions' },
];

const truncate = filters.truncate;
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

  .recipient-address>.v-input__control>.v-input__slot {
    background-color: var(--g-raised);
    border-radius: var(--g-r-control);
    padding: 5px 10px;

    & textarea {
      resize: none;
    }
  }
}
</style>
