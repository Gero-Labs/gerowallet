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
  background: transparent;
  padding: 0 var(--g-s-5);
}

/* Legal links are quiet chrome, not accents: compact tertiary GButtons in the
   tertiary text tone, through GButton's --g-btn-fg seam. Their size is the
   button tier's own. */
.footer-legal :deep(.footer-btn) {
  --g-btn-fg: var(--g-text-3);
}
</style>
