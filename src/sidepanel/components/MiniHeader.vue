<template>
  <header class="mini-header">
    <div class="header-left" @click="$emit('wallet-switch')">
      <div class="header-icon">
        <v-avatar size="30" class="wallet-avatar">
          <v-img :src="walletIcon" />
        </v-avatar>
        <v-avatar v-if="networkIcon" size="14" class="chain-badge">
          <v-img contain :src="networkIcon" />
        </v-avatar>
      </div>

      <div class="wallet-info">
        <span class="wallet-name text-body-2 white--text text-truncate">
          {{ walletName }}
        </span>
        <div class="ada-handle" v-if="adaHandle">
          <span class="text-truncate" style="color: #0fd25b; font-weight: 600">$</span>{{ adaHandle.replace(/^\$/, '') }}
        </div>

      </div>
      <v-icon size="14" color="rgba(255,255,255,0.4)" class="chevron-icon">mdi-chevron-down</v-icon>
    </div>
    <div class="header-right">
      <v-tooltip v-if="connectedSiteEntry" bottom content-class="custom-tooltip">
        <template v-slot:activator="{ on }">
          <v-btn icon x-small @click="disconnectActiveSite" class="toolbar-btn" v-on="on">
            <v-icon size="16" color="#47CD89">mdi-link-variant</v-icon>
          </v-btn>
        </template>
        <span>{{ $t('miniGero.connectedToSite', { domain: connectedSiteEntry.domain }) }}</span>
      </v-tooltip>
      <v-tooltip bottom content-class="custom-tooltip">
        <template v-slot:activator="{ on }">
          <v-btn icon x-small @click="toggleHideBalances()" class="toolbar-btn" v-on="on">
            <v-icon size="18" color="#888">{{ hideBalances ? 'mdi-eye-off-outline' : 'mdi-eye-outline' }}</v-icon>
          </v-btn>
        </template>
        <span>{{ hideBalances ? $t('dashboard.showBalances') : $t('dashboard.hideBalances') }}</span>
      </v-tooltip>
      <v-tooltip bottom content-class="custom-tooltip">
        <template v-slot:activator="{ on }">
          <v-btn icon x-small @click="openFullDashboard" class="toolbar-btn" v-on="on">
            <v-icon size="20" color="#888">mdi-fullscreen</v-icon>
          </v-btn>
        </template>
        <span>{{ $t('miniGero.openFullDashboard') }}</span>
      </v-tooltip>
      <v-btn icon x-small @click="$emit('settings')" class="toolbar-btn">
        <v-icon size="18" color="#888">mdi-cog-outline</v-icon>
      </v-btn>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { walletStore } from '@/stores/walletStore';
import WalletStore from '@/stores/walletStore';
import assets from '@/utils/assets';
import networks from '@/utils/networks';
import { openFullDashboard as openFullDashboardTab } from '@/shared/utils/openFullDashboard';

// Connected-site visibility: no session management existed anywhere in the
// panel before this — once whitelisted, enable() auto-approved silently
// forever with no way to see or revoke it from here. Resolved once on mount
// and re-resolved on visibilitychange (same pattern dappRequestHub uses) to
// track tab navigation while the panel stays open across it.
const activeTabOrigin = ref('');

function resolveActiveTabOrigin() {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs?.[0]?.url;
      if (!url) { activeTabOrigin.value = ''; return; }
      try { activeTabOrigin.value = new URL(url).origin; } catch { activeTabOrigin.value = ''; }
    });
  } catch { activeTabOrigin.value = ''; }
}

function onVisibilityChange() {
  if (document.visibilityState === 'visible') resolveActiveTabOrigin();
}

onMounted(() => {
  resolveActiveTabOrigin();
  document.addEventListener('visibilitychange', onVisibilityChange);
});
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange);
});

interface ConnectedDappEntry { id: string; domain: string }
const connectedSiteEntry = computed<ConnectedDappEntry | null>(() => {
  const origin = activeTabOrigin.value;
  if (!origin || !WalletStore.isWhitelisted(origin)) return null;
  const dapps = (walletStore.connectedDapps || []) as ConnectedDappEntry[];
  return dapps.find((d) => d.domain && origin.indexOf(String(d.domain)) !== -1) || null;
});

function disconnectActiveSite() {
  const entry = connectedSiteEntry.value;
  const walletId = walletStore.loggedWallet?.id;
  if (!entry || walletId == null) return;
  WalletStore.disconnectDapp(walletId, entry.id);
}

const ADA_HANDLE_POLICY = 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a';

const walletName = computed(() => walletStore.loggedWallet?.name || 'Wallet');
const walletIcon = computed(() => assets.resolveIcon(walletStore.loggedWallet?.icon));
const adaHandle = computed(() => {
  const collections = walletStore.collections;
  if (!collections) return '';
  const handleCollection = collections[ADA_HANDLE_POLICY];
  if (!handleCollection?.items?.length) return '';
  return handleCollection.items[0].name || '';
});
const networkIcon = computed(() => {
  const wallet = walletStore.loggedWallet;
  if (!wallet) return '';
  const network = networks.resolveNetwork(wallet.chain, wallet.network);
  return network ? network.icon : '';
});

const hideBalances = computed(() => walletStore.config?.hideBalances || false);

function toggleHideBalances() {
  WalletStore.setHideBalances(!hideBalances.value);
}

function openFullDashboard() {
  openFullDashboardTab();
}
</script>

<style scoped>
.mini-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  height: 48px;
  position: sticky;
  top: 0;
  z-index: 10;
  background: rgba(10, 12, 16, 0.55);
  backdrop-filter: blur(24px) saturate(1.8);
  -webkit-backdrop-filter: blur(24px) saturate(1.8);
  border-bottom: 1px solid var(--g-hairline-1);
  box-shadow: 0 1px 8px rgba(0, 0, 0, 0.3);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  cursor: pointer;
  max-width: 60%;
  gap: 8px;
  padding: 4px 8px 4px 4px;
  border-radius: 10px;
  transition: background 0.15s ease;
}

.header-left:hover {
  background: rgba(255, 255, 255, 0.08);
}

.header-left:hover .chevron-icon {
  color: rgba(255, 255, 255, 0.7) !important;
}

.header-icon {
  position: relative;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
}

.wallet-avatar {
  border: 1.5px solid rgba(255, 255, 255, 0.12);
}

.chain-badge {
  position: absolute;
  bottom: -2px;
  right: -4px;
  border: 1.5px solid rgba(0, 0, 0, 0.6);
  background: #1a1a1a;
}

.wallet-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}

.wallet-name {
  max-width: 120px;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.ada-handle {
  font-size: 10px;
  opacity: 0.85;
}

.chevron-icon {
  transition: color 0.15s ease;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.toolbar-btn {
  width: 32px;
  height: 32px;
}

</style>
