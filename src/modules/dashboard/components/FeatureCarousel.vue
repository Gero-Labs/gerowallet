<template>
  <div
    class="carousel-wrapper"
    :class="[wrapperClass, { 'carousel-behind-overlay': isLoading }]"
    @mouseenter="handleMouseEnter"
    @mouseleave="handleMouseLeave"
  >
    <v-carousel
      ref="carousel"
      :value="modelValue"
      @change="$emit('update:modelValue', $event)"
      :cycle="false"
      height="100%"
      hide-delimiter-background
      show-arrows-on-hover
      :class="carouselClass"
    >
      <v-carousel-item
        v-for="(item, index) in items"
        :key="index"
        :src="item.backgroundImage"
        :class="getItemClass(item)"
        @click="!isLoading && handleItemClick(item)"
      >
        <div class="carousel-overlay" :class="getOverlayClass(item)">
          <div class="carousel-content" :class="getContentClass(item)">
            <!-- Special slot for debit card items -->
            <div v-if="item.type === 'debit-card'" class="carousel-text-top">
              <slot name="debit-card" :item="item">
                <div class="debit-card-container">
                  <div class="debit-card-glow"></div>
                  <div class="debit-card-3d-wrapper" @mousemove="handleCardMouseMove" @mouseleave="handleCardMouseLeave" :style="debitCardStyle">
                    <img
                      :src="item.cardImage"
                      alt="Gero Debit Card"
                      class="debit-card-floating"
                    />
                  </div>
                </div>
                <div class="debit-card-text">
                  <v-card-title class="pt-0 pb-0 white--text text-center debit-card-title" style="margin-bottom: 0;">{{ item.title }}</v-card-title>
                  <div class="debit-card-description white--text text-center mb-2">
                    Top up and pay with ADA
                  </div>
                  <v-card-subtitle class="pb-0 white--text text-center debit-card-coming-soon">Coming soon</v-card-subtitle>
                </div>
              </slot>
            </div>

            <!-- Special slot for cashback items -->
            <div v-else-if="item.type === 'ada-cashback'" class="carousel-text-top cashback-card">
              <slot name="ada-cashback" :item="item">
                <div class="cashback-container">
                  <img
                    :src="item.cardImage"
                    alt="ADA Cashback"
                    class="cashback-floating"
                  />
                  <div class="debit-card-glow"></div>
                </div>
                <div class="debit-card-text cashback-text">
                  <v-card-title class="pt-0 pb-0 white--text text-center debit-card-title cashback-title" style="margin-bottom: 0;">{{ item.title }}</v-card-title>
                  <div class="debit-card-description white--text text-center mb-2 cashback-subtitle">
                    {{ item.subtitle.split('\n')[0] }}
                  </div>
                  <v-card-subtitle class="pb-0 white--text text-center debit-card-coming-soon cashback-cta">
                    {{ item.subtitle.split('\n')[1] }}
                  </v-card-subtitle>
                </div>
              </slot>
            </div>

            <!-- Default content for standard items -->
            <div v-else class="carousel-content-center">
              <slot name="default" :item="item">
                <img
                  :src="item.logo"
                  :alt="item.logoAlt"
                  class="carousel-logo mb-3"
                  :class="{ 'apex-logo': isApexItem(item) }"
                />
                <div class="carousel-text" :class="{ 'apex-text': isApexItem(item) }">
                  <v-card-title class="pt-0 white--text text-center carousel-title-large">{{ item.title }}</v-card-title>
                  <v-card-subtitle class="pb-0 white--text text-center">{{ item.subtitle }}</v-card-subtitle>
                </div>
              </slot>
            </div>
          </div>
        </div>
      </v-carousel-item>
    </v-carousel>

    <!-- Custom Progress Bar -->
    <div v-if="showProgressBar" class="carousel-progress-container">
      <slot name="progress-bar" :progress-value="progressValue">
        <v-progress-linear
          :key="progressKey"
          :value="progressValue"
          color="primary"
          height="3"
          class="carousel-progress-bar"
        ></v-progress-linear>
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';

// Define and export carousel item interface
export interface CarouselItem {
  id: string;
  title: string;
  subtitle: string;
  logo: string;
  logoAlt: string;
  backgroundImage: string;
  cardImage?: string;
  action?: string;
  type?: 'default' | 'debit-card' | 'ada-cashback';
}

// Props
interface Props {
  items: CarouselItem[];
  modelValue: number;
  paused: boolean;
  isLoading?: boolean;
  showProgressBar?: boolean;
  carouselClass?: string;
  wrapperClass?: string;
}

const props = withDefaults(defineProps<Props>(), {
  isLoading: false,
  showProgressBar: false,
  carouselClass: 'feature-carousel dashboard-card feature-card-full-height',
  wrapperClass: ''
});

// Emits
const emit = defineEmits([
  'update:modelValue',
  'item-click',
  'mouse-leave'
]);

// Reactive data
const progressValue = ref(0);
const carouselInterval = ref<ReturnType<typeof setInterval> | null>(null);
const debitCardStyle = ref<any>({});
const progressKey = ref(0);
const isHovered = ref(false);
const carousel = ref<any>(null);

// Methods
const handleMouseEnter = () => {
  isHovered.value = true;
};

const handleMouseLeave = () => {
  isHovered.value = false;
};

const handleItemClick = (item: CarouselItem) => {
  emit('item-click', item);
};

const getItemClass = (item: CarouselItem) => {
  const classes: string[] = [];
  if (item.id === 'apex-welcome') classes.push('apex-welcome-background');
  return classes;
};

const getOverlayClass = (item: CarouselItem) => {
  const classes: string[] = [];
  if (item.type === 'debit-card') classes.push('carousel-overlay-transparent');
  if (item.type === 'ada-cashback') classes.push('carousel-overlay-darkened');
  if (isApexItem(item)) classes.push('apex-carousel-overlay');
  return classes;
};

const getContentClass = (item: CarouselItem) => {
  const classes: string[] = [];
  if (item.type === 'debit-card' || item.type === 'ada-cashback') {
    classes.push('carousel-content-top');
  }
  return classes;
};

const isApexItem = (item: CarouselItem) => {
  return item.id?.startsWith('apex-');
};

// 3D Card tilt effect for debit card
const handleCardMouseMove = (event: MouseEvent) => {
  const card = event.currentTarget as HTMLElement;
  const rect = card.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const centerX = rect.width / 2;
  const centerY = rect.height / 2;

  const rotateX = (y - centerY) / 10;
  const rotateY = (centerX - x) / 10;

  debitCardStyle.value = {
    transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(10px)`,
    transition: 'transform 0.1s ease-out'
  };
};

const handleCardMouseLeave = () => {
  debitCardStyle.value = {
    transform: 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0px)',
    transition: 'transform 0.3s ease-out'
  };
};

// Custom progress bar animation
const PROGRESS_UPDATE_RATE = 50; // Update every 50ms
const PROGRESS_INCREMENT = 0.5; // 0.5% per 50ms = 10 seconds total (0.5 * 200 = 100%)

const startProgressAnimation = () => {
  if (!props.showProgressBar) return;

  carouselInterval.value = setInterval(() => {
    // Only increment if not paused and not hovered
    if (!props.paused && !isHovered.value) {
      progressValue.value += PROGRESS_INCREMENT;

      // When progress reaches 100%, change slide and reset
      if (progressValue.value >= 100) {
        const nextIndex = (props.modelValue + 1) % props.items.length;

        // Emit the change and reset progress
        emit('update:modelValue', nextIndex);
        progressValue.value = 0;
        progressKey.value++; // Force component recreation
      }
    }
  }, PROGRESS_UPDATE_RATE);
};

const stopProgressAnimation = () => {
  if (carouselInterval.value) {
    clearInterval(carouselInterval.value);
    carouselInterval.value = null;
  }
};

// Lifecycle
onMounted(() => {
  if (props.showProgressBar) {
    startProgressAnimation();
  }
});

onUnmounted(() => {
  stopProgressAnimation();
});
</script>

<style scoped>
.carousel-wrapper {
  position: relative;
  height: 100%;
  min-height: 422px;
  border-radius: 12px;
  overflow: hidden;
  background-color: rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: all 0.3s ease;
  cursor: pointer;
  max-height: 422px;
}

.carousel-wrapper:hover {
  background-color: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(15px);
  -webkit-backdrop-filter: blur(15px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  transform: scale(1.01);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.carousel-wrapper .v-card__title {
  text-align: center !important;
  justify-content: center !important;
}

/* Ensure v-carousel maintains consistent height during transitions */
.carousel-wrapper .v-carousel,
.carousel-wrapper .v-carousel .v-window,
.carousel-wrapper .v-carousel .v-window__container,
.carousel-wrapper .v-carousel-item {
  height: 100% !important;
  min-height: 422px !important;
}

/* Prevent height flickering during transitions */
.carousel-wrapper .v-window__container {
  display: flex !important;
}

.carousel-wrapper .v-window-item {
  flex: 0 0 100% !important;
  height: 100% !important;
  min-height: 422px !important;
}

.carousel-behind-overlay {
  pointer-events: none;
}

.carousel-overlay {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  background: rgba(0, 0, 0, 0.3);
  padding: 20px;
  overflow: visible;
}

.carousel-overlay-transparent {
  background: rgba(0, 0, 0, 0.1);
}

.carousel-overlay-darkened {
  background: rgba(0, 0, 0, 0.6);
}

.carousel-content {
  text-align: center;
  width: 100%;
  overflow: visible;
}

.carousel-content-center {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
}

.carousel-content-top {
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  justify-content: flex-start;
  padding-top: 40px;
  overflow: visible;
}

.carousel-logo {
  max-width: 80px;
  max-height: 80px;
}

.carousel-text {
  margin-top: 10px;
}

.carousel-title-large {
  font-size: 1.5rem !important;
  font-weight: 600 !important;
}

.carousel-progress-container {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
}

.carousel-progress-bar {
  border-radius: 0;
}

/* Apex specific styles */
.apex-welcome-background {
  background: linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #2a2a2a 100%);
}

.apex-carousel-overlay {
  background: none;
}

.apex-logo {
  max-width: 100px;
  max-height: 100px;
}

/* Debit card styles */
.debit-card-container {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  margin-bottom: 20px;
  overflow: visible;
}

.debit-card-3d-wrapper {
  position: relative;
  z-index: 2;
}

.debit-card-floating {
  width: 200px;
  height: auto;
  border-radius: 12px;
  animation: float 5s ease-in-out infinite;
}

.debit-card-glow {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 240px;
  height: 160px;
  background: radial-gradient(circle, rgba(0, 122, 255, 0.2) 0%, rgba(0, 122, 255, 0.1) 30%, transparent 60%);
  border-radius: 20px;
  z-index: 1;
  pointer-events: none;
}

.debit-card-text {
  text-align: center;
}

.debit-card-title {
  font-size: 1.4rem !important;
  font-weight: 700 !important;
  text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.7);
}

.debit-card-description {
  font-size: 0.9rem;
  font-weight: 500;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.7);
}

.debit-card-coming-soon {
  font-size: 0.8rem !important;
  font-weight: 600 !important;
  text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.7);
}

/* Cashback specific styles */
.cashback-container {
  margin-bottom: 15px;
  overflow: visible;
}

.cashback-floating {
  width: 180px;
  height: auto;
  border-radius: 12px;
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-10px);
  }
}

.cashback-title {
  font-size: 1.3rem !important;
  font-weight: 700 !important;
}

.cashback-subtitle {
  font-size: 0.85rem;
  font-weight: 500;
}

.cashback-cta {
  font-size: 0.75rem !important;
  font-weight: 600 !important;
}
</style>
