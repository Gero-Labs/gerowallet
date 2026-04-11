<template>
  <BaseDialog
    icon="mdi-cog"
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="t('settings.settings')"
    :subtitle="t('settings.modifyWalletAndExtension')"
    :loading="loading"
    :min-height="0"
    scrollable
    :persistent="false"
  >
    <v-card-title class="px-2 py-0">
      <v-tabs
        fixed-tabs
        v-model="tab"
        color="white"
        class="v-tabs-border-bottom mb-0"
        background-color="transparent"
        show-arrows
      >
        <v-tab
          v-for="tab in tabs"
          :key="tab.value"
          :disabled="tab.disabled"
          style="word-break: keep-all;"
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
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, watch } from 'vue'
import BaseDialog             from '@/shared/dialogs/BaseDialog.vue'
import ContactsTab            from '@/modules/dashboard/components/ContactsTab.vue'
import CollateralTab          from '@/modules/dashboard/components/CollateralTab.vue'
import ProfileTab             from '@/modules/dashboard/components/ProfileTab.vue'
import ConnectedDappsTab      from '@/modules/dashboard/components/ConnectedDappsTab.vue'
import AdvancedSettingsTab    from '@/modules/dashboard/components/AdvancedSettingsTab.vue'
import walletStoreDefault from '@/stores/walletStore';
import SecurityTab from '@/modules/dashboard/components/SecurityTab.vue';
import { hasNewFeaturesInPath, markFeatureAsSeen } from '@/shared/composables/useFeatureNotifications';

const { t } = useTranslation();

// Props & Emitting
const props = defineProps<{ isOpen: boolean; initialTab?: string }>()
defineEmits<{ (e: 'close'): void }>()

// Derive whether we've ever loaded a backup setting
const hasBackup = computed(() => walletStoreDefault.hasBackup())

// Read the actual backup‐enabled flag (defaults to true)
const getBackup = computed(() => walletStoreDefault.getBackup())

// Show a badge if the user *should* back up
const shouldBackup = computed(() => hasBackup.value && !getBackup.value)

// Check if there are new features in the security section
const hasNewSecurityFeatures = computed(() => hasNewFeaturesInPath(['settings', 'security']))

// Check if there are new features in the profile section (e.g., German language)
const hasNewProfileFeatures = computed(() => hasNewFeaturesInPath(['settings', 'profile']))

// Check if there are new features in the advanced section (e.g., default extension mode)
const hasNewAdvancedFeatures = computed(() => hasNewFeaturesInPath(['settings', 'advanced']))

// Check if there are new features in the collateral section (e.g., auto-detect banner)
const hasNewCollateralFeatures = computed(() => hasNewFeaturesInPath(['settings', 'collateral']))

// Local reactive state
const tab     = ref<string | null>(null)
const loading = ref(false)
const visitedAdvancedTab = ref(false)

// Build your tab array, injecting the dynamic badge
const tabs = computed(() => [
  { label: t('settings.profile'), value: 'profile', badge: hasNewProfileFeatures.value },
  // { label: 'Password', value: 'password' },
  { label: t('settings.collateral'), value: 'collateral', disabled: false, badge: hasNewCollateralFeatures.value },
  { label: t('settings.contacts'), value: 'contacts', disabled: false },
  { label: t('settings.dapps'), value: 'connectedDapps', disabled: false },
  { label: t('settings.security'), value: 'security', disabled: false, badge: shouldBackup.value || hasNewSecurityFeatures.value },
  { label: t('settings.advanced'), value: 'advanced', disabled: false, badge: hasNewAdvancedFeatures.value },
])

// Track when user visits the Advanced tab
const advancedTabIndex = computed(() => tabs.value.findIndex(t => t.value === 'advanced'));
watch(tab, (val) => {
  if (val === advancedTabIndex.value) {
    visitedAdvancedTab.value = true;
  }
});

// Jump to a specific tab when initialTab prop changes or dialog opens
// Mark seen advanced features when dialog closes
watch(
  () => props.isOpen,
  (open) => {
    if (open && props.initialTab) {
      const idx = tabs.value.findIndex(t => t.value === props.initialTab);
      if (idx >= 0) tab.value = idx as any;
    }
    if (!open && visitedAdvancedTab.value) {
      markFeatureAsSeen('settings.advanced.defaultExtensionMode');
      visitedAdvancedTab.value = false;
    }
  }
);

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
