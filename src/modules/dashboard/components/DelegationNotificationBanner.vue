<template>
  <transition name="slide-down">
    <div v-if="hasActiveRequests" class="delegation-notification-banner">
      <div class="banner-content">
        <div class="banner-icon">
          <v-icon color="primary" size="24">mdi-hand-coin-outline</v-icon>
        </div>

        <div class="banner-text">
          <div class="banner-title">
            {{ bannerTitle }}
          </div>
          <div class="banner-subtitle">
            {{ bannerSubtitle }}
          </div>
        </div>

        <div class="banner-actions">
          <v-btn
            small
            outlined
            color="primary"
            @click="viewRequests"
            class="view-btn"
          >
            View {{ delegationStore.unreadCount > 1 ? 'Requests' : 'Request' }}
          </v-btn>
          <v-btn
            icon
            small
            @click="dismissBanner"
            class="dismiss-btn"
          >
            <v-icon size="18">mdi-close</v-icon>
          </v-btn>
        </div>
      </div>

      <!-- Optional: Show individual request cards for the first request -->
      <v-expand-transition>
        <div v-if="showRequestCard && firstRequest" class="request-card">
          <div class="request-header">
            <div class="requester-info">
              <div class="requester-name">
                {{ firstRequest.requesterName || 'Anonymous' }}
              </div>
              <div class="requester-address">
                {{ truncateAddress(firstRequest.requesterAddress) }}
              </div>
            </div>
            <div class="request-time">
              {{ formatTimeAgo(firstRequest.createdAt) }}
            </div>
          </div>

          <div v-if="firstRequest.message" class="request-message">
            {{ firstRequest.message }}
          </div>

          <div class="request-details">
            <div class="detail-item">
              <span class="detail-label">Estimated Fee:</span>
              <span class="detail-value">{{ formatDust(firstRequest.estimatedFee) }} DUST</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Expires:</span>
              <span class="detail-value">{{ formatExpiry(firstRequest.expiresAt) }}</span>
            </div>
          </div>

          <div class="request-actions">
            <v-btn
              small
              color="error"
              text
              @click="rejectRequest(firstRequest.id)"
            >
              Decline
            </v-btn>
            <v-btn
              small
              color="primary"
              @click="approveRequest(firstRequest.id)"
            >
              Approve
            </v-btn>
          </div>
        </div>
      </v-expand-transition>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ref, computed, toRefs } from 'vue';
import delegationStore from '@/stores/delegationStore';
import { DelegationRequestStatus } from '@/models/delegation-types';

const emit = defineEmits(['view-requests', 'approve-request', 'reject-request']);

const { incomingRequests, unreadCount } = toRefs(delegationStore);
const showRequestCard = ref(false);
const dismissed = ref(false);

const hasActiveRequests = computed(() => {
  return !dismissed.value && unreadCount.value > 0;
});

const firstRequest = computed(() => {
  return incomingRequests.value.find(
    req => req.status === DelegationRequestStatus.PENDING
  );
});

const bannerTitle = computed(() => {
  if (unreadCount.value === 1) {
    return 'New DUST Delegation Request';
  }
  return `${unreadCount.value} New DUST Delegation Requests`;
});

const bannerSubtitle = computed(() => {
  if (unreadCount.value === 1 && firstRequest.value) {
    const name = firstRequest.value.requesterName || 'A wallet';
    return `${name} is requesting fee delegation for DUST registration`;
  }
  return 'Wallets are requesting fee delegation for DUST registration';
});

function viewRequests() {
  emit('view-requests');
  showRequestCard.value = !showRequestCard.value;
}

function dismissBanner() {
  dismissed.value = true;
}

function approveRequest(requestId: string) {
  emit('approve-request', requestId);
}

function rejectRequest(requestId: string) {
  emit('reject-request', requestId);
}

function truncateAddress(address: string): string {
  if (!address) return '';
  return `${address.slice(0, 12)}...${address.slice(-8)}`;
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

function formatExpiry(expiresAt: number): string {
  const now = Date.now();
  const diffMs = expiresAt - now;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMs < 0) return 'expired';
  if (diffMins < 1) return 'less than a minute';
  if (diffMins < 60) return `in ${diffMins} minute${diffMins > 1 ? 's' : ''}`;
  if (diffHours < 24) return `in ${diffHours} hour${diffHours > 1 ? 's' : ''}`;
  return `in ${diffDays} day${diffDays > 1 ? 's' : ''}`;
}

function formatDust(dust: string): string {
  // DUST has 12 decimals
  const value = parseInt(dust) / 1e12;
  return value.toFixed(6);
}
</script>

<style scoped>
.delegation-notification-banner {
  background: linear-gradient(135deg, rgba(45, 240, 247, 0.08) 0%, rgba(45, 240, 247, 0.04) 100%);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(45, 240, 247, 0.2);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  position: relative;
  overflow: hidden;
}

.delegation-notification-banner::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, #2df0f7, #00bcd4, #2df0f7);
  background-size: 200% 100%;
  animation: shimmer 2s linear infinite;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

.banner-content {
  display: flex;
  align-items: center;
  gap: 16px;
}

.banner-icon {
  flex-shrink: 0;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(45, 240, 247, 0.1);
  border-radius: 12px;
  border: 1px solid rgba(45, 240, 247, 0.2);
}

.banner-text {
  flex: 1;
  min-width: 0;
}

.banner-title {
  font-size: 16px;
  font-weight: 600;
  color: #ffffff;
  margin-bottom: 4px;
}

.banner-subtitle {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.4;
}

.banner-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.view-btn {
  text-transform: none;
  font-weight: 500;
}

.dismiss-btn {
  opacity: 0.6;
}

.dismiss-btn:hover {
  opacity: 1;
}

/* Request Card */
.request-card {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.request-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.requester-info {
  flex: 1;
}

.requester-name {
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
  margin-bottom: 2px;
}

.requester-address {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  font-family: 'Courier New', monospace;
}

.request-time {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.request-message {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.8);
  line-height: 1.5;
  margin-bottom: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  border-left: 3px solid rgba(45, 240, 247, 0.5);
}

.request-details {
  display: flex;
  gap: 24px;
  margin-bottom: 12px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-value {
  font-size: 13px;
  color: #ffffff;
  font-weight: 500;
}

.request-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* Animations */
.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.3s ease;
}

.slide-down-enter-from {
  opacity: 0;
  transform: translateY(-20px);
}

.slide-down-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}

/* Responsive */
@media (max-width: 768px) {
  .banner-content {
    flex-wrap: wrap;
  }

  .banner-actions {
    width: 100%;
    justify-content: space-between;
    margin-top: 12px;
  }

  .request-details {
    flex-direction: column;
    gap: 12px;
  }
}
</style>
