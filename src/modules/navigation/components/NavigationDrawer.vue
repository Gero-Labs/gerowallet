<template>
  <v-navigation-drawer
      v-model="drawer"
      :temporary="$vuetify.breakpoint.mobile"
      width="270"
      height="100vh"
      style="min-width: 270px; min-height: 100%; border-right: 1px solid rgba(128,128,128,0.15)"
      class="px-3"
      :absolute="$vuetify.breakpoint.mobile"
  >
    <template v-slot:prepend>
      <v-list-item class="text-center">
        <v-list-item-content class="py-2">
          <v-list-item-title>
            <img
                :src="assts.geroDashboard" width="100" alt="logo"
            />
          </v-list-item-title>
          <v-list-item-subtitle>
            <v-btn color="orange" text plain @click="changeLog.setEnabled(true)">
              {{ `v${version}` }}
              <v-icon small class="ml-1">
                mdi-lightning-bolt
              </v-icon>
            </v-btn>
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
    </template>
    <v-list nav dense>
      <template v-for="(item, index) in items">
        <v-subheader v-if="item.header" :key="index" style="font-weight: 800">
          {{ item.header }}
        </v-subheader>
        <v-list-item
            v-else-if="item.link"
            :to="item.link"
            v-show="item.enabled || item.soon"
            :disabled="item.soon"
            :key="index"
            :active-class="$vuetify.theme.isDark ? 'activePageDark' : 'activePage'"
            link
            class="menuItem"
            style="height: 40px"
        >
          <v-list-item-avatar tile size="18" :style="item.soon ? { filter: 'opacity(0.5)'} : {}">
            <v-img width="18" height="18" :src="item.icon" :alt="item.title" contain style="filter: invert(98%) sepia(44%) saturate(0%) hue-rotate(18deg) brightness(103%) contrast(103%);"></v-img>
          </v-list-item-avatar>

          <v-list-item-content>
            <v-list-item-title style="font-weight: 800">
              {{ item.title }}
<!--              <v-chip-->
<!--                  v-if="item.soon"-->
<!--                  class="ma-2"-->
<!--                  color="#333741"-->
<!--                  x-small-->
<!--                  outlined-->
<!--                  style="color: #9e9fa1"-->
<!--              >-->
<!--                Soon-->
<!--              </v-chip>-->
            </v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <v-list-item
            v-else-if="item.href"
            :href="item.href"
            :disabled="item.soon"
            :key="index"
            :active-class="$vuetify.theme.isDark ? 'activePageDark' : 'activePage'"
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
                  outlined
              >
                Soon
              </v-chip>
            </v-list-item-title>
          </v-list-item-content>
          <v-list-item-action>
            <v-icon small>
              mdi-open-in-new
            </v-icon>
          </v-list-item-action>
        </v-list-item>
      </template>
    </v-list>
    <template v-slot:append>
      <v-divider></v-divider>
        <v-list-item three-line class="px-0">
          <v-list-item-avatar style="margin: auto" class="mr-3" size="40" >
            <v-img v-if="account" :src="avatar"></v-img>
<!--            <v-dialog v-model="changeAvatarDialog" scrollable width="720">-->
<!--              <template v-slot:activator="{ on, attrs }">-->
<!--                <v-hover>-->
<!--                  <template v-slot:default="{ hover }">-->
<!--                    <v-btn fab elevation="0" v-bind="attrs" v-on="on">-->
<!--                      <v-img v-if="account" :src="avatar"></v-img>-->
<!--                      <v-fade-transition>-->
<!--                        <v-overlay v-if="hover" absolute color="#ffffff"></v-overlay>-->
<!--                      </v-fade-transition>-->
<!--                    </v-btn>-->
<!--                  </template>-->
<!--                </v-hover>-->
<!--              </template>-->
<!--              <v-card :loading="avatarsLoading">-->
<!--                <v-card-title class="justify-center">-->
<!--                  Change Your Profile Picture-->
<!--                </v-card-title>-->
<!--                <v-card-text>-->
<!--                  <v-item-group v-model="selectedAvatar">-->
<!--                    <v-container>-->
<!--                      <v-row>-->
<!--                        <v-col-->
<!--                            v-for="(avatar, index) in avatars"-->
<!--                            :key="index"-->
<!--                            cols="12"-->
<!--                            lg="3"-->
<!--                            md="4"-->
<!--                            sm="6"-->
<!--                            class="pa-2"-->
<!--                        >-->
<!--                          <v-item v-slot="{ active, toggle }">-->
<!--                            <v-card-->
<!--                                :color="active ? 'primary' : ''"-->
<!--                                flat-->
<!--                                outlined-->
<!--                                dark-->
<!--                                @click="toggle"-->
<!--                                class="fill-height"-->
<!--                                :disabled="loading"-->
<!--                            >-->
<!--                              <v-img :src="avatar.image | toIPFS" alt="" contain-->
<!--                                     @error="fallbackImage"-->
<!--                                     onerror="this.onerror=null; this.src='https://d1zjrpdfxjmowk.cloudfront.net/assets/images/1x1.webp';"-->
<!--                                     aspect-ratio="1">-->
<!--                                <template v-slot:placeholder>-->
<!--                                  <v-sheet>-->
<!--                                    <v-skeleton-loader class="mx-auto" type="image"></v-skeleton-loader>-->
<!--                                  </v-sheet>-->
<!--                                </template>-->
<!--                                &lt;!&ndash;                              <div style="position: absolute; margin-left: auto; margin-right: auto; left: 0; right: 0; text-align: center; bottom: 0;">&ndash;&gt;-->
<!--                                &lt;!&ndash;                                <strong style="font-size: 12px; line-height: 2.2;">{{ avatar.assetName }}</strong>&ndash;&gt;-->
<!--                                &lt;!&ndash;                              </div>&ndash;&gt;-->
<!--                                <v-scroll-y-transition>-->
<!--                                  <v-icon v-if="active" style="position: absolute; right: 4px; top: 2px;">-->
<!--                                    mdi-check-->
<!--                                  </v-icon>-->
<!--                                </v-scroll-y-transition>-->
<!--                              </v-img>-->
<!--                              <v-card-title class="text-center justify-center pt-0 px-0 pb-1"-->
<!--                                            style="word-break: break-word; font-size: 12px">-->
<!--                                {{ avatar.assetName }}-->
<!--                              </v-card-title>-->
<!--                            </v-card>-->
<!--                          </v-item>-->
<!--                        </v-col>-->
<!--                      </v-row>-->
<!--                    </v-container>-->
<!--                  </v-item-group>-->
<!--                </v-card-text>-->
<!--                <v-card-actions class="justify-center">-->
<!--                  <v-btn color="primary" text @click="closeChangeAvatarDialog" :disabled="loading">Cancel</v-btn>-->
<!--                  <v-btn color="primary" elevation="0" @click="selectAvatar" :loading="loading"-->
<!--                         :disabled="loading || selectedAvatar === undefined">Save-->
<!--                  </v-btn>-->
<!--                </v-card-actions>-->
<!--              </v-card>-->
<!--            </v-dialog>-->
          </v-list-item-avatar>
          <v-list-item-content class="py-0" style="align-self: initial">
            <v-list-item-title class="mb-0" style="font-size: 14px" v-if="account">{{ account.name }}</v-list-item-title>
            <v-list-item-subtitle class="mb-0" style="font-size: 10px" v-if="account">{{ account.chain }}</v-list-item-subtitle>
            <v-list-item-subtitle style="font-size: 8px" v-if="account">{{account.network }}</v-list-item-subtitle>
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

<script>
import filters from '@/shared/utils/filters'
import {mapActions, mapState} from "pinia";
import {useStore} from "@/store";
import networks from '@/shared/utils/networks';
import { musicStore } from '@/store/modules/music';
import assts from '@/utils/assets';
import changeLog from '@/plugins/changeLog'

export default {
  name: 'NavigationDrawer',
  props: {
    value: {
      type: Boolean,
      default: false
    }
  },
  filters,
  watch: {
    '$vuetify.breakpoint.mobile'(newVal, oldVal) {
      if (oldVal === false && newVal === true) {
        this.drawer = false;
      }
    }
  },
  computed: {
    networks() {
      return networks
    },
    ...mapState(useStore, ['wallets', 'loggedWallet']),
    ...mapState(musicStore, ['musicPlaylist']),
    avatar() {
      if (this.account.icon.includes('http')) {
        return this.account.icon
      } else {
        return this.resolveIcon(this.account.icon)
      }
    },
    account() {
      if (this.loggedWallet) {
        return this.wallets.find(wallet => wallet.id === this.loggedWallet.id)
      }
      return null
    },
    items() {
      return [
        // { header: 'Home' },
        {title: 'Dashboard', icon: assts.barChart, link: '/', enabled: true},
        {title: 'Blog', icon: assts.blog, link: '/blog', enabled: true },
        { header: 'Activities & Rewards' },
        {title: 'Transactions', icon: assts.transactions, link: '/transactions', enabled: networks.resolveTransactionsSupport(this.loggedWallet?.chain, this.loggedWallet?.network)},
        {title: 'Claim Rewards', icon: assts.infinity, link: '/claim-rewards', soon: true},
        {title: 'Referral', icon: assts.usersPlus, link: '/referral', soon: true},
        { header: 'Cardano Essentials' },
        {title: 'Staking', icon: assts.coinsStacked, link: '/staking', enabled: true},
        {title: 'Governance', icon: assts.governance, link: '/governance', enabled: networks.resolveGovernanceSupport(this.loggedWallet?.chain, this.loggedWallet?.network)},
        {title: 'Multisig', icon: assts.multisigTree, link: '/multisig', enabled: true},
        { header: 'Financial Hub' },
        {title: 'Cashback', icon: assts.cashback, link: '/cashback', enabled: networks.resolveCashbackSupport(this.loggedWallet?.chain, this.loggedWallet?.network)},
        {title: 'Market', icon: assts.market, link: '/market', enabled: false, soon: true},
        {title: 'zkFiat', icon: assts.zkFiat, link: '/zkFiat', soon: true},
        // { header: 'Media' },
        {title: 'Media Player', icon: assts.mediaPlayer, link: '/media-player', enabled: this.musicPlaylist?.length > 0 },
        // { header: 'Tools' },
        // { title: 'Airdrop', icon: 'mdi-gift', link: '/airdrop', soon: true },
        // { title: 'IPFS Cache', icon: 'mdi-cube', link: '/ipfs-cache', soon: true },
        // { title: 'Snapshot', icon: 'mdi-camera-enhance', link: '/snapshot', soon: true },
        // { header: 'Documentation' },
        // { title: 'Guides', icon: 'mdi-book-open-variant', href: 'https://docs.adabox.io/'},
        // { title: 'Whitepaper', icon: 'mdi-file-certificate-outline', href: 'https://docs.adabox.io/whitepapers/forge-whitepaper'},
      ]
    },
    drawer: {
      get() {
        if (this.$vuetify.breakpoint.mobile) {
          return this.value
        } else {
          return true
        }
      },
      set(val) {
        this.$emit('input', val)
      }
    }
  },
  data: () => ({
    avatarsLoading: true,
    loading: false,
    network: 'mainnet',
    assets: [],
    selectedAvatar: undefined,
    avatars: [],
    changeAvatarDialog: false,
    errorImage: assts.errorImage,
    changeLog,
    assts,
    version: ''
  }),
  methods: {
    ...mapActions(useStore, ['logout']),
    async submitLogout() {
      await this.logout();
      await this.$router.push("/welcome")
    },
    resolveIcon(icon) {
      return assts.resolveIcon(icon)
    },
    async selectAvatar() {
      // if (this.avatars && this.avatars.length > 0 && this.selectedAvatar && this.avatars[this.selectedAvatar]) {
      //   this.loading = true
      //   try {
      //     const response = await api.updateProfilePic(token, this.avatars[this.selectedAvatar].image, this.account.user.id)
      //     console.log(response)
      //     if (response.status === 200) {
      //       await this.$store.dispatch('changeProfilePic', {cid: response.data})
      //       this.changeAvatarDialog = false
      //       this.$emit('snackbarChange', {text: 'Avatar Changed Successfully!', color: 'success'})
      //     }
      //   } catch (e) {
      //     console.log(e)
      //   }
      //   this.loading = false
      // }

    },
    async getAvatars() {

    },
    closeChangeAvatarDialog() {
      this.changeAvatarDialog = false
    },
    fallbackImage(e) {
      e.target.src = this.errorImage
    }
  },
  mounted() {
    this.version = APP_VERSION
  }
}
</script>
<style lang="scss" scoped>
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

  &:before {
    content: '';
    display: block;
    width: 100%;
    height: 1px;
    background: #0C0E12;
    position: absolute;
    top: 50%;
    left: 0;
    z-index: -1;
  }
}
</style>
