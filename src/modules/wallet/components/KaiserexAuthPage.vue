<template>
  <div class="kaiserex-auth-page card-hub">
    <!-- Signed in, but Zione did not approve the application: signing in again cannot help. -->
    <section v-if="isRejected" class="card-hub__rejected glass-panel" aria-labelledby="card-hub-rejected">
      <IsoScene name="attention" class="card-hub__rejected-art" />
      <div class="card-hub__rejected-copy">
        <CardChip tone="error">{{ t('card.rejected') }}</CardChip>
        <h1 id="card-hub-rejected" class="t-title">{{ t('card.applicationNotApproved') }}</h1>
        <p class="t-body">{{ t('card.applicationNotApprovedDesc') }}</p>
        <div class="card-hub__row">
          <GButton tier="secondary" :href="`mailto:${CARD_PROVIDER.supportEmail}`">
            <v-icon small left>mdi-email-outline</v-icon>
            {{ t('card.contactSupport') }}
          </GButton>
        </div>
      </div>
    </section>

    <!-- One path: the value and the primary action above the fold, then benefits, how it
         works, pricing and the partner's legal facts, in that order of importance. -->
    <template v-else>
      <header class="card-hub__hero" aria-labelledby="card-hub-title">
        <div class="card-hub__intro">
          <CardChip tone="accent" icon="mdi-tag-outline" clickable @click="showPromotionModal = true">
            {{ t('card.enjoyZeroFeesUntil') }}
          </CardChip>
          <div class="card-hub__headline">
            <h1 id="card-hub-title" class="t-display">{{ t('card.getYourGeroCryptoCard') }}</h1>
            <p class="card-hub__lead">{{ t('card.hubLead') }}</p>
          </div>
          <div class="card-hub__primary">
            <GButton tier="primary" @click="showRegistrationModal = true">{{ t('card.orderYourGeroCard') }}</GButton>
            <p class="t-body-sm">
              {{ t('card.newToKaiserex') }}
              <v-tooltip top :open-delay="300" max-width="320">
                <template #activator="{ on, attrs }">
                  <button type="button" class="card-hub__term" v-bind="attrs" v-on="on">{{ t('card.kaiserex') }}</button>
                </template>
                <span class="t-caption">{{ t('card.kaiserexTooltip') }}</span>
              </v-tooltip>?
            </p>
          </div>
          <div class="card-hub__row">
            <span class="t-body-sm">{{ t('card.alreadyHaveAccount') }}</span>
            <GButton tier="secondary" compact :loading="signingIn" @click="handleLogin">{{ t('card.signIn') }}</GButton>
          </div>
          <ul class="card-hub__trust">
            <li><v-icon x-small>mdi-lock-outline</v-icon>{{ t('card.secureSignInWindow') }}</li>
            <li><v-icon x-small>mdi-shield-check-outline</v-icon>{{ t('card.licensedRegulated') }} · FSP {{ CARD_PROVIDER.fspNumber }}</li>
          </ul>
        </div>
        <IsoScene name="hero" class="card-hub__art" :label="t('card.heroArtLabel')" />
      </header>

      <FeatureGridSection />

      <section class="card-hub__how" aria-labelledby="card-hub-how">
        <h2 id="card-hub-how" class="t-heading">{{ t('card.howItWorks') }}</h2>
        <ol class="card-hub__steps">
          <li v-for="(step, i) in steps" :key="step" class="glass-tier">
            <span class="card-hub__num g-num" aria-hidden="true">{{ i + 1 }}</span>
            <span class="card-hub__step">{{ step }}</span>
          </li>
        </ol>
      </section>

      <section class="card-hub__pricing glass-panel" aria-labelledby="card-hub-pricing">
        <div class="card-hub__pricing-col">
          <h2 id="card-hub-pricing" class="t-heading">{{ t('card.pricingTitle') }}</h2>
          <p class="t-body-sm">{{ t('card.enjoyZeroFeesUntil') }}</p>
          <ul class="card-hub__checks">
            <li><v-icon small>mdi-check</v-icon>{{ t('card.zeroMonthlyFees') }}</li>
            <li><v-icon small>mdi-check</v-icon>{{ t('card.zeroAdaEurFees') }}</li>
          </ul>
        </div>
        <div class="card-hub__pricing-col">
          <p class="t-body-sm">
            {{ t('card.startingMayFirst') }} <strong>{{ t('card.geroHolders') }}</strong>
            {{ t('card.willEnjoyTokenIncentives') }}
          </p>
          <GButton tier="secondary" @click="showPromotionModal = true">{{ t('card.viewFees') }}</GButton>
        </div>
      </section>

      <KaiserexPartnershipSection />
    </template>

    <KaiserexRegistrationModal
      :open="showRegistrationModal"
      @close="showRegistrationModal = false"
      @sign-in="signInFromRegistration"
    />
    <PromotionModal :open="showPromotionModal" @close="showPromotionModal = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { receiveKaiserExToken } from '@/services/kaiserEx.service';
import cardStore from '@/stores/modules/card';
import { debugLog } from '@/utils/debug';
import { CARD_PROVIDER } from '@/modules/wallet/cardProvider';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import CardChip from './ui/CardChip.vue';
import FeatureGridSection from './FeatureGridSection.vue';
import KaiserexRegistrationModal from './KaiserexRegistrationModal.vue';
import PromotionModal from './PromotionModal.vue';
import KaiserexPartnershipSection from './KaiserexPartnershipSection.vue';

const { t } = useTranslation();
const emit = defineEmits<{
  (e: 'auth-complete'): void;
}>();

const showRegistrationModal = ref(false);
const showPromotionModal = ref(false);
const signingIn = ref(false);

// The card page maps a rejected application to this page, so tell the user instead of
// offering a sign-in they already did.
const isRejected = computed(() => cardStore.isAuthenticated && cardStore.state.walletStatus.kycStatus === 'rejected');

const steps = computed(() => [
  t('card.registerOnKaiserex'),
  t('card.activateViaEmail'),
  t('card.signInCompleteKYC'),
  t('card.onceApprovedOrder'),
]);

async function handleLogin(): Promise<void> {
  signingIn.value = true;
  try {
    await receiveKaiserExToken(async tokenData => {
      try {
        await cardStore.setKaiserExTokens(tokenData);
        emit('auth-complete');
      } catch (error) {
        console.error('Failed to store card session:', error instanceof Error ? error.message : error);
      } finally {
        signingIn.value = false;
      }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'Authentication window was closed by user') {
      debugLog('Card sign-in cancelled by user');
    } else {
      console.error('Card sign-in failed:', message);
    }
    signingIn.value = false;
  }
}

function signInFromRegistration(): void {
  showRegistrationModal.value = false;
  handleLogin();
}
</script>

<style lang="scss" scoped>
.card-hub {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-6);
  width: 100%;
  max-width: var(--g-content-max);
  margin: 0 auto;
  padding: var(--g-s-6) clamp(16px, 3vw, 32px);
}

/* Hero: the value, one primary action, the secondary path, then trust. */
.card-hub__hero {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr));
  gap: var(--g-s-6);
  align-items: center;
}

.card-hub__intro {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-5);
}

.card-hub__headline {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);

  h1 {
    margin: 0;
  }
}

.card-hub__lead {
  margin: 0;
  max-width: 460px;
  font-size: 16px;
  color: var(--g-text-2);
}

.card-hub__primary {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-2);

  p {
    margin: 0;
  }
}

.card-hub__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-2) var(--g-s-3);
}

.card-hub__trust {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2) var(--g-s-5);
  align-self: stretch;
  margin: 0;
  padding: var(--g-s-4) 0 0;
  border-top: 1px solid var(--g-hairline-1);
  list-style: none;

  li {
    display: inline-flex;
    align-items: center;
    gap: var(--g-s-1);
    font-size: 12px;
    color: var(--g-text-3);
  }

  .v-icon {
    color: var(--g-text-3);
  }
}

.card-hub__art {
  max-width: 560px;
  justify-self: end;
}

.card-hub__term {
  padding: 0;
  border: 0;
  background: none;
  color: var(--g-accent);
  font: inherit;
  text-decoration: underline dotted;
  text-underline-offset: 3px;
  cursor: help;
}

/* How it works: the process once, as four numbered steps. */
.card-hub__how {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);

  h2 {
    margin: 0;
  }
}

.card-hub__steps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: var(--g-s-3);
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: flex;
    align-items: center;
    gap: var(--g-s-3);
    padding: var(--g-s-4);
  }
}

.card-hub__num {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  flex: none;
  border-radius: var(--g-r-pill);
  border: 1px solid color-mix(in srgb, var(--g-accent) 40%, transparent);
  color: var(--g-accent);
  font-size: 13px;
  font-weight: 600;
}

.card-hub__step {
  font-size: 14px;
  color: var(--g-text-1);
}

/* Pricing: what applies now and what changes after the promotion. */
.card-hub__pricing {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
  gap: var(--g-s-5);
  align-items: center;
  padding: var(--g-s-5);
}

.card-hub__pricing-col {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-3);

  h2,
  p {
    margin: 0;
  }

  strong {
    color: var(--g-text-1);
  }
}

.card-hub__checks {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 13px;
  color: var(--g-text-2);

  li {
    display: flex;
    align-items: center;
    gap: var(--g-s-2);
  }

  .v-icon {
    color: var(--g-accent);
  }
}

.card-hub__rejected {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
  gap: var(--g-s-5);
  align-items: center;
  padding: var(--g-s-6);
}

.card-hub__rejected-art {
  max-width: 340px;
  justify-self: center;
}

.card-hub__rejected-copy {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  align-items: flex-start;

  h1,
  p {
    margin: 0;
  }
}
</style>
