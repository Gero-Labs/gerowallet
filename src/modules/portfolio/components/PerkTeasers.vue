<template>
  <!-- Empty-wallet incentive strip: what a funded wallet unlocks, as tappable
       teasers. Each card renders only where the feature exists (same chain
       gating as the EmptyStateHero perks footnote). -->
  <section v-if="perks.length" class="perk-teasers">
    <p class="perk-teasers__label g-mono">{{ $t('dashboard.onceFundedTitle') }}</p>
    <div class="perk-teasers__grid">
      <button
        v-for="(perk, i) in perks"
        :key="perk.key"
        type="button"
        class="perk-teasers__card"
        :style="{ '--pt-d': `${i * 60}ms` }"
        @click="perk.go()"
      >
        <!-- Hand-drawn accent SVGs with hover-triggered micro-animation
             (feedback, not decorative loops — every run is finite and
             user-initiated). transform-box: fill-box is what lets bars/coins
             scale around their own box instead of the viewBox origin. -->
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
import { useQuickActionDialogs } from '@/shared/composables/useQuickActionDialogs';

const { loggedWallet } = toRefs(walletStore);
const instance = getCurrentInstance();
const router = instance?.proxy?.$router;
const { openDialog } = useQuickActionDialogs();

const perks = computed(() => {
  const chain = loggedWallet.value?.chain;
  const network = loggedWallet.value?.network;
  const list: { key: string; title: string; hook: string; go: () => void }[] = [];
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

.perk-teasers__card {
  appearance: none;
  font: inherit;
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  padding: var(--g-s-3);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  cursor: pointer;
  animation: pt-rise var(--g-dur-slow) var(--g-ease) both;
  animation-delay: var(--pt-d, 0ms);
  transition: border-color var(--g-dur-fast) var(--g-ease), background var(--g-dur-fast) var(--g-ease);
}

.perk-teasers__card:hover,
.perk-teasers__card:focus-visible {
  border-color: color-mix(in srgb, var(--g-accent) 45%, transparent);
  background: color-mix(in srgb, var(--g-accent) 7%, var(--g-overlay));
}

@keyframes pt-rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}

.perk-teasers__icon {
  width: 38px;
  height: 38px;
  border-radius: var(--g-r-control);
  background: color-mix(in srgb, var(--g-accent) 14%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* ── SVG micro-animations (hover/focus feedback, all finite runs) ── */

.pt-svg {
  width: 22px;
  height: 22px;
  stroke: var(--g-accent);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Staking: bars pop up in a stagger */
.pt-bar {
  fill: var(--g-accent);
  stroke: none;
  transform-box: fill-box;
  transform-origin: 50% 100%;
}

.pt-bar:nth-of-type(1) { opacity: 0.5; }
.pt-bar:nth-of-type(2) { opacity: 0.75; }

.perk-teasers__card:hover .pt-bar,
.perk-teasers__card:focus-visible .pt-bar {
  animation: pt-bar-pop var(--g-dur-slow) var(--g-ease) both;
}

.perk-teasers__card:hover .pt-bar:nth-of-type(2),
.perk-teasers__card:focus-visible .pt-bar:nth-of-type(2) { animation-delay: 70ms; }

.perk-teasers__card:hover .pt-bar:nth-of-type(3),
.perk-teasers__card:focus-visible .pt-bar:nth-of-type(3) { animation-delay: 140ms; }

@keyframes pt-bar-pop {
  0% { transform: scaleY(0.45); }
  70% { transform: scaleY(1.1); }
  100% { transform: none; }
}

/* Cashback: coin flips once */
.pt-coin {
  transform-box: fill-box;
  transform-origin: 50% 50%;
}

.perk-teasers__card:hover .pt-coin,
.perk-teasers__card:focus-visible .pt-coin {
  animation: pt-coin-flip 500ms var(--g-ease) both;
}

@keyframes pt-coin-flip {
  0% { transform: scaleX(1); }
  50% { transform: scaleX(-0.12); }
  100% { transform: scaleX(1); }
}

/* Gero Card: tilts and lifts while hovered, settles back on leave */
.pt-cc {
  transform-box: fill-box;
  transform-origin: 50% 100%;
  transition: transform var(--g-dur-base) var(--g-ease);
}

.pt-cc-chip {
  fill: var(--g-accent);
  stroke: none;
}

.perk-teasers__card:hover .pt-cc,
.perk-teasers__card:focus-visible .pt-cc {
  transform: rotate(-7deg) translateY(-1px);
}

/* Perpetuals: the line redraws itself, then the end dot pops */
.pt-line {
  stroke-dasharray: 100;
  stroke-dashoffset: 0;
}

.pt-dot {
  fill: var(--g-accent);
  stroke: none;
  transform-box: fill-box;
  transform-origin: 50% 50%;
}

.perk-teasers__card:hover .pt-line,
.perk-teasers__card:focus-visible .pt-line {
  animation: pt-draw 600ms var(--g-ease) both;
}

.perk-teasers__card:hover .pt-dot,
.perk-teasers__card:focus-visible .pt-dot {
  animation: pt-dot-pop 300ms var(--g-ease) 380ms both;
}

@keyframes pt-draw {
  from { stroke-dashoffset: 100; }
  to { stroke-dashoffset: 0; }
}

@keyframes pt-dot-pop {
  0% { transform: scale(0); }
  70% { transform: scale(1.5); }
  100% { transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .perk-teasers__card { animation: none; }

  /* Same compound selectors as the triggers — a bare class here would lose
     the specificity tie against the :hover rules above. */
  .perk-teasers__card:hover .pt-bar,
  .perk-teasers__card:focus-visible .pt-bar,
  .perk-teasers__card:hover .pt-coin,
  .perk-teasers__card:focus-visible .pt-coin,
  .perk-teasers__card:hover .pt-line,
  .perk-teasers__card:focus-visible .pt-line,
  .perk-teasers__card:hover .pt-dot,
  .perk-teasers__card:focus-visible .pt-dot { animation: none; }

  .pt-cc { transition: none; }
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

.perk-teasers__card:hover .perk-teasers__arrow {
  transform: translateX(3px);
  color: var(--g-accent);
}
</style>
