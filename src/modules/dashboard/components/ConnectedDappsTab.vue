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
<script >
import { mapActions, mapState } from 'pinia';
import { useStore } from '@/stores';

export default {
  name: 'CollateralTab',
  computed: {
    ...mapState(useStore, ['connectedDapps']),
  },
  methods: {
    ...mapActions(useStore, ['disconnectDapp']),
    confirmRemove(item) {
      this.itemToDelete = item
      this.confirmRemoveDialog = true
    },
    remove() {
      this.disconnectDapp(this.itemToDelete.id)
      this.itemToDelete = undefined
      this.confirmRemoveDialog = false
    }
  },
  data: () => ({
    confirmRemoveDialog: false,
    itemToDelete: undefined,
    transaction: '62b6f02a8be5ccdd40c1d89068f9f0de05dc2fe67c7eda52dc6c673b7ee309e6',
    headers: [
      { text: "Domain", align: "start", sortable: true, value: "domain", width: '99%'},
      { text: "", align: "start", sortable: false, value: "actions" },
    ]
  }),
}
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
