<template>
  <div class="loading-step">
    <!-- Currency Icon -->
    <div class="currency-icon">
      <v-icon color="#75E0A7" size="20">mdi-currency-usd</v-icon>
    </div>

    <!-- Title and Subtitle -->
    <div class="header-text">
      <h2 class="modal-title">{{ t('card.loadingTopUp') }}</h2>
      <p class="modal-subtitle">{{ t('card.shouldBeDoneWithin') }}</p>
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
              <img src="@/modules/wallet/icons/progress-dollar.svg" alt="progress-dollar" />
            </div>
          </div>
        </div>
        
        <!-- Sliding Step Text Below Progress Bar -->
        <div class="step-text-container">
          <div class="step-text-wrapper">
            <transition-group name="slide-step" tag="div" class="step-transitions">
              <div 
                v-for="(step, index) in visibleSteps" 
                :key="`step-${index}-${step.id}`"
                class="sliding-step"
              >
                {{ step.text }}
              </div>
            </transition-group>
          </div>
        </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, onMounted, onUnmounted } from 'vue';

// Props
interface Props {
  duration?: number; // Duration in milliseconds
}

withDefaults(defineProps<Props>(), {
  duration: 4000, // 30 seconds for testing
});

// Emits
const emit = defineEmits<{
  (e: 'complete'): void;
}>();

// Reactive data
const progress = ref(0);
const interval = ref<number | null>(null);
const currentStep = ref(0);

const { t } = useTranslation();

// Processing steps with realistic timings
const steps = [
  { text: t('card.preparingAdaTransaction'), duration: 2000 }, // 0-14%
  { text: t('card.sendingAdaToExchange'), duration: 4000 }, // 14-43%
  { text: t('card.confirmingAdaTransaction'), duration: 3000 }, // 43-65%
  { text: t('card.convertingAdaToEur'), duration: 2500 }, // 65-83%
  { text: t('card.transferringEurToCard'), duration: 2000 }, // 83-97%
  { text: t('card.updatingCardBalance'), duration: 500 } // 97-100%
];

const visibleSteps = ref([
  { 
    id: 0, 
    text: steps[0].text, 
    status: 'active'
  }
]);

// Helper function to update step transitions
const updateStepTransition = (newStepIndex: number) => {
  // Immediately replace the current step with the new one
  // This creates a smooth sliding transition without color changes
  if (newStepIndex < steps.length) {
    visibleSteps.value = [{
      id: newStepIndex,
      text: steps[newStepIndex].text,
      status: 'active'
    }];
  }
};

// Start progress animation with realistic steps
const startProgress = () => {
  progress.value = 0;
  currentStep.value = 0;
  
  // Reset visible steps
  visibleSteps.value = [{
    id: 0,
    text: steps[0].text,
    status: 'active'
  }];
  
  let _elapsedTime = 0;
  let currentStepProgress = 0;
  
  // Calculate total duration and progress breakpoints
  const totalDuration = steps.reduce((sum, step) => sum + step.duration, 0);
  let cumulativeProgress = 0;
  const progressBreakpoints = steps.map(step => {
    cumulativeProgress += (step.duration / totalDuration) * 100;
    return cumulativeProgress;
  });
  
  console.log('Total duration:', totalDuration, 'Progress breakpoints:', progressBreakpoints);

  interval.value = window.setInterval(() => {
    _elapsedTime += 100;
    currentStepProgress += 100;
    
    // Check if current step is complete
    if (currentStepProgress >= steps[currentStep.value].duration) {
      // Move to next step
      if (currentStep.value < steps.length - 1) {
        currentStep.value++;
        updateStepTransition(currentStep.value);
        currentStepProgress = 0;
      } else {
        // Final step is complete, force progress to 100% and complete
        console.log('Final step completed, forcing completion...');
        progress.value = 100;
        if (interval.value) {
          clearInterval(interval.value);
        }
        setTimeout(() => {
          console.log('Emitting complete event from final step');
          emit('complete');
        }, 200);
        return; // Exit the interval early
      }
    }
    
    // Calculate overall progress
    const stepProgress = Math.min(currentStepProgress / steps[currentStep.value].duration, 1);
    const baseProgress = currentStep.value > 0 ? progressBreakpoints[currentStep.value - 1] : 0;
    const stepRange = progressBreakpoints[currentStep.value] - baseProgress;
    progress.value = Math.min(baseProgress + (stepProgress * stepRange), 100);
    
    // Debug logging for final step
    if (currentStep.value === steps.length - 1) {
      console.log(`Final step progress: ${stepProgress.toFixed(2)}, currentStepProgress: ${currentStepProgress}, duration: ${steps[currentStep.value].duration}, overall progress: ${progress.value.toFixed(2)}`);
    }

    if (progress.value >= 100) {
      progress.value = 100;
      console.log('Progress reached 100%, completing...');
      if (interval.value) {
        clearInterval(interval.value);
      }
      
      // Add small delay before completing to show final step
      setTimeout(() => {
        console.log('Emitting complete event');
        emit('complete');
      }, 500);
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
  justify-content: center;
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
  transition: width var(--g-dur-fast) ease;
}

.progress-icon {
  position: absolute;
  top: 53%;
  transform: translateY(-50%);
  z-index: 1;
  transition: left var(--g-dur-fast) ease;
}

.progress-text {
  font-family: var(--g-font-ui);
  font-weight: 600;
  font-size: 16px;
  line-height: 1.25;
  color: $text-primary;
}

// Sliding Step Text Styles
.step-text-container {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 40px;
}

.step-text-wrapper {
  position: relative;
  overflow: hidden;
  height: 40px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.step-transitions {
  position: relative;
  width: 100%;
  height: 100%;
}

.sliding-step {
  position: absolute;
  width: 100%;
  text-align: center;
  font-family: var(--g-font-ui);
  font-weight: 600;
  font-size: 16px;
  line-height: 1.25;
  color: $text-primary;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
}

// Slide transition styles
.slide-step-enter-active {
  transition: opacity var(--g-dur-slow) ease-out, transform var(--g-dur-slow) ease-out;
}

.slide-step-enter-from {
  opacity: 0;
  transform: translateY(100%);
}

.slide-step-enter-to {
  opacity: 1;
  transform: translateY(0);
}

.slide-step-leave-from {
  opacity: 1;
  transform: translateY(0);
}

.slide-step-leave-to {
  opacity: 0;
  transform: translateY(-100%);
}

// Move transition for when items change positions
.slide-step-move {
  transition: transform var(--g-dur-slow) ease;
}

// Enhanced fade-out animation for leaving text
@keyframes fadeUpAndOut {
  0% {
    opacity: 1;
    transform: translateY(0);
  }
  30% {
    opacity: 0.7;
    transform: translateY(-30%);
  }
  60% {
    opacity: 0.3;
    transform: translateY(-60%);
  }
  100% {
    opacity: 0;
    transform: translateY(-100%);
  }
}

.slide-step-leave-active {
  animation: fadeUpAndOut 0.4s ease-out forwards;
}
</style>
