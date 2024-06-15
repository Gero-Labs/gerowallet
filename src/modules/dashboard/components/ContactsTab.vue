<template>
  <v-tab-item>
    <v-data-table
      :headers="headers"
      :items="contacts"
      class="transparent"
    >
      <template v-slot:top>
        <v-toolbar
          flat
          class="transparent"
        >
          <v-toolbar-title>
            Edit, delete or add new contacts here <br/>
            <span class="subtitle">Contacts can be chosen in the various send screens to save time</span>
          </v-toolbar-title>
          <v-spacer></v-spacer>

          <v-dialog
            v-model="dialog"
            max-width="500px"
          >
            <template v-slot:activator="{ on, attrs }">
              <v-btn
                large
                style="text-transform: capitalize; background: linear-gradient(45deg, #00c7f3, #00ffd1); color: black"
                v-bind="attrs"
                v-on="on"
              >
                Add Contact
              </v-btn>
            </template>

            <v-card>
              <v-card-title>
                <span class="text-h5">{{ formTitle }}</span>
              </v-card-title>

              <v-card-text>
                <v-container>
                  <v-row>
                    <v-col
                      cols="12"
                      sm="6"
                      md="6"
                    >
                      <v-text-field
                        v-model="editedItem.name"
                        label="Name"
                        :maxlength="25"
                        :rules="[v => !!v || 'Error: Please enter a name']"
                        validate-on-blur
                      ></v-text-field>
                    </v-col>
                    <v-col
                      cols="12"
                      sm="6"
                      md="6"
                    >
                      <v-text-field
                        v-model="editedItem.$handle"
                        label="$handle"
                        :rules="[v => !!v || 'Error: Please enter $handle']"
                        validate-on-blur
                      ></v-text-field>
                    </v-col>

                    <v-col
                      cols="12"
                      sm="12"
                      md="12"
                    >
                      <v-text-field
                        v-model="editedItem.address"
                        label="Address"
                        :rules="[v => !!v || 'Error: Please enter an address']"
                        validate-on-blur
                      ></v-text-field>
                    </v-col>

                  </v-row>
                </v-container>
              </v-card-text>

              <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn
                  color="blue darken-1"
                  text
                  @click="close"
                >
                  Cancel
                </v-btn>
                <v-btn
                  color="blue darken-1"
                  text
                  @click="save"
                  :disabled="saveButtonIsDisabled(editedItem)"
                >
                  Save
                </v-btn>
              </v-card-actions>
            </v-card>
          </v-dialog>

          <v-dialog v-model="dialogDelete" max-width="500px">
            <v-card>
              <v-card-title class="text-h5">Are you sure you want to delete this item?</v-card-title>
              <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn color="blue darken-1" text @click="closeDelete">Cancel</v-btn>
                <v-btn color="blue darken-1" text @click="deleteItemConfirm">OK</v-btn>
                <v-spacer></v-spacer>
              </v-card-actions>
            </v-card>
          </v-dialog>

        </v-toolbar>
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
export default {
  name: 'ContactsTab',
  data: () => ({
    dialog: false,
    dialogDelete: false,
    headers: [
      {
        text: 'Name',
        value: 'name',
        width: '20%'
      },
      {text: '$handle', value: '$handle', width: '20%'},
      {text: 'Address', value: 'truncatedAddress', width: '55%'},
      {text: 'Actions', value: 'actions', sortable: false, width: '5%'},
    ],
    contacts: [],
    editedIndex: -1,
    editedItem: {
      name: '',
      $handle: '',
      address: '',
    },
    defaultItem: {
      name: '',
      $handle: '',
      address: '',
    },
  }),

  computed: {
    formTitle() {
      return this.editedIndex === -1 ? 'New Contact' : 'Edit Contact'
    },
  },

  watch: {
    dialog(val) {
      val || this.close()
    },
    dialogDelete(val) {
      val || this.closeDelete()
    },
  },

  created() {
    this.initialize()
  },

  methods: {
    initialize() {
      this.contacts = [
        {
          name: 'John Doe',
          $handle: '$johnD',
          address: 'addr1q9hnmantdjruxqzc9qqq6kznup8xha3shuvhtktsp3j0rmh4xmy84q2crvzy6he2j69798923xvt3jk51234eecmxkskmexus',
          truncatedAddress: this.truncateAddress('addr1q9hnmantdjruxqzc9qqq6kznup8xha3shuvhtktsp3j0rmh4xmy84q2crvzy6he2j69798923xvt3jk51234eecmxkskmexus'),
        },
        {
          name: 'Dudi',
          $handle: '$dudi',
          address: 'addr1q9hnmantdjruxqzc9qqq6kznup8xha3shuvhtktsp3j0rmh4xmy84q2crvzy6he2j69798923xvt3jk51234eecmxkskmexus',
          truncatedAddress: this.truncateAddress('addr1q9hnmantdjruxqzc9qqq6kznup8xha3shuvhtktsp3j0rmh4xmy84q2crvzy6he2j69798923xvt3jk51234eecmxkskmexus'),
        },
      ]
    },

    editItem(item) {
      this.editedIndex = this.contacts.indexOf(item)
      this.editedItem = Object.assign({}, item)
      this.dialog = true
    },

    deleteItem(item) {
      this.editedIndex = this.contacts.indexOf(item)
      this.editedItem = Object.assign({}, item)
      this.dialogDelete = true
    },

    deleteItemConfirm() {
      this.contacts.splice(this.editedIndex, 1)
      this.closeDelete()
    },

    close() {
      this.dialog = false
      this.$nextTick(() => {
        this.editedItem = Object.assign({}, this.defaultItem)
        this.editedIndex = -1
      })
    },

    closeDelete() {
      this.dialogDelete = false
      this.$nextTick(() => {
        this.editedItem = Object.assign({}, this.defaultItem)
        this.editedIndex = -1
      })
    },

    save() {
      if (this.editedIndex > -1) {
        Object.assign(this.contacts[this.editedIndex], this.editedItem)
      } else {
        this.contacts.push(this.editedItem)
      }
      this.close()
    },

    truncateAddress(address) {
      return address.substring(0, 20) + ' ..... ' + address.substring(address.length - 20, address.length)
    },

    saveButtonIsDisabled(editItem){
      return editItem.name?.length === 0 || editItem.address?.length === 0 || editItem.$handle?.length === 0;
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
