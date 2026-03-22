<template>
  <v-tab-item>
    <v-data-table
      v-if="contacts"
      :headers="headers"
      :items="Object.values(contacts)"
      class="transparent"
      :header-props="{ 'sort-icon': 'mdi-menu-up' }"
      hide-default-footer
      disable-pagination
    >
      <template v-slot:top>
        <v-toolbar flat class="transparent my-2">
          <v-toolbar-title>
            {{ $t('common.addEditDeleteContacts') }}<br/>
            <span class="subtitle">{{ $t('common.contactsHelper') }}</span>
          </v-toolbar-title>
          <v-spacer></v-spacer>
          <v-btn
            style="letter-spacing: normal; background: linear-gradient(45deg, #00c7f3, #00ffd1); color: black"
            @click="dialog = true"
          >
            {{ $t('common.addContact') }}
          </v-btn>
          <BaseDialog :isOpen="dialog" @close="close" :title="formTitle" :subtitle="editedAddress && contacts[editedAddress]?.handle ? contacts[editedAddress].handle : ''" :icon="formIcon" :width="500" :height="400" :min-height="300" :persistent="false" :loading="resolving">
            <v-form ref="form" v-model="valid" class="px-3">
              <v-alert
                v-if="handleWarning.show"
                type="warning"
                dense
                outlined
                border="left"
                style="font-size: 12px"
                class="mb-2"
              >
                <strong>{{ handleWarning.handle }}</strong> {{ $t('wallet.contactHandleAddressChanged') }}
                <div style="font-size: 11px; margin-top: 4px; opacity: 0.8">
                  {{ $t('wallet.contactSavedAddress') }}: {{ filters.shortenStringWithEllipsis(handleWarning.oldAddress, 20) }}
                </div>
                <div style="font-size: 11px; opacity: 0.8">
                  {{ $t('wallet.contactCurrentAddress') }}: {{ filters.shortenStringWithEllipsis(handleWarning.newAddress, 20) }}
                </div>
                <v-btn x-small color="warning" class="mt-2" @click="applyFreshAddress">
                  {{ $t('wallet.contactUpdateAddress') }}
                </v-btn>
              </v-alert>
              <div style="display: flex; align-items: flex-start; gap: 12px">
                <v-avatar v-if="handleImg || resolving" size="106" rounded style="border-radius: 8px; border: 1px #444 solid; flex-shrink: 0">
                  <v-img v-if="handleImg" :src="handleImg" contain />
                  <v-progress-circular v-else indeterminate color="primary" />
                </v-avatar>
                <div style="flex: 1; min-width: 0">
                  <v-text-field
                    outlined
                    dense
                    v-model="editedItem.name"
                    :label="$t('common.name')"
                    :maxlength="40"
                    counter="40"
                    :rules="[rules.required(), rules.maxCharacters(40), rules.minCharacters(3)]"
                  ></v-text-field>
                  <v-text-field
                    outlined
                    dense
                    v-model="editedItem.address"
                    :label="$t('common.address')"
                    :rules="[rules.recipientRules(loggedWallet?.chain, loggedWallet?.network)]"
                    hide-details
                  ></v-text-field>
                </div>
              </div>
            </v-form>
            <v-card-actions class="px-3 pt-4">
              <v-spacer></v-spacer>
              <v-btn
                color="primary"
                text
                @click="close"
              >
                {{ $t('common.cancel') }}
              </v-btn>
              <v-btn
                color="primary"
                @click="save"
                :disabled="!valid"
              >
                {{ $t('common.save') }}
              </v-btn>
            </v-card-actions>
          </BaseDialog>
          <BaseDialog :isOpen="dialogDelete" @close="closeDelete" :title="t('wallet.deleteContact')" icon="mdi-account-remove" :width="500" :min-height="150" :persistent="false">
            <div class="text-center py-3" style="z-index: 9999">
              <h2>{{ $t('common.areYouSureDelete') }}</h2>
            </div>
            <v-card-actions class="px-3">
              <v-spacer></v-spacer>
              <v-btn color="primary" text @click="closeDelete">{{ $t('common.cancel') }}</v-btn>
              <v-btn color="primary" @click="deleteItemConfirm">{{ $t('common.yes') }}</v-btn>
            </v-card-actions>
          </BaseDialog>
        </v-toolbar>
      </template>
      <template v-slot:[`item.address`]="{ item }">
        {{ filters.shortenStringWithEllipsis(item.address, 24) }}<CopyButton x-small :value="item.address" />
      </template>
      <template v-slot:[`item.actions`]="{ item }">
        <v-icon
          small
          class="mr-2"
          @click="editItem(item)"
        >
          mdi-pencil
        </v-icon>
        <v-icon
          small
          @click="deleteItem(item)"
        >
          mdi-delete
        </v-icon>
      </template>
    </v-data-table>
  </v-tab-item>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, watch, nextTick, toRefs } from 'vue';
import rules from '@/utils/rules';
import filters from '@/shared/utils/filters';
import CopyButton from '@/shared/components/CopyButton.vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { addOrUpdateContact, removeContact } from '@/db/wallet-db';
import adaHandleApi from '@/api/ada-handle.api';
import assets from '@/utils/assets';
import { Blockchain, Contact, Network } from '@/models/types';
import { isPaymentAddress } from '@/chrome/serialization';

// Get reactive store properties
const { loggedWallet, contacts } = toRefs(walletStore);

// Reactive data
const { t } = useTranslation();
const form = ref(null);
const valid = ref<boolean>(false);
const dialog = ref<boolean>(false);
const dialogDelete = ref<boolean>(false);
const editedAddress = ref<string | null>(null);

const headers = ref([
  { text: t('common.name'), value: 'name', width: '20%' },
  { text: t('common.address'), value: 'address', width: '75%' },
  { text: t('common.actions'), value: 'actions', sortable: false, width: '5%' },
]);

const editedItem = ref<Contact>({
  name: '',
  address: '',
});

const defaultItem: Contact = {
  name: '',
  address: '',
};

const resolving = ref(false);
const handleImg = ref<string | undefined>(undefined);
const handleAddressApplied = ref(false);
const handleWarning = ref({ show: false, handle: '', oldAddress: '', newAddress: '' });

// Computed properties (contacts are now directly from store)
const formTitle = computed(() => {
  return editedAddress.value === null ? t('common.newContact') : t('common.editContact');
});

const formIcon = computed(() => {
  return editedAddress.value === null ? 'mdi-account-plus' : 'mdi-account-edit';
});

// Watchers
watch(dialog, (val) => {
  if (val) {
    nextTick(() => form.value?.resetValidation());
  } else {
    close();
  }
});

watch(dialogDelete, (val) => {
  val || closeDelete();
});

// Methods
const editItem = async (item: Contact) => {
  editedAddress.value = item.address;
  editedItem.value = { ...contacts.value[item.address] };
  handleWarning.value = { show: false, handle: '', oldAddress: '', newAddress: '' };
  handleAddressApplied.value = false;
  handleImg.value = undefined;
  dialog.value = true;

  const contact = contacts.value[item.address];
  if (contact?.handle && loggedWallet.value?.network === Network.MAINNET && loggedWallet.value?.chain === Blockchain.CARDANO) {
    resolving.value = true;
    try {
      const res = await adaHandleApi.resolve(contact.handle.replace('$', ''));
      if (res.status === 200 && res.data?.resolved_addresses?.ada) {
        handleImg.value = res.data.image ? assets.resolveIcon(res.data.image) : undefined;
        const freshAddress = res.data.resolved_addresses.ada;
        if (isPaymentAddress(freshAddress) && freshAddress !== item.address) {
          handleWarning.value = { show: true, handle: contact.handle, oldAddress: item.address, newAddress: freshAddress };
        }
      }
    } catch { /* silent - keep stored address */
    } finally { resolving.value = false; }
  }
};

const applyFreshAddress = () => {
  editedItem.value.address = handleWarning.value.newAddress;
  handleAddressApplied.value = true;
  handleWarning.value.show = false;
};

const deleteItem = (item: Contact) => {
  editedAddress.value = item.address;
  editedItem.value = { ...contacts.value[item.address] };
  dialogDelete.value = true;
};

const deleteItemConfirm = async () => {
  if (editedAddress.value) {
    // Remove contact directly from store and database
    delete contacts.value[editedAddress.value];
    await removeContact(loggedWallet.value.id, editedAddress.value);
  }
  closeDelete();
};

const close = () => {
  dialog.value = false;
  handleWarning.value = { show: false, handle: '', oldAddress: '', newAddress: '' };
  handleImg.value = undefined;
  handleAddressApplied.value = false;
  nextTick(() => {
    editedItem.value = { ...defaultItem };
    editedAddress.value = null;
  });
};

const closeDelete = () => {
  dialogDelete.value = false;
  nextTick(() => {
    editedItem.value = { ...defaultItem };
    editedAddress.value = null;
  });
};

const save = async () => {
  const addressChanged = editedAddress.value && editedAddress.value !== editedItem.value.address;
  const existingHandle = editedAddress.value ? contacts.value[editedAddress.value]?.handle : undefined;

  // Preserve handle only if address unchanged or updated via handle re-resolve; clear if manually changed
  const handle = (!addressChanged || handleAddressApplied.value) ? (existingHandle || undefined) : undefined;

  // If editing existing contact and address changed, remove old entry
  if (addressChanged) {
    delete contacts.value[editedAddress.value];
    await removeContact(loggedWallet.value.id, editedAddress.value);
  }

  const contactData = {
    name: editedItem.value.name,
    address: editedItem.value.address,
    handle,
  };

  contacts.value[editedItem.value.address] = contactData;
  await addOrUpdateContact(loggedWallet.value.id, contactData);
  close();
};
</script>

<style scoped>
.subtitle {
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  text-align: left;
  color: #94969C;
}

.v-data-table {
  width: 100%;
}
</style>
