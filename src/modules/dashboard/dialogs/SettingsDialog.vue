<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Settings" subtitle="Modify wallet and extension configuration settings" :loading="loading" :min-height="0" >
    <v-card-title class="pa-0">
      <v-tabs
        v-model="tab"
        color="white"
        class="v-tabs-border-bottom mb-0"
        background-color="transparent"
      >
        <v-tab
          v-for="tab in tabs"
          :key="tab.value"
          :disabled="tab.disabled"
        >
          {{ tab.label }}
        </v-tab>
      </v-tabs>
    </v-card-title>
    <v-card-text class="px-3 justify-center text-center pb-0" style="z-index: 1; min-height: 0; height: 608px">
<!--      <v-text-field-->
<!--        v-model="search"-->
<!--        placeholder="Search"-->
<!--        prepend-inner-icon="mdi-magnify"-->
<!--        outlined-->
<!--        dense-->
<!--        hide-details-->
<!--        class="mb-4"-->
<!--        :disabled="true"-->
<!--      />-->

      <v-tabs-items v-model="tab" class="transparent">
        <ProfileTab />
<!--        <PasswordTab />-->
        <CollateralTab />
        <ContactsTab />
        <ConnectedDappsTab />
        <AdvancedSettingsTab @loading="loadingChange" />
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
import AdvancedSettingsTab from '@/modules/dashboard/components/AdvancedSettingsTab.vue';

export default {
  name: 'SettingsDialog',
  components: {
    AdvancedSettingsTab, BaseDialog, ContactsTab,
    // PasswordTab,
    CollateralTab, ProfileTab, ConnectedDappsTab },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  methods: {
    loadingChange(val) {
      this.loading = val
    }
  },
  data: () => ({
    search: null,
    tab: null,
    loading: false,
    tabs: [
      { label: 'Profile', value: 'profile' },
      // { label: 'Password', value: 'password' },
      { label: 'Collateral', value: 'collateral', disabled: false },
      { label: 'Contacts', value: 'contacts', disabled: true },
      { label: 'Connected Dapps', value: 'connectedDapps', disabled: false },
      { label: 'Advanced', value: 'advanced', disabled: false }
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
