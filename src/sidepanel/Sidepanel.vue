<script setup lang="ts">
import { storageDemo } from '~/logic/storage'

function openOptionsPage() {
  browser.runtime.openOptionsPage()
}
</script>

<template>
  <v-app>
    <v-main class="w-full px-4 py-5 text-center text-gray-700">
      <Logo />
      <div>Sidepanel</div>
      <SharedSubtitle />
      <v-btn>
        test
      </v-btn>

      <button class="btn mt-2" @click="openOptionsPage">
        Open Optionss
      </button>
      <div class="mt-2">
        <span class="opacity-50">Storage:</span> {{ storageDemo }}
      </div>
    </v-main>
  </v-app>
</template>
