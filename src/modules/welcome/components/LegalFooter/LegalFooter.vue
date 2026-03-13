<template>
  <div class="footer-legal">
    <GButton
      color="white"
      text
      :ripple="false"
      class="footer-btn"
      href="https://gerowallet.io/legal/privacy/"
      target="_blank"
    >
      {{ $t('navigation.privacyPolicy') }}
    </GButton>
    <v-divider vertical></v-divider>
    <GButton
      color="white"
      text
      :ripple="false"
      class="footer-btn"
      href="https://gerowallet.io/legal/terms/"
      target="_blank"
    >
      {{ $t('navigation.termsOfService') }}
    </GButton>
    <v-divider vertical></v-divider>
    <GButton color="white" text :ripple="false" class="footer-btn" @click="changeLogDialog = true">
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

.footer-btn {
  text-transform: none;
  font-size: 10px;
  color: #ffffff;
}
</style>
