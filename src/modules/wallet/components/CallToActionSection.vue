<template>
  <section class="call-to-action-section">
    <!-- Left: the 3D card. Its tilt, shine and glow are unchanged. -->
    <div class="card-column">
      <div class="card-container">
        <div
          class="credit-card"
          @mousemove="handleCardMouseMove"
          @mouseleave="handleCardMouseLeave"
          :style="cardTiltStyle"
        >
          <!-- Shine effect -->
          <div class="card-shine" :style="cardShineStyle"></div>
        </div>
      </div>
    </div>

    <!-- Right: identity verification with Zione -->
    <div class="kyc-column">
      <span class="t-label kyc-eyebrow">{{ t('card.journeyVerify') }}</span>
      <h1 class="t-display">{{ t('card.spendAdaAnywhere') }}</h1>
      <p class="kyc-lead">{{ t('card.beforeOrderingKYC') }}</p>

      <div v-if="verificationFailed" class="kyc-failed" role="status">
        <IsoScene name="attention" class="kyc-failed__art" />
        <div class="kyc-failed__copy">
          <CardChip tone="warning">{{ t('card.verificationFailed') }}</CardChip>
          <h2 class="t-body-lg">{{ t('card.verificationFailedTitle') }}</h2>
          <p class="t-body-sm">{{ t('card.verificationFailedDesc') }}</p>
        </div>
      </div>

      <div v-if="kycStatus !== 'verified'" class="kyc-action">
        <GButton tier="primary" :loading="openingKyc" @click="startKYC">
          {{ verificationFailed ? t('card.restartVerification') : t('card.startKYCProcess') }}
          <v-icon small right>mdi-open-in-new</v-icon>
        </GButton>
        <span class="t-caption">{{ t('card.kycOpensNewTab') }}</span>
      </div>

      <div class="kyc-status glass-tier">
        <span class="t-body-sm">{{ t('card.yourKYCStatus') }}</span>
        <v-tooltip bottom max-width="350" :open-delay="300">
          <template #activator="{ on, attrs }">
            <span class="kyc-status__chip" tabindex="0" v-bind="attrs" v-on="on">
              <CardChip :tone="verificationFailed ? 'warning' : 'neutral'">{{ statusLabel }}</CardChip>
            </span>
          </template>
          <div class="kyc-status__help">
            <p class="t-caption"><strong>{{ t('card.kycRegistered') }}:</strong> {{ t('card.kycRegisteredDesc') }}</p>
            <p class="t-caption"><strong>{{ t('card.kycVerificationStarted') }}:</strong> {{ t('card.kycVerificationStartedDesc') }}</p>
          </div>
        </v-tooltip>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import cardStore from '@/stores/modules/card';
import snackbar from '@/plugins/snackbar';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import CardChip from './ui/CardChip.vue';

const { t } = useTranslation();

const cardTiltStyle = ref<Record<string, string>>({});
const cardShineStyle = ref<Record<string, string | number>>({});
const openingKyc = ref(false);

const kycStatus = computed(() => cardStore.state.walletStatus.kycStatus);
const verificationFailed = computed(() => kycStatus.value === 'verification_failed');

const statusLabel = computed(() => {
  switch (kycStatus.value) {
    case 'verification_started':
      return t('card.kycVerificationStarted');
    case 'verification_failed':
      return t('card.verificationFailed');
    case 'verified':
      return t('card.kycUnderReview');
    default:
      return t('card.kycRegistered');
  }
});

async function startKYC(): Promise<void> {
  openingKyc.value = true;
  try {
    await cardStore.fetchKYCLink();
  } catch {
    snackbar.setError(t('card.kycLinkFailed'));
  } finally {
    openingKyc.value = false;
  }
}

// 3D Card tilt effect with shine and dynamic glow
const handleCardMouseMove = (event: MouseEvent) => {
  const card = event.currentTarget as HTMLElement;
  const rect = card.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const centerX = rect.width / 2;
  const centerY = rect.height / 2;

  const rotateX = (y - centerY) / 20;
  const rotateY = (centerX - x) / 20;

  // Calculate shine position based on mouse
  const percentX = (x / rect.width) * 100;
  const percentY = (y / rect.height) * 100;

  // Calculate glow offset based on tilt
  const glowOffsetX = rotateY * 2; // Horizontal shift
  const glowOffsetY = -rotateX * 2; // Vertical shift (inverted)

  cardTiltStyle.value = {
    transform: `scale(0.7) perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(5px)`,
    transition: 'transform 0.1s ease-out',
    boxShadow: `
      0 10px 30px rgba(0, 0, 0, 0.3),
      ${glowOffsetX}px ${glowOffsetY}px 120px rgba(0, 200, 200, 0.12),
      ${glowOffsetX * 0.5}px ${glowOffsetY * 0.5}px 60px rgba(0, 200, 200, 0.08)
    `,
  };

  cardShineStyle.value = {
    background: `
      radial-gradient(circle at ${percentX}% ${percentY}%, rgba(255, 255, 255, 0.08) 0%, transparent 50%),
      linear-gradient(135deg, rgba(255, 255, 255, 0.03) 0%, transparent 50%, rgba(255, 255, 255, 0.02) 100%)
    `,
    opacity: 1,
  };
};

const handleCardMouseLeave = () => {
  cardTiltStyle.value = {
    transform: 'scale(0.7) perspective(1000px) rotateX(0deg) rotateY(0deg) translateZ(0px)',
    transition: 'transform 0.3s ease-out',
    boxShadow: `
      0 10px 30px rgba(0, 0, 0, 0.3),
      0 0 120px rgba(0, 200, 200, 0.12),
      0 0 60px rgba(0, 200, 200, 0.08)
    `,
  };

  cardShineStyle.value = {
    opacity: 0,
    transition: 'opacity 0.3s ease-out',
  };
};
</script>

<style lang="scss" scoped>
.call-to-action-section {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr));
  gap: var(--g-s-5);
  align-items: center;
  width: 100%;
}

.card-column {
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-container {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
}

.kyc-column {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  max-width: 520px;

  h1 {
    margin: 0;
  }
}

.kyc-eyebrow {
  color: var(--g-accent);
}

.kyc-lead {
  margin: 0;
  font-size: 16px;
  color: var(--g-text-2);
}

.kyc-failed {
  display: flex;
  gap: var(--g-s-4);
  align-items: center;
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
}

.kyc-failed__art {
  width: 112px;
  flex: none;
}

.kyc-failed__copy {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-2);

  h2,
  p {
    margin: 0;
  }
}

.kyc-action {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-2);
}

.kyc-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
}

.kyc-status__chip {
  cursor: help;
  border-radius: var(--g-r-pill);
}

.kyc-status__help p {
  margin: 0 0 var(--g-s-2);

  &:last-child {
    margin-bottom: 0;
  }
}

// Credit Card Styling (the 3D card: unchanged)
.credit-card {
  width: 35rem;
  aspect-ratio: 345 / 222;
  max-width: 90%;
  margin: 0 auto;
  background-image: url('@/assets/front_card_no_mcx2.png');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  border-radius: 1rem;
  padding: 2rem;
  color: white;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3), 0 0 120px rgba(0, 200, 200, 0.12), 0 0 60px rgba(0, 200, 200, 0.08);
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  cursor: pointer;
  transform-style: preserve-3d;
  transform: scale(0.7);
  overflow: hidden;
}

.card-shine {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: 1rem;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--g-dur-fast) ease-out;
  z-index: 1;
}
</style>
