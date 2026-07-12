<template>
  <div class="es-root">

    <!-- Slim backup strip: the security ask stays visible but no longer owns
         the visual center (the first deposit does). -->
    <button
      v-if="shouldBackup && !isBackupComplete"
      type="button"
      class="es-backup es-reveal"
      style="--es-d: 0ms"
      @click="$emit('backup-wallet')"
    >
      <v-icon size="16" color="var(--g-warning)">mdi-shield-alert-outline</v-icon>
      <span class="es-backup__text">
        <strong>{{ $t('dashboard.backupStripTitle') }}</strong>
        {{ $t('dashboard.backupStripBody') }}
      </span>
      <span class="es-backup__cta">{{ $t('dashboard.backupStripCta') }} →</span>
    </button>

    <!-- ═══ Act 1: the zero moment ═══ -->
    <section class="es-hero es-reveal" style="--es-d: 60ms">
      <div class="es-balance g-num">
        <span class="es-balance__cur">{{ currencySymbol }}</span><span class="es-balance__zero">0.00</span>
      </div>
      <p class="es-tagline">{{ tagline }}</p>
      <div class="es-ctas">
        <v-btn v-if="buySupported" large class="geroButton es-cta" @click="$emit('buy-crypto')">
          {{ $t('dashboard.buy') }} {{ currencyTicker }}
        </v-btn>
        <v-btn large outlined class="es-cta es-cta--ghost" @click="$emit('show-receive')">
          <v-icon small left>mdi-qrcode</v-icon>
          {{ $t('dashboard.receiveAction') }}
        </v-btn>
      </div>
    </section>

    <!-- ═══ Act 2: ways to fund ═══ -->
    <section class="es-sect-wrap es-reveal" style="--es-d: 160ms">
      <h2 class="es-sect">{{ $t('dashboard.fundWaysTitle') }}</h2>
      <div class="es-ways">
        <button v-if="buySupported" type="button" class="es-way" @click="$emit('buy-crypto')">
          <span class="es-way__icon es-way__icon--buy">
            <v-icon size="19" color="var(--g-success)">mdi-credit-card-outline</v-icon>
          </span>
          <span class="es-way__text">
            <span class="es-way__title">{{ $t('dashboard.fundBuyTitle') }}</span>
            <span class="es-way__desc">{{ $t('dashboard.fundBuyDesc', { ticker: currencyTicker }) }}</span>
          </span>
          <span class="es-way__meta">
            <span class="es-badge">{{ $t('dashboard.fundBuyBadge') }}</span>
            <v-icon size="18" color="var(--g-text-3)">mdi-chevron-right</v-icon>
          </span>
        </button>

        <button type="button" class="es-way" @click="$emit('show-receive')">
          <span class="es-way__icon es-way__icon--rec">
            <v-icon size="19" color="var(--g-accent)">mdi-bank-transfer-in</v-icon>
          </span>
          <span class="es-way__text">
            <span class="es-way__title">{{ $t('dashboard.fundExchangeTitle') }}</span>
            <span class="es-way__desc">{{ $t('dashboard.fundExchangeDesc') }}</span>
          </span>
          <span class="es-way__meta">
            <span
              v-if="truncatedAddress"
              class="es-addr g-mono"
              role="button"
              :title="$t('dashboard.copyAddress')"
              @click.stop="copyToClipboard"
            >
              {{ copiedFeedback ? $t('dashboard.copied') : truncatedAddress }}
              <v-icon size="12" color="var(--g-text-3)">{{ copiedFeedback ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
            </span>
            <v-icon size="18" color="var(--g-text-3)">mdi-chevron-right</v-icon>
          </span>
        </button>

        <button type="button" class="es-way" @click="$emit('show-receive')">
          <span class="es-way__icon es-way__icon--mov">
            <v-icon size="19" color="var(--g-info)">mdi-swap-horizontal</v-icon>
          </span>
          <span class="es-way__text">
            <span class="es-way__title">{{ $t('dashboard.fundWalletTitle') }}</span>
            <span class="es-way__desc">{{ $t('dashboard.fundWalletDesc', { blockchain }) }}</span>
          </span>
          <span class="es-way__meta">
            <v-icon size="18" color="var(--g-text-3)">mdi-chevron-right</v-icon>
          </span>
        </button>
      </div>
    </section>

    <!-- ═══ Act 3: what the funds unlock (chain-aware, de-emphasized) ═══ -->
    <section v-if="perks.length" class="es-sect-wrap es-reveal" style="--es-d: 260ms">
      <h2 class="es-sect">{{ $t('dashboard.onceFundedTitle') }}</h2>
      <div class="es-perks">
        <button v-for="perk in perks" :key="perk.key" type="button" class="es-perk" @click="perk.go()">
          <span class="es-perk__title">
            <v-icon size="15" color="var(--g-accent)">{{ perk.icon }}</v-icon>
            {{ $t(perk.title) }}
          </span>
          <span class="es-perk__desc">{{ $t(perk.desc, { ticker: currencyTicker }) }}</span>
        </button>
      </div>
    </section>

  </div>
</template>

<script setup lang="ts">
import { toRefs, ref, getCurrentInstance, computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import networks from '@/utils/networks';

const { t } = useTranslation();

const { loggedWallet } = toRefs(walletStore);
const instance = getCurrentInstance();
const proxy = instance?.proxy;
const router = proxy?.$router;

interface Props {
  isNewUser?: boolean;
  showTutorial?: boolean;
  shouldBackup?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  isNewUser: false,
  showTutorial: true,
});

defineEmits([
  'buy-crypto',
  'show-receive',
  'open-learn',
  'start-tutorial',
  'load-sample-data',
  'backup-wallet',
]);

const blockchain = computed(() => loggedWallet.value?.chain || 'Blockchain');

const currencySymbol = computed(() =>
  networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network));

const currencyTicker = computed(() =>
  networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network));

const buySupported = computed(() =>
  networks.resolveBuySupported(loggedWallet.value?.chain, loggedWallet.value?.network));

const tagline = computed(() => {
  if (props.isNewUser) return t('dashboard.emptyTaglineNew');
  return t('dashboard.addCurrencyToStart', { currency: currencyTicker.value });
});

// Chain-aware perks: each entry only renders where the feature exists.
const perks = computed(() => {
  const chain = loggedWallet.value?.chain;
  const network = loggedWallet.value?.network;
  const list: { key: string; icon: string; title: string; desc: string; go: () => void }[] = [];
  if (networks.resolveStakingSupport(chain, network)) {
    list.push({
      key: 'stake', icon: 'mdi-chart-timeline-variant', title: 'dashboard.perkStakeTitle',
      desc: 'dashboard.perkStakeDesc', go: () => router?.push('/staking'),
    });
  }
  if (networks.resolveGeroCardSupport(chain, network)) {
    list.push({
      key: 'card', icon: 'mdi-credit-card-outline', title: 'dashboard.perkSpendTitle',
      desc: 'dashboard.perkSpendDesc', go: () => router?.push('/card'),
    });
  }
  if (chain === Blockchain.CARDANO) {
    list.push({
      key: 'cashback', icon: 'mdi-cash-refund', title: 'dashboard.perkCashbackTitle',
      desc: 'dashboard.perkCashbackDesc', go: () => router?.push('/cashback'),
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

const isBackupComplete = computed(() => {
  const config = walletStore.config;
  return config && 'backup' in config && config.backup === true;
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
  max-width: 760px;
  margin: 0 auto;
  padding: 36px 16px 56px;
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

/* ── Backup strip ── */
.es-backup {
  appearance: none;
  font: inherit;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 14px;
  border-radius: var(--g-r-control);
  background: color-mix(in srgb, var(--g-warning) 9%, transparent);
  border: 1px solid color-mix(in srgb, var(--g-warning) 30%, transparent);
  font-size: 13px;
  color: var(--g-text-2);
  text-align: left;
  cursor: pointer;
  margin-bottom: 40px;
  transition: border-color var(--g-dur-fast) var(--g-ease);
}

.es-backup:hover {
  border-color: color-mix(in srgb, var(--g-warning) 55%, transparent);
}

.es-backup__text { flex: 1; min-width: 0; }

.es-backup__text strong {
  color: var(--g-warning);
  font-weight: 600;
  margin-right: 4px;
}

.es-backup__cta {
  color: var(--g-warning);
  font-weight: 600;
  font-size: 12.5px;
  white-space: nowrap;
}

/* ── Hero: the zero ── */
.es-hero {
  text-align: center;
  margin-bottom: 46px;
}

.es-balance {
  font-size: 72px;
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1;
  color: var(--g-text-1);
}

.es-balance__cur {
  background: linear-gradient(90deg, var(--g-grad-1), var(--g-grad-2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.es-balance__zero { color: var(--g-text-3); }

.es-tagline {
  font-size: 16.5px;
  color: var(--g-text-2);
  margin: 14px auto 0;
  max-width: 480px;
}

.es-ctas {
  display: flex;
  gap: 10px;
  justify-content: center;
  flex-wrap: wrap;
  margin-top: 24px;
}

.es-cta {
  text-transform: none;
  letter-spacing: 0;
  font-weight: 600;
  min-width: 150px;
}

.es-cta--ghost {
  color: var(--g-text-1) !important;
  border-color: var(--g-hairline-3) !important;
}

.es-cta--ghost:hover {
  border-color: var(--g-accent) !important;
  color: var(--g-accent) !important;
}

/* ── Section labels ── */
.es-sect-wrap { margin-bottom: 40px; }

.es-sect {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--g-text-3);
  margin: 0 0 12px 2px;
}

/* ── Funding rows ── */
.es-ways {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.es-way {
  appearance: none;
  font: inherit;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 15px 18px;
  border-radius: var(--g-r-card);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  cursor: pointer;
  text-align: left;
  transition: border-color var(--g-dur-fast) var(--g-ease),
    background var(--g-dur-fast) var(--g-ease),
    transform var(--g-dur-fast) var(--g-ease);
}

.es-way:hover {
  border-color: var(--g-hairline-3);
  background: var(--g-raised);
  transform: translateY(-1px);
}

.es-way:active { transform: scale(0.995); }

.es-way__icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.es-way__icon--buy { background: color-mix(in srgb, var(--g-success) 13%, transparent); }
.es-way__icon--rec { background: color-mix(in srgb, var(--g-accent) 13%, transparent); }
.es-way__icon--mov { background: color-mix(in srgb, var(--g-info) 13%, transparent); }

.es-way__text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.es-way__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--g-text-1);
}

.es-way__desc {
  font-size: 13px;
  color: var(--g-text-3);
  line-height: 1.45;
}

.es-way__meta {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.es-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: var(--g-r-pill);
  background: color-mix(in srgb, var(--g-success) 12%, transparent);
  color: var(--g-success);
}

.es-addr {
  font-size: 12px;
  color: var(--g-text-3);
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-1);
  border-radius: 6px;
  padding: 4px 9px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  transition: border-color var(--g-dur-fast) var(--g-ease);
}

.es-addr:hover {
  border-color: var(--g-accent);
  color: var(--g-text-2);
}

/* ── Perks ── */
.es-perks {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 8px;
}

.es-perk {
  appearance: none;
  font: inherit;
  padding: 15px 16px;
  border-radius: var(--g-r-card);
  background: transparent;
  border: 1px solid var(--g-hairline-1);
  cursor: pointer;
  text-align: left;
  transition: border-color var(--g-dur-fast) var(--g-ease),
    background var(--g-dur-fast) var(--g-ease);
}

.es-perk:hover {
  border-color: var(--g-hairline-3);
  background: var(--g-surface);
}

.es-perk__title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--g-text-1);
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 4px;
}

.es-perk__desc {
  display: block;
  font-size: 12.5px;
  color: var(--g-text-3);
  line-height: 1.45;
}

/* ── Responsive ── */
@media (max-width: 700px) {
  .es-balance { font-size: 54px; }

  .es-addr { display: none; }
}
</style>
