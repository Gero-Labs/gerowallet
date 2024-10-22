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
                          :rules="[rules.required, rules.maxCharacters(40), rules.minCharacters(3)]"
                        ></v-text-field>
                      </v-col>
                      <v-col cols="12" sm="12" md="12" class="py-0">
                        <v-text-field
                          outlined
                          dense
                          v-model="editedItem.address"
                          label="Address"
                          :rules="[rules.required, rules.paymentAddress(loggedWallet.network === Network.TESTNET)]"
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
        {{ item.address | shortenStringWithEllipsis(24) }}<CopyButton x-small :value="item.address" />
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
<script>
import rules from '@/shared/utils/rules';
import { Network } from '@/models/types';
import { mapActions, mapState } from 'pinia';
import { useStore } from '@/store';
import filters from '@/shared/utils/filters';
import CopyButton from '@/shared/components/CopyButton.vue';
import { walletConfigStore } from '@/store/modules/walletConfig';

export default {
  name: 'ContactsTab',
  components: { CopyButton },
  computed: {
    ...mapState(useStore, ['loggedWallet']),
    ...mapState(walletConfigStore, ['contacts']),
    Network() {
      return Network
    },
    formTitle() {
      return this.editedAddress === null ? 'New Contact' : 'Edit Contact'
    },
  },
  data: () => ({
    valid: false,
    rules,
    dialog: false,
    dialogDelete: false,
    headers: [
      { text: 'Name', value: 'name', width: '20%' },
      {text: 'Address', value: 'address', width: '75%'},
      {text: 'Actions', value: 'actions', sortable: false, width: '5%'},
    ],
    editedItem: {
      name: '',
      address: '',
    },
    defaultItem: {
      name: '',
      address: '',
    },
  }),
  filters,
  watch: {
    dialog(val) {
      val || this.close()
    },
    dialogDelete(val) {
      val || this.closeDelete()
    },
  },
  methods: {
    ...mapActions(walletConfigStore, ['addOrUpdateContact', 'removeContact']),
    editItem(item) {
      console.log(item)
      this.editedAddress = item.address
      this.editedItem = this.contacts[item.address]
      this.dialog = true
    },
    deleteItem(item) {
      this.editedAddress = item.address
      this.editedItem = this.contacts[item.address]
      this.dialogDelete = true
    },
    deleteItemConfirm() {
      this.removeContact(this.editedAddress)
      this.closeDelete()
    },
    close() {
      this.dialog = false
      this.$nextTick(() => {
        if (this.defaultItem) {
          this.editedItem = Object.assign({}, this.defaultItem)
          this.editedAddress = null
        }
      })
    },
    closeDelete() {
      this.dialogDelete = false
      this.$nextTick(() => {
        if (this.defaultItem) {
          this.editedItem = Object.assign({}, this.defaultItem)
          this.editedAddress = null
        }
      })
    },
    save() {
      this.addOrUpdateContact(this.editedItem, this.editedAddress)
      this.close()
    }
  },
}
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
