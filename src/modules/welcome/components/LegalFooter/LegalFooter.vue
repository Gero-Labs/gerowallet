<template>
  <div class="footer-legal">
    <GButton
      tier="tertiary"
      compact
      :ripple="false"
      class="footer-btn"
      href="https://gerowallet.io/legal/privacy/"
      target="_blank"
    >
      {{ $t('navigation.privacyPolicy') }}
    </GButton>
    <v-divider vertical></v-divider>
    <GButton
      tier="tertiary"
      compact
      :ripple="false"
      class="footer-btn"
      href="https://gerowallet.io/legal/terms/"
      target="_blank"
    >
      {{ $t('navigation.termsOfService') }}
    </GButton>
    <v-divider vertical></v-divider>
    <GButton tier="tertiary" compact :ripple="false" class="footer-btn" @click="changeLogDialog = true">
      {{ $t('help.welcome.whatsNew') }} (v{{ version }})
    </GButton>

    <!-- Dialogs -->
    <ChangeLogDialog :isOpen="changeLogDialog" @close="changeLogDialog = false" :persistent="false" />
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import ChangeLogDialog from '@/options/modules/navigation/dialogs/ChangeLogDialog.vue';

const changeLogDialog = ref(false);

//@ts-ignore
const version = ref<string>(APP_VERSION);
</script>
<style lang="css" scoped>
.footer-legal {
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* The footer sits on the chain's background image, whose bright areas (Cardano's teal
     at the bottom right) left the links at under 2:1. A light canvas scrim, fading out
     by the top of the footer, keeps them readable without dimming the image. */
  background: linear-gradient(
    to top,
    color-mix(in srgb, var(--g-canvas) 55%, transparent),
    color-mix(in srgb, var(--g-canvas) 25%, transparent)
  );
  padding: 0 var(--g-s-5);
}

/* Legal links are quiet chrome, not accents: compact tertiary GButtons at caption
   size and weight, in the primary text tone so they stay readable on the image,
   through GButton's --g-btn-fg seam. */
.footer-legal :deep(.v-btn.g-btn.footer-btn) {
  --g-btn-fg: var(--g-text-1);
  font-size: 12px;
  font-weight: 400;
}
</style>
