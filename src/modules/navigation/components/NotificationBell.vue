<template>
  <v-menu
    offset-y
    :close-on-content-click="false"
    nudge-left="75"
    nudge-top="-10"
    max-width="400"
    transition="slide-y-transition"
  >
    <template v-slot:activator="{ on, attrs }">
      <v-btn
        icon
        class="notification-bell"
        :class="{ 'has-notifications': unreadCount > 0 }"
        v-bind="attrs"
        v-on="on"
      >
        <v-badge
          :value="unreadCount > 0"
          :content="unreadCount"
          color="error"
          overlap
          offset-x="10"
          offset-y="10"
        >
          <v-icon :class="{ 'breathing-glow': unreadCount > 0 }">
            mdi-bell
          </v-icon>
        </v-badge>
      </v-btn>
    </template>

    <v-card class="notifications-dropdown liquid-glass" min-width="350">
      <v-card-title class="d-flex align-center justify-space-between pa-3">
        <span class="text-subtitle-1">Notifications</span>
        <v-chip x-small color="primary" v-if="unreadCount > 0">
          {{ unreadCount }} new
        </v-chip>
      </v-card-title>

      <v-divider></v-divider>

      <!-- Empty State -->
      <v-card-text v-if="pendingNotifications.length === 0" class="text-center py-6">
        <v-icon size="48" color="rgba(255, 255, 255, 0.3)">mdi-bell-outline</v-icon>
        <div class="text-caption mt-2" style="color: rgba(255, 255, 255, 0.5)">
          No new notifications
        </div>
      </v-card-text>

      <!-- Notifications List (max 3) -->
      <v-list v-else class="transparent pa-0" style="max-height: 300px; overflow-y: auto;">
        <v-list-item
          v-for="notification in displayedNotifications"
          :key="notification.id"
          class="notification-item"
          @click="handleNotificationClick(notification)"
        >
          <v-list-item-content>
            <v-list-item-title class="d-flex align-center justify-space-between mb-1">
              <span class="font-weight-bold">{{ notification.requesterName || 'Anonymous' }}</span>
              <v-chip x-small color="warning">Pending</v-chip>
            </v-list-item-title>
            <v-list-item-subtitle class="text-caption">
              Requests {{ formatDust(notification.estimatedFee) }} DUST
            </v-list-item-subtitle>
            <v-list-item-subtitle class="text-caption" style="color: rgba(255, 255, 255, 0.4)">
              {{ formatTimeAgo(notification.createdAt) }}
            </v-list-item-subtitle>
          </v-list-item-content>
          <v-list-item-action>
            <v-icon small color="rgba(255, 255, 255, 0.5)">mdi-chevron-right</v-icon>
          </v-list-item-action>
        </v-list-item>
      </v-list>

      <!-- View All Button (when 3+ notifications) -->
      <v-divider v-if="pendingNotifications.length >= 3"></v-divider>
      <v-card-actions v-if="pendingNotifications.length >= 3" class="pa-2">
        <v-btn
          text
          small
          color="primary"
          block
          @click="handleViewAll"
        >
          <v-icon small left>mdi-format-list-bulleted</v-icon>
          View All Notifications ({{ pendingNotifications.length }})
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-menu>
</template>

<script lang="ts">
import { defineComponent, computed } from 'vue';
import delegationStore from '@/stores/delegationStore';
import { DelegationRequest, DelegationRequestStatus } from '@/models/delegation-types';

export default defineComponent({
  name: 'NotificationBell',

  setup(_, { emit }) {
    // Get unread count from delegation store
    const unreadCount = computed(() => delegationStore.unreadCount);

    // Get pending notifications (sorted by newest first)
    const pendingNotifications = computed(() => {
      return delegationStore.incomingRequests
        .filter(req => req.status === DelegationRequestStatus.PENDING)
        .sort((a, b) => b.createdAt - a.createdAt);
    });

    // Show max 3 notifications in dropdown
    const displayedNotifications = computed(() => {
      return pendingNotifications.value.slice(0, 3);
    });

    const formatDust = (dust: string): string => {
      const value = parseInt(dust) / 1e12;
      return value.toFixed(6);
    };

    const formatTimeAgo = (timestamp: number): string => {
      const now = Date.now();
      const diffMs = now - timestamp;
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
      if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
      return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    };

    const handleNotificationClick = (notification: DelegationRequest) => {
      emit('notification-click', notification);
    };

    const handleViewAll = () => {
      emit('view-all');
    };

    return {
      unreadCount,
      pendingNotifications,
      displayedNotifications,
      formatDust,
      formatTimeAgo,
      handleNotificationClick,
      handleViewAll,
    };
  },
});
</script>

<style scoped lang="scss">
.notification-bell {
  position: relative;

  &.has-notifications {
    .v-icon {
      color: var(--v-primary-base) !important;
    }
  }
}

// Breathing glow animation
.breathing-glow {
  animation: breathing-glow 2s ease-in-out infinite;
}

@keyframes breathing-glow {
  0%, 100% {
    filter: drop-shadow(0 0 2px currentColor);
    opacity: 1;
  }
  50% {
    filter: drop-shadow(0 0 8px currentColor) drop-shadow(0 0 12px currentColor);
    opacity: 0.85;
  }
}

// Badge styling
::v-deep .v-badge__badge {
  font-size: 10px;
  height: 18px;
  min-width: 18px;
  padding: 0 4px;
  font-weight: 600;
}

// Dropdown styling
.notifications-dropdown {
  &.liquid-glass {
    background: linear-gradient(135deg, rgba(19, 22, 27, 0.98) 0%, rgba(19, 22, 27, 0.95) 100%) !important;
    backdrop-filter: blur(20px) saturate(1.5) !important;
    -webkit-backdrop-filter: blur(20px) saturate(1.5) !important;
    border: 1px solid rgba(45, 240, 247, 0.2) !important;
    box-shadow:
      0 8px 32px rgba(0, 0, 0, 0.5),
      inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  }
}

.notification-item {
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  cursor: pointer;
  transition: background-color 0.2s ease;

  &:hover {
    background-color: rgba(45, 240, 247, 0.1) !important;
  }

  &:last-child {
    border-bottom: none;
  }
}
</style>
