<template>
  <v-tab-item>
    <v-card flat class="transparent">
      <v-card-text class="px-0">
        <v-data-table
          class="transparent"
          :items="connectedDapps"
          :headers="headers"
          hide-default-footer
          disable-pagination
          :header-props="{ 'sort-icon': 'mdi-menu-up' }"
        >
          <template v-slot:[`item.domain`]="{ item }">
            <v-avatar size="16">
              <v-img :src="`https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${item.domain}&size=16`" contain></v-img>
            </v-avatar>&nbsp;
            {{item.domain}}
          </template>
          <template v-slot:[`item.actions`]="{ item }">
            <v-btn small icon @click="confirmRemove(item)">
              <v-icon small color="red">
                mdi-trash-can
              </v-icon>
            </v-btn>
          </template>
        </v-data-table>
      </v-card-text>
    </v-card>
    <v-dialog
      v-model="confirmRemoveDialog"
      persistent
      max-width="400"
    >
      <v-card>
        <v-card-title>
          Remove Dapp Access
        </v-card-title>
        <v-card-text v-if="itemToDelete">Are you sure you want to remove Dapp access for <strong style="color: white">{{itemToDelete.domain}}</strong>?
          This action cannot be undone.</v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            text
            @click="confirmRemoveDialog = false"
          >
            No
          </v-btn>
          <v-btn
            color="primary"
            text
            @click="remove"
          >
            Yes
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-tab-item>
</template>
<script setup lang="ts">
import { ref, toRefs } from 'vue';
import WalletStore, { walletStore } from '@/plugins/walletStore';

const { loggedWallet, connectedDapps } = toRefs(walletStore);

// Reactive data
const confirmRemoveDialog = ref<boolean>(false);
const itemToDelete = ref<any>(undefined);
const transaction = ref<string>('');

const headers = ref([
  { text: "Domain", align: "start", sortable: true, value: "domain", width: '99%'},
  { text: "", align: "start", sortable: false, value: "actions" },
]);

// Methods
const confirmRemove = (item: any) => {
  itemToDelete.value = item;
  confirmRemoveDialog.value = true;
};

const remove = () => {
  WalletStore.disconnectDapp(loggedWallet.value.id, itemToDelete.value.id);
  itemToDelete.value = undefined;
  confirmRemoveDialog.value = false;
};
</script>

<style scoped>

.title {
  font-size: 18px;
  font-weight: 600;
  line-height: 28px;
  text-align: left;
}

.subtitle {
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  text-align: left;
  color: #94969C;
}

</style>
