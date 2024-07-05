<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Settings" subtitle="Modify wallet and extension configuration settings">
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1">
      <v-text-field
        v-model="search"
        placeholder="Search"
        prepend-inner-icon="mdi-magnify"
        outlined
        dense
        hide-details
        class="mb-4"
      />
      <v-tabs
        v-model="tab"
        color="white"
        class="v-tabs-border-bottom"
        background-color="transparent"
      >
        <v-tab
          v-for="tab in tabs"
          :key="tab.value">{{ tab.label }}
        </v-tab>
      </v-tabs>
      <v-tabs-items v-model="tab" class="transparent">
        <ProfileTab />
        <PasswordTab />
        <CollateralTab />
        <ContactsTab />
        <ConnectedDappsTab />
      </v-tabs-items>
    </v-card-text>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';
import ContactsTab from '@/modules/dashboard/components/ContactsTab.vue';
import PasswordTab from '@/modules/dashboard/components/PasswordTab.vue';
import CollateralTab from '@/modules/dashboard/components/CollateralTab.vue';
import ProfileTab from '@/modules/dashboard/components/ProfileTab.vue';
import ConnectedDappsTab from '@/modules/dashboard/components/ConnectedDappsTab.vue';

export default {
  name: 'SettingsDialog',
  components: { BaseDialog, ContactsTab, PasswordTab, CollateralTab, ProfileTab, ConnectedDappsTab },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },

  data: () => ({
    search: null,
    tab: null,
    tabs: [
      { label: 'Profile', value: 'profile' },
      { label: 'Password', value: 'password' },
      { label: 'Collateral', value: 'collateral' },
      { label: 'Contacts', value: 'contacts' },
      { label: 'Connected Dapps', value: 'connectedDapps' }
    ],
  }),
};
</script>
<style>
.v-tabs-border-bottom {
  border-bottom: 2px #333333 solid;
  margin-bottom: 1rem;
}

.v-tab {
  font-size: 0.75rem !important;
}
.no-shadow{
  box-shadow: none !important;
}
</style>
