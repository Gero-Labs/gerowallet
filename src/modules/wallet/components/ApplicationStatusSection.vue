<template>
  <section class="application-status-section">
    <div class="status-content">
      <div class="card-container">
        <img src="@/modules/wallet/icons/card.svg" alt="card" />
      </div>

      <div class="status-info">
        <div class="icon-and-text">
          <div class="featured-icon">
            <img src="@/modules/wallet/icons/waiting.svg" alt="waiting" />
          </div>
          <div class="heading-and-supporting-text">
            <h3 class="heading">We're reviewing your application</h3>
            <p class="supporting-text">
              Thanks for submitting your details. Our team is reviewing your application and will get back to you
              shortly. You'll receive an email as soon as there's an update.
            </p>
          </div>
        </div>
        <SecondaryButton text="Contact Support" @click="handleContactSupport" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import SecondaryButton from './SecondaryButton.vue';

const handleContactSupport = () => {
  console.log('Contact support clicked');
};
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';
.application-status-section {
  padding: $spacing-2xl;
  border-radius: $border-radius-lg;
  border: 1px solid $border-secondary;
  background: linear-gradient(100deg, $primary-cyan -35.87%, $background-dark 40.02%, $background-dark 84.89%);
}

.status-content {
  display: flex;
  align-items: center;
  gap: $spacing-2xl;
  padding: $spacing-2xl 0;
}

.card-container {
  flex-shrink: 0;
}

.credit-card-mockup {
  position: relative;
  width: 428px;
  height: 258px;
  background: linear-gradient(135deg, $background-dark 0%, $primary-cyan 100%);
  border-radius: $border-radius-lg;
  border: 1px solid rgba(255, 255, 255, 0.2);
  overflow: hidden;
  box-shadow: $shadow-md;
}

.card-strip {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: $spacing-2xl;
  background: $background-dark;
  opacity: 0.79;
}

.payment-method-icon {
  position: absolute;
  bottom: $spacing-md;
  right: $spacing-md;
  width: $spacing-2xl;
  height: $spacing-2xl;
  background: rgba(255, 255, 255, 0.1);
  border-radius: $border-radius-sm;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mastercard-icon {
  position: relative;
  width: $spacing-2xl;
  height: $spacing-2xl;
}

.mastercard-left {
  position: absolute;
  left: 0;
  top: 0;
  width: $spacing-2xl;
  height: $spacing-2xl;
  background: $text-secondary;
  border-radius: 50%;
  opacity: 0.5;
}

.mastercard-right {
  position: absolute;
  right: 0;
  top: 0;
  width: $spacing-2xl;
  height: $spacing-2xl;
  background: linear-gradient(135deg, $primary-cyan 0%, $background-dark 100%);
  border-radius: 50%;
  opacity: 0.5;
}

.mastercard-middle {
  position: absolute;
  left: $spacing-md;
  top: $spacing-md;
  width: $spacing-2xl;
  height: $spacing-2xl;
  background: $text-primary;
  border-radius: $border-radius-sm;
}

.card-number {
  position: absolute;
  bottom: $spacing-2xl;
  left: $spacing-md;
  @include heading-style($font-size-2xl);
  color: $text-primary;
  letter-spacing: 2px;
}

.cardholder {
  position: absolute;
  bottom: $spacing-2xl;
  left: $spacing-md;
  @include body-text($font-size-base);
  color: $text-primary;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.expiry {
  position: absolute;
  bottom: $spacing-2xl;
  right: $spacing-md;
  @include body-text($font-size-base);
  color: $text-primary;
  letter-spacing: 1px;
}

.paypass-icon {
  position: absolute;
  top: $spacing-2xl;
  right: $spacing-2xl;
  color: $text-primary;
}

.gero-logo {
  position: absolute;
  top: $spacing-md;
  left: $spacing-md;
  width: $spacing-2xl;
  height: $spacing-2xl;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-placeholder {
  color: $text-primary;
  @include body-text($font-size-base);
}

.status-info {
  display: flex;
  flex-direction: column;
  gap: $spacing-2xl;
  max-width: 560px;
}

.icon-and-text {
  display: flex;
  flex-direction: column;
  gap: $spacing-xl;
}

.featured-icon {
  width: 48px;
  height: 48px;
  background: rgba(0, 223, 243, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.heading-and-supporting-text {
  display: flex;
  flex-direction: column;
  gap: $spacing-xl;
}

.heading {
  @include heading-style($font-size-2xl);
  color: $text-primary;
  margin: 0;
  line-height: 1.27;
}

.supporting-text {
  @include body-text($font-size-base);
  color: $text-secondary;
  margin: 0;
  line-height: 1.56;
}

@media (max-width: $breakpoint-lg) {
  .status-content {
    flex-direction: column;
    gap: $spacing-2xl;
    text-align: center;
  }

  .credit-card-mockup {
    width: 360px;
    height: $spacing-2xl;
  }

  .heading {
    @include heading-style($font-size-2xl);
  }

  .supporting-text {
    @include body-text($font-size-base);
  }
}

@media (max-width: $breakpoint-md) {
  .application-status-section {
    padding: $spacing-2xl 0;
  }

  .credit-card-mockup {
    width: 320px;
    height: $spacing-2xl;
  }

  .card-number {
    @include heading-style($font-size-2xl);
  }

  .cardholder,
  .expiry {
    @include body-text($font-size-base);
  }

  .heading {
    @include heading-style($font-size-2xl);
  }

  .supporting-text {
    @include body-text($font-size-base);
  }
}
</style>
