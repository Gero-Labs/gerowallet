<template>
  <section class="partnership-section mb-2">
    <div class="partnership-header">
      <div class="kaiserex-logo">
        <img src="@/assets/svg/Icon-Kaiserex.svg" :alt="$t('card.kaiserex')" class="logo-icon" />
      </div>
      <h3 class="partnership-heading">{{ t('card.poweredByKaiserex') }}</h3>
      <p class="partnership-subheading">
        {{ t('card.cardPoweredByKaiser') }}
      </p>
    </div>

    <div class="trust-grid">
      <!-- Regulatory Compliance -->
      <div class="trust-card">
        <h4 class="trust-title">{{ t('card.licensedRegulated') }}</h4>
        <p class="trust-description">
          {{ t('card.licensedRegulatedDesc') }}
        </p>
      </div>

      <!-- Industry Experience -->
      <div class="trust-card">
        <h4 class="trust-title">{{ t('card.yearsExperience') }}</h4>
        <p class="trust-description">
          {{ t('card.yearsExperienceDesc') }}
        </p>
      </div>

      <!-- Security -->
      <div class="trust-card">
        <h4 class="trust-title">{{ t('card.enterpriseSecurity') }}</h4>
        <p class="trust-description">
          {{ t('card.enterpriseSecurityDesc') }}
        </p>
      </div>
    </div>

    <div class="partnership-footer">
      <div class="company-info">
        <p class="company-name">{{ t('card.kaiserExchangeInternational') }}</p>
        <p class="company-details">{{ t('card.companyDetails') }}</p>
      </div>
      <div class="footer-divider"></div>
      <div class="footer-links">
        <a
          href="https://www.kaiserex.com/"
          target="_blank"
          rel="noopener noreferrer"
          class="kaiserex-link"
          @click="trackKaiserexClick"
        >
          {{ t('card.learnMoreKaiserex') }}
        </a>
        <a
          href="https://www.gerowallet.io/post/gero-card-satchel-eu-integration-cardano-crypto-card"
          target="_blank"
          rel="noopener noreferrer"
          class="blog-link"
          @click="trackBlogClick"
        >
          {{ t('card.readOurAnnouncement') }}
        </a>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';

const { t } = useTranslation();

const trackKaiserexClick = () => {
  // Track external link click for analytics
  console.log('Kaiserex link clicked');
};

const trackBlogClick = () => {
  // Track blog link click for analytics
  console.log('Gero blog link clicked');
};
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';

.partnership-section {
  @include flex-column;
  gap: $spacing-4xl;
  padding: $spacing-4xl $spacing-3xl;

  // Liquid glass effect matching auth cards
  -webkit-backdrop-filter: blur(12px) brightness(0.2) !important;
  backdrop-filter: blur(12px) !important;
  background: #000000ab !important;
  border: solid 2px #ffffff44 !important;
  border-radius: 16px;
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;

  // Top gradient line effect
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: linear-gradient(90deg, $primary-cyan 0%, $primary-green 100%);
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  &:hover {
    background: #000000bb !important;
    border-color: rgba(0, 199, 243, 0.4) !important;
    -webkit-backdrop-filter: blur(15px) brightness(0.3) !important;
    backdrop-filter: blur(15px) !important;
  }

  &:hover::before {
    opacity: 1;
  }

  @include mobile {
    padding: $spacing-3xl $spacing-2xl;
    gap: $spacing-3xl;
  }
}

// Header Section
.partnership-header {
  @include flex-column;
  @include flex-center;
  gap: $spacing-lg;
  text-align: center;
}

.kaiserex-logo {
  display: flex;
  justify-content: center;
  margin-bottom: -25px;
  margin-top: -25px;

  .logo-icon {
    width: 80px;
    height: 80px;
    // Make the logo white using CSS filters
    filter: brightness(0) invert(1);
    opacity: 0.9;
    transition: opacity 0.3s ease;
  }

  &:hover .logo-icon {
    opacity: 1;
  }
}

.partnership-heading {
  @include heading-style($font-size-2xl);
  margin: 0;
  background: linear-gradient(135deg, #00c7f3 0%, #75e0a7 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.partnership-subheading {
  @include body-text($font-size-base);
  max-width: 600px;
  margin: 0;
  opacity: 0.9;
}

// Trust Grid
.trust-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: $spacing-2xl;

  @include mobile {
    grid-template-columns: 1fr;
    gap: $spacing-xl;
  }
}

.trust-card {
  @include flex-column;
  gap: $spacing-md;
  padding: $spacing-2xl;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: all 0.3s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(0, 199, 243, 0.3);
    transform: translateY(-2px);
  }
}

.trust-title {
  @include text-style($font-size-lg, $font-weight-semibold, $line-height-normal);
  color: $text-primary;
  margin: 0;
}

.trust-description {
  @include body-text($font-size-sm);
  margin: 0;
  opacity: 0.8;
  line-height: 1.6;
}

// Footer Section
.partnership-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: $spacing-2xl;
  padding-top: $spacing-2xl;
  border-top: 1px solid rgba(255, 255, 255, 0.05);

  @include mobile {
    flex-direction: column;
    gap: $spacing-lg;
  }
}

.company-info {
  @include flex-column;
  gap: $spacing-xs;
  text-align: center;

  .company-name {
    @include text-style($font-size-base, $font-weight-medium, $line-height-normal);
    color: $text-primary;
    margin: 0;
  }

  .company-details {
    @include text-style($font-size-sm, $font-weight-normal, $line-height-normal);
    color: $text-secondary;
    margin: 0;
  }
}

.footer-divider {
  width: 1px;
  height: 40px;
  background: rgba(255, 255, 255, 0.1);

  @include mobile {
    display: none;
  }
}

.footer-links {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs;
  align-items: flex-start;

  @include mobile {
    align-items: center;
  }
}

.kaiserex-link,
.blog-link {
  display: inline-flex;
  align-items: center;
  gap: $spacing-sm;
  @include text-style($font-size-sm, $font-weight-medium, $line-height-normal);
  color: #00c7f3;
  text-decoration: none;
  padding: $spacing-xs $spacing-md;
  border-radius: $border-radius-md;
  transition: all 0.2s ease;

  &:hover {
    background: rgba(0, 199, 243, 0.1);
    gap: $spacing-sm + 2px;
  }

  .link-arrow {
    width: 14px;
    height: 14px;
    transition: transform 0.2s ease;
  }

  &:hover .link-arrow {
    transform: translateX(4px);
  }
}
</style>
