<template>
  <div class="gero-card-coming-soon">
    <!-- Background image with blend effect -->
    <div class="background-layer"></div>

    <!-- Floating Elements behind content -->
    <div class="floating-elements">
      <div class="floating-card card-1"></div>
      <div class="floating-card card-2"></div>
      <div class="floating-card card-3"></div>
      <div class="floating-card card-4"></div>
      <div class="floating-card card-5"></div>
      <div class="floating-card card-6"></div>
    </div>

    <!-- Main Content Container -->
    <div class="content-container">
      <!-- Liquid Glass Card -->
      <div class="liquid-glass-card">
        <!-- 3D Debit Card Section -->
        <div class="debit-card-container">
          <div class="debit-card-glow"></div>
          <div class="debit-card-3d-wrapper"
               @mousemove="handleCardMouseMove"
               @mouseleave="handleCardMouseLeave"
               :style="debitCardStyle">
            <img
              src="@/assets/front_card_no_mcx2.png"
              alt="Gero Debit Card"
              class="debit-card-floating"
            />
          </div>
        </div>

        <!-- Title & Description -->
        <h1 class="coming-soon-title">
          Gero Card
          <span class="gradient-text">Coming Soon</span>
        </h1>

        <p class="coming-soon-description">
          Get ready to seamlessly bridge your digital assets with everyday purchases.
        </p>

        <!-- Features Grid -->
        <div class="features-grid">
          <div class="feature-item">
            <div class="feature-icon">
              <v-icon size="20">mdi-flash</v-icon>
            </div>
            <span class="feature-text">Instant Conversion</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">
              <v-icon size="20">mdi-shield-check</v-icon>
            </div>
            <span class="feature-text">Secure & Compliant</span>
          </div>
          <div class="feature-item">
            <div class="feature-icon">
              <v-icon size="20">mdi-earth</v-icon>
            </div>
            <span class="feature-text">Global Acceptance</span>
          </div>
        </div>

        <!-- Read More Link -->
        <div class="read-more-section">
          <a href="https://www.gerowallet.io/gero-card-satchel-eu-bank-integration" target="_blank" class="read-more-link">
            <span>Read more</span>
            <v-icon size="16" class="read-more-icon">mdi-arrow-top-right</v-icon>
          </a>
        </div>

      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { use3DCard } from '@/composables/use3DCard';

// 3D Card tilt effect for debit card
const {
  cardStyle: debitCardStyle,
  handleCardMouseMove,
  handleCardMouseLeave
} = use3DCard(10);
</script>

<style lang="scss" scoped>
// Variables
$primary-cyan: #00c7f3;
$primary-green: #00ffd1;
$text-primary: #ffffff;
$text-secondary: #cecfd2;

// Animations
@keyframes float {
  0%, 100% {
    transform: translateY(0px);
  }
  50% {
    transform: translateY(-10px);
  }
}

@keyframes card-float-1 {
  0%, 100% {
    transform: translate(0, 0) rotate(15deg);
  }
  33% {
    transform: translate(30px, -30px) rotate(20deg);
  }
  66% {
    transform: translate(-20px, 20px) rotate(10deg);
  }
}

@keyframes card-float-2 {
  0%, 100% {
    transform: translate(0, 0) rotate(-10deg);
  }
  33% {
    transform: translate(-40px, 30px) rotate(-15deg);
  }
  66% {
    transform: translate(20px, -40px) rotate(-5deg);
  }
}

@keyframes card-float-3 {
  0%, 100% {
    transform: translate(0, 0) rotateY(25deg) rotateX(10deg) rotate(12deg);
  }
  50% {
    transform: translate(-25px, -35px) rotateY(30deg) rotateX(15deg) rotate(18deg);
  }
}

@keyframes card-float-4 {
  0%, 100% {
    transform: translate(0, 0) rotateY(-20deg) rotateX(-5deg) rotate(-8deg);
  }
  40% {
    transform: translate(35px, 25px) rotateY(-25deg) rotateX(-2deg) rotate(-12deg);
  }
  80% {
    transform: translate(-15px, -20px) rotateY(-15deg) rotateX(-8deg) rotate(-4deg);
  }
}

@keyframes card-float-5 {
  0%, 100% {
    transform: translate(0, 0) rotateY(35deg) rotateX(15deg) rotate(20deg);
  }
  60% {
    transform: translate(20px, -30px) rotateY(40deg) rotateX(20deg) rotate(25deg);
  }
}

@keyframes card-float-6 {
  0%, 100% {
    transform: translate(0, 0) rotateY(-30deg) rotateX(8deg) rotate(-15deg);
  }
  30% {
    transform: translate(-20px, 20px) rotateY(-35deg) rotateX(12deg) rotate(-20deg);
  }
  70% {
    transform: translate(25px, -15px) rotateY(-25deg) rotateX(5deg) rotate(-10deg);
  }
}


// Main Container
.gero-card-coming-soon {
  position: relative;
  width: 100%;
  height: 80vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  overflow: hidden;
}

// Background Layer
.background-layer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-image: url('@/assets/emptyStateDarker.png');
  background-size: 100%;
  background-position: center;
  background-repeat: no-repeat;
  mix-blend-mode: screen;
  opacity: 1;
  z-index: 1;
}

// Content Container
.content-container {
  position: relative;
  z-index: 3;
  width: 100%;
  max-width: 700px;
  padding: 0 20px;
}

// Liquid Glass Card
.liquid-glass-card {
  background: linear-gradient(
    135deg,
    rgba(0, 199, 243, 0.05) 0%,
    rgba(0, 255, 209, 0.05) 100%
  );
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 24px;
  padding: 24px;
  box-shadow:
    0 20px 40px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 0 80px rgba(0, 199, 243, 0.1);
  position: relative;
  overflow: hidden;

  // Glass effect overlay
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 100%;
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.05) 0%,
      transparent 50%
    );
    pointer-events: none;
  }

}

// 3D Debit Card Section
.debit-card-container {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 10px auto 16px;
  overflow: visible;
  width: 300px;
  height: 200px;
  z-index: 10;
}

.debit-card-3d-wrapper {
  position: relative;
  z-index: 10;
}

.debit-card-floating {
  width: 300px;
  height: auto;
  border-radius: 16px;
  animation: float 5s ease-in-out infinite;
  box-shadow:
    0 20px 40px rgba(0, 199, 243, 0.3),
    0 0 60px rgba(0, 199, 243, 0.2);
}

.debit-card-glow {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 340px;
  height: 220px;
  background: radial-gradient(circle, rgba(0, 199, 243, 0.2) 0%, rgba(0, 199, 243, 0.1) 30%, transparent 60%);
  border-radius: 20px;
  z-index: 1;
  pointer-events: none;
}

// Title & Description
.coming-soon-title {
  font-size: 48px;
  font-weight: 700;
  text-align: center;
  margin: 0 0 16px 0;
  color: $text-primary;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  z-index: 10;

  .gradient-text {
    background: linear-gradient(90deg, $primary-cyan, $primary-green);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    font-size: 36px;
    font-weight: 600;
    margin-top: -12px;
  }
}

.coming-soon-description {
  font-size: 18px;
  line-height: 1.6;
  color: $text-secondary;
  text-align: center;
  margin: 0 0 24px 0;
  max-width: 500px;
  margin-left: auto;
  margin-right: auto;
}

// Features Grid
.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.feature-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  transition: all 0.3s ease;

  &:hover {
    background: rgba(0, 199, 243, 0.05);
    border-color: rgba(0, 199, 243, 0.2);
    transform: translateY(-2px);
  }

  .feature-icon {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 199, 243, 0.1);
    border-radius: 6px;
    color: $primary-cyan;
    flex-shrink: 0;
  }

  .feature-text {
    font-size: 11px;
    font-weight: 500;
    color: $text-secondary;
    line-height: 1.3;
  }
}



// Floating Elements
.floating-elements {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 2;
}

.floating-card {
  position: absolute;
  width: 200px;
  height: 120px;
  background: linear-gradient(
    135deg,
    rgba(0, 199, 243, 0.08) 0%,
    rgba(0, 255, 209, 0.08) 100%
  );
  backdrop-filter: blur(15px);
  -webkit-backdrop-filter: blur(15px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  opacity: 0.3;

  // Glass effect overlay
  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 100%;
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.04) 0%,
      transparent 50%
    );
    border-radius: 16px;
    pointer-events: none;
  }

  &.card-1 {
    top: 15%;
    left: 5%;
    width: 200px;
    height: 120px;
    opacity: 0.3;
    animation: card-float-1 20s ease-in-out infinite;
  }

  &.card-2 {
    top: 20%;
    right: 2%;
    width: 180px;
    height: 108px;
    opacity: 0.25;
    animation: card-float-2 25s ease-in-out infinite;
  }

  &.card-3 {
    top: 10%;
    left: 25%;
    width: 140px;
    height: 84px;
    opacity: 0.15;
    transform: rotateY(25deg) rotateX(10deg);
    animation: card-float-3 18s ease-in-out infinite;
  }

  &.card-4 {
    bottom: 10%;
    left: 8%;
    width: 160px;
    height: 96px;
    opacity: 0.2;
    transform: rotateY(-20deg) rotateX(-5deg);
    animation: card-float-4 22s ease-in-out infinite;
  }

  &.card-5 {
    bottom: 15%;
    right: 5%;
    width: 120px;
    height: 72px;
    opacity: 0.12;
    transform: rotateY(35deg) rotateX(15deg);
    animation: card-float-5 16s ease-in-out infinite;
  }

  &.card-6 {
    top: 8%;
    right: 20%;
    width: 100px;
    height: 60px;
    opacity: 0.08;
    transform: rotateY(-30deg) rotateX(8deg);
    animation: card-float-6 24s ease-in-out infinite;
  }
}

// Responsive Design
@media (max-width: 768px) {
  .liquid-glass-card {
    padding: 32px 24px;
  }

  .coming-soon-title {
    font-size: 36px;

    .gradient-text {
      font-size: 28px;
    }
  }

  .coming-soon-description {
    font-size: 16px;
  }

  .features-grid {
    grid-template-columns: 1fr 1fr;
  }

  .floating-card {
    display: none;
  }
}

@media (max-width: 480px) {
  .coming-soon-title {
    font-size: 28px;

    .gradient-text {
      font-size: 24px;
    }
  }

  .features-grid {
    grid-template-columns: 1fr;
  }
}

// Read More Section
.read-more-section {
  text-align: center;
  margin-top: 24px;
}

.read-more-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: $primary-cyan;
  text-decoration: none;
  font-size: 14px;
  font-weight: 500;
  padding: 8px 16px;
  border-radius: 8px;
  transition: all 0.3s ease;
  background: rgba(0, 199, 243, 0.1);
  border: 1px solid rgba(0, 199, 243, 0.2);

  &:hover {
    background: rgba(0, 199, 243, 0.15);
    border-color: rgba(0, 199, 243, 0.3);
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(0, 199, 243, 0.2);
  }

  span {
    color: $primary-cyan;
  }

  .read-more-icon {
    color: $primary-cyan;
    transition: transform 0.3s ease;
  }

  &:hover .read-more-icon {
    transform: translate(2px, -2px);
  }
}

</style>
