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
            <img :src="isApex ? assets.geroDashboardApex : assets.geroDashboard" width="100" alt="logo" />
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
          :disabled="item.soon"
          :active-class="themeDark ? (isApex ? 'activePageDark apex' : 'activePageDark') : (isApex ? 'activePage apex' : 'activePage')"
          link
          class="menuItem"
          style="height: 40px"
          :key="index"
        >
          <v-list-item-avatar tile size="18" :style="item.soon ? { filter: 'opacity(0.5)' } : {}">
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
              <span>Mini Player</span>
            </v-tooltip>
          </v-list-item-action>

          <v-list-item-action v-else-if="item.new">
            <v-chip
              v-if="item.new"
              class="my-2 px-2"
              color="primary"
              x-small
            >
              NEW
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
                Soon
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

        <v-list-item-action style="margin: auto">
          <v-btn icon @click="submitLogout">
            <v-avatar tile size="18">
              <v-img :src="assts.logout" alt="logout"></v-img>
            </v-avatar>
          </v-btn>
        </v-list-item-action>
      </v-list-item>
    </template>
  </v-navigation-drawer>
</template>

<script setup lang="ts">
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
import LoadingState from '@/stores/loading';
import { Blockchain } from '@/models/types';
import assets from '@/utils/assets';
import { updateVuetifyTheme } from '@/plugins/vuetify';

interface NavigationItem {
  title?: string;
  icon?: string;
  link?: string;
  href?: string;
  header?: string;
  enabled?: boolean;
  soon?: boolean;
  new?: boolean;
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

  return [
    { title: 'Dashboard', icon: assts.barChart, link: '/', enabled: true },
    { title: 'Blog', icon: assts.blog, link: '/blog', enabled: true },
    { header: 'Financial Hub', enabled: true },
    { title: 'Transactions', icon: assts.transactions, link: '/transactions', enabled: networks.resolveTransactionsSupport(loggedWallet.value?.chain, loggedWallet.value?.network) && transactions.value.length > 0 },
    { title: 'Staking', icon: assts.coinsStacked, link: '/staking', enabled: isStakingEnabled },
    { title: 'Governance', icon: assts.governance, link: '/governance', enabled: networks.resolveGovernanceSupport(loggedWallet.value?.chain, loggedWallet.value?.network) },
    { title: 'Multisig', icon: assts.multisigTree, link: '/multisig', enabled: networks.resolveMultiSigSupport(loggedWallet.value?.chain, loggedWallet.value?.network) },
    { title: 'Gero Card', icon: assts.card, link: '/card',  enabled: networks.resolveGeroCardSupport(loggedWallet.value?.chain, loggedWallet.value?.network), new: true },
    { header: 'Activities & Rewards', enabled: hasActivitiesRewardsItems },
    { title: 'Claim Rewards', icon: assts.infinity, link: '/claim-rewards', enabled: isClaimRewardsEnabled },
    { title: 'Cashback', icon: assts.cashback, link: '/cashback', enabled: isCashbackEnabled },
    { title: 'Referral', icon: assts.usersPlus, link: '/referral', enabled: isReferralEnabled },
    // { title: 'Market', icon: assts.market, link: '/market', enabled: false },
    // { title: 'zkFiat', icon: assts.zkFiat, link: '/zkFiat', enabled: false },
    { header: 'Media', enabled: musicPlaylist.value?.length > 0 },
    { title: 'Media Player', icon: assts.mediaPlayer, link: '/media-player', enabled: musicPlaylist.value?.length > 0 },
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

async function submitLogout() {
  try {
    LoadingState.setText('Logging out ...')
    LoadingState.setLoading(true);
    // Send logout message to background
    router.push('/welcome')
    await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.LOGOUT,
      data: { },
    });
    updateVuetifyTheme(false, true);
    // // Navigate to welcome page after store is cleared
    // router.push('/welcome').catch(err => {
    //   console.debug('Navigation after logout handled (expected during logout):', err.message || err);
    //   // Fallback: force page reloads to welcome
    //   window.location.hash = '#/welcome';
    // });
  } catch (error) {
    console.error('Error during logout:', error);
    // Force navigation even on error
    router.replace('/welcome').catch(err => {
      console.debug('Navigation after logout error handled (expected during logout):', err.message || err);
      window.location.hash = '#/welcome';
    });
  } finally {
    LoadingState.setLoading(false);
    LoadingState.setText('');
  }
}

// Lifecycle
onMounted(() => {
  // @ts-ignore
  version.value = APP_VERSION
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
