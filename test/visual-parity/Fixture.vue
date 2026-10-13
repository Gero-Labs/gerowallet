<template>
  <v-app>
    <main class="fixture pa-6">
      <h1 data-testid="heading">Gero control parity</h1>
      <p data-testid="paragraph">Synthetic controls. No wallet, extension, or remote data.</p>
      <div class="d-flex align-center ga-6 py-4">
        <v-avatar data-testid="avatar-empty" rounded="0" size="18" />
        <v-avatar data-testid="avatar-glyph" rounded="0" size="18">
          <v-icon size="18" color="primary">mdi-send</v-icon>
        </v-avatar>
        <v-avatar data-testid="avatar-image" rounded="0" size="18">
          <v-img :src="dollarShield" alt="Buy" />
        </v-avatar>
        <v-avatar data-testid="avatar-mask" rounded="0" size="18">
          <span class="nav-mask" :style="{ maskImage: cssUrl(walletIcon), WebkitMaskImage: cssUrl(walletIcon) }" role="img" aria-label="Wallet" />
        </v-avatar>
        <v-avatar data-testid="avatar-primary" color="primary" size="32">P</v-avatar>
        <v-avatar data-testid="avatar-hex" color="#FDB022" size="32">H</v-avatar>
        <v-avatar data-testid="avatar-inline" style="background-color: #7AA7FF" size="32">I</v-avatar>
        <v-avatar data-testid="avatar-transparent" color="transparent" size="32">T</v-avatar>
        <v-avatar data-testid="avatar-elevated" variant="elevated" size="32">E</v-avatar>
      </div>
      <div data-testid="token-avatars" class="d-flex align-center ga-6 py-4">
        <v-avatar v-for="token in tokenAvatars" :key="token.size" :data-testid="`token-avatar-${token.size}`" :size="token.size">
          <img :src="token.image" :alt="`Token at ${token.size}px`" />
        </v-avatar>
        <v-avatar data-testid="token-avatar-custom" size="32">
          <img :src="cardanoIcon" alt="Explicitly smaller token" style="width: 16px; height: 16px" />
        </v-avatar>
        <v-avatar data-testid="token-avatar-cover" size="32"><v-img :src="cardanoIcon" cover alt="Native cover image" /></v-avatar>
        <v-avatar data-testid="token-avatar-contain" size="32"><v-img :src="cardanoIcon" :cover="false" alt="Native contain image" /></v-avatar>
      </div>
      <div class="d-flex align-center ga-4 py-4">
        <v-chip data-testid="chip-neutral">Neutral</v-chip>
        <v-chip data-testid="chip-primary" color="primary">New</v-chip>
        <v-chip data-testid="chip-hex" color="#FDB022">Hex</v-chip>
        <v-chip data-testid="chip-inline" style="background-color: #7AA7FF">Inline</v-chip>
        <v-chip data-testid="chip-outlined" color="primary" variant="outlined">Outlined</v-chip>
        <v-chip data-testid="chip-tonal" color="primary" variant="tonal">Tonal</v-chip>
      </div>
      <div class="d-flex align-center ga-4 py-4">
        <v-btn data-testid="icon-button" icon variant="text" aria-label="Refresh fixture" @click="clicks++">
          <v-icon>mdi-refresh</v-icon>
        </v-btn>
        <v-btn data-testid="icon-button-primary" icon variant="text" color="primary" aria-label="Favorite fixture" @click="clicks++">
          <v-icon>mdi-star</v-icon>
        </v-btn>
        <v-btn data-testid="small-icon-button" size="small" icon variant="text" aria-label="Small refresh" @click="clicks++">
          <v-icon>mdi-refresh</v-icon>
        </v-btn>
        <v-btn data-testid="sized-icon-button" size="24" icon variant="text" aria-label="Sized refresh"><v-icon>mdi-refresh</v-icon></v-btn>
        <v-btn data-testid="styled-icon-button" style="height: 22px; width: 22px" icon variant="text" aria-label="Styled refresh"><v-icon>mdi-refresh</v-icon></v-btn>
        <span role="status">{{ clicks }} clicks</span>
        <v-btn variant="text" @click="updateVuetifyTheme('Midnight')">Midnight theme</v-btn>
        <v-btn variant="text" @click="overlay = true">Open overlay</v-btn>
      </div>
      <div class="d-flex ga-4 py-4">
        <button data-testid="plain-button" type="button" @click="clicks++">Plain action</button>
        <button data-testid="disabled-plain-button" type="button" disabled>Disabled action</button>
        <button data-testid="styled-plain-button" type="button" style="background: var(--g-raised); border: 1px solid var(--g-hairline-3)">Styled action</button>
        <v-btn data-testid="filled-button" color="primary" variant="flat">Filled action</v-btn>
        <v-btn data-testid="outlined-button" color="primary" variant="outlined">Outlined action</v-btn>
      </div>
      <div class="d-flex ga-4 py-4">
        <span data-testid="caption-bold" class="text-caption font-weight-bold">Bold caption</span>
        <span data-testid="body-bold" class="text-body-2 font-weight-bold">Bold body</span>
        <span data-testid="heading-regular" class="text-h6 font-weight-regular">Regular heading</span>
        <div data-testid="spacing" class="ma-2 pa-3">Explicit spacing</div>
        <ul data-testid="list"><li>Default list inset</li></ul>
      </div>
      <v-card>
        <v-card-title data-testid="tab-header">
          <v-tabs v-model="tab" data-testid="tabs" class="v-tabs-border-bottom">
            <v-tab value="profile">Profile</v-tab>
            <v-tab value="security">Security</v-tab>
            <v-tab value="contacts">Contacts</v-tab>
          </v-tabs>
        </v-card-title>
      </v-card>
      <v-window v-model="tab">
        <v-window-item value="profile">Profile panel</v-window-item>
        <v-window-item value="security">Security panel</v-window-item>
        <v-window-item value="contacts">Contacts panel</v-window-item>
      </v-window>
      <v-tabs model-value="custom" height="32" class="mt-4">
        <v-tab data-testid="custom-tab" value="custom" style="text-transform: none; padding: 0 12px">Custom tab</v-tab>
      </v-tabs>
      <div class="d-flex ga-4 py-4">
        <v-text-field data-testid="field-default" label="Default focus" variant="outlined" hide-details />
        <v-text-field data-testid="field-explicit" label="Explicit focus" color="success" variant="outlined" hide-details />
        <v-text-field data-testid="field-error" label="Error focus" error variant="outlined" hide-details />
      </div>
      <section data-testid="focus-variants" class="d-flex flex-wrap ga-4 py-4">
        <v-text-field v-for="variant in borderlessVariants" :key="variant" :data-testid="`field-${variant}`"
          :variant="variant" :label="variant" prepend-inner-icon="mdi-magnify" rounded="lg" hide-details />
        <v-text-field data-testid="field-solo-explicit" variant="solo" color="success" label="Solo explicit" hide-details />
        <v-text-field data-testid="field-solo-error" variant="solo" error label="Solo error" hide-details />
        <v-text-field data-testid="field-filled" variant="filled" label="Filled" hide-details />
        <v-text-field data-testid="field-underlined" variant="underlined" label="Underlined" hide-details />
        <v-textarea data-testid="field-textarea" variant="outlined" label="Notes" rows="2" hide-details />
        <v-select data-testid="field-select" variant="outlined" label="Select" :items="['One', 'Two']" hide-details />
        <v-autocomplete data-testid="field-autocomplete" variant="outlined" label="Search items" :items="['One', 'Two']" hide-details />
        <input data-testid="plain-input" aria-label="Plain input" />
      </section>
      <div data-testid="numeric-otp" class="py-4">
        <NumericOtpInput v-model="pin" :error="pinError" @finish="pinFinished = true" />
        <span data-testid="pin-finished">{{ pinFinished ? 'complete' : 'incomplete' }}</span>
        <v-btn variant="text" @click="pinError = 'Synthetic validation error'">Show PIN error</v-btn>
      </div>
      <v-dialog v-model="overlay" width="320">
        <v-card>
          <v-card-title>Overlay controls</v-card-title>
          <v-card-text>
            <h2 data-testid="overlay-heading">Overlay heading</h2>
            <v-avatar data-testid="overlay-avatar" rounded="0" size="18"><v-icon size="18">mdi-send</v-icon></v-avatar>
            <v-avatar data-testid="overlay-primary" color="primary" size="32">P</v-avatar>
            <v-avatar data-testid="overlay-token-avatar" size="26"><img :src="cardanoIcon" alt="Token in dialog" /></v-avatar>
            <button data-testid="overlay-plain-button" type="button">Overlay action</button>
            <v-text-field data-testid="overlay-field-solo" variant="solo" label="Overlay search" prepend-inner-icon="mdi-magnify" hide-details />
          </v-card-text>
          <v-card-actions><v-btn variant="text" @click="overlay = false">Close overlay</v-btn></v-card-actions>
        </v-card>
      </v-dialog>
    </main>
  </v-app>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { VApp, VAutocomplete, VAvatar, VBtn, VCard, VCardActions, VCardText, VCardTitle, VChip, VDialog, VIcon, VImg, VSelect, VTab, VTabs, VTextarea, VTextField, VWindow, VWindowItem } from 'vuetify/components';
import { updateVuetifyTheme } from '@/plugins/vuetify';
import { cssUrl } from '@/shared/utils/cssUrl';
import dollarShield from '@/assets/svg/dollar-shield.svg';
import walletIcon from '@/assets/svg/wallet.svg';
import cardanoIcon from '@/assets/svg/cardano.svg';
import geroIcon from '@/assets/svg/gero-notext.svg';
import midnightIcon from '@/assets/Midnight.webp';
import NumericOtpInput from '@/shared/components/NumericOtpInput.vue';

const clicks = ref(0);
const overlay = ref(false);
const tab = ref('profile');
const pin = ref('');
const pinError = ref('');
const pinFinished = ref(false);
const borderlessVariants = ['solo', 'solo-filled', 'solo-inverted', 'plain'] as const;
const tokenAvatars = [
  { size: 26, image: cardanoIcon },
  { size: 30, image: geroIcon },
  { size: 32, image: midnightIcon },
  { size: 40, image: geroIcon },
];
</script>

<style scoped>
.fixture { background: var(--g-raised); }
.nav-mask {
  display: inline-block;
  width: 18px;
  height: 18px;
  background: var(--g-accent);
  mask-repeat: no-repeat;
  mask-position: center;
  mask-size: contain;
}
</style>
