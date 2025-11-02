<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { storageDemo } from '~/logic/storage'

function openOptionsPage() {
  browser.runtime.openOptionsPage()
}
</script>

<template>
  <v-app>
    <v-main>
      <Logo />
      <div>Popup</div>
      <SharedSubtitle />

      <button class="btn mt-2" @click="openOptionsPage">
        Open Options
      </button>
      <div class="mt-2">
        <span class="opacity-50">Storage:</span> {{ storageDemo }}
      </div>
    </v-main>
  </v-app>
</template>
