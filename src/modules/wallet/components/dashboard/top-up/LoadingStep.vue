<template>
  <div class="loading-step">
    <!-- Currency Icon -->
    <div class="currency-icon">
      <v-icon color="#75E0A7" size="20">mdi-currency-usd</v-icon>
    </div>

    <!-- Title and Subtitle -->
    <div class="header-text">
      <h2 class="modal-title">Loading your top up</h2>
      <p class="modal-subtitle">It should be done within 1-2 minutes</p>
    </div>

    <!-- Loading Section -->
    <div class="loading-section">
      <div class="loading-container">
        <div class="progress-section">
          <div class="progress-wrapper">
            <div class="progress-bar">
              <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
            </div>
            <div class="progress-icon" :style="{ left: `${Math.min(progress, 100)}%` }">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M5 13.3334C5 15.1744 6.49238 16.6667 8.33333 16.6667H11.6667C13.5076 16.6667 15 15.1744 15 13.3334C15 11.4925 13.5076 10.0001 11.6667 10.0001H8.33333C6.49238 10.0001 5 8.5077 5 6.66675C5 4.8258 6.49238 3.33341 8.33333 3.33341H11.6667C13.5076 3.33341 15 4.8258 15 6.66675M10 1.66675V18.3334"
                  stroke="url(#paint0_linear_5074_28698)"
                  stroke-width="1.66667"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <defs>
                  <linearGradient
                    id="paint0_linear_5074_28698"
                    x1="5"
                    y1="1.66675"
                    x2="15.5205"
                    y2="1.79912"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0.39554" stop-color="#00C7F3" />
                    <stop offset="1" stop-color="#00FFD1" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
          </div>
          <span class="progress-text">Progressing...</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

// Props
interface Props {
  duration?: number; // Duration in milliseconds
}

const props = withDefaults(defineProps<Props>(), {
  duration: 4000, // 30 seconds for testing
});

// Emits
const emit = defineEmits<{
  (e: 'complete'): void;
}>();

// Reactive data
const progress = ref(0);
const interval = ref<number | null>(null);

// Start progress animation
const startProgress = () => {
  const step = 100 / (props.duration / 100); // Update every 100ms
  progress.value = 0;

  interval.value = window.setInterval(() => {
    progress.value += step;

    if (progress.value >= 100) {
      progress.value = 100;
      if (interval.value) {
        clearInterval(interval.value);
      }
      emit('complete');
    }
  }, 100);
};

// Cleanup on unmount
onMounted(() => {
  startProgress();
});

onUnmounted(() => {
  if (interval.value) {
    clearInterval(interval.value);
  }
});
</script>

<style lang="scss" scoped>
@import '../../../styles/variables';
@import '../../../styles/mixins';

.loading-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  padding: $spacing-2xl $spacing-2xl $spacing-md;
}

.currency-icon {
  width: 48px;
  height: 48px;
  background: $background-secondary;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.header-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: $spacing-sm;
  width: 100%;
}

.modal-title {
  @include heading-style($font-size-2xl);
  color: $text-primary;
  margin: 0;
  line-height: 1.17;
  text-align: center;
  font-weight: 600;
  font-size: 24px;
}

.modal-subtitle {
  @include body-text($font-size-base);
  color: $text-secondary;
  margin: 0;
  line-height: 1.5;
  text-align: center;
  font-size: 16px;
}

.loading-section {
  display: flex;
  flex-direction: column;
  gap: $spacing-md;
  width: 100%;
}

.loading-container {
  display: flex;
  flex-direction: column;
  gap: $spacing-lg;
  padding: 10px 16px;
  background: $background-secondary;
  border: 1px solid #1f242f;
  border-radius: $border-radius-md;
  width: 100%;
}

.progress-section {
  display: flex;
  gap: $spacing-md;
  align-items: center;
  justify-content: space-between;
}

.progress-wrapper {
  position: relative;
  width: 275px;
  height: 48px;
  display: flex;
  align-items: center;
}

.progress-bar {
  width: 274px;
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
  position: relative;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(135deg, $primary-cyan 0%, $primary-green 100%);
  border-radius: 4px;
  transition: width 0.1s ease;
}

.progress-icon {
  position: absolute;
  top: 53%;
  transform: translateY(-50%);
  z-index: 1;
  transition: left 0.1s ease;
}

.progress-text {
  font-family: Inter;
  font-weight: 600;
  font-size: 16px;
  line-height: 1.25;
  color: $text-primary;
}
</style>
