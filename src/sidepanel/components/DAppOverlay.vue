<template>
  <BottomSheet
    :value="isVisible"
    :persistent="true"
    :show-handle="false"
    height="85%"
  >
    <div v-if="currentRequest" class="dapp-overlay">
      <!-- Queue indicator -->
      <div v-if="requestQueue.length > 0" class="queue-indicator mb-2">
        <span class="grey--text text-caption">
          Request 1 of {{ requestQueue.length + 1 }}
        </span>
      </div>

      <!-- DApp Connect -->
      <div v-if="currentRequest.method === 'enable'" class="dapp-connect">
        <v-icon size="48" color="#00c7f3" class="mb-3">mdi-link-variant</v-icon>
        <h3 class="white--text text-h6 mb-1">{{ $t('miniGero.connectRequest') }}</h3>
        <p class="grey--text text-body-2 mb-4">{{ currentRequest.payload?.website }}</p>
        <div class="action-buttons">
          <v-btn outlined rounded dark @click="reject()">{{ $t('miniGero.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed @click="approve({ approved: true })">
            {{ $t('miniGero.approve') }}
          </v-btn>
        </div>
      </div>

      <!-- Sign Data -->
      <div v-else-if="currentRequest.method === 'signData'" class="dapp-sign">
        <v-icon size="48" color="#FDA29B" class="mb-3">mdi-file-sign</v-icon>
        <h3 class="white--text text-h6 mb-1">{{ $t('miniGero.signDataRequest') }}</h3>
        <p class="grey--text text-body-2 mb-4">{{ currentRequest.payload?.website }}</p>
        <div class="message-preview pa-3 mb-4">
          <p class="white--text text-caption" style="word-break: break-all;">
            {{ currentRequest.payload?.message || currentRequest.payload?.payload }}
          </p>
        </div>
        <div class="action-buttons">
          <v-btn outlined rounded dark @click="reject()">{{ $t('miniGero.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed @click="handleSign">
            {{ $t('miniGero.sign') }}
          </v-btn>
        </div>
      </div>

      <!-- Sign Transaction -->
      <div v-else-if="currentRequest.method === 'signTx'" class="dapp-sign-tx">
        <v-icon size="48" color="#FFF59E" class="mb-3">mdi-file-document-edit-outline</v-icon>
        <h3 class="white--text text-h6 mb-1">{{ $t('miniGero.signTxRequest') }}</h3>
        <p class="grey--text text-body-2 mb-4">{{ currentRequest.payload?.website }}</p>
        <!-- Transaction details will be expanded by the Flows teammate -->
        <div class="action-buttons">
          <v-btn outlined rounded dark @click="reject()">{{ $t('miniGero.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed @click="handleSignTx">
            {{ $t('miniGero.sign') }}
          </v-btn>
        </div>
      </div>
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { useDAppOverlay } from '../composables/useDAppOverlay';
import BottomSheet from './BottomSheet.vue';

const { isVisible, currentRequest, requestQueue, approve, reject } = useDAppOverlay();

async function handleSign() {
  // Signing logic will be implemented by the Flows teammate
  approve({ signed: true });
}

async function handleSignTx() {
  // Transaction signing logic will be implemented by the Flows teammate
  approve({ signed: true });
}
</script>

<style scoped>
.dapp-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px;
}

.queue-indicator {
  text-align: center;
}

.message-preview {
  background: #111;
  border-radius: 8px;
  max-height: 120px;
  overflow-y: auto;
  width: 100%;
}

.action-buttons {
  display: flex;
  gap: 12px;
  width: 100%;
  justify-content: center;
  margin-top: 16px;
}

.action-buttons .v-btn {
  flex: 1;
  max-width: 160px;
}
</style>
