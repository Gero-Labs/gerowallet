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
        <v-list-item-content class="py-2">
          <v-list-item-title>
            <img
              :src="isApex ? assets.geroDashboardApex : assets.geroDashboard"
              width="100"
              alt="logo"
            />
          </v-list-item-title>
          <v-list-item-subtitle>
            <v-btn color="orange" text plain @click="changeLogRef.setEnabled(true)">
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
        <v-subheader class="pt-2 pb-1" v-if="item.header && item.enabled" style="font-weight: 800; height: 18px;" :key="index">
          {{ item.header }}
        </v-subheader>

        <v-list-item
          v-else-if="item.link"
          :to="item.link"
          v-show="item.enabled || item.soon"
          :disabled="item.soon || item.loading || item.underMaintenance"
          :active-class="themeDark ? (isApex ? 'activePageDark apex' : 'activePageDark') : (isApex ? 'activePage apex' : 'activePage')"
          link
          class="menuItem"
          style="height: 40px"
          :key="index"
        >
          <v-list-item-avatar tile size="18" :style="item.soon || item.loading || item.underMaintenance ? { filter: 'opacity(0.5)' } : {}">
            <v-img
              width="18"
              height="18"
              :src="item.icon"
              :alt="item.title"
              contain
              style="filter: invert(98%) sepia(44%) saturate(0%) hue-rotate(18deg) brightness(103%) contrast(103%);"
            />
          </v-list-item-avatar>

          <v-list-item-content>
            <v-list-item-title style="font-weight: 800">
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
              color="#FFD700"
              style="margin-left: 1px; margin-bottom: 1px; scale: 0.9"
            ><v-icon color="#FFD700" x-small class="mr-1">mdi-hammer-screwdriver</v-icon> Maintenance</v-chip>
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
            <v-list-item-title style="font-weight: 800">
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
          <!-- Avatar change dialog commented out -->
        </v-list-item-avatar>

        <v-list-item-content class="py-0" style="align-self: initial">
          <v-list-item-title class="mb-0" style="font-size: 14px" v-if="account">
            {{ account.name }}
          </v-list-item-title>
          <v-list-item-subtitle class="mb-0" style="font-size: 10px" v-if="account">
            {{ account.chain }}
          </v-list-item-subtitle>
          <v-list-item-subtitle style="font-size: 8px" v-if="account">
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
import { ref, computed, watch, onMounted, getCurrentInstance, toRefs } from 'vue'
import networks from '@/utils/networks'
import { musicStore } from '@/stores/musicStore'
import MusicStoreModule from '@/stores/musicStore'
import assts from '@/utils/assets'
import changeLog from '@/plugins/changeLog'
import { Cardano } from '@cardano-sdk/core'
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import cardStore from '@/stores/modules/card';
import LoadingState from '@/stores/loading';
import { Blockchain } from '@/models/types';
import assets from '@/utils/assets';
import { updateVuetifyTheme } from '@/plugins/vuetify';
import { debugLog } from '@/utils/debug';

interface NavigationItem {
  title?: string;
  icon?: string;
  link?: string;
  href?: string;
  header?: string;
  enabled?: boolean;
  soon?: boolean;
  new?: boolean;
  underMaintenance?: boolean;
  loading?: boolean;
}

type NavigationLinkItem = NavigationItem & { link: string };
type NavigationHrefItem = NavigationItem & { href: string };
type NavigationHeaderItem = NavigationItem & { header: string };
type NavigationItemUnion = NavigationLinkItem | NavigationHrefItem | NavigationHeaderItem;

const changeLogRef = ref(changeLog)
const isBeta = ref<boolean>(import.meta.env['VITE_IS_BETA'] === 'true')
// Define props and emit
const props = defineProps<{ value: boolean }>()
const emit = defineEmits(['input'])

// Access Vuetify instance
const vmProxy = getCurrentInstance()!.proxy as any
const breakpoint = vmProxy.$vuetify.breakpoint
const themeDark = vmProxy.$vuetify.theme.isDark
const router = vmProxy.$router

// Reactive state
const version = ref('')
const hasUnlockMethod = ref(false)

const { musicPlaylist, context } = toRefs(musicStore);
const { loggedWallet, transactions } = toRefs(walletStore);

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

const items = computed((): NavigationItemUnion[] => {
  let isStakingEnabled = false;
  if (loggedWallet.value?.baseAddress) {
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
    { title: t('navigation.blog'), icon: assts.blog, link: '/blog', enabled: true },
    { header: t('navigation.financialHub'), enabled: true },
    { title: t('navigation.transactions'), icon: assts.transactions, link: '/transactions', enabled: networks.resolveTransactionsSupport(loggedWallet.value?.chain, loggedWallet.value?.network) && transactions.value.length > 0 },
    { title: t('navigation.staking'), icon: assts.coinsStacked, link: '/staking', enabled: isStakingEnabled },
    { title: t('navigation.governance'), icon: assts.governance, link: '/governance', enabled: networks.resolveGovernanceSupport(loggedWallet.value?.chain, loggedWallet.value?.network) },
    { title: t('navigation.multisig'), icon: assts.multisigTree, link: '/multisig', enabled: false }, // Disabled - under maintenance
    {
      title: t('navigation.geroCard'),
      icon: assts.cardIcon,
      link: '/card',
      enabled: networks.resolveGeroCardSupport(loggedWallet.value?.chain, loggedWallet.value?.network),
      new: true,
      underMaintenance: !isGeroCardEnabledByFeatureFlag.value,
      loading: loadingFFs.value
    },
    { header: t('navigation.activitiesRewards'), enabled: hasActivitiesRewardsItems },
    { title: t('navigation.claimRewards'), icon: assts.infinity, link: '/claim-rewards', enabled: isClaimRewardsEnabled },
    { title: t('navigation.cashback'), icon: assts.cashback, link: '/cashback', enabled: isCashbackEnabled },
    { title: t('navigation.referral'), icon: assts.usersPlus, link: '/referral', enabled: isReferralEnabled },
    // { title: 'Market', icon: assts.market, link: '/market', enabled: false },
    // { title: 'zkFiat', icon: assts.zkFiat, link: '/zkFiat', enabled: false },
    { header: t('navigation.media'), enabled: musicPlaylist.value?.length > 0 },
    { title: t('navigation.mediaPlayer'), icon: assts.mediaPlayer, link: '/media-player', enabled: musicPlaylist.value?.length > 0 },
    // Uncomment to add more items:
    // { header: 'Tools' },
    // { title: 'Airdrop', icon: 'mdi-gift', link: '/airdrop', soon: true },
    // { title: 'IPFS Cache', icon: 'mdi-cube', link: '/ipfs-cache', soon: true },
    // { title: 'Snapshot', icon: 'mdi-camera-enhance', link: '/snapshot', soon: true },
    // { header: 'Documentation' },
    // { title: 'Guides', icon: 'mdi-book-open-variant', href: 'https://docs.adabox.io/' },
    // { title: 'Whitepaper', icon: 'mdi-file-certificate-outline', href: 'https://docs.adabox.io/whitepapers/forge-whitepaper' }
  ].filter(i => i)
})

// Loading state for swap feature flag
const loadingFFs = computed(() => {
  return featureFlagsStore.state.isLoading || !featureFlagsStore.state.isInitialized;
});

// Check if swap is enabled by LaunchDarkly feature flag
const isGeroCardEnabledByFeatureFlag = computed(() => {
  return featureFlagsStore.isGeroCardEnabled();
});

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
    updateVuetifyTheme(false, true);
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
<style lang="scss" scoped>
.menuItem {
  border: 1px solid transparent;
}

.activePage {
  background: linear-gradient(45deg, #00c7f3, #00ffd1);
}

.activePage.apex {
  background: linear-gradient(45deg, #F8A282, #FECB82);
}

.activePageDark {
  color: #FFFFFF;
  background: #0C0E12;
  border: 1px solid transparent;
  border-radius: 6px;
  background: {
    image: linear-gradient(to right, #0C0E12, #0C0E12),
    linear-gradient(to right, #0C0E12 8%, #00D1FF);
    clip: padding-box, border-box;
    origin: padding-box, border-box;
  }

  .v-image {
    filter: brightness(0) saturate(100%) invert(62%) sepia(93%) saturate(1287%) hue-rotate(136deg) brightness(102%) contrast(101%) !important;
  }
}

.activePageDark.apex {
  color: #FFFFFF;
  background: #0C0E12;
  border: 1px solid transparent;
  border-radius: 6px;
  background: {
    image: linear-gradient(to right, #0C0E12, #0C0E12),
    linear-gradient(to right, #0C0E12 8%, #F8A282);
    clip: padding-box, border-box;
    origin: padding-box, border-box;
  }

  .v-image {
    filter: brightness(0) saturate(100%) invert(92%) sepia(45%) saturate(5319%) hue-rotate(301deg) brightness(100%) contrast(95%) !important;
  }
}

.theme--dark.v-list-item {
  &:not(.v-list-item--active):not(.v-list-item--disabled) {
    color: #FFFFFF !important;
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
    background: #0C0E12;
    border: 1px solid transparent;
  }

  &:not(.activePageDark):hover {
    background: #0C0E12;
    border: 1px solid transparent;
  }
}

.v-subheader {
  font-size: 10px;
  text-align: center;
  line-height: 10px;
  width: 100%;
  position: relative;
  z-index: 1;
}
</style>
