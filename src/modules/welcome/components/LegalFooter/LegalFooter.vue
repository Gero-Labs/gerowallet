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
      Change Log ({{ `v${version}` }})
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
  padding: 0 20px;
}

/* Legal links are quiet chrome, not accents. The foreground comes from
   GButton's --g-btn-fg seam (custom properties resolve on this element, so no
   specificity contest). The size needs a real rule, qualified up to 0,5,0 so it
   beats GButton's own 0,4,0 base rule deterministically rather than by
   stylesheet injection order. 11px is the ramp floor (was 10px). */
.footer-btn {
  --g-btn-fg: var(--g-text-3);
}
.v-btn.footer-btn.g-btn.g-btn--tertiary {
  font-size: 11px;
}
</style>
