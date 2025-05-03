<template>
  <BaseDialog
    title="Create New Wallet"
    :subtitle="network.title"
    style="opacity: 0.9"
    content-class="rounded-xxl dialogStyle darken"
    :is-open="isOpen"
    @close="dialogLocal = false"
    scrollable
    max-width="850"
    :min-height="0"
    :persistent="persistent"
  >
    <v-card-text class="px-0 py-2" style="justify-items: center;">
      <v-form ref="form" v-model="valid">
        <v-card flat class="transparent d-flex row fill-height no-gutters" style="max-width: 540px;">
          <v-card-text class="pa-0 d-flex row no-gutters">
            <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">Set up your wallet name</h2>
            <h3 class="text-left px-0 pb-3" style="font-size: 1.1em; width: 100%">Choose a name to help you identify your wallet.</h3>
            <v-text-field
              style="width: 100%"
              v-model="newWallet.name"
              dense
              filled
              label="Wallet Name"
              placeholder="e.g. My New Wallet"
              :rules="[rules.required(), rules.minCharacters(3), rules.maxCharacters(40)]"
            ></v-text-field>
            <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">Wallet Icon</h2>
            <v-radio-group v-model="newWallet.icon" style="width: 100%; display: grid;" row mandatory class="no-gutters justify-space-around mt-2 mb-2" hide-details>
              <v-radio value="green">
                <template v-slot:label>
                  <v-avatar size="32"  >
                    <v-img :src="assets.greenSvg" cover></v-img>
                  </v-avatar>
                </template>
              </v-radio>
              <v-radio value="purple">
                <template v-slot:label>
                  <v-avatar size="32" >
                    <v-img :src="assets.purpleSvg" cover></v-img>
                  </v-avatar>
                </template>
              </v-radio>
              <v-radio value="pink">
                <template v-slot:label>
                  <v-avatar size="32" >
                    <v-img :src="assets.pinkSvg" cover></v-img>
                  </v-avatar>
                </template>
              </v-radio>
              <v-radio value="orange">
                <template v-slot:label>
                  <v-avatar size="32" >
                    <v-img :src="assets.orangeSvg" cover></v-img>
                  </v-avatar>
                </template>
              </v-radio>
              <v-radio value="blue">
                <template v-slot:label>
                  <v-avatar size="32" >
                    <v-img :src="assets.blueSvg" cover></v-img>
                  </v-avatar>
                </template>
              </v-radio>
              <v-radio value="grey">
                <template v-slot:label>
                  <v-avatar size="32" >
                    <v-img :src="assets.greySvg" cover></v-img>
                  </v-avatar>
                </template>
              </v-radio>
            </v-radio-group>
            <h2 class="text-left px-0 pt-0 pb-1 white--text" style="width: 100%">Set up your spending password</h2>
            <h3 class="text-left px-0 pb-3" style="font-size: 1.1em; width: 100%">You'll use this to log into your wallet and make transactions.</h3>
            <v-text-field
              style="width: 100%"
              block
              dense
              v-model="newWallet.password"
              filled
              label="Spending Password"
              :type="show1 ? 'text' : 'password'"
              :rules="[rules.required(), rules.spaceNotAllowed, rules.minCharacters(10), rules.oneOrMoreNumbers, rules.containCapital, rules.containLowerCase,rules.containSpecialCharacter]"
            >
              <template v-slot:append>
                <v-icon @click="show1 = !show1" tabindex="-1">
                  {{show1 ? 'mdi-eye' : 'mdi-eye-off'}}
                </v-icon>
              </template>
            </v-text-field>
            <v-text-field
              style="width: 100%"
              dense
              v-model="newWallet.confirmPassword"
              filled
              label="Confirm Password"
              :type="show2 ? 'text' : 'password'"
              :rules="[rules.required(), (newWallet.password === newWallet.confirmPassword) || 'Password must match']"
            >
              <template v-slot:append>
                <v-icon @click="show2 = !show2" tabindex="-1">
                  {{show2 ? 'mdi-eye' : 'mdi-eye-off'}}
                </v-icon>
              </template>
            </v-text-field>
            <v-checkbox
              style="width: 100%"
              class="mt-0 text-left"
              hide-details
              v-model="newWallet.recoverPasswordChecked"
              label="I understand that GeroWallet cannot recover this password for me."
              :rules="[(newWallet.recoverPasswordChecked)]"
            ></v-checkbox>
            <v-checkbox
              style="width: 100%"
              class="mt-0 mb-2"
              hide-details
              v-model="newWallet.termsChecked"
              :rules="[(newWallet.termsChecked)]"
            >
              <template v-slot:label>
                <div>
                  I have read and agree to the
                  <a @click.stop href="https://www.gerowallet.io/_files/ugd/79567a_718ec62866234a2689831a9e5c632725.pdf?index=true" target="_blank">Terms of Service</a>.
                </div>
              </template>
            </v-checkbox>
          </v-card-text>
        </v-card>
      </v-form>
    </v-card-text>
    <v-card-actions class="pa-0 align-self-center" style="width: 100%; justify-content: center;">
      <v-btn
        style="color: black!important;"
        class="geroButton"
        color="primary"
        @click="walletCreationStep"
        elevation="0"
        :disabled="isDisabled"
        :loading="creatingWalletLoader"
      >
        CREATE WALLET
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>
<script>
import rules from "@/utils/rules";
import {Theme} from "@/models/types"
import db from "@/db";
import { useStore } from "@/stores";
import { mapActions, mapState } from 'pinia';
import assets from '@/utils/assets';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';

export default {
  name: "CreateWallet",
  components: { BaseDialog },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
    persistent: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    ...mapState(useStore, ['network']),
    isDisabled() {
      return !this.valid || this.creatingWalletLoader
    },
    dialogLocal: {
      get() {
        return this.dialog
      },
      set(value) {
        if (!value) {
          this.$emit('close')
          this.resetDialog()
        }
      },
    },
  },
  methods: {
    ...mapActions(useStore, ['login']),
    async walletCreationStep() {
      this.creatingWalletLoader = true
      const walletId = await db.createNewWallet(this.newWallet.name, this.newWallet.icon, Theme.GERO, null, this.newWallet.password, this.network.blockchain, this.network.network)
      this.dialogLocal = false
      this.resetDialog()
      await this.login(walletId)
      await this.$router.push('/')
    },
    resetDialog() {
      this.newWallet = {
        name: '',
        password: '',
        confirmPassword: '',
        termsChecked: false,
        recoverPasswordChecked: false,
      }
      this.valid = false
      this.creatingWalletLoader = false
      console.log('resetDialog')
      this.$nextTick(() => {
        this.$refs.form.resetValidation()
      })
    }
  },
  data: () => ({
    rules,
    db,
    show1: false,
    show2: false,
    newWallet: {
      name: '',
      icon: '',
      password: '',
      confirmPassword: '',
      termsChecked: false,
      recoverPasswordChecked: false,
    },
    valid: false,
    creatingWalletLoader: false,
    assets,
  }),
}
</script>
<style scoped>
.v-dialog__content--active {
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}
</style>
