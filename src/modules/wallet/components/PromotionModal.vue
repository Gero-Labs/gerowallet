<template>
  <v-dialog v-model="isOpen" max-width="800px" @click:outside="closeModal">
    <v-card class="promotion-modal">
      <v-card-title class="modal-header">
        <v-btn icon @click="closeModal" class="close-btn" aria-label="Close promotional modal">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-card-text class="modal-content">
        <!-- Zero Fees Promotion -->
        <div class="promo-banner">
          <div class="promo-text">
            <h3 class="promo-heading">Enjoy ZERO FEES until May 1st, 2025</h3>
            <p class="promo-subheading">Get started with your Gero Card completely free</p>
          </div>
        </div>

        <!-- Two Column Layout -->
        <div class="content-grid">
          <!-- Left Column: $GERO Token Incentives -->
          <div class="token-section">
            <div class="token-banner">
              <v-icon class="token-icon">mdi-star-circle</v-icon>
              <p class="token-message">Starting May 1st, <strong>$GERO holders</strong> will enjoy token incentives in the form of fee waivers</p>
            </div>

            <div class="tiers-vertical">
              <!-- Basic Tier -->
              <div class="tier-card basic-tier">
                <div class="tier-header">
                  <div class="tier-title-row">
                    <h4 class="tier-name">Baby Gero</h4>
                    <div class="tier-requirement">
                      <span class="tier-price">€15</span>
                      <span class="tier-details">in $GERO</span>
                    </div>
                  </div>
                </div>
                <div class="tier-benefits">
                  <div class="benefit-item">
                    <v-icon class="benefit-icon">mdi-check-circle</v-icon>
                    <span>Free ATM withdrawals</span>
                  </div>
                  <div class="benefit-item">
                    <v-icon class="benefit-icon">mdi-check-circle</v-icon>
                    <span>No Monthly Fee</span>
                  </div>
                </div>
              </div>

              <!-- Core Tier -->
              <div class="tier-card core-tier">
                <div class="tier-header">
                  <div class="tier-title-row">
                    <h4 class="tier-name">Gero Pro</h4>
                    <div class="tier-requirement">
                      <span class="tier-price">€50</span>
                      <span class="tier-details">in $GERO</span>
                    </div>
                  </div>
                </div>
                <div class="tier-benefits">
                  <div class="benefit-item">
                    <v-icon class="benefit-icon">mdi-check-circle</v-icon>
                    <span>Basic +</span>
                  </div>
                  <div class="benefit-item">
                    <v-icon class="benefit-icon">mdi-check-circle</v-icon>
                    <span>All EU + INT POS fees waived</span>
                  </div>
                </div>
              </div>

              <!-- Pro Tier -->
              <div class="tier-card pro-tier">
                <div class="tier-header">
                  <div class="tier-title-row">
                    <h4 class="tier-name">Gerobanga!</h4>
                    <div class="tier-requirement">
                      <span class="tier-price">€200</span>
                      <span class="tier-details">in $GERO</span>
                    </div>
                  </div>
                </div>
                <div class="tier-benefits">
                  <div class="benefit-item">
                    <v-icon class="benefit-icon">mdi-check-circle</v-icon>
                    <span>ALL FEES waived</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Right Column: Standard Fees Table -->
          <div class="fees-section">
            <h3 class="section-title">Standard Fees (After Promotional Period)</h3>
            <div class="fees-table">
              <div class="table-row table-header">
                <div class="table-cell">Fee Type</div>
                <div class="table-cell">Fee</div>
              </div>
              <div class="table-row">
                <div class="table-cell">Card Issuance</div>
                <div class="table-cell">€3</div>
              </div>
              <div class="table-row">
                <div class="table-cell">Monthly Fee</div>
                <div class="table-cell">€3 Physical / Virtual</div>
              </div>
              <div class="table-row">
                <div class="table-cell">Top-Up (ADA → EUR)</div>
                <div class="table-cell">1.5%</div>
              </div>
              <div class="table-row">
                <div class="table-cell">ATM Withdrawal (EU)</div>
                <div class="table-cell">€1.50</div>
              </div>
              <div class="table-row">
                <div class="table-cell">ATM Withdrawal (Intl)</div>
                <div class="table-cell">2% + €2</div>
              </div>
              <div class="table-row">
                <div class="table-cell">POS Purchases (EU)</div>
                <div class="table-cell">0.5% + €0.15</div>
              </div>
              <div class="table-row">
                <div class="table-cell">POS Purchases (Intl)</div>
                <div class="table-cell">2.0% + €0.75</div>
              </div>
              <div class="table-row">
                <div class="table-cell">FX Conversion Markup</div>
                <div class="table-cell">1%</div>
              </div>
              <div class="table-row">
                <div class="table-cell">Transaction Decline</div>
                <div class="table-cell">€0.50</div>
              </div>
              <div class="table-row">
                <div class="table-cell">Replacement Card (Physical)</div>
                <div class="table-cell">+€5 (Express +€10)</div>
              </div>
            </div>
          </div>
        </div>
      </v-card-text>

      <div class="modal-footer">
        <v-icon small class="footer-icon">mdi-wallet-outline</v-icon>
        <span>Your tier is detected automatically by holding $GERO tokens in your wallet</span>
      </div>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue';

interface Props {
  open: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  open: false,
});
const emit = defineEmits<{
  (e: 'close'): void;
}>();

const isOpen = computed({
  get: () => props.open,
  set: (value) => {
    if (!value) {
      emit('close');
    }
  },
});

const closeModal = () => {
  emit('close');
};
</script>

<style lang="scss" scoped>
@import '../styles/_variables';
@import '../styles/_mixins';

.promotion-modal {
  background: $background-card;
  border: 1px solid $border-secondary;
  border-radius: $border-radius-xl;
  overflow: hidden;
}

.modal-header {
  padding: $spacing-md $spacing-md;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-height: 48px;

  .close-btn {
    color: $text-secondary;

    &:hover {
      color: $text-primary;
    }
  }
}

.modal-content {
  padding: $spacing-2xl;
  max-height: 70vh;
  overflow-y: auto;
}

// Promo Banner
.promo-banner {
  display: flex;
  align-items: center;
  gap: $spacing-lg;
  padding: $spacing-xl;
  background: linear-gradient(135deg, rgba(0, 199, 243, 0.15) 0%, rgba(0, 255, 209, 0.15) 100%);
  border-radius: $border-radius-lg;
  border: 1px solid rgba(0, 199, 243, 0.3);
  margin-bottom: $spacing-2xl;

  .promo-icon {
    font-size: 48px;
    color: $primary-cyan;
  }

  .promo-text {
    flex: 1;

    .promo-heading {
      @include heading-style($font-size-xl);
      color: $text-primary;
      margin: 0 0 $spacing-xs 0;
    }

    .promo-subheading {
      @include body-text($font-size-base);
      color: $text-secondary;
      margin: 0;
    }
  }
}

// Two Column Layout
.content-grid {
  display: grid;
  grid-template-columns: 45% 55%;
  gap: $spacing-2xl;
  margin-top: $spacing-2xl;

  @media (max-width: $breakpoint-md) {
    grid-template-columns: 1fr;
  }
}

// Fees Section
.fees-section {
  .section-title {
    @include heading-style($font-size-lg);
    color: $text-primary;
    margin: 0 0 $spacing-lg 0;
  }
}

.fees-table {
  border: 1px solid $border-secondary;
  border-radius: $border-radius-md;
  overflow: hidden;

  .table-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-bottom: 1px solid $border-secondary;

    &:last-child {
      border-bottom: none;
    }

    &.table-header {
      background: rgba(0, 199, 243, 0.1);
      font-weight: $font-weight-semibold;
      color: $text-primary;
    }

    .table-cell {
      padding: $spacing-md $spacing-lg;
      @include body-text($font-size-sm);
      color: $text-secondary;

      &:first-child {
        border-right: 1px solid $border-secondary;
        color: $text-primary;
      }
    }
  }

  .table-header .table-cell {
    color: $primary-cyan;
  }
}

// Token Section
.token-section {
  .section-title {
    @include heading-style($font-size-lg);
    color: $text-primary;
    margin: 0 0 $spacing-lg 0;
  }
}

.token-banner {
  display: flex;
  align-items: center;
  gap: $spacing-md;
  padding: $spacing-lg;
  border-radius: $border-radius-md;
  margin-bottom: $spacing-xl;

  .token-icon {
    font-size: 32px;
    color: $tier-gold;
  }

  .token-message {
    @include body-text($font-size-sm);
    color: $text-secondary;
    margin: 0;

    strong {
      color: $tier-gold;
      font-weight: $font-weight-semibold;
    }
  }
}

// Tiers Vertical (Left Column)
.tiers-vertical {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
}

.tier-card {
  background: $background-secondary;
  border: 1px solid $border-secondary;
  border-radius: $border-radius-lg;
  padding: $spacing-xl;
  transition: all 0.3s ease;

  &:hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  }

  &.basic-tier {
    border-top: 3px solid $tier-basic-green;
  }

  &.core-tier {
    border-top: 3px solid $tier-core-blue;
  }

  &.pro-tier {
    border-top: 3px solid $tier-pro-purple;
    background: linear-gradient(135deg, rgba($tier-pro-purple, 0.15) 0%, rgba($tier-pro-pink, 0.15) 100%);
    box-shadow: 0 0 30px rgba($tier-pro-purple, 0.4), 0 0 60px rgba($tier-pro-pink, 0.2);
  }

  .tier-header {
    margin-bottom: $spacing-lg;

    .tier-title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: $spacing-md;
    }

    .tier-name {
      @include heading-style($font-size-xl);
      color: $text-primary;
      margin: 0;
    }

    .tier-requirement {
      display: flex;
      align-items: baseline;
      gap: $spacing-xs;
      white-space: nowrap;

      .tier-price {
        @include heading-style($font-size-xl);
        color: $text-primary;
        font-weight: $font-weight-bold;
        margin: 0;
      }

      .tier-details {
        @include body-text($font-size-sm);
        color: $text-muted;
        font-style: italic;
      }
    }
  }

  .tier-benefits {
    .benefit-item {
      display: flex;
      align-items: center;
      gap: $spacing-sm;
      margin-bottom: $spacing-sm;

      .benefit-icon {
        font-size: 18px;
        color: $primary-cyan;
      }

      span {
        @include body-text($font-size-sm);
        color: $text-secondary;
      }
    }
  }
}

// Modal Footer
.modal-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $spacing-sm;
  padding: $spacing-lg $spacing-2xl;
  background: rgba(0, 199, 243, 0.05);
  border-top: 1px solid $border-secondary;
  font-size: $font-size-xs;
  color: $text-muted;
  font-style: italic;

  .footer-icon {
    color: $primary-cyan;
  }
}
</style>
