<template>
  <v-navigation-drawer
    v-model="drawer"
    :temporary="breakpoint.mobile"
    width="270"
    height="100vh"
    style="min-width: 270px; min-height: 100%; border-right: 1px solid rgba(128,128,128,0.15)"
    class="px-3"
    :absolute="breakpoint.mobile"
  >
    <!-- Prepend slot -->
    <template #prepend>
      <v-list-item class="text-center">
        <v-list-item-content class="py-2">
          <v-list-item-title>
            <img :src="assts.geroDashboard" width="100" alt="logo" />
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
        <v-subheader v-if="item.header" style="font-weight: 800" :key="index">
          {{ item.header }}
        </v-subheader>

        <v-list-item
          v-else-if="item.link"
          :to="item.link"
          v-show="item.enabled || item.soon"
          :disabled="item.soon"
          :active-class="themeDark ? 'activePageDark' : 'activePage'"
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
        </v-list-item>

        <v-list-item
          v-else-if="item.href"
          :href="item.href"
          :disabled="item.soon"
          :key="index"
          :active-class="themeDark ? 'activePageDark' : 'activePage'"
          target="_blank"
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
import { ref, computed, watch, onMounted, getCurrentInstance } from 'vue'
import { useStore } from '@/stores'
import networks from '@/utils/networks'
import { musicStore } from '@/stores/modules/music'
import assts from '@/utils/assets'
import changeLog from '@/plugins/changeLog'
import { Cardano } from '@cardano-sdk/core'

const changeLogRef = ref(changeLog)

const isBeta: boolean = ref<boolean>(import.meta.env['VITE_IS_BETA'])

// Define props and emit
const props = defineProps<{ value: boolean }>()
const emit = defineEmits(['input'])

// Access Vuetify instance
const vmProxy = getCurrentInstance()!.proxy as any
const breakpoint = vmProxy.$vuetify.breakpoint
const themeDark = vmProxy.$vuetify.theme.isDark
const router = vmProxy.$router

// Pinia stores
const store = useStore()
const music = musicStore()

// Reactive state
const version = ref('')

// Computed properties
const wallets = computed(() => store.wallets)
const loggedWallet = computed(() => store.loggedWallet)
const transactionsCount = computed(() => store.transactions || 0)
const baseAddress = computed(() => store.baseAddress)
const musicPlaylist = computed(() => music.musicPlaylist)

const account = computed(() => {
  return loggedWallet.value
    ? wallets.value.find(w => w.id === loggedWallet.value.id)
    : null
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

const items = computed(() => {
  let isStakingEnabled = false
  if (baseAddress.value) {
    isStakingEnabled =
      Cardano.Address.fromBech32(baseAddress.value).getType() !==
      Cardano.AddressType.EnterpriseScript
  }

  return [
    { title: 'Dashboard', icon: assts.barChart, link: '/', enabled: true },
    { title: 'Staking', icon: assts.coinsStacked, link: '/staking', enabled: isStakingEnabled },
    { title: 'Blog', icon: assts.blog, link: '/blog', enabled: true },
    { title: 'Media Player', icon: assts.mediaPlayer, link: '/media-player', enabled: musicPlaylist.value?.length > 0 },
    { title: 'Cashback', icon: assts.cashback, link: '/cashback', enabled: networks.resolveCashbackSupport(loggedWallet.value?.chain, loggedWallet.value?.network) },
    { title: 'Governance', icon: assts.governance, link: '/governance', enabled: networks.resolveGovernanceSupport(loggedWallet.value?.chain, loggedWallet.value?.network) },
    { title: 'Transactions', icon: assts.transactions, link: '/transactions', enabled: networks.resolveTransactionsSupport(loggedWallet.value?.chain, loggedWallet.value?.network) && transactionsCount.value > 0 },
    { title: 'Market', icon: assts.market, link: '/market', enabled: false },
    { title: 'zkFiat', icon: assts.zkFiat, link: '/zkFiat', enabled: false },
    { title: 'Claim Rewards', icon: assts.infinity, link: '/claim-rewards', enabled: false },
    { title: 'Referral', icon: assts.usersPlus, link: '/referral', enabled: false }
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
async function submitLogout() {
  await store.logout()
  await router.push('/welcome')
}

// Lifecycle
onMounted(() => {
  version.value = APP_VERSION
})
</script>

<style scoped>
.menuItem {
  border: 1px solid transparent;
}

.activePage {
  background: linear-gradient(45deg, #00c7f3, #00ffd1);
}

.activePageDark {
  color: #FFFFFF;
  background: #0C0E12;
  border: 1px solid transparent;
  border-radius: 6px;
  background:
    linear-gradient(to right, #0C0E12, #0C0E12),
    linear-gradient(to right, #0C0E12 8%, #00D1FF);
  background-clip: padding-box, border-box;
  background-origin: padding-box, border-box;
}

.activePageDark .v-image {
  filter: brightness(0) saturate(100%) invert(62%) sepia(93%) saturate(1287%) hue-rotate(136deg) brightness(102%) contrast(101%) !important;
}

.theme--dark.v-list-item:not(.v-list-item--active):not(.v-list-item--disabled) {
  color: #FFFFFF !important;
}

.menuItem.v-list-item--link:before {
  background: #0C0E12;
  border: 1px solid transparent;
}

.menuItem.v-list-item--link:not(.activePageDark):hover {
  background: #0C0E12;
  border: 1px solid transparent;
}

.theme--dark.v-list-item:focus::before,
.theme--dark.v-list-item--active:focus::before,
.theme--dark.v-list-item--active:hover::before,
.theme--dark.v-list-item--active::before {
  opacity: 0 !important;
}
</style>
