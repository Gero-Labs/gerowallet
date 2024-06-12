<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')">
    <v-card-title>Settings
      <v-spacer></v-spacer>
    </v-card-title>
    <v-card-subtitle>Modify wallet and extension configuration settings</v-card-subtitle>
    <v-card-text>
      <v-text-field
        v-model="search"
        placeholder="Search"
        prepend-inner-icon="mdi-magnify"
        outlined
        dense
        hide-details
        class="mb-4"
      />
      <v-card class="col-12 align-content-start no-shadow">
        <v-tabs
          color="white"
          class="v-tabs-border-bottom"
          background-color="transparent"
        >
          <v-tab
            v-for="tab in tabs"
            :key="tab.value"
            @click="activeTab=tab.value"
            :value="tab.value">{{ tab.label }}
          </v-tab>
        </v-tabs>

        <ProfileTab v-if="activeTab === 'profile'" />
        <PasswordTab v-if="activeTab === 'password'" />
        <CollateralTab v-if="activeTab === 'collateral'" />
        <ContactsTab v-if="activeTab === 'contacts'" />
      </v-card>
    </v-card-text>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';
import ContactsTab from '@/modules/dashboard/components/ContactsTab.vue';
import PasswordTab from '@/modules/dashboard/components/PasswordTab.vue';
import CollateralTab from '@/modules/dashboard/components/CollateralTab.vue';
import ProfileTab from '@/modules/dashboard/components/ProfileTab.vue';

export default {
  name: 'SettingsDialog',
  components: { BaseDialog, ContactsTab, PasswordTab, CollateralTab, ProfileTab },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },

  data: () => ({
    activeTab: 'profile',
    search: null,
    tabs: [
      { label: 'Profile', value: 'profile' },
      { label: 'Password', value: 'password' },
      { label: 'Collateral', value: 'collateral' },
      { label: 'Contacts', value: 'contacts' },
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
