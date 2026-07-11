<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <div class="nexus-page">

          <!-- ═══ Hero ═══ -->
          <section class="nx-hero nx-reveal" style="--nx-d: 0ms">
            <img :src="assets.nexusLogo" alt="Nexus" class="nx-hero__mark" width="88" height="88" />
            <h1 class="nx-hero__title">{{ $t('nexus.heroTitle') }}</h1>
            <p class="nx-hero__sub">{{ $t('nexus.heroSubtitle') }}</p>
            <div class="nx-hero__ctas">
              <v-btn class="geroButton nx-cta" href="https://nexus.gerowallet.io" target="_blank" rel="noopener">
                {{ $t('nexus.exploreNexus') }}
                <v-icon small right>mdi-arrow-top-right</v-icon>
              </v-btn>
              <v-btn outlined class="nx-cta nx-cta--ghost" href="https://nexus.gerowallet.io/swagger-ui" target="_blank" rel="noopener">
                {{ $t('nexus.viewDocs') }}
              </v-btn>
            </div>

            <!-- Proof strip: real numbers from the product -->
            <div class="nx-proof">
              <div class="nx-proof__item">
                <span class="nx-proof__num g-num">3</span>
                <span class="nx-proof__label">{{ $t('nexus.proofChains') }}</span>
              </div>
              <span class="nx-proof__sep"></span>
              <div class="nx-proof__item">
                <span class="nx-proof__num g-num">11</span>
                <span class="nx-proof__label">{{ $t('nexus.proofDexes') }}</span>
              </div>
            </div>
          </section>

          <!-- ═══ What is Nexus ═══ -->
          <section class="nx-sect nx-reveal" style="--nx-d: 90ms">
            <p class="nx-what">{{ $t('nexus.whatIs') }}</p>
          </section>

          <!-- ═══ Products ═══ -->
          <section class="nx-sect nx-reveal" style="--nx-d: 180ms">
            <h2 class="nx-sect__title">{{ $t('nexus.productsTitle') }}</h2>
            <div class="nx-grid">
              <div v-for="p in products" :key="p.key" class="nx-card">
                <div class="nx-card__icon" :style="{ color: p.color }">
                  <v-icon :color="p.color" size="22">{{ p.icon }}</v-icon>
                </div>
                <h3 class="nx-card__title">{{ $t(`nexus.product.${p.key}`) }}</h3>
                <p class="nx-card__desc">{{ $t(`nexus.product.${p.key}Desc`) }}</p>
              </div>
            </div>
          </section>

          <!-- ═══ Who it's for ═══ -->
          <section class="nx-sect nx-reveal" style="--nx-d: 270ms">
            <h2 class="nx-sect__title">{{ $t('nexus.audienceTitle') }}</h2>
            <div class="nx-personas">
              <div v-for="a in audiences" :key="a.key" class="nx-persona">
                <v-icon size="20" color="var(--g-text-2)" class="nx-persona__icon">{{ a.icon }}</v-icon>
                <div>
                  <h3 class="nx-persona__title">{{ $t(`nexus.audience.${a.key}`) }}</h3>
                  <p class="nx-persona__desc">{{ $t(`nexus.audience.${a.key}Desc`) }}</p>
                </div>
              </div>
            </div>
          </section>

          <!-- ═══ Why Nexus ═══ -->
          <section class="nx-sect nx-reveal" style="--nx-d: 360ms">
            <h2 class="nx-sect__title">{{ $t('nexus.whyTitle') }}</h2>
            <ul class="nx-why">
              <li v-for="w in whys" :key="w" class="nx-why__item">
                <v-icon size="15" color="var(--g-success)">mdi-check</v-icon>
                <span>{{ $t(`nexus.why.${w}`) }}</span>
              </li>
            </ul>
          </section>

          <!-- ═══ Footer CTA ═══ -->
          <section class="nx-final nx-reveal" style="--nx-d: 450ms">
            <h2 class="nx-final__title">{{ $t('nexus.finalTitle') }}</h2>
            <p class="nx-final__sub">{{ $t('nexus.finalSubtitle') }}</p>
            <v-btn class="geroButton nx-cta" href="https://nexus.gerowallet.io/get-started" target="_blank" rel="noopener">
              {{ $t('nexus.startTrial') }}
              <v-icon small right>mdi-arrow-top-right</v-icon>
            </v-btn>
            <p class="nx-final__note">{{ $t('nexus.geroDiscount') }}</p>
          </section>

        </div>
      </v-col>
    </v-row>
  </v-layout>
</template>

<script setup lang="ts">
import assets from '@/utils/assets';

// Product areas: grounded in the Nexus API surface (nexus repo:
// application.yml swagger allowlist + controller mappings). Colors are the
// four gradient families of the Nexus logo mark.
const products = [
  { key: 'chainData', icon: 'mdi-cube-outline', color: '#4A9ADA' },
  { key: 'marketData', icon: 'mdi-chart-line', color: '#44A8B4' },
  { key: 'walletAnalytics', icon: 'mdi-wallet-outline', color: '#5F78D0' },
  { key: 'txBuilder', icon: 'mdi-file-sign', color: '#7B6CDC' },
  { key: 'swapAggregation', icon: 'mdi-swap-horizontal', color: '#44A8B4' },
  { key: 'streaming', icon: 'mdi-broadcast', color: '#4A9ADA' },
  { key: 'multiChain', icon: 'mdi-link-variant', color: '#5F78D0' },
  { key: 'mcp', icon: 'mdi-robot-outline', color: '#7B6CDC' },
];

// ICP order from nexus/docs/gtm/icp.md
const audiences = [
  { key: 'enterprises', icon: 'mdi-office-building-outline' },
  { key: 'utxoTeams', icon: 'mdi-source-branch' },
  { key: 'dappBuilders', icon: 'mdi-code-braces' },
];

const whys = ['failover', 'oneKey', 'flatPricing', 'openapi', 'sdks'];
</script>

<style lang="scss" scoped>
.nexus-page {
  max-width: 880px;
  margin: 0 auto;
  padding: 40px 16px 72px;
}

/* Staggered load reveal; collapses to plain fade for reduced motion. */
.nx-reveal {
  animation: nx-rise var(--g-dur-slow) var(--g-ease) both;
  animation-delay: var(--nx-d, 0ms);
}

@keyframes nx-rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .nx-reveal { animation: none; }
}

/* ── Hero ── */
.nx-hero {
  text-align: center;
  margin-bottom: 40px;
}

.nx-hero__mark {
  margin-bottom: 20px;
}

.nx-hero__title {
  font-size: 34px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
  color: var(--g-text-1);
  margin: 0 auto 12px;
  max-width: 620px;
}

.nx-hero__sub {
  font-size: 15px;
  line-height: 1.55;
  color: var(--g-text-2);
  max-width: 560px;
  margin: 0 auto 24px;
}

.nx-hero__ctas {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
}

.nx-cta {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 600;
}

.nx-cta--ghost {
  color: var(--g-text-1) !important;
  border-color: var(--g-hairline-3) !important;
}

.nx-cta--ghost:hover {
  border-color: var(--g-accent) !important;
  color: var(--g-accent) !important;
}

/* Proof strip */
.nx-proof {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 22px;
  margin-top: 32px;
  flex-wrap: wrap;
}

.nx-proof__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.nx-proof__num {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--g-text-1);
}

.nx-proof__label {
  font-size: 11.5px;
  color: var(--g-text-3);
}

.nx-proof__sep {
  width: 1px;
  height: 26px;
  background: var(--g-hairline-2);
}

/* ── What is ── */
.nx-what {
  font-size: 16px;
  line-height: 1.65;
  color: var(--g-text-2);
  text-align: center;
  max-width: 680px;
  margin: 0 auto;
}

/* ── Sections ── */
.nx-sect {
  margin-top: 52px;
}

.nx-sect__title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.09em;
  text-transform: uppercase;
  color: var(--g-text-3);
  margin: 0 0 16px;
}

/* ── Product grid ── */
.nx-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}

.nx-card {
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: 16px 15px;
  transition: border-color var(--g-dur-fast) var(--g-ease), transform var(--g-dur-fast) var(--g-ease);
}

.nx-card:hover {
  border-color: var(--g-hairline-3);
  transform: translateY(-2px);
}

.nx-card__icon {
  margin-bottom: 10px;
}

.nx-card__title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--g-text-1);
  margin: 0 0 4px;
}

.nx-card__desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--g-text-3);
  margin: 0;
}

/* ── Personas ── */
.nx-personas {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.nx-persona {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  background: transparent;
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: 16px;
}

.nx-persona__icon {
  margin-top: 2px;
}

.nx-persona__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--g-text-1);
  margin: 0 0 4px;
}

.nx-persona__desc {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--g-text-3);
  margin: 0;
}

/* ── Why ── */
.nx-why {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px 24px;
}

.nx-why__item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--g-text-2);

  .v-icon {
    margin-top: 3px;
  }
}

/* ── Final CTA ── */
.nx-final {
  margin-top: 64px;
  text-align: center;
  padding: 36px 24px;
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-sheet);
  background:
    radial-gradient(420px 180px at 50% 0%, color-mix(in srgb, #5F78D0 9%, transparent), transparent 70%),
    var(--g-surface);
}

.nx-final__title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--g-text-1);
  margin: 0 0 8px;
}

.nx-final__sub {
  font-size: 14px;
  color: var(--g-text-2);
  margin: 0 auto 20px;
  max-width: 480px;
}

.nx-final__note {
  font-size: 12px;
  color: var(--g-text-3);
  margin: 14px 0 0;
}

/* ── Responsive ── */
@media (max-width: 900px) {
  .nx-grid { grid-template-columns: repeat(2, 1fr); }
  .nx-personas { grid-template-columns: 1fr; }
  .nx-why { grid-template-columns: 1fr; }
}

@media (max-width: 520px) {
  .nx-grid { grid-template-columns: 1fr; }
  .nx-hero__title { font-size: 27px; }
}
</style>
