<template>
  <v-navigation-drawer
    v-model="drawer"
    :temporary="mobile"
    width="270"
    height="100vh"
    style="min-width: 270px; min-height: 100%"
    class="px-3 liquid-glass-nav-drawer"
    :absolute="mobile"
  >
    <!-- Prepend slot -->
    <template #prepend>
      <v-list-item class="text-center">
        <div class="pb-2 g-list-content" style="padding-top: 22px;">
          <v-list-item-title>
            <img
              :src="navLogo"
              width="64"
              alt="logo"
            />
          </v-list-item-title>
          <v-list-item-subtitle>
            <v-btn color="warning" variant="text" plain @click="changeLogRef.setEnabled(true)">
              {{ `v${version}` }}<span class="ml-1" v-if="isBeta">(Beta)</span>
              <v-icon size="small" class="ml-1">mdi-lightning-bolt</v-icon>
            </v-btn>
          </v-list-item-subtitle>
        </div>
      </v-list-item>
    </template>

    <!-- Navigation items -->
    <v-list nav density="compact">
      <template :key="index" v-for="(item, index) in items" >
        <v-list-subheader class="pt-2 pb-1" v-if="item.header && item.enabled" style="font-weight: 600; height: 18px; margin-top: 6px; margin-bottom: 10px;" >
          {{ item.header }}
        </v-list-subheader>

        <v-list-item
          v-else-if="item.link"
          :to="item.link"
          v-show="item.enabled || item.soon"
          :disabled="item.soon || item.loading || item.underMaintenance"
          :active-class="themeDark ? 'activePageDark' : 'activePage'"
          link
          :class="['menuItem', { 'nexus-item': item.special }]"
          style="height: 34px"

          @mouseenter="prefetchItem(item)"
          @focusin="prefetchItem(item)"
          @pointerdown="prefetchItem(item)"
        >
          <template #prepend>
            <v-avatar rounded="0" size="18" :style="item.soon || item.loading || item.underMaintenance ? { filter: 'opacity(0.5)' } : {}">
              <v-badge :model-value="!!item.notificationDot" dot color="error" overlap bordered>
                <v-icon v-if="item.icon?.startsWith('mdi-')" size="18" color="var(--g-accent)">{{ item.icon }}</v-icon>
                <!-- Non-special SVG marks tint to the chain accent via a mask (a
                     color filter can't resolve an arbitrary themeable hex). -->
                <span
                  v-else-if="!item.special"
                  class="nav-svg-icon"
                  role="img"
                  :aria-label="item.title"
                  :style="{ maskImage: cssUrl(item.icon), WebkitMaskImage: cssUrl(item.icon) }"
                />
                <v-img
                  v-else
                  width="18"
                  height="18"
                  :src="item.icon"
                  :alt="item.title"

                />
              </v-badge>
            </v-avatar>
          </template>

          <div class="g-list-content">
            <v-list-item-title style="font-weight: 500">
              {{ item.title }}
            </v-list-item-title>
          </div>
          <template #append v-if="(item.title === 'Media Player' && musicPlaylist?.length > 0) || item.loading || item.underMaintenance || item.new">
            <!-- Mini Player Button for Media Player item -->
            <v-tooltip v-if="item.title === 'Media Player' && musicPlaylist?.length > 0" location="end" >
              <template v-slot:activator="{ props: activatorProps }">
                <v-btn
                  icon variant="text"
                  size="x-small"
                  v-bind="activatorProps"

                  @click.stop.prevent="toggleMiniPlayer"
                  :color="context.shown ? 'primary' : ''"
                >
                  <v-icon size="16">mdi-play-box-multiple</v-icon>
                </v-btn>
              </template>
              <span>{{ $t('navigation.miniPlayer') }}</span>
            </v-tooltip>
            <v-progress-circular v-else-if="item.loading" size="16" width="2" indeterminate></v-progress-circular>
            <v-chip
              v-else-if="item.underMaintenance"
              variant="outlined"
              class="px-1"
              size="x-small"
              color="warning"
              style="margin-left: 1px; margin-bottom: 1px; scale: 0.9"
            ><v-icon color="warning" size="x-small" class="mr-1">mdi-hammer-screwdriver</v-icon> {{ $t('common.maintenance') }}</v-chip>
            <v-chip
              v-else-if="item.new"
              class="my-2 px-2"
              color="primary"
              size="x-small"
            >
              {{ $t('common.new') }}
            </v-chip>
          </template>
        </v-list-item>

        <v-list-item
          v-else-if="item.href"
          :disabled="item.soon"

          :active-class="themeDark ? 'activePageDark' : 'activePage'"
          link
          @click="openExternalLink(item.href)"
        >
          <template #prepend>
            <v-avatar>
              <v-img :src="item.icon" :alt="item.title"></v-img>
            </v-avatar>
          </template>

          <div class="g-list-content">
            <v-list-item-title style="font-weight: 500">
              {{ item.title }}
              <v-chip
                v-if="item.soon"
                class="ma-2"
                color="primary"
                size="x-small"
                variant="outlined">
                {{ $t('common.comingSoon') }}
              </v-chip>
            </v-list-item-title>
          </div>

          <template #append>
            <v-icon size="small">mdi-open-in-new</v-icon>
          </template>
        </v-list-item>
      </template>
    </v-list>

    <!-- Append slot -->
    <template #append>
      <v-divider></v-divider>
      <v-list-item lines="three" class="px-0" prepend-gap="12">
        <template #prepend>
          <v-avatar size="40">
            <v-img v-if="account" :src="avatar" />
          </v-avatar>
        </template>

        <div class="py-0 g-list-content" style="align-self: initial">
          <v-list-item-title class="mb-0" style="font-size: 14px" v-if="account && !editingName">
            <span
              class="editable-name"
              @click="startEditingName"
              :title="t('settings.editWalletName')"
            >{{ accountTitle }}<v-icon size="x-small" class="ml-1 edit-icon">mdi-pencil</v-icon></span>
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
            <v-btn icon variant="text" size="x-small" @mousedown.prevent="saveWalletName" :disabled="!isNameValid" color="success" class="ml-1" style="width: 16px; height: 16px;">
              <v-icon style="font-size: 12px;">mdi-check</v-icon>
            </v-btn>
          </v-list-item-title>
          <v-list-item-subtitle class="mb-0" style="font-size: 11px" v-if="account">
            {{ account.chain }}
          </v-list-item-subtitle>
          <v-list-item-subtitle style="font-size: 11px" v-if="account">
            {{ accountNetworkLabel }}
          </v-list-item-subtitle>
          <v-menu v-if="account && accountSwitchable" location="top">
            <template #activator="{ props: activatorProps }">
              <button type="button" class="account-switch" v-bind="activatorProps" :disabled="switchingAccount"
                :aria-label="t('accounts.switchAccount')">
                {{ t('accounts.label', { index: loggedRecord?.accountIndex ?? 0 }) }}<v-icon size="x-small">mdi-chevron-down</v-icon>
              </button>
            </template>
            <v-list density="compact">
              <v-list-subheader>{{ t('accounts.switchAccount') }}</v-list-subheader>
              <v-list-item v-for="member in accountGroupMembers" :key="member.id" :active="member.id === account.id"
                @click="switchAccount(member.id)">
                <v-list-item-title>{{ member.name }}</v-list-item-title>
                <v-list-item-subtitle>{{ t('accounts.label', { index: member.accountIndex ?? 0 }) }}</v-list-item-subtitle>
              </v-list-item>
              <template v-if="canAddMoreAccounts">
                <v-divider />
                <v-list-item prepend-icon="mdi-plus" @click="addAccount()">
                  <v-list-item-title>{{ t('accounts.addAccount') }}</v-list-item-title>
                </v-list-item>
              </template>
            </v-list>
          </v-menu>
        </div>

        <template #append>
          <div class="d-flex flex-row">
            <v-tooltip location="top" v-if="hasUnlockMethod"  content-class="custom-tooltip">
              <template v-slot:activator="{ props: activatorProps }">
                <v-btn icon variant="text" :aria-label="t('security.lock')" @click="submitLock" v-bind="activatorProps" >
                  <v-icon size="18">mdi-lock</v-icon>
                </v-btn>
              </template>
              <span>{{ $t('security.lock') }}</span>
            </v-tooltip>

            <v-tooltip location="top"  content-class="custom-tooltip">
              <template v-slot:activator="{ props: activatorProps }">
                <v-btn icon variant="text" :aria-label="t('wallet.logout')" @click="submitLogout" v-bind="activatorProps" >
                  <v-avatar rounded="0" size="18">
                    <v-img :src="assts.logout" alt="logout"></v-img>
                  </v-avatar>
                </v-btn>
              </template>
              <span>{{ $t('wallet.logout') }}</span>
            </v-tooltip>
          </div>
        </template>
      </v-list-item>
    </template>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
import { isPublicRoute } from '@/modules/navigation/helpAccess';
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, watch, onMounted, nextTick, getCurrentInstance, toRefs } from 'vue'
import { useDisplay, useTheme } from 'vuetify';
import networks from '@/utils/networks'
import { musicStore } from '@/stores/musicStore'
import MusicStoreModule from '@/stores/musicStore'
import { midnightStore } from '@/stores/midnightStore'
import assts from '@/utils/assets'
import changeLog from '@/plugins/changeLog'
import { Cardano } from '@cardano-sdk/core'
import { walletStore } from '@/stores/walletStore';
import governanceAlertsStore from '@/stores/governanceAlertsStore';
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
import { cssUrl } from '@/shared/utils/cssUrl';
import { debugLog } from '@/utils/debug';
import { hasNewFeaturesInPath } from '@/shared/composables/useFeatureNotifications';
import { GOVERNANCE_ITEMS } from '@/modules/navigation/components/governanceNav';
import { prefetchPage } from '@/modules/navigation/lazyPage';
import { accountGroup, canAddAccounts, conflictingWalletNames, secretsWalletId, walletDisplayName } from '@/shared/utils/walletAccount';

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
  /** Amber delegation-health dot. Rides My governance. */
  alertDot?: boolean;
}

type NavigationLinkItem = NavigationItem & { link: string };
type NavigationHrefItem = NavigationItem & { href: string };
type NavigationHeaderItem = NavigationItem & { header: string };
type NavigationItemUnion = NavigationLinkItem | NavigationHrefItem | NavigationHeaderItem;

const { t } = useTranslation();
const changeLogRef = ref(changeLog)
const isBeta = ref<boolean>(import.meta.env['VITE_IS_BETA'] === 'true')
// Define props and emit
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits(['update:modelValue'])

// Composition injections are available in setup; $vuetify is installed later
// by the options mixin, after this component's setup has finished.
const { mobile } = useDisplay();
const theme = useTheme();
const themeDark = computed(() => theme.current.value.dark);
const vmProxy = getCurrentInstance()!.proxy
const router = vmProxy.$router

function prefetchItem(item: NavigationItemUnion) {
  if ('link' in item && item.enabled && !item.soon && !item.loading && !item.underMaintenance) {
    void prefetchPage(router, item.link);
  }
}

// Reactive state
const version = ref('')
const hasUnlockMethod = ref(false)

const { musicPlaylist, context } = toRefs(musicStore);
const { loggedWallet, transactions } = toRefs(walletStore);
const { transactions: midnightTransactions } = toRefs(midnightStore);

const account = computed(() => {
  return loggedWallet.value
})

// BTC testnet is testnet4 (backend electrs-testnet4) — show the variant in the
// wallet card, matching the onboarding pill / balance card / status tooltip.
const accountNetworkLabel = computed(() => {
  const n = account.value?.network;
  return account.value?.chain === Blockchain.BITCOIN && n === 'Testnet' ? 'Testnet4' : n;
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

const isMidnight = computed(() => {
  return loggedWallet.value?.chain === Blockchain.MIDNIGHT;
});

// Nav-bar Gero mark, tinted per chain. Apex Prime (teal) and Vector (orange)
// use their own variants so the logo matches the chain's onboarding art.
const navLogo = computed(() => {
  switch (loggedWallet.value?.chain) {
    case Blockchain.APEX_PRIME:
      return assets.geroNoTextPrime;
    case Blockchain.APEX_VECTOR:
      return assets.geroNoTextVector;
    case Blockchain.MIDNIGHT:
      return assets.geroNoTextMidnight;
    default:
      return assets.geroNoText;
  }
});

/**
 * Delegation-health alerts waiting on the user. Drives the amber dot on My
 * governance and its mirror on the Governance parent row.
 */
const governanceAlertCount = computed(() => governanceAlertsStore.alertCount());

/**
 * The Governance section's gate. Textually identical to the router's own
 * `governance` guard: network support AND the master feature flag. Every row in
 * the section reads this, so the drawer and the router cannot disagree about
 * whether governance exists for this wallet.
 */
const governanceEnabled = computed(
  () =>
    networks.resolveGovernanceSupport(loggedWallet.value?.chain, loggedWallet.value?.network) &&
    featureFlagsStore.isGovernanceEnabled(),
);

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
  // Chains without delegated staking (e.g. Apex Vector) never show the page.
  isStakingEnabled = isStakingEnabled &&
    networks.resolveStakingSupport(loggedWallet.value?.chain, loggedWallet.value?.network);

  // Check if any Activities & Rewards items are enabled
  const isClaimRewardsEnabled = false;
  const isCashbackEnabled = networks.resolveCashbackSupport(loggedWallet.value?.chain, loggedWallet.value?.network);
  const isReferralEnabled = false;
  const hasActivitiesRewardsItems = isClaimRewardsEnabled || isCashbackEnabled || isReferralEnabled;

  const { t } = useTranslation();

  return [
    { title: t('navigation.dashboard'), icon: assts.barChart, link: '/', enabled: true },
    {
      title: t(featureFlagsStore.isHelpCenterEnabled() ? 'help.title' : 'navigation.blog'),
      icon: assts.blog,
      link: featureFlagsStore.isHelpCenterEnabled() ? '/help' : '/blog',
      enabled: true,
      underMaintenance: !featureFlagsStore.isHelpCenterEnabled() && !isBlogEnabledByFeatureFlag.value,
    },
    { title: t('navigation.copilotFeed'), icon: 'mdi-bell-outline', link: '/copilot-feed', enabled: featureFlagsStore.isCopilotEnabled() },
    { header: t('navigation.financialHub'), enabled: true },
    // Midnight tx history lives in midnightStore (walletStore.transactions is Cardano-only).
    { title: t('navigation.transactions'), icon: 'mdi-swap-horizontal', link: '/transactions', enabled: networks.resolveTransactionsSupport(loggedWallet.value?.chain, loggedWallet.value?.network) && (loggedWallet.value?.chain === Blockchain.MIDNIGHT ? midnightTransactions.value.length > 0 : transactions.value.length > 0), notificationDot: hasNewFeaturesInPath(['transactions']) },
    { title: t('navigation.midnightProofServer'), icon: 'mdi-server-security', link: '/proof-server', enabled: isMidnight.value },
    { title: t('navigation.staking'), icon: assts.coinsStacked, link: '/staking', enabled: isStakingEnabled },
    // RealFi Earn — a yield product, so it sits beside Staking in Financial Hub.
    // Mirrors the router's `realfi` guard exactly (network support AND the master
    // flag). Keep the two in step: an item visible here that the guard redirects
    // away from is worse than no item at all.
    { title: t('navigation.realfi'), icon: 'mdi-sprout-outline', link: '/realfi', enabled: networks.resolveRealFiSupport(loggedWallet.value?.chain, loggedWallet.value?.network) && featureFlagsStore.isRealFiEnabled(), new: true },
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
      enabled: networks.resolveGoMiningSupport(loggedWallet.value?.chain, loggedWallet.value?.network) && featureFlagsStore.isBitcoinEnabled(),
      new: true,
      underMaintenance: !isGoMiningEnabledByFeatureFlag.value,
      loading: loadingFFs.value
    },
    {
      title: t('navigation.staking'),
      icon: assts.coinsStacked,
      link: '/babylon',
      enabled: networks.resolveBabylonSupport(loggedWallet.value?.chain, loggedWallet.value?.network) && featureFlagsStore.isBitcoinEnabled(),
      new: true,
    },
    {
      title: t('navigation.ordinals'),
      icon: 'mdi-image-multiple-outline',
      link: '/ordinals',
      enabled: networks.resolveOrdinalsSupport(loggedWallet.value?.chain, loggedWallet.value?.network) && featureFlagsStore.isBitcoinEnabled(),
      new: true,
    },
    {
      title: t('navigation.thorchain'),
      icon: 'mdi-swap-horizontal',
      link: '/thorchain',
      enabled: networks.resolveThorchainSupport(loggedWallet.value?.chain, loggedWallet.value?.network) && featureFlagsStore.isBitcoinEnabled(),
      new: true,
    },
    {
      title: t('navigation.mempool'),
      icon: 'mdi-database-clock',
      link: '/mempool',
      enabled: networks.resolveMempoolSupport(loggedWallet.value?.chain, loggedWallet.value?.network) && featureFlagsStore.isBitcoinEnabled(),
      new: true,
    },
    {
      title: t('navigation.lightning'),
      icon: 'mdi-lightning-bolt',
      link: '/lightning',
      enabled: networks.resolveLightningSupport(loggedWallet.value?.chain, loggedWallet.value?.network) && featureFlagsStore.isBitcoinEnabled(),
      new: true,
    },
    // ── Governance ───────────────────────────────────────────────────────
    // A section of its own rather than one expandable row. `governanceEnabled`
    // mirrors the router's `governance` guard exactly (network support AND the
    // master feature flag) — keep the two textually identical. Every row
    // inherits that gate; only registration adds a narrower one, because it
    // posts a deposit and a certificate on chain and the router gates that
    // route the same way. A row the router would redirect away from is worse
    // than no row at all.
    { header: t('navigation.governance'), enabled: governanceEnabled.value },
    ...GOVERNANCE_ITEMS.filter(
      item => item.flag !== 'voting' || featureFlagsStore.isGovernanceVotingEnabled(),
    ).map(item => ({
      title: t(item.titleKey),
      icon: item.icon,
      link: item.link,
      enabled: governanceEnabled.value,
      // The delegation-health dot rides My governance, the page that explains it.
      alertDot: item.link === '/governance/me' && governanceAlertCount.value > 0,
      notificationDot:
        item.link === '/governance/me' && hasNewFeaturesInPath(['navigation', 'governance']),
    })),
    { header: t('navigation.activitiesRewards'), enabled: hasActivitiesRewardsItems },
    { title: t('navigation.claimRewards'), icon: assts.infinity, link: '/claim-rewards', enabled: isClaimRewardsEnabled },
    { title: t('navigation.cashback'), icon: assts.cashback, link: '/cashback', enabled: isCashbackEnabled },
    { title: t('navigation.referral'), icon: assts.usersPlus, link: '/referral', enabled: isReferralEnabled },
    { header: t('navigation.media'), enabled: loggedWallet.value?.chain !== Blockchain.BITCOIN && loggedWallet.value?.chain !== Blockchain.APEX_VECTOR },
    // Only show the player when the wallet actually holds playable media —
    // an empty player is dead weight (and the Media header auto-hides with it).
    { title: t('navigation.mediaPlayer'), icon: assts.mediaPlayer, link: '/media-player', enabled: loggedWallet.value?.chain !== Blockchain.BITCOIN && loggedWallet.value?.chain !== Blockchain.APEX_VECTOR && (musicPlaylist.value?.length ?? 0) > 0 },
    { header: t('navigation.developers'), enabled: true },
    { title: t('navigation.poolOperator'), icon: 'mdi-server-network', link: '/pool-operator', enabled: networks.resolveStakingSupport(loggedWallet.value?.chain, loggedWallet.value?.network) && featureFlagsStore.isPoolOperatorEnabled(), new: true },
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
    if (!('header' in item) || !item.header || !item.enabled) return item;
    for (let j = i + 1; j < all.length && !('header' in all[j]); j++) {
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
    return mobile.value ? props.modelValue : true
  },
  set(val: boolean) {
    emit('update:modelValue', val)
  }
})

// Watch mobile breakpoint to auto-close drawer
watch(mobile,
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
  // An added account is named within its wallet; any other wallet among the top-level ones.
  return !!loggedRecord.value && !conflictingWalletNames(loggedRecord.value, wallets.value).includes(v)
})

// Accounts of the logged wallet's device (multi-account). The record from the wallet
// list, not loggedWallet, so a rename shows here at once.
const loggedRecord = computed(() => (account.value ? wallets.value[account.value.id] ?? account.value : null))
const accountTitle = computed(() => (loggedRecord.value ? walletDisplayName(loggedRecord.value, wallets.value) : ''))
const accountGroupMembers = computed(() => (loggedRecord.value ? accountGroup(loggedRecord.value, wallets.value) : []))
const canAddMoreAccounts = computed(() => !!loggedRecord.value && featureFlagsStore.isMultiAccountEnabled() && canAddAccounts(loggedRecord.value))
const accountSwitchable = computed(() => accountGroupMembers.value.length > 1 || canAddMoreAccounts.value)
const switchingAccount = ref(false)

async function switchAccount(id: number) {
  const wallet = wallets.value[id]
  if (!wallet || switchingAccount.value || id === account.value?.id) return
  switchingAccount.value = true
  try {
    await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.LOGIN, data: { wallet } })
  } finally {
    switchingAccount.value = false
  }
}

function addAccount() {
  const head = accountGroupMembers.value[0]
  if (head) router.push({ path: '/welcome', query: { addWallet: '1', addAccount: String(head.id) } }).catch(() => {})
}

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
    !isPublicRoute(router.currentRoute.value) && router.replace('/welcome').catch(err => {
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
    // Explicit logout returns to the wallet list, including from public Help.
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

    // An added account's lock settings are its account #0's.
    const { getDb } = await import('@/db/wallet-db')
    const db = await getDb(secretsWalletId(loggedWallet.value))
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

/* Delegation-health dot. Amber, quiet, and never animated. */
.nav-dot {
  display: inline-block;
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: var(--g-r-pill);
  background: var(--g-warning);
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


/* Non-special nav SVG marks — tinted to the chain accent via a mask so they
   match the accent-colored mdi icons (replaces a hardcoded white filter, and
   the accent tracks the chain: violet on Midnight, cyan on Cardano, etc.). */
.nav-svg-icon {
  display: inline-block;
  width: 18px;
  height: 18px;
  background-color: var(--g-accent);
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
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

/* Per-chain active-item colors are handled entirely by the base rule above via
   --g-accent (set per chain by useChainAccent). No hardcoded per-chain overrides:
   they broke Apex Prime (teal art) by forcing the shared Apex orange. */

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

.v-list-subheader {
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

.account-switch {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  margin-top: var(--g-s-1);
  color: var(--g-text-2);
  font-size: 11px;
  border-radius: var(--g-r-chip);

  &:hover:not(:disabled) {
    color: var(--g-text-1);
  }

  &:focus-visible {
    outline: 2px solid var(--g-accent);
    outline-offset: 2px;
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
