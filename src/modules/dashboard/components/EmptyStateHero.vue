<template>
  <div class="es-root">

    <!-- Backup: an emphasized ledger annotation. Mono, amber, unmissable. -->
    <BackupReminderStrip
      v-if="shouldBackup"
      class="es-backup-slot es-reveal"
      style="--es-d: 0ms"
      @backup="$emit('backup-wallet')"
    />

    <!-- ═══ The first page of the ledger: a welcome, not a verdict ═══ -->
    <section class="es-reveal" style="--es-d: 60ms">
      <h1 class="t-display">{{ $t('dashboard.emptyWelcomeTitle') }}</h1>
      <p class="es-welcome-sub t-body-lg">
        {{ $t('dashboard.emptyWelcomeSub', { ticker: currencyTicker }) }}
      </p>
      <div class="es-ctas">
        <v-btn v-if="buySupported" large class="geroButton es-cta" @click="$emit('buy-crypto')">
          {{ $t('dashboard.buy') }} {{ currencyTicker }}
        </v-btn>
        <v-btn large outlined class="es-cta es-cta--ghost" @click="$emit('show-receive')">
          {{ $t('dashboard.receiveAction') }}
        </v-btn>
      </div>
    </section>

    <!-- ═══ The index: numbered funding paths, hairline rules, no cards ═══ -->
    <section class="es-reveal" style="--es-d: 160ms">
      <p class="es-eyebrow g-mono">{{ $t('dashboard.fundWaysTitle') }}</p>
      <div class="es-index">
        <button
          v-for="(row, idx) in fundingRows"
          :key="row.key"
          type="button"
          class="es-row"
          @click="row.go()"
        >
          <span class="es-row__num g-mono">{{ String(idx + 1).padStart(2, '0') }}</span>
          <span class="es-row__main">
            <span class="es-row__title">{{ $t(row.title) }}</span>
            <span class="es-row__desc">{{ $t(row.desc, { ticker: currencyTicker, blockchain }) }}</span>
          </span>
          <span class="es-row__meta">
            <span v-if="row.tag" class="es-row__tag g-mono">{{ $t(row.tag) }}</span>
            <span
              v-if="row.key === 'exchange' && truncatedAddress"
              class="es-row__addr g-mono"
              role="button"
              :title="$t('dashboard.copyAddress')"
              @click.stop="copyToClipboard"
            >
              {{ copiedFeedback ? $t('dashboard.copied') : truncatedAddress }}
              <v-icon size="12" color="var(--g-text-3)">{{ copiedFeedback ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
            </span>
            <v-icon size="17" class="es-row__arrow">mdi-arrow-right</v-icon>
          </span>
        </button>
      </div>
    </section>

    <!-- ═══ Footnote: what the funds unlock ═══ -->
    <section v-if="perks.length" class="es-footnote es-reveal" style="--es-d: 260ms">
      <p class="es-eyebrow g-mono es-footnote__label">{{ $t('dashboard.onceFundedTitle') }}</p>
      <template v-for="(perk, idx) in perks">
        <button :key="perk.key" type="button" class="es-footnote__link" @click="perk.go()">
          <v-icon size="14" color="var(--g-accent)">{{ perk.icon }}</v-icon>
          {{ $t(perk.title) }}
        </button>
        <span v-if="idx < perks.length - 1" :key="`dot-${perk.key}`" class="es-footnote__dot">·</span>
      </template>
    </section>

  </div>
</template>

<script setup lang="ts">
import { toRefs, ref, getCurrentInstance, computed } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import networks from '@/utils/networks';
import BackupReminderStrip from '@/shared/components/BackupReminderStrip.vue';

const { loggedWallet } = toRefs(walletStore);
const instance = getCurrentInstance();
const proxy = instance?.proxy;
const router = proxy?.$router;

interface Props {
  isNewUser?: boolean;
  showTutorial?: boolean;
  shouldBackup?: boolean;
}

withDefaults(defineProps<Props>(), {
  isNewUser: false,
  showTutorial: true,
});

const emit = defineEmits([
  'buy-crypto',
  'show-receive',
  'open-learn',
  'start-tutorial',
  'load-sample-data',
  'backup-wallet',
]);

const blockchain = computed(() => loggedWallet.value?.chain || 'Blockchain');

const currencyTicker = computed(() =>
  networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network));

const buySupported = computed(() =>
  networks.resolveBuySupported(loggedWallet.value?.chain, loggedWallet.value?.network));

// The numbered index. Rows renumber automatically when buy is unsupported.
const fundingRows = computed(() => {
  const rows: { key: string; title: string; desc: string; tag?: string; go: () => void }[] = [];
  if (buySupported.value) {
    rows.push({
      key: 'buy', title: 'dashboard.fundBuyTitle', desc: 'dashboard.fundBuyDesc',
      tag: 'dashboard.fundBuyBadge', go: () => emit('buy-crypto'),
    });
  }
  rows.push({
    key: 'exchange', title: 'dashboard.fundExchangeTitle', desc: 'dashboard.fundExchangeDesc',
    go: () => emit('show-receive'),
  });
  rows.push({
    key: 'wallet', title: 'dashboard.fundWalletTitle', desc: 'dashboard.fundWalletDesc',
    go: () => emit('show-receive'),
  });
  return rows;
});

// Chain-aware footnote links: each renders only where the feature exists.
const perks = computed(() => {
  const chain = loggedWallet.value?.chain;
  const network = loggedWallet.value?.network;
  const list: { key: string; icon: string; title: string; go: () => void }[] = [];
  if (networks.resolveStakingSupport(chain, network)) {
    list.push({
      key: 'stake', icon: 'mdi-chart-timeline-variant', title: 'dashboard.perkStakeTitle',
      go: () => router?.push('/staking'),
    });
  }
  if (networks.resolveGeroCardSupport(chain, network)) {
    list.push({
      key: 'card', icon: 'mdi-credit-card-outline', title: 'dashboard.perkSpendTitle',
      go: () => router?.push('/card'),
    });
  }
  if (chain === Blockchain.CARDANO) {
    list.push({
      key: 'cashback', icon: 'mdi-cash-refund', title: 'dashboard.perkCashbackTitle',
      go: () => router?.push('/cashback'),
    });
  }
  return list;
});

const walletAddress = computed(() => loggedWallet.value?.baseAddress || '');

const truncatedAddress = computed(() => {
  const a = walletAddress.value;
  if (!a) return '';
  return a.length > 16 ? `${a.slice(0, 9)}…${a.slice(-5)}` : a;
});

const copiedFeedback = ref(false);

const copyToClipboard = async () => {
  if (!walletAddress.value) return;
  try {
    await navigator.clipboard.writeText(walletAddress.value);
  } catch (err) {
    const textArea = document.createElement('textarea');
    textArea.value = walletAddress.value;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }
  copiedFeedback.value = true;
  setTimeout(() => { copiedFeedback.value = false; }, 2000);
};
</script>

<style scoped>
.es-root {
  max-width: 880px;
  margin: 0 auto;
  padding: 40px 24px 60px;
}

/* Staggered load reveal */
.es-reveal {
  animation: es-rise var(--g-dur-slow) var(--g-ease) both;
  animation-delay: var(--es-d, 0ms);
}

@keyframes es-rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .es-reveal { animation: none; }
}

/* ── Backup annotation (shared strip; only spacing lives here) ── */
.es-backup-slot { margin-bottom: 44px; }

/* ── Eyebrows (mono ledger labels) ── */
.es-eyebrow {
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--g-text-3);
  margin: 0 0 10px;
}

/* ── The welcome (type ramp carries size/weight; only rhythm lives here) ── */
.es-welcome-sub {
  color: var(--g-text-2);
  margin: 10px 0 0;
}

.es-ctas {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin: 28px 0 52px;
}

.es-cta {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 600;
  min-width: 140px;
}

.es-cta--ghost {
  color: var(--g-text-1) !important;
  border-color: var(--g-hairline-3) !important;
}

.es-cta--ghost:hover {
  border-color: var(--g-accent) !important;
  color: var(--g-accent) !important;
}

/* ── The index ── */
.es-index {
  border-top: 1px solid var(--g-hairline-2);
  margin-bottom: 40px;
}

.es-row {
  appearance: none;
  font: inherit;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 20px 4px;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--g-hairline-1);
  cursor: pointer;
  text-align: left;
  transition: background var(--g-dur-fast) var(--g-ease);
}

.es-row:hover { background: var(--g-surface); }

.es-row__num {
  font-size: 13px;
  color: var(--g-text-3);
  width: 26px;
  flex-shrink: 0;
  transition: color var(--g-dur-fast) var(--g-ease);
}

.es-row:hover .es-row__num { color: var(--g-accent); }

.es-row__main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.es-row__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--g-text-1);
}

.es-row__desc {
  font-size: 13px;
  color: var(--g-text-3);
  line-height: 1.45;
}

.es-row__meta {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
}

.es-row__tag {
  font-size: 11px;
  color: var(--g-success);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.es-row__addr {
  font-size: 12px;
  color: var(--g-text-3);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: color var(--g-dur-fast) var(--g-ease);
}

.es-row__addr:hover { color: var(--g-accent); }

.es-row__arrow {
  color: var(--g-text-3) !important;
  transition: transform var(--g-dur-fast) var(--g-ease), color var(--g-dur-fast) var(--g-ease);
}

.es-row:hover .es-row__arrow {
  transform: translateX(4px);
  color: var(--g-accent) !important;
}

/* ── Footnote ── */
.es-footnote {
  display: flex;
  align-items: baseline;
  gap: 14px;
  flex-wrap: wrap;
}

.es-footnote__label { margin: 0; }

.es-footnote__link {
  appearance: none;
  background: none;
  border: none;
  border-bottom: 1px solid var(--g-hairline-2);
  padding: 0 0 1px;
  font: inherit;
  font-size: 13.5px;
  color: var(--g-text-2);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease);
}

.es-footnote__link:hover {
  color: var(--g-accent);
  border-color: var(--g-accent);
}

.es-footnote__dot { color: var(--g-text-3); }

/* ── Responsive ── */
@media (max-width: 700px) {
  .es-row__addr { display: none; }
}
</style>
