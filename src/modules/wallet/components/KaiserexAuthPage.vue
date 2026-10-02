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

    <template v-else>
      <header class="card-hub__hero">
        <div class="card-hub__intro">
          <span class="t-label card-hub__eyebrow">{{ t('card.geroCard') }}</span>
          <h1 class="t-display">{{ t('card.getYourGeroCryptoCard') }}</h1>
          <p class="card-hub__lead t-body">{{ t('card.chooseOptionBelow') }}</p>
          <div class="card-hub__row">
            <CardChip tone="accent" icon="mdi-tag-outline" clickable @click="showPromotionModal = true">
              {{ t('card.enjoyZeroFeesUntil') }}
            </CardChip>
            <GButton tier="tertiary" compact @click="showPromotionModal = true">{{ t('card.viewFees') }}</GButton>
          </div>
        </div>
        <IsoScene name="hero" class="card-hub__art" :label="t('card.heroArtLabel')" />
      </header>

      <CardJourney :current="0" />

      <div class="card-hub__options">
        <article class="card-hub__steps glass-tier">
          <h2 class="t-body-lg">{{ t('card.getCardInSteps') }}</h2>
          <ol class="card-hub__numbered">
            <li v-for="(step, i) in steps" :key="step">
              <span class="card-hub__num g-num" aria-hidden="true">{{ i + 1 }}</span>
              {{ step }}
            </li>
          </ol>
          <hr class="card-hub__rule" />
          <ul class="card-hub__checks">
            <li><v-icon small>mdi-check</v-icon>{{ t('card.zeroMonthlyFees') }}</li>
            <li><v-icon small>mdi-check</v-icon>{{ t('card.zeroAdaEurFees') }}</li>
          </ul>
        </article>

        <article class="card-hub__option card-hub__option--lead glass-panel">
          <IsoScene name="register" class="card-hub__option-art" />
          <div class="card-hub__option-copy">
            <h2 class="t-heading">{{ t('card.registerToOrderCard') }}</h2>
            <p class="t-body">{{ t('card.createKaiserexAccount') }}</p>
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
          <GButton tier="primary" block @click="showRegistrationModal = true">{{ t('card.orderYourGeroCard') }}</GButton>
        </article>

        <article class="card-hub__option glass-panel">
          <IsoScene name="activate" class="card-hub__option-art" />
          <div class="card-hub__option-copy">
            <h2 class="t-heading">{{ t('card.alreadyHaveAccount') }}</h2>
            <p class="t-body">{{ t('card.signInTopUpCheck') }}</p>
            <ul class="card-hub__checks">
              <li><v-icon small>mdi-check</v-icon>{{ t('card.checkOrderStatus') }}</li>
              <li><v-icon small>mdi-check</v-icon>{{ t('card.topUpCardWithAda') }}</li>
              <li><v-icon small>mdi-check</v-icon>{{ t('card.orderAdditionalCards') }}</li>
            </ul>
          </div>
          <div class="card-hub__signin">
            <GButton tier="secondary" block :loading="signingIn" @click="handleLogin">{{ t('card.signIn') }}</GButton>
            <span class="t-caption card-hub__secure">
              <v-icon x-small>mdi-lock-outline</v-icon>
              {{ t('card.secureSignInWindow') }}
            </span>
          </div>
        </article>
      </div>

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
import CardJourney from './ui/CardJourney.vue';
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

.card-hub__hero {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(420px, 100%), 1fr));
  gap: var(--g-s-5);
  align-items: center;
}

.card-hub__intro {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);

  h1 {
    margin: 0;
  }
}

.card-hub__eyebrow {
  color: var(--g-accent);
}

.card-hub__lead {
  margin: 0;
  max-width: 520px;
  font-size: 16px;
}

.card-hub__art {
  max-width: 560px;
  justify-self: end;
}

.card-hub__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-2);
}

.card-hub__options {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: var(--g-s-4);
}

.card-hub__steps,
.card-hub__option {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-5);

  h2 {
    margin: 0;
  }
}

.card-hub__option--lead {
  border-color: color-mix(in srgb, var(--g-accent) 30%, transparent);
}

.card-hub__option-art {
  width: 160px;
}

.card-hub__option-copy {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  flex: 1;

  p {
    margin: 0;
  }
}

.card-hub__numbered,
.card-hub__checks {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
  font-size: 14px;
  color: var(--g-text-2);
}

.card-hub__numbered {
  gap: var(--g-s-3);

  li {
    display: flex;
    align-items: center;
    gap: var(--g-s-3);
  }
}

.card-hub__num {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-1);
  color: var(--g-text-1);
  font-size: 12px;
  font-weight: 600;
}

.card-hub__checks {
  gap: var(--g-s-2);
  font-size: 13px;

  li {
    display: flex;
    align-items: center;
    gap: var(--g-s-2);
  }

  .v-icon {
    color: var(--g-accent);
  }
}

.card-hub__rule {
  border: 0;
  height: 1px;
  margin: 0;
  background: var(--g-hairline-1);
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

.card-hub__signin {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.card-hub__secure {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-1);
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
