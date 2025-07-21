<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    title="Settings"
    subtitle="Modify wallet and extension configuration settings"
    :loading="loading"
    :min-height="0"
    scrollable
  >
    <v-card-title class="px-2 py-0">
      <v-tabs
        fixed-tabs
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
          <v-icon color="error" x-small class="ml-1" v-if="tab.badge">
            mdi-circle
          </v-icon>
        </v-tab>
      </v-tabs>
    </v-card-title>
    <v-card-text class="px-3 justify-center text-center pb-0" style="z-index: 1; height: 548px">
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

      <v-tabs-items v-model="tab" class="transparent" style="overflow: visible">
        <ProfileTab @close="$emit('close')" />
<!--        <PasswordTab />-->
        <CollateralTab />
        <ContactsTab />
        <ConnectedDappsTab />
        <SecurityTab />
        <AdvancedSettingsTab @loading="loadingChange" />
      </v-tabs-items>
    </v-card-text>
  </BaseDialog>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue'
import BaseDialog             from '@/shared/dialogs/BaseDialog.vue'
import ContactsTab            from '@/modules/dashboard/components/ContactsTab.vue'
import CollateralTab          from '@/modules/dashboard/components/CollateralTab.vue'
import ProfileTab             from '@/modules/dashboard/components/ProfileTab.vue'
import ConnectedDappsTab      from '@/modules/dashboard/components/ConnectedDappsTab.vue'
import AdvancedSettingsTab    from '@/modules/dashboard/components/AdvancedSettingsTab.vue'
import walletStoreDefault from '@/stores/walletStore';
import SecurityTab from '@/modules/dashboard/components/SecurityTab.vue';

// Props & Emitting
const props = defineProps<{ isOpen: boolean }>()
const emit  = defineEmits<{ (e: 'close'): void }>()

// Derive whether we've ever loaded a backup setting
const hasBackup = computed(() => walletStoreDefault.hasBackup())

// Read the actual backup‐enabled flag (defaults to true)
const getBackup = computed(() => walletStoreDefault.getBackup())

// Show a badge if user *should* back up
const shouldBackup = computed(() => hasBackup.value && !getBackup.value)

// Local reactive state
const tab     = ref<string | null>(null)
const loading = ref(false)

// Build your tabs array, injecting the dynamic badge
const tabs = computed(() => [
  { label: 'Profile', value: 'profile' },
  // { label: 'Password', value: 'password' },
  { label: 'Collateral', value: 'collateral', disabled: false },
  { label: 'Contacts', value: 'contacts', disabled: false },
  { label: 'Dapps', value: 'connectedDapps', disabled: false },
  { label: 'Security', value: 'security', disabled: false, badge: shouldBackup.value },
  { label: 'Advanced', value: 'advanced', disabled: false },
])

// Handle loading events from AdvancedSettingsTab
function loadingChange(val: boolean) {
  loading.value = val
}
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
