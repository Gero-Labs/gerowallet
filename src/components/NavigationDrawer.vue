<template>
  <v-navigation-drawer
    v-model="drawer"
    width="220"
    height="100vh"
    style="min-width: 210px; min-height: 100%"
    permanent
    floating
  >
    <template v-slot:prepend>
      <v-list-item class="text-center">
        <v-list-item-content class="py-2">
          <v-list-item-title>
            <img
                :src="require('@/assets/gero_dashboards.png')" width="100" alt="logo"
                style="-webkit-filter: drop-shadow(-8px 3px 6px #B71C1C2D);
              filter: drop-shadow(-8px 3px 6px #B71C1C2D);"
            />
          </v-list-item-title>
        </v-list-item-content>
      </v-list-item>
    </template>
    <v-list v-if="account" class="ma-2" dense rounded style="border: 1px solid #0000001f; border-radius: 12px!important; background-color: rgba(0,0,0,0.1)">
      <v-list-item three-line class="px-0">
        <v-list-item-avatar size="60">
          <v-dialog v-model="changeAvatarDialog" scrollable width="720">
            <template v-slot:activator="{ on, attrs }">
              <v-hover>
                <template v-slot:default="{ hover }">
                  <v-btn fab elevation="0" v-bind="attrs" v-on="on">
                    <v-img :src="avatar" width="60" contain></v-img>
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
                            <v-img :src="avatar.image | toIPFS" alt="" contain onerror="this.onerror=null; this.src='https://d1zjrpdfxjmowk.cloudfront.net/assets/images/1x1.webp';" aspect-ratio="1">
                              <template v-slot:placeholder>
                                <v-sheet>
                                  <v-skeleton-loader class="mx-auto" type="image"> </v-skeleton-loader>
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
                            <v-card-title class="text-center justify-center pt-0 px-0 pb-1" style="word-break: break-word; font-size: 12px">
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
                <v-btn color="primary" elevation="0" @click="selectAvatar" :loading="loading" :disabled="loading || selectedAvatar === undefined">Save</v-btn>
              </v-card-actions>
            </v-card>
          </v-dialog>
        </v-list-item-avatar>
        <v-list-item-content style="align-self: initial">
          <v-list-item-title class="mb-0">
            <strong>{{ account.user.username }}</strong>
          </v-list-item-title>
          <v-list-item-subtitle class="mb-0" style="font-size: 12px; font-weight: 700">
            Connected With
            <v-avatar tile size="12" style="margin-bottom: 4px;">
              <img :src="this.$vuetify.theme.isDark ? account.wallet.icon : account.wallet.dark" :alt="account.wallet.name" />
            </v-avatar>
          </v-list-item-subtitle>
          <v-list-item-subtitle class="mb-0" style="font-size: 10px; font-weight: 700">
            {{ balance.coin | toAda }}<br>
            {{ account.wallet.balance.forge }} $FORGE
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
      <v-list-item link style="background: #b71c1c; color: white; min-height: 20px" @click="logout">
        <v-list-item-content>
          <v-list-item-title class="text-center">
            <v-icon small color="white">
              mdi-logout-variant
            </v-icon>
            &nbsp;&nbsp;Logout
          </v-list-item-title>
        </v-list-item-content>
      </v-list-item>
    </v-list>
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
          <v-list-item-icon>
            <v-icon>{{ item.icon }}</v-icon>
          </v-list-item-icon>

          <v-list-item-content>
            <v-list-item-title style="font-weight: 800">
              {{ item.title }}
              <v-chip
                v-if="item.soon"
                class="ma-2"
                color="primary"
                x-small
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
          <v-list-item-icon>
            <v-icon>{{ item.icon }}</v-icon>
          </v-list-item-icon>

          <v-list-item-content>
            <v-list-item-title style="font-weight: 800">
              {{ item.title }}
              <v-chip
                v-if="item.soon"
                class="ma-2"
                color="primary"
                x-small
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
      <v-list-item style="min-height: 30px">
        <v-list-item-content class="pa-0">
          <v-list-item-title class="text-center" style="font-size: 18px">
            <v-btn
              icon
              class="ml-2 mr-1"
              height="32" width="32"
              @click="changeTheme"
            >
              <v-icon
                v-if="$vuetify.theme.isDark"
              >
                mdi-weather-sunny
              </v-icon>
              <v-icon
                v-else
              >
                mdi-weather-night
              </v-icon>
            </v-btn>
          </v-list-item-title>
        </v-list-item-content>
      </v-list-item>
      <v-list dense rounded>
        <v-list-item style="min-height: 30px">
          <v-list-item-content class="pa-0">
            <v-list-item-title class="text-center" style="font-size: 18px">
              <strong><a href="https://adabox.io" target="_blank"><img src="https://d1zjrpdfxjmowk.cloudfront.net/assets/images/logo.webp" width="14" alt="logo" />&nbsp;adabox.io</a></strong>&nbsp;© {{ new Date().getFullYear() }}
            </v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <v-list-item style="min-height: 30px">
          <v-list-item-content class="pa-0">
            <v-list-item-title class="text-center" style="font-size: 18px">
              <v-btn icon small href="https://twitter.com/AdaBoxIO" target="_blank">
                <v-icon small>
                  mdi-twitter
                </v-icon>
              </v-btn>
              <v-btn icon small href="https://discord.gg/tUDmxUhgZ9" target="_blank">
                <v-icon small>
                  mdi-discord
                </v-icon>
              </v-btn>
              <v-btn icon small href="https://github.com/adabox-aio" target="_blank">
                <v-icon small>
                  mdi-github
                </v-icon>
              </v-btn>
            </v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <v-list-item style="min-height: 20px">
          <v-list-item-content class="pa-0">
            <v-list-item-title class="text-center" style="font-size: 11px">
              <a href="/tos">Terms of Service</a> &nbsp;•&nbsp; <a href="/privacy">Privacy Policy</a>
            </v-list-item-title>
          </v-list-item-content>
        </v-list-item>
      </v-list>
    </template>
  </v-navigation-drawer>
</template>

<script>
import filters from '@/utils/filters'
import api from '@/api/api'

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
      { title: 'Dashboard', icon: 'mdi-chart-bar', link: '/' },
      { title: 'Assets', icon: 'mdi-archive-outline', link: '/assets' },
      { title: 'Market', icon: 'mdi-currency-usd', link: '/market' },
      { title: 'Staking', icon: 'mdi-hand-coin-outline', link: '/staking' },
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
    avatar() {
      if (this.account.user.image_url.includes('http')) {
        return this.account.user.image_url
      } else {
        return filters.toIPFS(this.account.user.image_url)
      }
    },
    account() {
      return this.$store.getters.getAccount
    },
  },
  methods: {
    async selectAvatar() {
      if (this.avatars && this.avatars.length > 0 && this.selectedAvatar && this.avatars[this.selectedAvatar]) {
        this.loading = true
        await this.$recaptchaLoaded()
        let token = await this.$recaptcha('profilePic')
        try {
          const response = await api.updateProfilePic(token, this.avatars[this.selectedAvatar].image, this.account.user.id)
          console.log(response)
          if (response.status === 200) {
            await this.$store.dispatch('changeProfilePic', {cid: response.data})
            this.changeAvatarDialog = false
            this.$emit('snackbarChange', { text: 'Avatar Changed Successfully!', color: 'success' })
          }
        } catch (e) {
          console.log(e)
        }
        this.loading = false
      }
    },
    async getAvatars() {
      const vm = this
      this.avatars = []
      const subDomain = this.network === 'mainnet' ? 'api' : 'preview'
      await this.assets.forEach(asset => {
        fetch(`https://${subDomain}.koios.rest/api/v0/asset_info?_asset_policy=${asset.policyId}&_asset_name=${asset.assetName}`).then(async response => {
          const res = await response.text()
          const assetJs = JSON.parse(res)
          if (assetJs.length > 0) {
            const assetNameAscii = assetJs[0]['asset_name_ascii']
            const mintingTxMetadata = assetJs[0]['minting_tx_metadata']
            const tokenRegistryMetadata = assetJs[0]['token_registry_metadata']
            if (mintingTxMetadata != null && mintingTxMetadata['721'] != null && mintingTxMetadata['721'][asset.policyId] &&
                mintingTxMetadata['721'][asset.policyId][assetNameAscii] != null && mintingTxMetadata['721'][asset.policyId][assetNameAscii]['image'] != null) {
              const image = mintingTxMetadata['721'][asset.policyId][assetNameAscii]['image']
              if (image) {
                vm.avatars.push({policyId: asset.policyId, assetName: assetNameAscii, image: image.replace('ipfs://', '')})
              }
            } else if (tokenRegistryMetadata != null) {
              // console.log("token://" + tokenRegistryMetadata['logo'])
            }
          }
        }).catch(error => {
          console.log(error)
        })
      })
    },
    closeChangeAvatarDialog() {
      this.changeAvatarDialog = false
    },
    async logout() {
      await this.$recaptchaLoaded()
      const token = await this.$recaptcha('logout')
      await api.logout(token)
      this.$store.dispatch('logout').then(() => {
        this.$router.push('/login')
      })
    },
    changeTheme() {
      this.$vuetify.theme.dark = !this.$vuetify.theme.isDark
      localStorage.setItem('theme-dark', this.$vuetify.theme.isDark)
    },
  },
  watch: {
    '$store.getters.getAccount.wallet': {
      async handler(val) {
        if (val && (this.balance !== val.balance || this.network !== val.network)) {
          if (this.balance !== val.balance) {
            this.balance = val.balance
            this.avatarsLoading = true
          }
          if (this.network !== val.network) {
            this.network = val.network
            this.selectedAvatar = undefined
            this.avatarsLoading = true
          }
          if (this.balance && this.balance.assets && this.balance.assets instanceof Map) {
            const assets = []
            this.balance.assets.forEach((value, key) => {
              if (value && value instanceof Map) {
                value.forEach((v, k) => {
                  const asset = {policyId: key, assetName: k}
                  assets.push(asset)
                })
              }
            })
            this.assets = assets
          }
          await this.getAvatars()
          this.avatarsLoading = false
        }
      },
      deep: true
    },
  }
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
.menuItem.v-list-item--link:before {
  background: linear-gradient(45deg, #00c7f3, #00ffd1);
}
</style>
