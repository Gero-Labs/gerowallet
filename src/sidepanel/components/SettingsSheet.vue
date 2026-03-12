<template>
  <div class="settings-sheet">
    <v-list dark dense class="transparent">
      <v-list-item @click="openFullSettings">
        <v-list-item-icon><v-icon color="#888">mdi-cog</v-icon></v-list-item-icon>
        <v-list-item-content>
          <v-list-item-title class="white--text">{{ $t('miniGero.allSettings') }}</v-list-item-title>
          <v-list-item-subtitle class="grey--text">{{ $t('miniGero.openFullDashboard') }}</v-list-item-subtitle>
        </v-list-item-content>
        <v-list-item-action><v-icon color="#888" size="18">mdi-open-in-new</v-icon></v-list-item-action>
      </v-list-item>

      <v-divider dark class="my-2" />

      <v-list-item @click="lockWallet">
        <v-list-item-icon><v-icon color="#888">mdi-lock-outline</v-icon></v-list-item-icon>
        <v-list-item-content>
          <v-list-item-title class="white--text">{{ $t('miniGero.lockWallet') }}</v-list-item-title>
        </v-list-item-content>
        <v-list-item-action>
          <v-icon color="#888">mdi-lock</v-icon>
        </v-list-item-action>
      </v-list-item>
    </v-list>
  </div>
</template>

<script setup lang="ts">
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';

const emit = defineEmits<{ (e: 'close'): void }>();

function openFullSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  emit('close');
}

async function lockWallet() {
  await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.LOCK,
    data: {},
  });
  emit('close');
}
</script>

<style scoped>
.settings-sheet {
  padding: 0;
}
</style>
