<template>
  <div>
    <v-app style="background: transparent !important">
      <v-main style="position: relative; z-index: 1; background: black !important">
        <v-container class="pa-0" style="position: relative">
          <!-- Background - Confined to dashboard working area -->
          <div
            :class="
              loggedWallet?.chain === Blockchain.APEX_PRIME || loggedWallet?.chain === Blockchain.APEX_VECTOR
                ? 'apex-background-dashboard'
                : loggedWallet?.chain === Blockchain.BITCOIN
                  ? 'bitcoin-background-dashboard'
                  : 'cardano-background-dashboard'
            "
            :style="{
              backgroundImage: `url(${
                loggedWallet?.chain === Blockchain.APEX_PRIME || loggedWallet?.chain === Blockchain.APEX_VECTOR
                  ? assets.apexBg
                  : loggedWallet?.chain === Blockchain.BITCOIN
                    ? assets.bitcoinBg
                    : assets.cardanoBg
              })`,
            }"
          ></div>

          <v-layout :align-start="true">
            <NavigationDrawer v-model="drawer" />
            <v-sheet ref="scrollContainer" style="height: 100vh; width: 100%; overflow-y: scroll; background-color: transparent" @scroll.native="onSheetScroll">
              <v-row no-gutters v-if="isBeta">
                <v-col cols="12">
                  <v-alert color="warning" style="color: black" class="pa-2 px-3 text-center">
                    {{ $t('navigation.betaVersionNoticePrefix') }} <strong>{{ $t('navigation.betaVersionNoticeBold') }}</strong>{{ $t('navigation.betaVersionNoticeSuffix') }}
                    <a
                      style="color: black; font-weight: 700"
                      href="https://chromewebstore.google.com/detail/gero-dashboard/bgpipimickeadkjlklgciifhnalhdjhe?hl=en-US&utm_source=ext_sidebar"
                      target="_blank"
                      >{{ $t('navigation.geroDashboard') }}</a
                    >
                    {{ $t('navigation.inChromeStore') }}
                  </v-alert>
                </v-col>
              </v-row>
              <v-layout column class="no-gutters px-4 transparent" :justify-start="true">
                <v-app-bar ref="navBarRef" flat color="transparent" style="max-height: 55px">
                  <v-app-bar-nav-icon v-if="$vuetify.breakpoint.mobile" @click.stop="drawer = !drawer" />

                  <!-- Global Search Field -->
                  <v-tooltip bottom :disabled="!compactNav" content-class="custom-tooltip">
                    <template v-slot:activator="{ on, attrs }">
                      <div
                        ref="searchFieldRef"
                        :class="['nav-search-field', { 'nav-search-compact': compactNav }]"
                        @click="openGlobalSearch"
                        v-bind="attrs"
                        v-on="on"
                      >
                        <v-icon size="16" color="#82B4FF" class="nav-search-icon">mdi-magnify</v-icon>
                        <template v-if="!compactNav">
                          <span class="nav-search-placeholder">{{ t('search.globalPlaceholder') }}</span>
                          <span class="nav-search-shortcut">Ctrl+K</span>
                        </template>
                      </div>
                    </template>
                    <span>{{ t('search.globalPlaceholder') }} (Ctrl+K)</span>
                  </v-tooltip>

                  <v-spacer />

                  <QuickActionsBox :compact="compactNav" />

                  <v-spacer />

                  <v-tooltip
                    bottom
                    :content-class="
                      connected
                        ? 'network-tooltip'
                        : connecting
                        ? 'network-tooltip connecting'
                        : 'network-tooltip offline'
                    "
                  >
                    <template v-slot:activator="{ on, attrs }">
                      <div
                        style="display: flex; align-items: center; gap: 4px"
                        :style="{ minWidth: compactNav ? '20px' : '60px' }"
                        v-bind="attrs"
                        v-on="on"
                      >
                        <v-icon
                          small
                          :color="connected ? primaryColor : connecting ? '#FFA500' : '#ff6464'"
                          :class="{ 'sync-animation': isSyncing, 'connecting-animation': connecting }"
                        >
                          {{ connected ? 'mdi-lan-connect' : connecting ? 'mdi-lan-pending' : 'mdi-lan-disconnect' }}
                        </v-icon>

                        <!-- Small epoch progress bar (hidden in compact mode) -->
                        <v-progress-linear
                          v-if="!compactNav"
                          class="epoch-progress-liquid-glass"
                          height="8"
                          :buffer-value="epochSlotPercentage"
                          :value="epochSlotPercentage"
                          :color="connected ? primaryColor : connecting ? '#FFA500' : '#ff6464'"
                          background-color="transparent"
                          style="width: 50px"
                          striped
                          :stream="connected"
                          :indeterminate="connecting"
                        ></v-progress-linear>
                      </div>
                    </template>

                    <div class="network-tooltip-content">
                      <div><strong>{{ t('navigation.network') }}:</strong> {{ loggedWallet?.network }}</div>
                      <div><strong>{{ t('navigation.lastSync') }}:</strong> {{ lastSyncTimestamp }}</div>
                      <div><strong>{{ t('navigation.epoch') }}:</strong> {{ tip?.epoch || 'N/A' }}</div>
                      <div><strong>{{ t('navigation.progress') }}:</strong> {{ epochSlotPercentage.toFixed(1) }}%</div>
                      <div>
                        <strong class="mr-1">{{ t('navigation.status') }}:</strong>
                        <span
                          :style="
                            connected ? { color: 'inherit' } : connecting ? { color: '#FFA500' } : { color: '#ff6464' }
                          "
                          >{{ connected ? t('navigation.online') : connecting ? t('navigation.connecting') : t('navigation.offline') }}</span
                        >
                      </div>
                    </div>
                  </v-tooltip>

                  <!-- Notifications Menu -->
                  <v-menu
                    v-model="notificationsMenu"
                    offset-y
                    nudge-left="75"
                    :close-on-content-click="true"
                    transition="none"
                  >
                    <template v-slot:activator="{ on, attrs }">
                      <v-btn class="ml-4 toolbar-icon-btn" icon v-bind="attrs" v-on="on">
                        <v-badge :value="kesWarningVisible" color="error" dot overlap>
                          <v-icon size="20">mdi-bell-outline</v-icon>
                        </v-badge>
                      </v-btn>
                    </template>
                    <v-card outlined class="notifications-card" style="min-width: 280px; max-width: 320px">
                      <v-card-title class="pa-3 pb-1" style="font-size: 15px">{{ t('navigation.notifications') }}</v-card-title>
                      <v-card-text class="pa-0 pb-2">
                        <v-list v-if="kesWarningVisible" class="transparent" dense>
                          <v-list-item class="kes-notification-item" @click="navigateToPoolOperator">
                            <v-list-item-avatar size="32" class="mr-2" style="background: rgba(253,176,34,0.12); border-radius: 8px; min-width: 32px">
                              <v-icon size="16" color="#FDB022">mdi-key-chain</v-icon>
                            </v-list-item-avatar>
                            <v-list-item-content>
                              <v-list-item-title style="font-size: 13px; font-weight: 600; color: #FDB022; white-space: normal">
                                {{ t('poolOperator.kesWarningTitle', { remaining: kesRemainingGlobal }) }}
                              </v-list-item-title>
                              <v-list-item-subtitle style="font-size: 11px; white-space: normal; color: rgba(255,255,255,0.5)">
                                {{ t('poolOperator.kesWarningSubtitle') }}
                              </v-list-item-subtitle>
                            </v-list-item-content>
                            <v-list-item-action class="my-0 ml-1">
                              <v-icon small color="#FDB022">mdi-chevron-right</v-icon>
                            </v-list-item-action>
                          </v-list-item>
                        </v-list>
                        <div v-else class="text-center pa-4" style="color: rgba(255,255,255,0.4); font-size: 13px">
                          <v-icon small color="rgba(255,255,255,0.3)" class="mr-1">mdi-bell-check-outline</v-icon>
                          {{ t('navigation.nothingNew') }}
                        </div>
                      </v-card-text>
                    </v-card>
                  </v-menu>

                  <v-tooltip bottom content-class="custom-tooltip">
                    <template v-slot:activator="{ on, attrs }">
                      <v-btn icon class="ml-3 toolbar-icon-btn" v-bind="attrs" v-on="on" @click="toggleHideBalances()">
                        <v-icon size="20">{{ hideBalances ? 'mdi-eye-off-outline' : 'mdi-eye-outline' }}</v-icon>
                      </v-btn>
                    </template>
                    <span>{{ hideBalances ? t('dashboard.showBalances') : t('dashboard.hideBalances') }}</span>
                  </v-tooltip>

                  <v-tooltip bottom content-class="custom-tooltip">
                    <template v-slot:activator="{ on }">
                      <v-btn icon class="ml-3 toolbar-icon-btn" v-on="on" @click="openMiniMode">
                        <v-avatar size="23">
                          <img :src="assets.miniModeSvg" :alt="t('miniGero.miniMode')" />
                        </v-avatar>
                      </v-btn>
                    </template>
                    <span>{{ t('miniGero.miniMode') }}</span>
                  </v-tooltip>

                  <v-btn @click="currentDialog = dialogs.SETTINGS" class="ml-3 toolbar-icon-btn" icon>
                    <v-badge bordered color="error" dot v-if="shouldBackup || hasNewSettingsFeatures">
                      <v-avatar size="20">
                        <img :src="assets.settingsSvg" :alt="t('common.settings')" />
                      </v-avatar>
                    </v-badge>
                    <v-avatar size="20" v-else>
                      <img :src="assets.settingsSvg" :alt="t('common.settings')" />
                    </v-avatar>
                  </v-btn>
                </v-app-bar>
                <v-row no-gutters v-if="shouldBackup && !isWalletEmpty">
                  <v-col cols="12">
                    <v-alert
                      type="error"
                      prominent
                      dismissible
                      rounded
                      outlined
                      color="error"
                      class="py-2 px-4 ma-2"
                      style="overflow: hidden"
                    >
                      <v-list-item>
                        <v-list-item-content>
                          <v-list-item-title style="white-space: break-spaces">
                            {{ $t('settings.backupYourSeedPhrase') }}
                          </v-list-item-title>
                          <v-list-item-subtitle style="white-space: break-spaces">
                            <span>{{ $t('settings.backupSeedPhraseWarning') }}</span>
                          </v-list-item-subtitle>
                        </v-list-item-content>
                        <v-list-item-action>
                          <v-btn depressed color="error" @click="backupWalletDialog = true">{{ $t('common.backup') }}</v-btn>
                        </v-list-item-action>
                      </v-list-item>
                    </v-alert>
                  </v-col>
                </v-row>
                <SettingsDialog :isOpen="currentDialog === dialogs.SETTINGS" :initial-tab="settingsInitialTab" @close="closeDialog(); settingsInitialTab = undefined" />
                <v-sheet class="transparent pt-2">
                  <keep-alive>
                    <router-view
                      @open-backup-dialog="handleOpenBackupDialog"
                    />
                  </keep-alive>
                </v-sheet>
              </v-layout>
              <Player
                v-if="currentPage.name !== 'mediaPlayer' && musicPlaylist?.length > 0 && context.shown"
                style="position: sticky; bottom: 0"
              />
            </v-sheet>
          </v-layout>
        </v-container>
      </v-main>

      <WelcomeDialog :isOpen="!isWelcomeDone" @close="closeWelcomeDialog" />

      <ChangeLogDialog
        :isOpen="changeLog.enabled || vmProxy.$route.query['changeLog'] === 'true'"
        @close="closeChangeLogDialog"
        :persistent="false"
      />

      <BackupWalletDialog :isOpen="backupWalletDialog" @close="backupWalletDialog = false" />

      <GlobalSearch />

    </v-app>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref, toRefs, watch } from 'vue';
import NavigationDrawer from '../components/NavigationDrawer.vue';
import SettingsDialog from '@/modules/dashboard/dialogs/SettingsDialog.vue';
import Player from '@/modules/media-player/Player.vue';
import QuickActionsBox from '@/modules/navigation/components/QuickActionsBox.vue';
import WelcomeDialog from '@/shared/dialogs/WelcomeDialog.vue';
import ChangeLogDialog from '@/options/modules/navigation/dialogs/ChangeLogDialog.vue';
import BackupWalletDialog from '@/modules/navigation/dialogs/BackupWalletDialog.vue';
import { Blockchain } from '@/models/types';
import assets from '@/utils/assets';
import { chainAccents, chainKeyFor } from '@/config/themes';
import { loadingState } from '@/stores/loading';
import changeLogPlugin from '@/plugins/changeLog';
import { walletStore } from '@/stores/walletStore';
import WalletStore from '@/stores/walletStore';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { networkStore } from '@/stores/networkStore';
import { setConfiguration } from '@/db/gero-db';
import { geroStore } from '@/stores/geroStore';
import { musicStore } from '@/stores/musicStore';
import { hasNewFeaturesInPath } from '@/shared/composables/useFeatureNotifications';
import GlobalSearch from '@/shared/components/GlobalSearch.vue';
import { useGlobalSearch, settingsNavRequest } from '@/shared/composables/useGlobalSearch';

const { t } = useTranslation();
const isBeta = ref<boolean>(import.meta.env['VITE_IS_BETA'] === 'true');
const vmProxy = getCurrentInstance()!.proxy;
const currentPage = computed(() => vmProxy.$route);
const { isSyncing, connected, connecting } = toRefs(loadingState);
const { loggedWallet, account, config } = toRefs(walletStore);
const { config: geroConfig } = toRefs(geroStore);
const { tip } = toRefs(networkStore);
const { musicPlaylist, context } = toRefs(musicStore);

// Global search
const { open: openGlobalSearch, handleKeydown: handleSearchKeydown } = useGlobalSearch();

const drawer = ref<boolean>(false);
const currentDialog = ref<string | null>(null);

// Compact nav mode — collapse labels to icons when toolbar is narrow
const compactNav = ref(false);
const navBarRef = ref(null);
const searchFieldRef = ref<HTMLElement | null>(null);
let navBarObserver: ResizeObserver | null = null;
const dialogs = { SETTINGS: 'SETTINGS' };
const backupWalletDialog = ref(false);
const settingsInitialTab = ref<string | undefined>(undefined);

// Watch for settings navigation requests from Global Search
watch(settingsNavRequest, (req) => {
  if (req) {
    settingsInitialTab.value = req.tab;
    currentDialog.value = dialogs.SETTINGS;
    settingsNavRequest.value = null;
  }
});


// Background image loading state for performance optimization
const backgroundImageLoaded = ref(false);

// Chain-correct for every chain, Midnight included (the old branching had no
// Midnight case and fell through to Cardano cyan).
const primaryColor = computed(() => chainAccents[chainKeyFor(loggedWallet.value?.chain)].accent);

const changeLog = changeLogPlugin;
const shouldBackup = computed(() => {
  // Use reactive config from store for proper sync between empty and populated states
  return config.value && 'backup' in config.value && !config.value.backup;
});

// Check if there are new features in the settings section
const hasNewSettingsFeatures = computed(() => hasNewFeaturesInPath(['settings']));

// Check if wallet is empty (no native tokens)
const isWalletEmpty = computed(() => {
  return !account.value || account.value.controlled_amount === '0';
});
// Notifications menu
const notificationsMenu = ref(false);

// Hide/show balances toggle
const hideBalances = computed(() => walletStore.config?.hideBalances || false);
const toggleHideBalances = () => {
  WalletStore.setHideBalances(!hideBalances.value);
};

// KES rotation warning — shows globally when BP node reports low KES remaining
const kesRemainingGlobal = computed(() => {
  const bp = poolOperatorStore.nodes.find(n => n.type === 'bp' && n.connected && n.data);
  return bp?.data?.kesRemaining ?? null;
});

const kesWarningVisible = computed(() => {
  // Pool Operator hard-gated off for 2.7 — suppress the KES bell entirely.
  if (!featureFlagsStore.isPoolOperatorEnabled()) return false;
  return kesRemainingGlobal.value !== null && kesRemainingGlobal.value < 50;
});

const epochSlotPercentage = computed(() => {
  return tip.value ? (tip.value.epoch_slot / 432000) * 100 : 0;
});

// Format last sync as timestamp (e.g., "2:45:32 PM")
const lastSyncTimestamp = computed(() => {
  if (!tip.value?.time) {
    return 'N/A';
  }

  const date = new Date(tip.value.time);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
});

const isWelcomeDone = computed({
  get() {
    return !!geroConfig.value?.welcomeDone;
  },
  set(val) {
    setConfiguration('welcomeDone', val);
  },
});

function closeWelcomeDialog() {
  // Update reactive config directly for immediate dialog close
  if (geroConfig.value) {
    geroConfig.value.welcomeDone = true;
  }
  // Persist to database
  setConfiguration('welcomeDone', true);
}

function closeChangeLogDialog() {
  changeLog.enabled = false;
  if (Object.keys(vmProxy.$route.query)?.length > 0) {
    vmProxy.$router.replace({ query: null });
  }
}
function closeDialog() {
  currentDialog.value = null;
}

function handleOpenBackupDialog() {
  console.log('Received backup dialog event from dashboard');
  backupWalletDialog.value = true;
}

function onSheetScroll() {
  if (notificationsMenu.value) notificationsMenu.value = false;
}

function navigateToPoolOperator() {
  notificationsMenu.value = false;
  vmProxy.$router.push('/pool-operator');
}


async function openMiniMode() {
  try {
    // Must call sidePanel.open() directly from user gesture context
    // (messaging to background loses user gesture propagation)
    const win = await chrome.windows.getCurrent();
    await chrome.sidePanel.setOptions({ path: 'sidepanel/index.html', enabled: true });
    await (chrome.sidePanel as any).open({ windowId: win.id });
  } catch (e) {
    console.warn('Failed to open side panel:', e);
  }
}

// Theme management lives in useChainAccent (bootstrapped in options/App.vue).
// It owns both the CSS accent slots and the Vuetify theme, so the local
// --*-color writer and its watcher that used to sit here are gone.

// Preload background image for better LCP performance
const preloadBackgroundImage = () => {
  const currentChain = loggedWallet.value?.chain;
  let imageUrl: string;
  switch (currentChain) {
    case Blockchain.APEX_PRIME:
    case Blockchain.APEX_VECTOR:
      imageUrl = assets.apexBg;
      break;
    case Blockchain.BITCOIN:
      imageUrl = assets.bitcoinBg;
      break;
    default:
      imageUrl = assets.cardanoBg;
  }
  const img = new Image();
  img.onload = () => {
    backgroundImageLoaded.value = true;
  };
  img.onerror = () => {
    // Fallback: show background anyway after a timeout
    setTimeout(() => {
      backgroundImageLoaded.value = true;
    }, 100);
  };
  img.src = imageUrl;
};

// Open settings dialog if launched from Mini Gero settings button.
// We listen for flag changes (handles the case where the dashboard tab is
// already open and just gets focused) instead of reading on mount, which
// would leave a stale flag in storage when no fresh ContentLayout mount occurs.
const handleStorageChange = (changes: { [key: string]: chrome.storage.StorageChange }, area: string) => {
  if (area === 'local' && changes.openSettingsOnLoad?.newValue) {
    currentDialog.value = dialogs.SETTINGS;
    chrome.storage.local.remove('openSettingsOnLoad');
  }
};
chrome.storage.onChanged.addListener(handleStorageChange);
onBeforeUnmount(() => {
  chrome.storage.onChanged.removeListener(handleStorageChange);
  // Clear any leftover flag so the dialog doesn't auto-open next time
  chrome.storage.local.remove('openSettingsOnLoad');
});

// Lifecycle
onMounted(async () => {
  // Catch the new-tab path: storage.onChanged fired before this listener was
  // registered, so check the flag once on mount. The already-open-tab path
  // is handled by handleStorageChange, which removes the flag before mount.
  chrome.storage.local.get('openSettingsOnLoad', (result) => {
    if (result.openSettingsOnLoad) {
      currentDialog.value = dialogs.SETTINGS;
      chrome.storage.local.remove('openSettingsOnLoad');
    }
  });

  // Chain colors are applied by useChainAccent (bootstrapped in options/App.vue
  // with immediate: true), so there is nothing to do here on mount.

  // Load SPO node config and start polling for KES notifications.
  // Pool Operator is hard-gated off for 2.7 — skip polling entirely.
  const walletId = walletStore.loggedWallet?.id;
  if (featureFlagsStore.isPoolOperatorEnabled() && walletId && poolOperatorStore.nodes.length === 0) {
    try {
      const { loadPoolOperatorConfig } = await import('@/stores/poolOperatorStore');
      await loadPoolOperatorConfig(walletId);
      // Poll connected BP nodes for status (KES data)
      if (poolOperatorStore.nodes.length > 0) {
        const { nodeFetch } = await import('@/modules/pool-operator/utils/nodeFetch');
        for (const node of poolOperatorStore.nodes) {
          try {
            node.data = await nodeFetch(node.url + '/status', 8000);
            node.connected = true;
          } catch { node.connected = false; }
        }
      }
    } catch { /* SPO not configured, skip */ }
  }

  // Preload background image after critical content
  requestIdleCallback(
    () => {
      preloadBackgroundImage();
    },
    { timeout: 2000 }
  );

  // Global search keyboard shortcut (Ctrl+K / Cmd+K)
  document.addEventListener('keydown', handleSearchKeydown);

  // Detect when the absolutely-centered QuickActionsBox clashes with
  // the search field or right-side icons. Uses overlap detection with
  // estimated expanded sizes to avoid oscillation.
  const barEl = navBarRef.value?.$el as HTMLElement | undefined;
  if (barEl) {
    // Known expanded element widths (measured from DOM):
    // - Search field: ~180px, Buttons with labels: ~560px, Right icons: ~170px, Gaps: ~40px
    const EXPANDED_CONTENT_WIDTH = 1020;
    navBarObserver = new ResizeObserver(([entry]) => {
      compactNav.value = entry.contentRect.width < EXPANDED_CONTENT_WIDTH;
    });
    navBarObserver.observe(barEl);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleSearchKeydown);
  navBarObserver?.disconnect();
});
</script>

<style scoped lang="scss">
/* Cardano Background - Confined to dashboard working area */
.cardano-background-dashboard {
  position: absolute;
  top: calc(-50% + 10px);
  left: 50%;
  width: 100vw;
  height: 100vh;
  z-index: -1; /* Behind dashboard content */
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  transform: translateX(-50%) scaleY(-0.7) scaleX(-1.2); /* Center horizontally, flip vertically and squeeze 20%, flip horizontally and stretch 20% */
  pointer-events: none; /* Allow clicks through */
  filter: brightness(0.7);
  opacity: 0;
  transition: opacity 0.3s ease-in-out;

  &[style*='url('] {
    opacity: 1;
  }
}

/* Apex background with same styling as Cardano */
.apex-background-dashboard {
  position: absolute;
  top: calc(-50% + 20px);
  left: 50%;
  width: 100vw;
  height: 100vh;
  z-index: -1; /* Behind dashboard content */
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  transform: translateX(-50%) scaleY(-0.7) scaleX(-1.2); /* Same transforms as Cardano */
  pointer-events: none; /* Allow clicks through */
  filter: brightness(0.7);
  opacity: 0;
  transition: opacity 0.3s ease-in-out;

  &[style*='url('] {
    opacity: 1;
  }
}

/* Bitcoin background — slightly warmer tint to complement the orange theme */
.bitcoin-background-dashboard {
  position: absolute;
  top: calc(-50% + 20px);
  left: 50%;
  width: 100vw;
  height: 100vh;
  z-index: -1;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  transform: translateX(-50%) scaleY(-0.7) scaleX(-1.2);
  pointer-events: none;
  filter: brightness(0.7);
  opacity: 0;
  transition: opacity 0.3s ease-in-out;

  &[style*='url('] {
    opacity: 1;
  }
}

/* Force progress bar colors to use CSS variables with higher specificity */
.v-progress-linear .v-progress-linear__determinate,
.v-progress-linear__determinate {
  background: linear-gradient(90deg, var(--g-grad-1), var(--g-grad-2)) !important;
  border-color: var(--g-grad-1) !important;
}

.epoch-progress-liquid-glass .v-progress-linear__determinate {
  background: var(--g-grad-1) !important;
}

/* Ensure v-app has pure black background outside working area */
.v-application {
  background: #000000 !important;
  position: relative;
  z-index: 1;
}

/* Override any Vuetify theme variables */
body {
  background: #000000 !important;
}

html {
  background: #000000 !important;
}

/* Make content areas transparent to show background */
.v-container {
  background-color: transparent !important;
}

.v-sheet.transparent {
  background-color: transparent !important;
}

div.v-toolbar__content {
  padding-right: 8px !important;
  padding-left: 8px !important;
}

.sync-animation {
  animation: sync-pulse 2s ease-in-out infinite;
}

.connecting-animation {
  animation: connecting-pulse 1.5s ease-in-out infinite;
}

@keyframes sync-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(1.1);
  }
}

@keyframes connecting-pulse {
  0%,
  100% {
    opacity: 0.5;
    transform: scale(1);
  }
  50% {
    opacity: 1;
    transform: scale(1.15);
  }
}

.epoch-progress-liquid-glass {
  border-radius: 8px;
  margin: 2px 0;
  background: rgba(255, 255, 255, 0.1) !important;
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.2);
  overflow: hidden;
}

.epoch-progress-liquid-glass .v-progress-linear__background {
  background: transparent !important;
}

.epoch-progress-liquid-glass .v-progress-linear__determinate {
  background: linear-gradient(
    90deg,
    rgba(0, 199, 243, 0.8) 0%,
    rgba(0, 199, 243, 1) 50%,
    rgba(0, 199, 243, 0.8) 100%
  ) !important;
  backdrop-filter: blur(10px);
  box-shadow: 0 0 20px rgba(0, 199, 243, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3);
}

.network-tooltip {
  background-color: rgba(0, 0, 0, 0.4) !important;
  backdrop-filter: blur(20px) saturate(1.8) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.8) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  border-radius: 12px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  isolation: isolate !important;
  padding: 12px 16px !important;

  &.connecting {
    border: 1px solid rgba(255, 165, 0, 0.3) !important;
    box-shadow: 0 8px 32px rgba(255, 165, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  }

  &.offline {
    border: 1px solid rgba(255, 100, 100, 0.3) !important;
    box-shadow: 0 8px 32px rgba(255, 100, 100, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  }
}

.network-tooltip-content {
  line-height: 1.3;
  color: #ffffff !important;
}

.network-tooltip-content div {
  margin-bottom: 2px;
}

.network-tooltip-content div:last-child {
  margin-bottom: 0;
}

.network-tooltip-content strong {
  color: #00c7f3 !important;
}

.v-dialog__content--active {
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
}

/* Search field in top nav bar */
.nav-search-field {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  border-radius: 8px;
  background: rgba(130, 180, 255, 0.08);
  border: 1px solid rgba(130, 180, 255, 0.25);
  cursor: pointer;
  min-width: 180px;
  transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
  animation: nav-search-breathe 3s ease-in-out infinite;
}
.nav-search-field:hover {
  background: rgba(130, 180, 255, 0.14);
  border-color: rgba(130, 180, 255, 0.45);
}
.nav-search-placeholder {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.45);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nav-search-shortcut {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: 'Roboto Mono', monospace;
  letter-spacing: 0.3px;
}
.nav-search-compact {
  min-width: unset !important;
  padding: 5px 8px !important;
  border-radius: 6px !important;
}
@keyframes nav-search-breathe {
  0%, 100% { box-shadow: 0 0 4px rgba(130, 180, 255, 0.15); }
  50% { box-shadow: 0 0 14px rgba(130, 180, 255, 0.35); }
}

.toolbar-icon-btn {
  width: 28px !important;
  height: 28px !important;
  border-radius: 6px !important;
}

.toolbar-icon-btn .v-icon {
  color: rgba(255, 255, 255, 0.85) !important;
}

.liquid-glass-card,
.v-card.liquid-glass-card {
  left: 0;
  margin-top: 10px;
  background-color: rgba(255, 255, 255, 0.18) !important;
  background-image: none !important;
  backdrop-filter: blur(10px) !important;
  -webkit-backdrop-filter: blur(10px) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 12px !important;
  transition: all 0.3s ease !important;
  cursor: pointer !important;
  overflow: hidden !important;
}

.liquid-glass-card:hover,
.v-card.liquid-glass-card:hover {
  background-color: rgba(255, 255, 255, 0.18) !important;
  backdrop-filter: blur(15px) !important;
  -webkit-backdrop-filter: blur(15px) !important;
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
  transform: translateY(-2px) !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
}
.notifications-card {
  background-color: rgba(0, 0, 0, 0.4) !important;
  backdrop-filter: blur(2px) !important;
  -webkit-backdrop-filter: blur(2px) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  border-radius: 12px !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  isolation: isolate !important;
}


</style>

<style>
.kes-notification-item {
  cursor: pointer;
  border-radius: 8px;
  margin: 0 8px;
}

.kes-notification-item:hover {
  background: rgba(253, 176, 34, 0.06) !important;
}
</style>

