<template>
  <div class="management-content">
    <img src="@/assets/img/card.svg" alt="card" />
    <div class="management-column-content">
      <div class="featured-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path
            d="M13 2L3 14H12L11 22L21 10H12L13 2Z"
            stroke="#36BFFA"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
      <h3 class="management-heading">Manage Your Card in Seconds</h3>
      <p class="management-description">
        An all-in-one platform that helps you manage everything about <br />
        your credit card account
      </p>
      <div class="feature-list">
        <FeatureListItem text="Approved within 24 hours" icon="check" />
        <FeatureListItem text="Apple Pay or Google Pay compatible" icon="check" />
        <FeatureListItem text="Physical card to you—anywhere, at no extra cost." icon="check" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import FeatureListItem from '@/modules/wallet/components/FeatureListItem.vue';
</script>

<style scoped lang="scss">
.management-content {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 60px;
  width: 100%;
  padding: 32px;
}

.management-column-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 100%;

  .featured-icon {
    width: 48px;
    height: 48px;
    background: #0b4a6f;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .management-heading {
    font-size: 32px;
    font-weight: 700;
    color: white;
  }
  .management-description {
    font-size: 16px;
    font-weight: 400;
    color: #94979c;
  }
  .feature-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
}
</style>
