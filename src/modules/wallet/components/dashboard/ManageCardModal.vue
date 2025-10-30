<template>
  <v-dialog v-model="open" max-width="700" persistent content-class="manage-card-modal">
    <v-card class="manage-card-dialog" outlined>
      <!-- Header -->
      <div class="modal-header">
        <div class="header-content">
          <h2 class="modal-title">{{ t('card.manageCardTitle') }}</h2>
          <p class="modal-subtitle">{{ t('card.manageCardSubtitleSecurely') }}</p>
        </div>
        <v-btn icon class="close-btn" @click="closeDialog">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </div>

      <!-- Tabs -->
<!--      <div class="tabs-container">-->
<!--        <div class="tabs-wrapper">-->
<!--          <v-btn-->
<!--            v-for="tab in tabs"-->
<!--            :key="tab.id"-->
<!--            :class="['tab-btn', { active: activeTab === tab.id }]"-->
<!--            text-->
<!--            @click="activeTab = tab.id"-->
<!--          >-->
<!--            {{ tab.label }}-->
<!--          </v-btn>-->
<!--        </div>-->
<!--      </div>-->

      <!-- Tab Content -->
      <div class="tab-content">
        <ViewCardDetails v-if="activeTab === 'view'" />
        <BlockCard v-if="activeTab === 'block'" />
        <OrderPhysicalCard v-if="activeTab === 'order'" @close="closeDialog" />
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref } from 'vue';
import BlockCard from './tabs/BlockCard.vue';
import OrderPhysicalCard from './tabs/OrderPhysicalCard.vue';
import ViewCardDetails from './tabs/ViewCardDetails.vue';

defineProps<{
  open: boolean;
}>();

interface Emits {
  (e: 'close'): void;
}

const emit = defineEmits<Emits>();

const { t } = useTranslation();

const tabs = [
  // { id: 'view', label: t('card.viewCardDetailsTab') },
  { id: 'block', label: t('card.blockCardTab') },
  // { id: 'order', label: t('card.orderPhysicalCardTab') },
];

const activeTab = ref('block');

const closeDialog = () => {
  emit('close');
};
</script>

<style lang="scss" scoped>
.manage-card-modal {
  .v-dialog__content {
    align-items: center;
    justify-content: center;
  }
}

.manage-card-dialog {
  background: rgb(12, 14, 18) !important;
  border-radius: 12px !important;
  overflow: hidden;
  width: 100%;
  max-width: 700px;
}

.modal-header {
  position: relative;
  padding: 32px 32px 0;
  display: flex;
  align-items: flex-start;
}

.modal-title {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 24px;
  line-height: 1.17;
  color: #f7f7f7;
  margin: 0 0 8px 0;
}

.modal-subtitle {
  font-family: 'Inter', sans-serif;
  font-weight: 400;
  font-size: 16px;
  line-height: 1.5;
  color: #94979c;
  margin: 0;
  text-align: center;
}

.close-btn {
  position: absolute;
  right: 16px;
  top: 16px;
  width: 44px;
  height: 44px;

  .v-icon {
    color: #85888e;
    font-size: 24px;
  }
}

.tabs-container {
  padding: 32px 32px 0;
  border-bottom: 1px solid #22262f;
}

.tabs-wrapper {
  display: flex;
  gap: 12px;
}

.tab-btn {
  font-family: 'Inter', sans-serif;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.43;
  color: #94979c !important;
  text-transform: none;
  padding: 0 4px 12px !important;
  min-width: auto !important;
  height: 32px !important;
  border-radius: 0 !important;

  &.active {
    color: #00dff3 !important;
    border-bottom: 2px solid #00dff3;
  }

  &:hover {
    background: transparent !important;
  }
}

.tab-content {
  padding: 32px;
}
</style>
