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
     at the bottom right) left the links at under 2:1. A canvas scrim rising from the
     bottom edge keeps them readable on every chain's image. */
  background: linear-gradient(
    to top,
    color-mix(in srgb, var(--g-canvas) 88%, transparent),
    color-mix(in srgb, var(--g-canvas) 70%, transparent)
  );
  padding: 0 var(--g-s-5);
}

/* Legal links are quiet chrome, not accents: compact tertiary GButtons in the
   secondary text tone (the tertiary tone is for solid surfaces), through GButton's
   --g-btn-fg seam. Their size is the button tier's own. */
.footer-legal :deep(.footer-btn) {
  --g-btn-fg: var(--g-text-2);
}
</style>
