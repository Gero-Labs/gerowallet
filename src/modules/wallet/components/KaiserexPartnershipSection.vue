<template>
  <section class="card-partner glass-panel" aria-labelledby="card-partner-heading">
    <div class="card-partner__intro">
      <IsoScene name="bridge" :animated="animated" class="card-partner__art" />
      <div class="card-partner__copy">
        <span class="t-label">{{ t('card.cardProgramPartner') }}</span>
        <h2 id="card-partner-heading" class="t-heading">{{ t('card.poweredByKaiserex') }}</h2>
        <p class="t-body">{{ t('card.cardPoweredByKaiser') }}</p>
      </div>
    </div>

    <div class="card-partner__facts">
      <!-- Facts from zione.com: Terms of Service section 1 and the AML/CFT policy section 9 -->
      <div class="card-partner__trust">
        <article class="card-partner__tile glass-tier">
          <h3 class="card-partner__tile-title t-body-lg">
            <v-icon small>mdi-shield-check-outline</v-icon>
            {{ t('card.providerRegulated') }}
          </h3>
          <p class="t-body-sm">{{ t('card.providerRegulatedDesc') }}</p>
        </article>
        <article class="card-partner__tile glass-tier">
          <h3 class="card-partner__tile-title t-body-lg">
            <v-icon small>mdi-account-check-outline</v-icon>
            {{ t('card.providerAmlKyc') }}
          </h3>
          <p class="t-body-sm">{{ t('card.providerAmlKycDesc') }}</p>
        </article>
      </div>

      <dl class="card-partner__legal">
        <dt>{{ t('card.legalEntity') }}</dt>
        <dd>{{ t('card.kaiserExchangeInternational') }}</dd>
        <dt>{{ t('card.registrationDetails') }}</dt>
        <dd class="g-num">{{ t('card.companyDetails') }}</dd>
        <dt>{{ t('card.providerRegisteredOffice') }}</dt>
        <dd>{{ CARD_PROVIDER.registeredOffice }}</dd>
        <dt>{{ t('support.toggle.support') }}</dt>
        <dd>
          <a :href="`mailto:${CARD_PROVIDER.supportEmail}`">{{ CARD_PROVIDER.supportEmail }}</a>
        </dd>
      </dl>

      <div class="card-partner__links">
        <GButton tier="tertiary" compact :href="CARD_PROVIDER.websiteUrl" target="_blank" rel="noopener noreferrer">
          {{ t('card.learnMoreKaiserex') }}
          <v-icon small right>mdi-open-in-new</v-icon>
        </GButton>
        <GButton tier="tertiary" compact :href="CARD_PROVIDER.termsUrl" target="_blank" rel="noopener noreferrer">
          {{ t('navigation.termsOfService') }}
        </GButton>
        <GButton tier="tertiary" compact :href="CARD_PROVIDER.privacyUrl" target="_blank" rel="noopener noreferrer">
          {{ t('navigation.privacyPolicy') }}
        </GButton>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { CARD_PROVIDER } from '@/modules/wallet/cardProvider';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';

withDefaults(defineProps<{ animated?: boolean }>(), { animated: false });

const { t } = useTranslation();
</script>

<style lang="scss" scoped>
.card-partner {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
  gap: var(--g-s-5);
  padding: var(--g-s-5);
  align-items: center;
}

.card-partner__intro,
.card-partner__copy,
.card-partner__facts {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.card-partner__copy {
  gap: var(--g-s-2);
}

.card-partner__copy p {
  margin: 0;
}

.card-partner__art {
  max-width: 320px;
}

.card-partner__trust {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
  gap: var(--g-s-3);
}

.card-partner__tile {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-4);

  p {
    margin: 0;
  }
}

.card-partner__tile-title {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin: 0;

  .v-icon {
    color: var(--g-accent);
  }
}

.card-partner__legal {
  display: grid;
  grid-template-columns: minmax(120px, auto) 1fr;
  gap: var(--g-s-2) var(--g-s-4);
  margin: 0;
  font-size: 13px;

  dt {
    color: var(--g-text-3);
  }

  dd {
    margin: 0;
    color: var(--g-text-1);
  }

  a {
    color: var(--g-accent);
  }
}

.card-partner__links {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-1);
  margin-left: calc(-1 * var(--g-s-3));
}
</style>
