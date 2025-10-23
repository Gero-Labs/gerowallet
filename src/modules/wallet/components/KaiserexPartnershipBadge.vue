<template>
  <div class="partnership-badge-compact">
    <div class="badge-content">
      <div class="badge-left">
        <img src="@/assets/svg/Icon-Kaiserex.svg" alt="Kaiserex" class="badge-icon" />
        <div class="badge-text">
          <span class="badge-title">Powered by Kaiserex</span>
          <span class="badge-subtitle">Licensed & Regulated Financial Services</span>
        </div>
      </div>
      <div class="badge-links">
        <a
          href="https://www.kaiserex.com/"
          target="_blank"
          rel="noopener noreferrer"
          class="badge-link"
          @click="trackKaiserexClick"
        >
          Learn more
          <img src="@/modules/wallet/icons/arrow-right.svg" alt="arrow" class="link-arrow" />
        </a>
        <a
          href="https://www.gerowallet.io/post/gero-card-satchel-eu-integration-cardano-crypto-card"
          target="_blank"
          rel="noopener noreferrer"
          class="badge-link blog-link"
          @click="trackBlogClick"
        >
          Read announcement
          <img src="@/modules/wallet/icons/arrow-right.svg" alt="arrow" class="link-arrow" />
        </a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const trackKaiserexClick = () => {
  console.log('Kaiserex link clicked from badge');
};

const trackBlogClick = () => {
  console.log('Gero blog link clicked from badge');
};
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';

.partnership-badge-compact {
  padding: $spacing-lg;
  background: linear-gradient(135deg, rgba(11, 74, 111, 0.1) 0%, rgba(8, 93, 58, 0.1) 100%);
  border-radius: $border-radius-lg;
  border: 1px solid rgba(117, 224, 167, 0.2);
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(117, 224, 167, 0.4) 50%,
      transparent 100%
    );
  }
}

.badge-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: $spacing-lg;

  @include mobile {
    flex-direction: column;
    align-items: flex-start;
    gap: $spacing-md;
  }
}

.badge-left {
  display: flex;
  align-items: center;
  gap: $spacing-md;
}

.badge-icon {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  // Make the Kaiserex logo white
  filter: brightness(0) invert(1);
  opacity: 0.9;
}

.badge-text {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs;
}

.badge-title {
  @include text-style($font-size-base, $font-weight-semibold, $line-height-normal);
  color: $text-primary;
}

.badge-subtitle {
  @include text-style($font-size-sm, $font-weight-normal, $line-height-normal);
  color: $text-secondary;
}

.badge-links {
  display: flex;
  flex-direction: column;
  gap: $spacing-xs;
  align-items: flex-end;

  @include mobile {
    align-items: flex-start;
  }
}

.badge-link {
  display: inline-flex;
  align-items: center;
  gap: $spacing-xs;
  @include text-style($font-size-sm, $font-weight-medium, $line-height-normal);
  color: #75e0a7;
  text-decoration: none;
  padding: $spacing-xs $spacing-md;
  border-radius: $border-radius-md;
  transition: all 0.2s ease;
  white-space: nowrap;

  &:hover {
    background: rgba(117, 224, 167, 0.1);
    gap: $spacing-sm;
  }

  .link-arrow {
    width: 14px;
    height: 14px;
    transition: transform 0.2s ease;
    // Make arrows off-white
    filter: brightness(0) invert(1);
    opacity: 0.7;
  }

  &:hover .link-arrow {
    transform: translateX(4px);
    opacity: 1;
  }

  &.blog-link {
    color: $text-secondary;

    &:hover {
      color: #75e0a7;
    }
  }
}
</style>
