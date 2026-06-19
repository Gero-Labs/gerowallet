<template>
  <div class="feature-coming-soon">
    <div class="coming-soon-icon">🚀</div>
    <h2 class="coming-soon-title">{{ $t('wallet.comingSoon') }}</h2>
    <p class="coming-soon-message">
      {{ $t('wallet.physicalCardOrderingComingSoon') }}
    </p>
    <p class="coming-soon-submessage">
      {{ $t('wallet.stayTuned') }}
    </p>
  </div>
</template>

<script setup lang="ts">
// Simple coming soon page for feature flags
</script>

<style lang="scss" scoped>
.feature-coming-soon {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 400px;
  text-align: center;
  padding: 40px;
}

.coming-soon-icon {
  font-size: 80px;
  margin-bottom: 32px;
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-20px);
  }
}

.coming-soon-title {
  color: #fff;
  font-size: 32px;
  font-weight: 700;
  margin: 0 0 16px 0;
  background: linear-gradient(135deg, #00c7f3 0%, #00ffd1 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.coming-soon-message {
  color: #cecfd2;
  font-size: 18px;
  margin: 0 0 12px 0;
  max-width: 500px;
  line-height: 1.6;
}

.coming-soon-submessage {
  color: #8e9195;
  font-size: 14px;
  margin: 0;
  max-width: 400px;
  line-height: 1.5;
}

// Responsive design
@media (max-width: 768px) {
  .feature-coming-soon {
    min-height: 300px;
    padding: 24px;
  }

  .coming-soon-icon {
    font-size: 64px;
    margin-bottom: 24px;
  }

  .coming-soon-title {
    font-size: 24px;
  }

  .coming-soon-message {
    font-size: 16px;
  }

  .coming-soon-submessage {
    font-size: 13px;
  }
}
</style>