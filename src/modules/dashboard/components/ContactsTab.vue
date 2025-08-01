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
            Add, Edit or Delete contacts<br/>
            <span class="subtitle">Contacts can be selected in the various send screens to save time</span>
          </v-toolbar-title>
          <v-spacer></v-spacer>
          <v-dialog
            v-model="dialog"
            max-width="500px"
          >
            <template v-slot:activator="{ on, attrs }">
              <v-btn
                style="letter-spacing: normal; background: linear-gradient(45deg, #00c7f3, #00ffd1); color: black"
                v-bind="attrs"
                v-on="on"
              >
                Add Contact
              </v-btn>
            </template>
            <v-form ref="form" v-model="valid">
              <v-card>
                <v-card-title>
                  {{ formTitle }}
                </v-card-title>
                <v-card-text class="py-0">
                  <v-container>
                    <v-row>
                      <v-col
                        cols="12"
                        sm="12"
                        md="12"
                        class="pb-0"
                      >
                        <v-text-field
                          outlined
                          dense
                          v-model="editedItem.name"
                          label="Name"
                          :maxlength="40"
                          counter="40"
                          :rules="[rules.required(), rules.maxCharacters(40), rules.minCharacters(3)]"
                        ></v-text-field>
                      </v-col>
                      <v-col cols="12" sm="12" md="12" class="py-0">
                        <v-text-field
                          outlined
                          dense
                          v-model="editedItem.address"
                          label="Address"
                          :rules="[rules.recipientRules(loggedWallet?.chain, loggedWallet?.network)]"
                        ></v-text-field>
                      </v-col>
                    </v-row>
                  </v-container>
                </v-card-text>
                <v-card-actions>
                  <v-spacer></v-spacer>
                  <v-btn
                    color="primary"
                    text
                    @click="close"
                  >
                    Cancel
                  </v-btn>
                  <v-btn
                    color="primary"
                    @click="save"
                    :disabled="!valid"
                  >
                    Save
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-form>
          </v-dialog>
          <v-dialog v-model="dialogDelete" max-width="500px">
            <v-card>
              <v-card-title>Are you sure you want to delete this item?</v-card-title>
              <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="primary" text @click="closeDelete">Cancel</v-btn>
                <v-btn color="primary" @click="deleteItemConfirm">OK</v-btn>
                <v-spacer></v-spacer>
              </v-card-actions>
            </v-card>
          </v-dialog>
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
import { ref, computed, watch, nextTick, toRefs } from 'vue';
import rules from '@/utils/rules';
import filters from '@/shared/utils/filters';
import CopyButton from '@/shared/components/CopyButton.vue';
import { walletStore } from '@/stores/walletStore';
import { addOrUpdateContact, removeContact } from '@/db/wallet-db';

// Get reactive store properties
const { loggedWallet, contacts } = toRefs(walletStore);

// Reactive data
const valid = ref<boolean>(false);
const dialog = ref<boolean>(false);
const dialogDelete = ref<boolean>(false);
const editedAddress = ref<string | null>(null);

const headers = ref([
  { text: 'Name', value: 'name', width: '20%' },
  { text: 'Address', value: 'address', width: '75%' },
  { text: 'Actions', value: 'actions', sortable: false, width: '5%' },
]);

const editedItem = ref({
  name: '',
  address: '',
});

const defaultItem = {
  name: '',
  address: '',
};

// Computed properties (contacts is now directly from store)

const formTitle = computed(() => {
  return editedAddress.value === null ? 'New Contact' : 'Edit Contact';
});

// Watchers
watch(dialog, (val) => {
  val || close();
});

watch(dialogDelete, (val) => {
  val || closeDelete();
});

// Methods
const editItem = (item: any) => {
  console.log(item);
  editedAddress.value = item.address;
  editedItem.value = { ...contacts.value[item.address] };
  dialog.value = true;
};

const deleteItem = (item: any) => {
  editedAddress.value = item.address;
  editedItem.value = { ...contacts.value[item.address] };
  dialogDelete.value = true;
};

const deleteItemConfirm = () => {
  if (editedAddress.value) {
    // Remove contact directly from store and database
    delete contacts.value[editedAddress.value];
    removeContact(loggedWallet.value.id, editedAddress.value);
  }
  closeDelete();
};

const close = () => {
  dialog.value = false;
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

const save = () => {
  // If editing existing contact and address changed, remove old entry
  if (editedAddress.value && editedAddress.value !== editedItem.value.address) {
    delete contacts.value[editedAddress.value];
    removeContact(loggedWallet.value.id, editedAddress.value);
  }
  
  // Add/update contact directly in store
  const contactData = {
    name: editedItem.value.name,
    address: editedItem.value.address,
  };
  
  contacts.value[editedItem.value.address] = contactData;
  addOrUpdateContact(loggedWallet.value.id, contactData);
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
