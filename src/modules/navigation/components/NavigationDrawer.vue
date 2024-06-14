<template>
  <v-navigation-drawer
      v-model="drawer"
      width="280"
      height="100vh"
      style="min-width: 270px; min-height: 100%; border-right: 1px solid rgba(128,128,128,0.15)"
      permanent
      floating
      class="px-3"
  >
    <template v-slot:prepend>
      <v-list-item class="text-center">
        <v-list-item-content class="py-2">
          <v-list-item-title>
            <img
                :src="require('../assets/gero_dashboards.png')" width="100" alt="logo"
                style="-webkit-filter: drop-shadow(-8px 3px 6px #B71C1C2D);
              filter: drop-shadow(-8px 3px 6px #B71C1C2D);"
            />
          </v-list-item-title>
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
            :disabled="item.soon"
            :key="index"
            :active-class="$vuetify.theme.isDark ? 'activePageDark' : 'activePage'"
            link
            class="menuItem"
        >
          <v-list-item-avatar tile size="18" :style="item.soon ? { filter: 'opacity(0.5)'} : {}">
            <v-img width="18" height="18" :src="item.icon" :alt="item.title" contain style="filter: invert(98%) sepia(44%) saturate(0%) hue-rotate(18deg) brightness(103%) contrast(103%);"></v-img>
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
            <v-dialog v-model="changeAvatarDialog" scrollable width="720">
              <template v-slot:activator="{ on, attrs }">
                <v-hover>
                  <template v-slot:default="{ hover }">
                    <v-btn fab elevation="0" v-bind="attrs" v-on="on">
                      <v-img v-if="account" :src="avatar"></v-img>
                      <v-fade-transition>
                        <v-overlay v-if="hover" absolute color="#ffffff"></v-overlay>
                      </v-fade-transition>
                    </v-btn>
                  </template>
                </v-hover>
              </template>
              <v-card :loading="avatarsLoading">
                <v-card-title class="justify-center">
                  Change Your Profile Picture
                </v-card-title>
                <v-card-text>
                  <v-item-group v-model="selectedAvatar">
                    <v-container>
                      <v-row>
                        <v-col
                            v-for="(avatar, index) in avatars"
                            :key="index"
                            cols="12"
                            lg="3"
                            md="4"
                            sm="6"
                            class="pa-2"
                        >
                          <v-item v-slot="{ active, toggle }">
                            <v-card
                                :color="active ? 'primary' : ''"
                                flat
                                outlined
                                dark
                                @click="toggle"
                                class="fill-height"
                                :disabled="loading"
                            >
                              <v-img :src="avatar.image | toIPFS" alt="" contain
                                     onerror="this.onerror=null; this.src='https://d1zjrpdfxjmowk.cloudfront.net/assets/images/1x1.webp';"
                                     aspect-ratio="1">
                                <template v-slot:placeholder>
                                  <v-sheet>
                                    <v-skeleton-loader class="mx-auto" type="image"></v-skeleton-loader>
                                  </v-sheet>
                                </template>
                                <!--                              <div style="position: absolute; margin-left: auto; margin-right: auto; left: 0; right: 0; text-align: center; bottom: 0;">-->
                                <!--                                <strong style="font-size: 12px; line-height: 2.2;">{{ avatar.assetName }}</strong>-->
                                <!--                              </div>-->
                                <v-scroll-y-transition>
                                  <v-icon v-if="active" style="position: absolute; right: 4px; top: 2px;">
                                    mdi-check
                                  </v-icon>
                                </v-scroll-y-transition>
                              </v-img>
                              <v-card-title class="text-center justify-center pt-0 px-0 pb-1"
                                            style="word-break: break-word; font-size: 12px">
                                {{ avatar.assetName }}
                              </v-card-title>
                            </v-card>
                          </v-item>
                        </v-col>
                      </v-row>
                    </v-container>
                  </v-item-group>
                </v-card-text>
                <v-card-actions class="justify-center">
                  <v-btn color="primary" text @click="closeChangeAvatarDialog" :disabled="loading">Cancel</v-btn>
                  <v-btn color="primary" elevation="0" @click="selectAvatar" :loading="loading"
                         :disabled="loading || selectedAvatar === undefined">Save
                  </v-btn>
                </v-card-actions>
              </v-card>
            </v-dialog>
          </v-list-item-avatar>
          <v-list-item-content class="py-0" style="align-self: initial">
            <v-list-item-title class="mb-0" style="font-size: 14px" v-if="account">{{ account.name }}</v-list-item-title>
            <v-list-item-subtitle class="mb-0" style="font-size: 10px">{{ account.chain }}</v-list-item-subtitle>
            <v-list-item-subtitle style="font-size: 8px">{{account.network }}</v-list-item-subtitle>
          </v-list-item-content>
          <v-list-item-action style="margin: auto">
            <v-btn icon @click="submitLogout">
              <v-avatar tile size="18">
                <v-img :src="require('@/assets/svg/log-out-01.svg')" alt="logout"></v-img>
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

export default {
  name: 'NavigationDrawer',
  filters,
  data: () => ({
    avatarsLoading: true,
    loading: false,
    drawer: true,
    balance: {
      assets: [],
      coin: 0,
      forge: 0,
    },
    network: 'mainnet',
    assets: [],
    selectedAvatar: undefined,
    avatars: [],
    changeAvatarDialog: false,
    items: [
      // { header: 'Home' },
      {title: 'Dashboard', icon: require('@/assets/svg/bar-chart-07.svg'), link: '/'},
      {title: 'Assets', icon: require('@/assets/svg/box.svg'), link: '/assets'},
      {title: 'Staking', icon: require('@/assets/svg/coins-stacked-02.svg'), link: '/staking'},
      {title: 'Swap', icon: require('@/assets/svg/swap.svg'), link: '/swap'},
      {title: 'Send', icon: require('@/assets/svg/send.svg'), link: '/send'},
      {title: 'Receive', icon: require('@/assets/svg/qr-code.svg'), link: '/receive'},
      // {title: 'Market', icon: require('@/assets/svg/currency-dollar.svg'), link: '/market'},
      {title: 'Media Player', icon: require('@/assets/svg/play-square.svg'), link: '/media-player', soon: true},
      {title: 'Claim Rewards', icon: require('@/assets/svg/infinity.svg'), link: '/claim-rewards', soon: true},
      {title: 'Referral', icon: require('@/assets/svg/users-plus.svg'), link: '/referral', soon: true},
      // { header: 'Tools' },
      // { title: 'Airdrop', icon: 'mdi-gift', link: '/airdrop', soon: true },
      // { title: 'IPFS Cache', icon: 'mdi-cube', link: '/ipfs-cache', soon: true },
      // { title: 'Snapshot', icon: 'mdi-camera-enhance', link: '/snapshot', soon: true },
      // { header: 'Documentation' },
      // { title: 'Guides', icon: 'mdi-book-open-variant', href: 'https://docs.adabox.io/'},
      // { title: 'Whitepaper', icon: 'mdi-file-certificate-outline', href: 'https://docs.adabox.io/whitepapers/forge-whitepaper'},
    ],
  }),
  computed: {
    ...mapState(useStore, ['wallets', 'loggedWallet']),
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
  },
  methods: {
    ...mapActions(useStore, ['logout']),
    submitLogout() {
      this.logout();
      this.$router.push("/welcome")
    },
    resolveIcon(icon) {
      return require('@/assets/svg/' + icon + '.svg')
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
    changeTheme() {
      this.$vuetify.theme.dark = !this.$vuetify.theme.isDark
      localStorage.setItem('theme-dark', this.$vuetify.theme.isDark)
    },
  },
  watch: {}
}
</script>
<style scoped>
.activePage {
  background: linear-gradient(45deg, #00c7f3, #00ffd1);
}

.activePageDark {
  color: black;
  background: linear-gradient(45deg, #00c7f3, #00ffd1);
}

.activePageDark .v-image {
  filter: none!important;
}

.menuItem.v-list-item--link:before {
  background: linear-gradient(45deg, #00c7f3, #00ffd1);
}
</style>
