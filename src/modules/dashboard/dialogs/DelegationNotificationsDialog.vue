<template>
  <v-dialog v-model="dialog" max-width="700" scrollable>
    <v-card class="liquid-glass">
      <v-card-title class="d-flex align-center justify-space-between">
        <span>Delegation Notifications</span>
        <v-btn icon small @click="close">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-divider></v-divider>

      <v-card-text style="max-height: 600px;" class="pa-0">
        <!-- Empty State -->
        <div v-if="allNotifications.length === 0" class="empty-state py-12 text-center">
          <v-icon size="64" color="rgba(255, 255, 255, 0.3)">mdi-bell-outline</v-icon>
          <div class="text-h6 mt-4" style="color: rgba(255, 255, 255, 0.5)">No notifications</div>
          <div class="text-caption" style="color: rgba(255, 255, 255, 0.3)">
            You'll receive notifications when someone requests DUST delegation
          </div>
        </div>

        <!-- Notifications List -->
        <div v-else class="notifications-list">
          <div
            v-for="notification in allNotifications"
            :key="notification.id"
            class="notification-item"
            :class="{
              'notification-pending': notification.status === 'PENDING',
              'notification-read': notification.status !== 'PENDING'
            }"
          >
            <!-- Status Badge -->
            <div class="notification-header">
              <div class="d-flex align-center">
                <v-chip
                  small
                  :color="getStatusColor(notification.status)"
                  class="status-chip mr-2"
                >
                  {{ getStatusLabel(notification.status) }}
                </v-chip>
                <span class="text-caption" style="color: rgba(255, 255, 255, 0.5)">
                  {{ formatTimeAgo(notification.createdAt) }}
                </span>
              </div>
            </div>

            <!-- Notification Content -->
            <div class="notification-content mt-2">
              <div class="mb-2">
                <div class="text-caption" style="color: rgba(255, 255, 255, 0.5)">From</div>
                <div class="font-weight-bold">{{ notification.requesterName || 'Anonymous' }}</div>
                <div class="text-caption font-monospace">{{ truncateAddress(notification.requesterAddress) }}</div>
              </div>

              <div v-if="notification.message" class="mb-2">
                <div class="text-caption" style="color: rgba(255, 255, 255, 0.5)">Message</div>
                <div class="message-preview">{{ notification.message }}</div>
              </div>

              <div class="mb-2">
                <div class="text-caption" style="color: rgba(255, 255, 255, 0.5)">Estimated Fee</div>
                <div class="font-weight-bold">{{ formatDust(notification.estimatedFee) }} DUST</div>
              </div>

              <!-- Transaction Hash (if approved) -->
              <div v-if="notification.txHash" class="mb-2">
                <div class="text-caption" style="color: rgba(255, 255, 255, 0.5)">Transaction</div>
                <div class="font-monospace text-caption">{{ truncateHash(notification.txHash) }}</div>
              </div>

              <!-- Error Message (if rejected with error) -->
              <div v-if="notification.txError" class="mb-2">
                <v-alert type="error" dense text class="mb-0">
                  {{ notification.txError }}
                </v-alert>
              </div>
            </div>

            <!-- Actions (only for PENDING) -->
            <div v-if="notification.status === 'PENDING'" class="notification-actions mt-3">
              <v-btn
                small
                outlined
                color="error"
                @click="decline(notification)"
                :disabled="actionLoading === notification.id"
              >
                <v-icon small left>mdi-close</v-icon>
                Decline
              </v-btn>
              <v-btn
                small
                color="primary"
                @click="approve(notification)"
                :loading="actionLoading === notification.id"
                :disabled="actionLoading && actionLoading !== notification.id"
              >
                <v-icon small left>mdi-check</v-icon>
                Approve
              </v-btn>
            </div>

            <!-- Dismiss button (for non-pending or after action) -->
            <div v-else class="notification-actions mt-3">
              <v-btn
                x-small
                text
                @click="dismiss(notification)"
                style="opacity: 0.6;"
              >
                <v-icon x-small left>mdi-eye-off</v-icon>
                Dismiss
              </v-btn>
            </div>
          </div>
        </div>
      </v-card-text>

      <v-divider></v-divider>

      <v-card-actions class="px-4 py-3">
        <v-spacer></v-spacer>
        <v-btn text @click="close">Close</v-btn>
      </v-card-actions>
    </v-card>

    <!-- Approve Delegation Dialog (reuse existing) -->
    <ApproveDelegationDialog
      v-model="approveDialogOpen"
      :request="selectedNotification"
      @approved="handleApproved"
    />
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import delegationStore, { updateDelegationRequestStatus } from '@/stores/delegationStore';
import { DelegationRequest, DelegationRequestStatus } from '@/models/delegation-types';
import ApproveDelegationDialog from './ApproveDelegationDialog.vue';

interface Props {
  value: boolean;
}

interface Emits {
  (e: 'input', value: boolean): void;
}

const props = withDefaults(defineProps<Props>(), {
  value: false
});
const emit = defineEmits<Emits>();

const dialog = computed({
  get: () => props.value,
  set: (value) => emit('input', value),
});

// State
const actionLoading = ref<string | null>(null);
const approveDialogOpen = ref(false);
const selectedNotification = ref<DelegationRequest | null>(null);

// Computed
const allNotifications = computed(() => {
  // Return all incoming requests, sorted by timestamp (newest first)
  return [...delegationStore.incomingRequests].sort((a, b) => b.createdAt - a.createdAt);
});

// Methods
function getStatusColor(status: string): string {
  switch (status) {
    case DelegationRequestStatus.PENDING:
      return 'warning';
    case DelegationRequestStatus.APPROVED:
      return 'success';
    case DelegationRequestStatus.REJECTED:
      return 'error';
    case DelegationRequestStatus.EXPIRED:
      return 'grey';
    default:
      return 'grey';
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case DelegationRequestStatus.PENDING:
      return 'Pending';
    case DelegationRequestStatus.APPROVED:
      return 'Approved';
    case DelegationRequestStatus.REJECTED:
      return 'Declined';
    case DelegationRequestStatus.EXPIRED:
      return 'Expired';
    case DelegationRequestStatus.DISMISSED:
      return 'Dismissed';
    default:
      return status;
  }
}

function formatDust(dust: string): string {
  const value = parseInt(dust) / 1e12;
  return value.toFixed(6);
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
}

function truncateAddress(address: string): string {
  if (!address || address.length < 20) return address;
  return `${address.slice(0, 15)}...${address.slice(-10)}`;
}

function truncateHash(hash: string): string {
  if (!hash) return '';
  return `${hash.slice(0, 12)}...${hash.slice(-8)}`;
}

function approve(notification: DelegationRequest) {
  selectedNotification.value = notification;
  approveDialogOpen.value = true;
}

async function decline(notification: DelegationRequest) {
  actionLoading.value = notification.id;
  try {
    console.log('❌ Declining delegation request:', notification.id);

    // Update status to REJECTED
    await updateDelegationRequestStatus(notification.id, DelegationRequestStatus.REJECTED);

    console.log('✅ Request declined');
  } catch (err) {
    console.error('Failed to decline request:', err);
  } finally {
    actionLoading.value = null;
  }
}

async function dismiss(notification: DelegationRequest) {
  try {
    console.log('🗑️ Dismissing notification:', notification.id);

    // Mark as dismissed (keeps in history but removes from active notifications)
    await updateDelegationRequestStatus(notification.id, DelegationRequestStatus.DISMISSED, {
      dismissedAt: Date.now(),
    });

    console.log('✅ Notification dismissed');
  } catch (err) {
    console.error('Failed to dismiss notification:', err);
  }
}

function handleApproved(requestId: string, txHash: string) {
  console.log('✅ Delegation approved:', requestId, txHash);
  approveDialogOpen.value = false;
  selectedNotification.value = null;
}

function close() {
  dialog.value = false;
}
</script>

<style scoped lang="scss">
.liquid-glass {
  background: linear-gradient(135deg, rgba(19, 22, 27, 0.95) 0%, rgba(19, 22, 27, 0.85) 100%) !important;
  backdrop-filter: blur(20px) saturate(1.5) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.5) !important;
  border: 1px solid rgba(45, 240, 247, 0.2) !important;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
}

.notifications-list {
  padding: 16px;
}

.notification-item {
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: all 0.3s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.05);
    border-color: rgba(45, 240, 247, 0.3);
  }

  &:last-child {
    margin-bottom: 0;
  }
}

.notification-pending {
  border-left: 3px solid rgba(255, 193, 7, 0.7);
  background: rgba(255, 193, 7, 0.05);
}

.notification-read {
  opacity: 0.8;
}

.notification-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.status-chip {
  font-size: 10px;
  height: 22px;
  font-weight: 600;
}

.notification-content {
  color: rgba(255, 255, 255, 0.9);
}

.font-monospace {
  font-family: 'Courier New', monospace;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.message-preview {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 8px 12px;
  border-left: 3px solid rgba(45, 240, 247, 0.5);
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.8);
  max-height: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.notification-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
</style>
