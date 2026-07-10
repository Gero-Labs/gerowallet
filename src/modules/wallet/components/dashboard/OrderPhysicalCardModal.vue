<template>
  <v-dialog v-model="dialog" max-width="700" persistent content-class="order-physical-card-modal">
    <v-card class="order-physical-card-dialog" outlined>
      <div class="modal-header">
        <div class="header-content">
          <h2 class="modal-title">{{ t('card.orderPhysicalCard') }}</h2>
          <p class="modal-subtitle">{{ t('card.writeDeliveryDetails') }}</p>
        </div>
        <v-btn icon class="close-btn" @click="handleClose">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </div>

      <div class="modal-content">
        <OrderPhysicalCard @close="handleClose" />
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import OrderPhysicalCard from './tabs/OrderPhysicalCard.vue';

const props = defineProps<{
  open: boolean;
}>();

interface Emits {
  (e: 'close'): void;
}

const emit = defineEmits<Emits>();

const { t } = useTranslation();

const dialog = computed({
  get: () => props.open,
  set: value => {
    if (!value) {
      emit('close');
    }
  },
});

const handleClose = () => {
  emit('close');
};
</script>

<style lang="scss" scoped>
.order-physical-card-modal {
  .v-dialog__content {
    align-items: center;
    justify-content: center;
  }
}

.order-physical-card-dialog {
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
  font-family: var(--g-font-ui);
  font-weight: 600;
  font-size: 24px;
  line-height: 1.17;
  color: #f7f7f7;
  margin: 0 0 8px 0;
}

.modal-subtitle {
  font-family: var(--g-font-ui);
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

.modal-content {
  padding: 32px;
}

@media (max-width: 600px) {
  .modal-content {
    padding: 24px;
  }
}
</style>

