<template>
  <v-tab-item>
    <v-card flat class="transparent">
      <v-card-text class="px-0">
        <v-data-table
          class="transparent"
          :items="connectedDapps"
          :headers="headers"
          hide-default-footer
          disable-pagination
          :header-props="{ 'sort-icon': 'mdi-menu-up' }"
        >
          <template v-slot:[`item.domain`]="{ item }">
            <v-avatar size="16">
              <v-img :src="`https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${item.domain}&size=16`" contain></v-img>
            </v-avatar>&nbsp;
            {{item.domain}}
          </template>
          <template v-slot:[`item.actions`]="{ item }">
            <v-btn small icon @click="confirmRemove(item)">
              <v-icon small color="red">
                mdi-trash-can
              </v-icon>
            </v-btn>
          </template>
        </v-data-table>
      </v-card-text>
    </v-card>

    <!-- WalletConnect Sessions -->
    <v-card flat class="transparent mt-4">
      <v-card-title class="px-0 py-2 d-flex align-center">
        <v-icon left small color="primary">mdi-link-variant</v-icon>
        <span style="font-size: 14px;">{{ $t('walletConnect.sessions') }}</span>
        <v-spacer />
        <v-btn small text color="primary" @click="showPairDialog = true">
          <v-icon small left>mdi-plus</v-icon>
          {{ $t('walletConnect.connectViaWalletConnect') }}
        </v-btn>
      </v-card-title>
      <v-card-text class="px-0">
        <div v-if="wcSessions.length === 0" class="text-center grey--text py-4">
          {{ $t('walletConnect.noActiveSessions') }}
        </div>
        <v-list v-else dense class="transparent">
          <v-list-item v-for="session in wcSessions" :key="session.topic" class="px-0">
            <v-list-item-avatar size="24">
              <v-img v-if="session.peerMeta.icons[0]" :src="session.peerMeta.icons[0]" contain />
              <v-icon v-else size="24">mdi-link-variant</v-icon>
            </v-list-item-avatar>
            <v-list-item-content>
              <v-list-item-title>{{ session.peerMeta.name }}</v-list-item-title>
              <v-list-item-subtitle>{{ session.peerMeta.url }}</v-list-item-subtitle>
            </v-list-item-content>
            <v-list-item-action>
              <v-btn small icon @click="confirmWcDisconnect(session)">
                <v-icon small color="red">mdi-link-variant-off</v-icon>
              </v-btn>
            </v-list-item-action>
          </v-list-item>
        </v-list>
      </v-card-text>
    </v-card>

    <!-- Remove DApp dialog -->
    <v-dialog
      v-model="confirmRemoveDialog"
      persistent
      max-width="400"
    >
      <v-card>
        <v-card-title>
          {{ $t('settings.removeDappAccess') }}
        </v-card-title>
        <v-card-text v-if="itemToDelete">{{ $t('settings.removeDappConfirm', { domain: itemToDelete.domain }) }}</v-card-text>
        <v-card-actions>
          <v-spacer></v-spacer>
          <v-btn
            text
            @click="confirmRemoveDialog = false"
          >
            {{ $t('common.no') }}
          </v-btn>
          <v-btn
            color="primary"
            text
            @click="remove"
          >
            {{ $t('common.yes') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- WC Disconnect dialog -->
    <v-dialog
      v-model="confirmWcDialog"
      persistent
      max-width="400"
    >
      <v-card>
        <v-card-title>{{ $t('walletConnect.disconnect') }}</v-card-title>
        <v-card-text v-if="wcSessionToDisconnect">
          {{ $t('walletConnect.disconnectConfirm', { name: wcSessionToDisconnect.peerMeta.name }) }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn text @click="confirmWcDialog = false">{{ $t('common.no') }}</v-btn>
          <v-btn color="primary" text @click="wcDisconnect">{{ $t('common.yes') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- WalletConnect Pair Dialog -->
    <WalletConnectPairDialog v-model="showPairDialog" @paired="onPaired" />
  </v-tab-item>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, toRefs } from 'vue';
import WalletStore, { walletStore } from '@/stores/walletStore';
import { walletConnectState } from '@/stores/walletConnectStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import WalletConnectPairDialog from '@/modules/walletconnect/dialogs/WalletConnectPairDialog.vue';
import type { WCSession } from '@/services/walletConnect/types';

const { t } = useTranslation();

const { loggedWallet, connectedDapps } = toRefs(walletStore);
const wcSessions = toRefs(walletConnectState).activeSessions;

// Reactive data
const confirmRemoveDialog = ref(false);
const itemToDelete = ref<any>(undefined);
const showPairDialog = ref(false);
const confirmWcDialog = ref(false);
const wcSessionToDisconnect = ref<WCSession | null>(null);

const headers = ref([
  { text: t('settings.domain'), align: "start", sortable: true, value: "domain", width: '99%'},
  { text: "", align: "start", sortable: false, value: "actions" },
]);

// DApp methods
const confirmRemove = (item: any) => {
  itemToDelete.value = item;
  confirmRemoveDialog.value = true;
};

const remove = () => {
  WalletStore.disconnectDapp(loggedWallet.value.id, itemToDelete.value.id);
  itemToDelete.value = undefined;
  confirmRemoveDialog.value = false;
};

// WC methods
const confirmWcDisconnect = (session: WCSession) => {
  wcSessionToDisconnect.value = session;
  confirmWcDialog.value = true;
};

const wcDisconnect = async () => {
  if (!wcSessionToDisconnect.value) return;
  try {
    await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.WC_DISCONNECT_SESSION,
      data: { topic: wcSessionToDisconnect.value.topic },
    });
  } catch (e) {
    console.warn('Failed to disconnect WC session:', e);
  }
  wcSessionToDisconnect.value = null;
  confirmWcDialog.value = false;
};

const onPaired = () => {
  // Pairing successful — session proposal will appear as a popup
};
</script>

<style scoped>

.title {
  font-size: 18px;
  font-weight: 600;
  line-height: 28px;
  text-align: left;
}

.subtitle {
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  text-align: left;
  color: #94969C;
}

</style>
