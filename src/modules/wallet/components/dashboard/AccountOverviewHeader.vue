<template>
  <div class="header-section">
    <div class="header-content">
      <span class="header-title">Account Overview</span>
      <div class="header-actions">
        <v-btn class="action-btn secondary-btn" variant="outlined" @click="$emit('topUp')">
          <img src="@/modules/wallet/icons/currency-dollar.svg" alt="Top up" class="btn-icon" />
          Top up
        </v-btn>
        <v-btn class="action-btn primary-btn" variant="outlined" @click="$emit('manageCard')">
          <img src="@/modules/wallet/icons/credit-card.svg" alt="Manage Card" class="btn-icon" />
          Manage Card
        </v-btn>
        <v-btn class="action-btn primary-btn" variant="outlined" @click="$emit('qrScan')">
          <img src="@/modules/wallet/icons/qr-code.svg" alt="QR Scan" class="btn-icon" />
          QR Scan
        </v-btn>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineEmits<{
  topUp: [];
  manageCard: [];
  qrScan: [];
}>();
</script>

<style lang="scss" scoped>
@import '../../styles/variables';
@import '../../styles/mixins';

.header-section {
  .header-content {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: $spacing-3xl;
  }

  .header-title {
    font-family: $font-family-primary;
    font-weight: $font-weight-semibold;
    font-size: $font-size-xl;
    line-height: 1.4;
    color: $text-primary;
    margin: 0;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: $spacing-md;
  }

  .action-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    border-radius: $border-radius-md;
    font-family: $font-family-primary;
    font-weight: $font-weight-semibold;
    font-size: $font-size-base;
    line-height: 1.5;
    text-transform: none;
    color: $text-primary;
    border-radius: $border-radius-md;
    background: $background-card;
    border: 1px solid $primary-cyan;
    box-shadow: $shadow-button;

    &:hover {
      background: lighten($background-card, 5%);
    }

    &:focus {
      outline: none;
    }

    .btn-icon {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
      margin-right: 6px;
    }
  }
}
</style>
