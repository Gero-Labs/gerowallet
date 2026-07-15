<template>
  <!-- Empty-wallet incentive strip: what a funded wallet unlocks, as tappable
       teasers. Each card renders only where the feature exists (same chain
       gating as the EmptyStateHero perks footnote).

       Deliberate canon deviations, both user-requested for this surface only
       (2026-07-15): ambient animation loops (long rest phases, desynced per
       card, killed under prefers-reduced-motion) and one soft per-perk hue
       wash so the cards read distinct. Don't copy either pattern elsewhere
       without the same sign-off. -->
  <section v-if="perks.length" class="perk-teasers">
    <p class="perk-teasers__label g-mono">{{ $t('dashboard.onceFundedTitle') }}</p>
    <div class="perk-teasers__grid">
      <button
        v-for="(perk, i) in perks"
        :key="perk.key"
        type="button"
        :class="['perk-teasers__card', 'glass-panel', `perk-teasers__card--${perk.key}`]"
        :style="{ '--pt-d': `${i * 60}ms`, '--pt-loop-d': `${i * 520}ms` }"
        @click="perk.go()"
      >
        <!-- Hand-drawn hue-stroked SVGs. transform-box: fill-box is what lets
             bars/coins scale around their own box instead of the viewBox
             origin. -->
        <span class="perk-teasers__icon" aria-hidden="true">
          <svg v-if="perk.key === 'stake'" class="pt-svg" viewBox="0 0 24 24">
            <rect class="pt-bar" x="4" y="13" width="3.4" height="7" rx="1" />
            <rect class="pt-bar" x="10.3" y="9" width="3.4" height="11" rx="1" />
            <rect class="pt-bar" x="16.6" y="5" width="3.4" height="15" rx="1" />
          </svg>
          <svg v-else-if="perk.key === 'cashback'" class="pt-svg" viewBox="0 0 24 24">
            <g class="pt-coin">
              <circle cx="12" cy="12" r="7.6" fill="none" />
              <path d="M9.4 15.6 L12 8.4 L14.6 15.6" fill="none" />
              <path d="M9.9 13.1 H14.1" fill="none" />
            </g>
          </svg>
          <svg v-else-if="perk.key === 'card'" class="pt-svg" viewBox="0 0 24 24">
            <g class="pt-cc">
              <rect x="3.5" y="6" width="17" height="12" rx="2" fill="none" />
              <rect class="pt-cc-chip" x="6.5" y="9" width="3.4" height="2.6" rx="0.6" />
              <path d="M6.5 14.8 H13" fill="none" />
            </g>
          </svg>
          <svg v-else-if="perk.key === 'swap'" class="pt-svg" viewBox="0 0 24 24">
            <g class="pt-swap">
              <path d="M5 9 H17 M14.4 5.8 L17.8 9 L14.4 12.2" fill="none" />
              <path d="M19 15 H7 M9.6 11.8 L6.2 15 L9.6 18.2" fill="none" />
            </g>
          </svg>
          <svg v-else class="pt-svg" viewBox="0 0 24 24">
            <path class="pt-line" pathLength="100" d="M3.5 16.5 L8 12.5 L11.5 14.5 L15.5 8.5 L20.5 6" fill="none" />
            <circle class="pt-dot" cx="20.5" cy="6" r="1.8" />
          </svg>
        </span>
        <span class="perk-teasers__text">
          <span class="perk-teasers__title">{{ $t(perk.title) }}</span>
          <span class="perk-teasers__hook">{{ $t(perk.hook) }}</span>
        </span>
        <span class="perk-teasers__arrow" aria-hidden="true">→</span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { toRefs, computed, getCurrentInstance } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import networks from '@/utils/networks';
import featureFlagsStore from '@/stores/featureFlagsStore';
import { useQuickActionDialogs } from '@/shared/composables/useQuickActionDialogs';

const { loggedWallet } = toRefs(walletStore);
const instance = getCurrentInstance();
const router = instance?.proxy?.$router;
const { openDialog } = useQuickActionDialogs();

const perks = computed(() => {
  const chain = loggedWallet.value?.chain;
  const network = loggedWallet.value?.network;
  const list: { key: string; title: string; hook: string; go: () => void }[] = [];
  if (networks.resolveSwapSupport(chain, network) && featureFlagsStore.isSwapEnabled()) {
    list.push({
      key: 'swap', title: 'portfolio.perkSwapTitle', hook: 'portfolio.perkSwapHook',
      go: () => openDialog('SWAP'),
    });
  }
  if (networks.resolveStakingSupport(chain, network)) {
    list.push({
      key: 'stake', title: 'dashboard.perkStakeTitle', hook: 'portfolio.perkStakeHook',
      go: () => router?.push('/staking'),
    });
  }
  if (chain === Blockchain.CARDANO) {
    list.push({
      key: 'cashback', title: 'dashboard.perkCashbackTitle', hook: 'portfolio.perkCashbackHook',
      go: () => router?.push('/cashback'),
    });
  }
  if (networks.resolveGeroCardSupport(chain, network)) {
    list.push({
      key: 'card', title: 'dashboard.perkSpendTitle', hook: 'portfolio.perkSpendHook',
      go: () => router?.push('/card'),
    });
  }
  if (networks.resolvePerpetualsSupport(chain, network)) {
    list.push({
      key: 'perps', title: 'portfolio.perkPerpsTitle', hook: 'portfolio.perkPerpsHook',
      go: () => openDialog('PERPETUALS'),
    });
  }
  return list;
});
</script>

<style scoped>
.perk-teasers__label {
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--g-text-3);
  margin: 0 0 8px 2px;
}

.perk-teasers__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--g-s-2);
}

/* Per-perk hue: soft top-to-bottom wash over the raised surface. Semantic
   tokens where one fits; the card perk carries the single new violet. */
.perk-teasers__card--stake { --pt-hue: var(--g-success); }
.perk-teasers__card--cashback { --pt-hue: var(--g-warning); }
.perk-teasers__card--card { --pt-hue: #A78BFA; }
.perk-teasers__card--perps { --pt-hue: var(--g-info); }
.perk-teasers__card--swap { --pt-hue: var(--g-accent); }

/* Surface (glass background/border/radius) comes from the shared
   .glass-panel material. The per-perk hue wash lives on a ::before overlay
   so it layers over the glass without fighting its flagged background. */
.perk-teasers__card {
  appearance: none;
  font: inherit;
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  padding: var(--g-s-3);
  cursor: pointer;
  animation: pt-rise var(--g-dur-slow) var(--g-ease) both;
  animation-delay: var(--pt-d, 0ms);
}

.perk-teasers__card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--pt-hue) 14%, transparent),
    transparent 72%
  );
  opacity: 0.75;
  pointer-events: none;
  transition: opacity var(--g-dur-fast) var(--g-ease);
}

.perk-teasers__card:hover::before,
.perk-teasers__card:focus-visible::before {
  opacity: 1;
}

/* Positioned so they paint above the ::before wash (tree order). */
.perk-teasers__icon,
.perk-teasers__text,
.perk-teasers__arrow {
  position: relative;
}

@keyframes pt-rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}

.perk-teasers__icon {
  width: 38px;
  height: 38px;
  border-radius: var(--g-r-control);
  background: color-mix(in srgb, var(--pt-hue) 14%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* ── SVG ambient loops ──
   Every cycle is mostly rest: the action lives in the first ~20% of a long
   cycle, and --pt-loop-d desyncs the cards so they never fire in unison.
   All loops collapse under prefers-reduced-motion below. */

.pt-svg {
  width: 22px;
  height: 22px;
  stroke: var(--pt-hue);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Staking: bars pop up in a stagger */
.pt-bar {
  fill: var(--pt-hue);
  stroke: none;
  transform-box: fill-box;
  transform-origin: 50% 100%;
  animation: pt-bar-pop 3600ms var(--g-ease) var(--pt-loop-d, 0ms) infinite;
}

.pt-bar:nth-of-type(1) { opacity: 0.5; }
.pt-bar:nth-of-type(2) { opacity: 0.75; animation-delay: calc(var(--pt-loop-d, 0ms) + 70ms); }
.pt-bar:nth-of-type(3) { animation-delay: calc(var(--pt-loop-d, 0ms) + 140ms); }

@keyframes pt-bar-pop {
  0% { transform: none; }
  4% { transform: scaleY(0.45); }
  14% { transform: scaleY(1.1); }
  20% { transform: none; }
  100% { transform: none; }
}

/* Cashback: coin flips once per cycle */
.pt-coin {
  transform-box: fill-box;
  transform-origin: 50% 50%;
  animation: pt-coin-flip 3600ms var(--g-ease) var(--pt-loop-d, 0ms) infinite;
}

@keyframes pt-coin-flip {
  0% { transform: scaleX(1); }
  7% { transform: scaleX(-0.12); }
  14% { transform: scaleX(1); }
  100% { transform: scaleX(1); }
}

/* Gero Card: brief tilt-and-settle */
.pt-cc {
  transform-box: fill-box;
  transform-origin: 50% 100%;
  animation: pt-cc-tilt 3600ms var(--g-ease) var(--pt-loop-d, 0ms) infinite;
}

.pt-cc-chip {
  fill: var(--pt-hue);
  stroke: none;
}

@keyframes pt-cc-tilt {
  0% { transform: none; }
  6% { transform: rotate(-7deg) translateY(-1px); }
  16% { transform: none; }
  100% { transform: none; }
}

/* Swap: two half-turns per cycle, so the arrows trade places and back */
.pt-swap {
  transform-box: fill-box;
  transform-origin: 50% 50%;
  animation: pt-swap-turn 3600ms var(--g-ease) var(--pt-loop-d, 0ms) infinite;
}

@keyframes pt-swap-turn {
  0% { transform: rotate(0deg); }
  10% { transform: rotate(180deg); }
  50% { transform: rotate(180deg); }
  60% { transform: rotate(360deg); }
  100% { transform: rotate(360deg); }
}

/* Perpetuals: the line redraws itself, then the end dot pops */
.pt-line {
  stroke-dasharray: 100;
  animation: pt-draw 3600ms var(--g-ease) var(--pt-loop-d, 0ms) infinite;
}

.pt-dot {
  fill: var(--pt-hue);
  stroke: none;
  transform-box: fill-box;
  transform-origin: 50% 50%;
  animation: pt-dot-pop 3600ms var(--g-ease) var(--pt-loop-d, 0ms) infinite;
}

@keyframes pt-draw {
  0% { stroke-dashoffset: 100; }
  16% { stroke-dashoffset: 0; }
  100% { stroke-dashoffset: 0; }
}

@keyframes pt-dot-pop {
  0% { transform: scale(0); }
  13% { transform: scale(0); }
  17% { transform: scale(1.5); }
  21% { transform: scale(1); }
  100% { transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .perk-teasers__card,
  .pt-bar,
  .pt-coin,
  .pt-cc,
  .pt-swap,
  .pt-line,
  .pt-dot { animation: none; }
}

.perk-teasers__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.perk-teasers__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--g-text-1);
}

.perk-teasers__hook {
  font-size: 12px;
  color: var(--g-text-3);
  line-height: 1.4;
}

.perk-teasers__arrow {
  margin-left: auto;
  font-size: 15px;
  color: var(--g-text-3);
  transition: transform var(--g-dur-fast) var(--g-ease), color var(--g-dur-fast) var(--g-ease);
}

.perk-teasers__card:hover .perk-teasers__arrow,
.perk-teasers__card:focus-visible .perk-teasers__arrow {
  transform: translateX(3px);
  color: var(--pt-hue);
}
</style>
