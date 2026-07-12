<template>
  <v-navigation-drawer
    v-model="drawer"
    :temporary="breakpoint.mobile"
    width="270"
    height="100vh"
    style="min-width: 270px; min-height: 100%"
    class="px-3 liquid-glass-nav-drawer"
    :absolute="breakpoint.mobile"
  >
    <!-- Prepend slot -->
    <template #prepend>
      <v-list-item class="text-center">
        <v-list-item-content class="pb-2" style="padding-top: 22px;">
          <v-list-item-title>
            <img
              :src="isApex ? assets.geroDashboardApex : assets.geroNoText"
              width="64"
              alt="logo"
            />
          </v-list-item-title>
          <v-list-item-subtitle>
            <v-btn color="warning" text plain @click="changeLogRef.setEnabled(true)">
              {{ `v${version}` }}<span class="ml-1" v-if="isBeta">(Beta)</span>
              <v-icon small class="ml-1">mdi-lightning-bolt</v-icon>
            </v-btn>
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
    </template>

    <!-- Navigation items -->
    <v-list nav dense>
      <template v-for="(item, index) in items" >
        <v-subheader class="pt-2 pb-1" v-if="item.header && item.enabled" style="font-weight: 600; height: 18px; margin-top: 6px; margin-bottom: 10px;" :key="index">
          {{ item.header }}
        </v-subheader>

        <v-list-item
          v-else-if="item.link"
          :to="item.link"
          v-show="item.enabled || item.soon"
          :disabled="item.soon || item.loading || item.underMaintenance"
          :active-class="themeDark ? (isApex ? 'activePageDark apex' : isBitcoin ? 'activePageDark bitcoin' : 'activePageDark') : (isApex ? 'activePage apex' : isBitcoin ? 'activePage bitcoin' : 'activePage')"
          link
          :class="['menuItem', { 'nexus-item': item.special }]"
          style="height: 34px"
          :key="index"
        >
          <v-list-item-avatar tile size="18" :style="item.soon || item.loading || item.underMaintenance ? { filter: 'opacity(0.5)' } : {}">
            <v-badge :value="!!item.notificationDot" dot color="error" overlap bordered>
              <v-icon v-if="item.icon?.startsWith('mdi-')" size="18" color="var(--g-text-1)">{{ item.icon }}</v-icon>
              <v-img
                v-else
                width="18"
                height="18"
                :src="item.icon"
                :alt="item.title"
                contain
                :style="item.special ? undefined : 'filter: invert(98%) sepia(44%) saturate(0%) hue-rotate(18deg) brightness(103%) contrast(103%);'"
              />
            </v-badge>
          </v-list-item-avatar>

          <v-list-item-content>
            <v-list-item-title style="font-weight: 500">
              {{ item.title }}
            </v-list-item-title>
          </v-list-item-content>
          <!-- Mini Player Button for Media Player item -->
          <v-list-item-action v-if="item.title === 'Media Player' && musicPlaylist?.length > 0">
            <v-tooltip right>
              <template v-slot:activator="{ on, attrs }">
                <v-btn
                  icon
                  x-small
                  v-bind="attrs"
                  v-on="on"
                  @click.stop.prevent="toggleMiniPlayer"
                  :color="context.shown ? 'primary' : ''"
                >
                  <v-icon size="16">mdi-play-box-multiple</v-icon>
                </v-btn>
              </template>
              <span>{{ $t('navigation.miniPlayer') }}</span>
            </v-tooltip>
          </v-list-item-action>
          <v-list-item-action v-else-if="item.loading">
            <v-progress-circular size="16" width="2" indeterminate></v-progress-circular>
          </v-list-item-action>
          <v-list-item-action v-else-if="item.underMaintenance" class="ma-0">
            <v-chip
              outlined
              class="px-1"
              x-small
              color="warning"
              style="margin-left: 1px; margin-bottom: 1px; scale: 0.9"
            ><v-icon color="warning" x-small class="mr-1">mdi-hammer-screwdriver</v-icon> {{ $t('common.maintenance') }}</v-chip>
          </v-list-item-action>
          <v-list-item-action v-else-if="item.new">
            <v-chip
              v-if="item.new"
              class="my-2 px-2"
              color="primary"
              x-small
            >
              {{ $t('common.new') }}
            </v-chip>
          </v-list-item-action>
        </v-list-item>

        <v-list-item
          v-else-if="item.href"
          :disabled="item.soon"
          :key="index"
          :active-class="themeDark ? 'activePageDark' : 'activePage'"
          link
          @click="openExternalLink(item.href)"
        >
          <v-list-item-avatar>
            <v-img :src="item.icon" :alt="item.title"></v-img>
          </v-list-item-avatar>

          <v-list-item-content>
            <v-list-item-title style="font-weight: 500">
              {{ item.title }}
              <v-chip
                v-if="item.soon"
                class="ma-2"
                color="primary"
                x-small
                outlined>
                {{ $t('common.comingSoon') }}
              </v-chip>
            </v-list-item-title>
          </v-list-item-content>

          <v-list-item-action>
            <v-icon small>mdi-open-in-new</v-icon>
          </v-list-item-action>
        </v-list-item>
      </template>
    </v-list>

    <!-- Append slot -->
    <template #append>
      <v-divider></v-divider>
      <v-list-item three-line class="px-0">
        <v-list-item-avatar style="margin: auto" class="mr-3" size="40">
          <v-img v-if="account" :src="avatar" />
        </v-list-item-avatar>

        <v-list-item-content class="py-0" style="align-self: initial">
          <v-list-item-title class="mb-0" style="font-size: 14px" v-if="account && !editingName">
            <span
              class="editable-name"
              @click="startEditingName"
              :title="t('settings.editWalletName')"
            >{{ account.name }}<v-icon x-small class="ml-1 edit-icon">mdi-pencil</v-icon></span>
          </v-list-item-title>
          <v-list-item-title class="mb-0" style="font-size: 14px; display: flex; align-items: center;" v-if="account && editingName">
            <input
              ref="nameInput"
              v-model="editNameValue"
              class="name-edit-input"
              maxlength="40"
              @keydown.enter="saveWalletName"
              @keydown.esc="cancelEditingName"
              @blur="onNameInputBlur"
            />
            <v-btn icon x-small @mousedown.prevent="saveWalletName" :disabled="!isNameValid" color="success" class="ml-1" style="width: 16px; height: 16px;">
              <v-icon style="font-size: 12px;">mdi-check</v-icon>
            </v-btn>
          </v-list-item-title>
          <v-list-item-subtitle class="mb-0" style="font-size: 11px" v-if="account">
            {{ account.chain }}
          </v-list-item-subtitle>
          <v-list-item-subtitle style="font-size: 11px" v-if="account">
            {{ account.network }}
          </v-list-item-subtitle>
        </v-list-item-content>

        <v-list-item-action style="margin: auto" class="d-flex flex-row">
          <v-tooltip v-if="hasUnlockMethod" top content-class="custom-tooltip">
            <template v-slot:activator="{ on, attrs }">
              <v-btn icon @click="submitLock" v-bind="attrs" v-on="on">
                <v-icon size="18">mdi-lock</v-icon>
              </v-btn>
            </template>
            <span>{{ $t('security.lock') }}</span>
          </v-tooltip>

          <v-tooltip top content-class="custom-tooltip">
            <template v-slot:activator="{ on, attrs }">
              <v-btn icon @click="submitLogout" v-bind="attrs" v-on="on">
                <v-avatar tile size="18">
                  <v-img :src="assts.logout" alt="logout"></v-img>
                </v-avatar>
              </v-btn>
            </template>
            <span>{{ $t('wallet.logout') }}</span>
          </v-tooltip>
        </v-list-item-action>
      </v-list-item>
    </template>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, watch, onMounted, nextTick, getCurrentInstance, toRefs } from 'vue'
import networks from '@/utils/networks'
import { musicStore } from '@/stores/musicStore'
import MusicStoreModule from '@/stores/musicStore'
import { midnightStore } from '@/stores/midnightStore'
import assts from '@/utils/assets'
import changeLog from '@/plugins/changeLog'
import { Cardano } from '@cardano-sdk/core'
import { walletStore } from '@/stores/walletStore';
import { geroStore } from '@/stores/geroStore';
import geroStoreDefault from '@/stores/geroStore';
import snackbar from '@/plugins/snackbar';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import cardStore from '@/stores/modules/card';
import LoadingState from '@/stores/loading';
import { Blockchain } from '@/models/types';
import assets from '@/utils/assets';
import { updateVuetifyTheme } from '@/plugins/vuetify';
import { debugLog } from '@/utils/debug';
import { hasNewFeaturesInPath } from '@/shared/composables/useFeatureNotifications';

interface NavigationItem {
  title?: string;
  icon?: string;
  link?: string;
  href?: string;
  header?: string;
  enabled?: boolean;
  soon?: boolean;
  new?: boolean;
  notificationDot?: boolean;
  underMaintenance?: boolean;
  loading?: boolean;
  /** Brand spotlight item (Nexus): colored icon, animated gradient border. */
  special?: boolean;
}

type NavigationLinkItem = NavigationItem & { link: string };
type NavigationHrefItem = NavigationItem & { href: string };
type NavigationHeaderItem = NavigationItem & { header: string };
type NavigationItemUnion = NavigationLinkItem | NavigationHrefItem | NavigationHeaderItem;

const { t } = useTranslation();
const changeLogRef = ref(changeLog)
const isBeta = ref<boolean>(import.meta.env['VITE_IS_BETA'] === 'true')
// Define props and emit
const props = defineProps<{ value: boolean }>()
const emit = defineEmits(['input'])

// Access Vuetify instance
const vmProxy = getCurrentInstance()!.proxy
const breakpoint = vmProxy.$vuetify.breakpoint
const themeDark = vmProxy.$vuetify.theme.dark
const router = vmProxy.$router

// Reactive state
const version = ref('')
const hasUnlockMethod = ref(false)

const { musicPlaylist, context } = toRefs(musicStore);
const { loggedWallet, transactions } = toRefs(walletStore);
const { transactions: midnightTransactions } = toRefs(midnightStore);

const account = computed(() => {
  return loggedWallet.value
})

const avatar = computed(() => {
  if (!account.value) return ''
  return account.value.icon.includes('http')
    ? account.value.icon
    : resolveIcon(account.value.icon)
})

function resolveIcon(icon: string) {
  return assts.resolveIcon(icon)
}

function openExternalLink(href?: string) {
  if (href) {
    window.open(href, '_blank')
  }
}

const isApex = computed(() => {
  return loggedWallet.value?.chain === Blockchain.APEX_PRIME ||
    loggedWallet.value?.chain === Blockchain.APEX_VECTOR;
});

const isBitcoin = computed(() => {
  return loggedWallet.value?.chain === Blockchain.BITCOIN;
});

const items = computed((): NavigationItemUnion[] => {
  let isStakingEnabled = false;
  // Only parse address for Cardano-based chains
  if (loggedWallet.value?.baseAddress &&
      (loggedWallet.value?.chain === Blockchain.CARDANO ||
       loggedWallet.value?.chain === Blockchain.APEX_PRIME ||
       loggedWallet.value?.chain === Blockchain.APEX_VECTOR)) {
    isStakingEnabled = Cardano.Address.fromBech32(loggedWallet.value.baseAddress).getType() !==
      Cardano.AddressType.EnterpriseScript
  }

  // Check if any Activities & Rewards items are enabled
  const isClaimRewardsEnabled = false;
  const isCashbackEnabled = networks.resolveCashbackSupport(loggedWallet.value?.chain, loggedWallet.value?.network);
  const isReferralEnabled = false;
  const hasActivitiesRewardsItems = isClaimRewardsEnabled || isCashbackEnabled || isReferralEnabled;

  const { t } = useTranslation();

  return [
    { title: t('navigation.dashboard'), icon: assts.barChart, link: '/', enabled: true },
    {
      title: t('navigation.blog'),
      icon: assts.blog,
      link: '/blog',
      enabled: true,
      underMaintenance: !isBlogEnabledByFeatureFlag.value,
    },
    { title: t('navigation.copilotFeed'), icon: 'mdi-bell-outline', link: '/copilot-feed', enabled: featureFlagsStore.isCopilotEnabled() },
    { header: t('navigation.financialHub'), enabled: true },
    // Midnight tx history lives in midnightStore (walletStore.transactions is Cardano-only).
    { title: t('navigation.transactions'), icon: 'mdi-swap-horizontal', link: '/transactions', enabled: networks.resolveTransactionsSupport(loggedWallet.value?.chain, loggedWallet.value?.network) && (loggedWallet.value?.chain === Blockchain.MIDNIGHT ? midnightTransactions.value.length > 0 : transactions.value.length > 0), notificationDot: hasNewFeaturesInPath(['transactions']) },
    { title: t('navigation.staking'), icon: assts.coinsStacked, link: '/staking', enabled: isStakingEnabled },
    { title: t('navigation.governance'), icon: assts.governance, link: '/governance', enabled: networks.resolveGovernanceSupport(loggedWallet.value?.chain, loggedWallet.value?.network) },
    { title: t('navigation.poolOperator'), icon: 'mdi-server-network', link: '/pool-operator', enabled: networks.resolveStakingSupport(loggedWallet.value?.chain, loggedWallet.value?.network) && featureFlagsStore.isPoolOperatorEnabled(), new: true },
    { title: t('navigation.multisig'), icon: assts.multisigTree, link: '/multisig', enabled: false }, // Disabled - under maintenance
    {
      title: t('navigation.geroCard'),
      icon: assts.cardIcon,
      link: '/card',
      enabled: networks.resolveGeroCardSupport(loggedWallet.value?.chain, loggedWallet.value?.network),
      underMaintenance: !isGeroCardEnabledByFeatureFlag.value,
      loading: loadingFFs.value
    },
    {
      title: t('navigation.goMining'),
      icon: assts.gominingIcon,
      link: '/gomining',
      enabled: networks.resolveGoMiningSupport(loggedWallet.value?.chain, loggedWallet.value?.network),
      new: true,
      underMaintenance: !isGoMiningEnabledByFeatureFlag.value,
      loading: loadingFFs.value
    },
    {
      title: t('navigation.staking'),
      icon: assts.coinsStacked,
      link: '/babylon',
      enabled: networks.resolveBabylonSupport(loggedWallet.value?.chain, loggedWallet.value?.network),
      new: true,
    },
    {
      title: t('navigation.ordinals'),
      icon: 'mdi-image-multiple-outline',
      link: '/ordinals',
      enabled: networks.resolveOrdinalsSupport(loggedWallet.value?.chain, loggedWallet.value?.network),
      new: true,
    },
    {
      title: t('navigation.thorchain'),
      icon: 'mdi-swap-horizontal',
      link: '/thorchain',
      enabled: networks.resolveThorchainSupport(loggedWallet.value?.chain, loggedWallet.value?.network),
      new: true,
    },
    {
      title: t('navigation.mempool'),
      icon: 'mdi-database-clock',
      link: '/mempool',
      enabled: networks.resolveMempoolSupport(loggedWallet.value?.chain, loggedWallet.value?.network),
      new: true,
    },
    {
      title: t('navigation.lightning'),
      icon: 'mdi-lightning-bolt',
      link: '/lightning',
      enabled: networks.resolveLightningSupport(loggedWallet.value?.chain, loggedWallet.value?.network),
      new: true,
    },
    { header: t('navigation.activitiesRewards'), enabled: hasActivitiesRewardsItems },
    { title: t('navigation.claimRewards'), icon: assts.infinity, link: '/claim-rewards', enabled: isClaimRewardsEnabled },
    { title: t('navigation.cashback'), icon: assts.cashback, link: '/cashback', enabled: isCashbackEnabled },
    { title: t('navigation.referral'), icon: assts.usersPlus, link: '/referral', enabled: isReferralEnabled },
    // { title: 'zkFiat', icon: assts.zkFiat, link: '/zkFiat', enabled: false },
    { header: t('navigation.media'), enabled: loggedWallet.value?.chain !== Blockchain.BITCOIN && loggedWallet.value?.chain !== Blockchain.APEX_VECTOR },
    // Only show the player when the wallet actually holds playable media —
    // an empty player is dead weight (and the Media header auto-hides with it).
    { title: t('navigation.mediaPlayer'), icon: assts.mediaPlayer, link: '/media-player', enabled: loggedWallet.value?.chain !== Blockchain.BITCOIN && loggedWallet.value?.chain !== Blockchain.APEX_VECTOR && (musicPlaylist.value?.length ?? 0) > 0 },
    { header: t('navigation.developers'), enabled: true },
    // Nexus infra product spotlight: colored brand logo + animated gradient border.
    { title: t('navigation.nexus'), icon: assts.nexusLogo, link: '/nexus', enabled: true, special: true },
    // Uncomment to add more items:
    // { header: 'Tools' },
    // { title: 'Airdrop', icon: 'mdi-gift', link: '/airdrop', soon: true },
    // { title: 'IPFS Cache', icon: 'mdi-cube', link: '/ipfs-cache', soon: true },
    // { title: 'Snapshot', icon: 'mdi-camera-enhance', link: '/snapshot', soon: true },
    // { header: 'Documentation' },
    // { title: 'Guides', icon: 'mdi-book-open-variant', href: 'https://docs.adabox.io/' },
    // { title: 'Whitepaper', icon: 'mdi-file-certificate-outline', href: 'https://docs.adabox.io/whitepapers/forge-whitepaper' }
  ].filter(i => i).map((item, i, all) => {
    // Auto-hide section headers with no enabled children: a header stays
    // enabled only if at least one non-header item before the next header is
    // enabled. Keeps chains with sparse feature sets (e.g. Midnight) from
    // rendering orphaned "Financial hub" / "Media" headings.
    if (!item.header || !item.enabled) return item;
    for (let j = i + 1; j < all.length && !all[j].header; j++) {
      if (all[j].enabled) return item;
    }
    return { ...item, enabled: false };
  })
})

// Loading state for swap feature flag
const loadingFFs = computed(() => {
  return featureFlagsStore.state.isLoading || !featureFlagsStore.state.isInitialized;
});

// Check if Gero Card is enabled by feature flag
const isGeroCardEnabledByFeatureFlag = computed(() => {
  return featureFlagsStore.isGeroCardEnabled();
});

const isGoMiningEnabledByFeatureFlag = computed(() => {
  return featureFlagsStore.isGoMiningEnabled();
});

const isBlogEnabledByFeatureFlag = computed(() => {
  return featureFlagsStore.isBlogEnabled();
})

// Drawer getter/setter
const drawer = computed({
  get() {
    return breakpoint.mobile ? props.value : true
  },
  set(val: boolean) {
    emit('input', val)
  }
})

// Watch mobile breakpoint to auto-close drawer
watch(() => breakpoint.mobile,
  (newVal, oldVal) => {
    if (oldVal === false && newVal === true) {
      drawer.value = false
    }
  }
)

// Wallet name editing
const { wallets } = toRefs(geroStore);
const editingName = ref(false)
const editNameValue = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

const isNameValid = computed(() => {
  const v = editNameValue.value.trim()
  if (!v || v.length < 3 || v.length > 40) return false
  if (v === account.value?.name) return false
  const otherNames = Object.values(wallets.value)
    .filter((w) => w.name !== account.value?.name)
    .map((w) => w.name)
  return !otherNames.includes(v)
})

function startEditingName() {
  editNameValue.value = account.value?.name || ''
  editingName.value = true
  nextTick(() => {
    nameInput.value?.focus()
  })
}

function cancelEditingName() {
  editingName.value = false
}

function onNameInputBlur() {
  // Small delay so mousedown on check button fires first
  setTimeout(() => { editingName.value = false }, 150)
}

function saveWalletName() {
  if (!isNameValid.value) return
  const newName = editNameValue.value.trim()
  geroStoreDefault.setWalletName(loggedWallet.value.id, newName)
  loggedWallet.value.name = newName
  snackbar.fireSuccess(t('settings.walletNameUpdated'))
  editingName.value = false
}

// Methods
function toggleMiniPlayer() {
  console.log('Toggling mini player, current shown:', context.value.shown)
  MusicStoreModule.setMediaPlayerShown(!context.value.shown)
}

async function submitLock() {
  try {
    debugLog('🔒 Manually locking wallet from navigation drawer');

    // Send lock message to background
    await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOCK,
      data: {},
    });

    debugLog('🔒 Wallet locked successfully');

    // Navigate to login screen
    router.replace('/welcome').catch(err => {
      debugLog('Navigation after lock handled:', err.message || err);
    });
  } catch (error) {
    console.error('❌ Error locking wallet:', error);
  }
}

async function submitLogout() {
  try {
    LoadingState.setText('Logging out ...')
    LoadingState.setLoading(true);
    await cardStore.logout();
    // Send logout message to background
    await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGOUT,
      data: { },
    });
    updateVuetifyTheme('Cardano'); // logout resets to the default chain accent
    // Navigate to welcome page after store is cleared
    // Use replace to avoid adding to history, and catch navigation guard redirects
    router.replace('/welcome').catch(err => {
      debugLog('Navigation after logout handled (expected during logout):', err.message || err);
    });
  } catch (error) {
    console.error('Error during logout:', error);
    // Force navigation even on error
    router.replace('/welcome').catch(err => {
      debugLog('Navigation after logout error handled (expected during logout):', err.message || err);
      window.location.hash = '#/welcome';
    });
  } finally {
    LoadingState.setLoading(false);
    LoadingState.setText('');
  }
}

// Check if wallet has unlock method configured
async function checkUnlockMethod() {
  try {
    if (!loggedWallet.value?.id) {
      hasUnlockMethod.value = false
      return
    }

    const { getDb } = await import('@/db/wallet-db')
    const db = await getDb(loggedWallet.value.id)
    const configTable = db.table('config')

    const unlockMethodConfig = await configTable.where({ key: 'unlockMethod' }).first()

    // Has unlock method if config exists and has a value (not null/undefined)
    hasUnlockMethod.value = !!(unlockMethodConfig?.value)
  } catch (error) {
    console.error('Error checking unlock method:', error)
    hasUnlockMethod.value = false
  }
}

// Watch for wallet changes to update unlock method state
watch(() => loggedWallet.value?.id, async (newId) => {
  if (newId) {
    await checkUnlockMethod()
  } else {
    hasUnlockMethod.value = false
  }
}, { immediate: true })

// Re-check unlock method when window regains focus (catches settings changes)
function handleVisibilityChange() {
  if (!document.hidden && loggedWallet.value?.id) {
    checkUnlockMethod()
  }
}

// Re-check unlock method when security settings are updated
function handleSecuritySettingsUpdate() {
  if (loggedWallet.value?.id) {
    checkUnlockMethod()
  }
}

// Lifecycle
onMounted(() => {
  // @ts-ignore
  version.value = APP_VERSION

  // Listen for visibility changes to refresh unlock method state
  document.addEventListener('visibilitychange', handleVisibilityChange)

  // Listen for security settings updates (from SecurityTab/LockSettingsDialog)
  window.addEventListener('security-settings-updated', handleSecuritySettingsUpdate)
})

// Cleanup on unmount
import { onUnmounted } from 'vue'
import featureFlagsStore from '@/stores/featureFlagsStore';
onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  window.removeEventListener('security-settings-updated', handleSecuritySettingsUpdate)
})
</script>
<style>
/* Typed registration so the Nexus ring's conic angle interpolates smoothly
   (an unregistered custom property can't animate — the ring would jump). */
@property --nx-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
</style>
<style lang="scss" scoped>
.menuItem {
  border: 1px solid transparent;
  border-radius: var(--g-r-control);
  /* Shorter, tighter rows (Vuetify dense defaults to 40px min-height + 8px gap). */
  min-height: 34px !important;
  margin-bottom: 4px !important;
}

.menuItem ::v-deep .v-list-item__avatar {
  overflow: visible !important;
}

.menuItem ::v-deep .v-avatar {
  overflow: visible !important;
}

.menuItem ::v-deep .v-badge {
  overflow: visible !important;
}

/* ── Nexus spotlight item ─────────────────────────────────────────────
   A thin conic-gradient ring in the four Nexus logo gradient families
   (sky / violet / teal / indigo) sweeps around the row — the "AI button"
   treatment. User-requested brand moment; the ring is masked to 1px so it
   reads as live energy, not a glow. Reduced motion gets a static ring. */
.nexus-item {
  position: relative;
}

.nexus-item::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: var(--g-r-control);
  padding: 1px;
  background: conic-gradient(
    from var(--nx-angle, 0deg),
    #4A9ADA, #7B6CDC, #44A8B4, #5F78D0, #4A9ADA
  );
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  mask-composite: exclude;
  animation: nexus-border-wave 4s linear infinite;
  pointer-events: none;
}

/* The colored logo must never be recolored by the active-page icon filter. */
.nexus-item ::v-deep .v-image {
  filter: none !important;
}

@keyframes nexus-border-wave {
  to { --nx-angle: 360deg; }
}

@media (prefers-reduced-motion: reduce) {
  .nexus-item::before {
    animation: none;
  }
}


/* Active nav item — clean tinted highlight (modern, no gradient) */
.activePage,
.activePageDark {
  color: var(--g-accent);
  background: color-mix(in srgb, var(--g-accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--g-accent) 28%, transparent);
  border-radius: var(--g-r-control);

  .v-image {
    filter: brightness(0) saturate(100%) invert(62%) sepia(93%) saturate(1287%) hue-rotate(136deg) brightness(102%) contrast(101%) !important;
  }

  .v-icon {
    color: var(--g-accent) !important;
  }
}

.activePage.apex,
.activePageDark.apex {
  color: #F8A282;
  background: rgba(248, 162, 130, 0.12);
  border-color: rgba(248, 162, 130, 0.28);

  .v-image {
    filter: brightness(0) saturate(100%) invert(92%) sepia(45%) saturate(5319%) hue-rotate(301deg) brightness(100%) contrast(95%) !important;
  }

  .v-icon {
    color: #F8A282 !important;
  }
}

.activePage.bitcoin,
.activePageDark.bitcoin {
  color: #F7931A;
  background: rgba(247, 147, 26, 0.12);
  border-color: rgba(247, 147, 26, 0.28);

  .v-image {
    filter: brightness(0) saturate(100%) invert(63%) sepia(88%) saturate(2100%) hue-rotate(8deg) brightness(104%) contrast(103%) !important;
  }

  .v-icon {
    color: #F7931A !important;
  }
}

.theme--dark.v-list-item {
  &:not(.v-list-item--active):not(.v-list-item--disabled) {
    color: var(--g-text-1) !important;
  }

  &:focus::before {
    opacity: 0 !important;
  }

  &--active {
    &:focus::before,
    &:hover::before,
    &::before {
      opacity: 0 !important;
    }
  }
}

.menuItem.v-list-item--link {
  &:before {
    background: transparent;
    border-radius: var(--g-r-control);
  }

  &:not(.activePage):not(.activePageDark):hover {
    background: var(--g-hairline-1);
  }
}

.v-subheader {
  font-size: 11px;
  text-align: left;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--g-text-3);
  line-height: 12px;
  width: 100%;
  padding-left: 12px;
  position: relative;
  z-index: 1;
}

.editable-name {
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  border-radius: 4px;
  padding: 0;
  margin-left: -2px;
  padding-left: 2px;
  padding-right: 2px;
  transition: background 0.15s;

  .edit-icon {
    opacity: 0;
    transition: opacity 0.15s;
  }

  &:hover {
    background: var(--g-hairline-1);

    .edit-icon {
      opacity: 0.6;
    }
  }
}

.name-edit-input {
  font-size: 14px;
  line-height: 20px;
  height: 20px;
  color: inherit;
  background: var(--g-hairline-1);
  border: none;
  border-bottom: 1px solid var(--g-hairline-3);
  border-radius: 4px;
  outline: none;
  padding: 0 4px;
  width: 100%;
  font-family: inherit;

  &:focus {
    border-bottom-color: var(--g-accent);
  }
}
</style>