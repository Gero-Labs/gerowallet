<template>
  <div class="ord-page">
    <!-- Header -->
    <div class="ord-page__header">
      <div class="ord-page__headline">
        <span class="t-label">{{ $t('bitcoin.ecosystem') }}</span>
        <h1 class="t-title">{{ $t('ordinals.title') }}</h1>
        <p class="t-body ord-page__subtitle">{{ $t('ordinals.subtitle') }}</p>
      </div>
      <div class="ord-page__header-side">
        <v-btn
          icon
          variant="text"
          size="small"
          :loading="loading"
          :aria-label="$t('common.refresh')"
          :title="$t('common.refresh')"
          @click="refresh()"
        >
          <v-icon size="small">mdi-refresh</v-icon>
        </v-btn>
      </div>
    </div>

    <!-- Segmented Inscriptions / Runes control -->
    <div class="ord-tabs" role="tablist" :aria-label="$t('ordinals.title')">
      <button
        id="ord-tab-inscriptions"
        type="button"
        role="tab"
        aria-controls="ord-panel-inscriptions"
        :aria-selected="tab === 0 ? 'true' : 'false'"
        :class="['t-body-sm', 'ord-tab', { 'ord-tab--active': tab === 0 }]"
        @click="tab = 0"
      >
        <v-icon size="small">mdi-image-outline</v-icon>
        {{ $t('ordinals.inscriptions') }}
        <span v-if="inscriptionTotal > 0" class="t-caption g-num ord-tab__count">{{ formatInt(inscriptionTotal) }}</span>
      </button>
      <button
        id="ord-tab-runes"
        type="button"
        role="tab"
        aria-controls="ord-panel-runes"
        :aria-selected="tab === 1 ? 'true' : 'false'"
        :class="['t-body-sm', 'ord-tab', { 'ord-tab--active': tab === 1 }]"
        @click="tab = 1"
      >
        <v-icon size="small">mdi-hexagon-outline</v-icon>
        {{ $t('ordinals.runes') }}
        <span v-if="runeBalances.length > 0" class="t-caption g-num ord-tab__count">{{ formatInt(runeBalances.length) }}</span>
      </button>
    </div>

    <!-- Inscriptions. v-show keeps both panels mounted across tab switches. -->
    <section
      v-show="tab === 0"
      id="ord-panel-inscriptions"
      class="glass-panel ord-panel"
      role="tabpanel"
      aria-labelledby="ord-tab-inscriptions"
    >
      <div v-if="loading && inscriptions.length === 0" class="ord-grid" aria-busy="true">
        <v-skeleton-loader v-for="i in 8" :key="i" type="image" class="ord-skeleton" />
      </div>

      <!-- Inscriptions only index after confirmation -->
      <div v-if="!loading && hasPendingBitcoinTx" class="t-body-sm ord-notice" role="status">
        <v-icon size="small">mdi-information-outline</v-icon>
        <span class="ord-notice__text">{{ $t('ordinals.pendingInscriptionHint') }}</span>
      </div>

      <div v-if="!loading && inscriptions.length === 0" class="ord-empty">
        <span class="ord-empty__icon"><v-icon size="28">mdi-image-off-outline</v-icon></span>
        <span class="t-body-lg">{{ $t('ordinals.noInscriptions') }}</span>
        <span class="t-body-sm ord-empty__hint">{{ $t('ordinals.noInscriptionsHint') }}</span>
      </div>

      <div v-if="inscriptions.length > 0" class="ord-grid">
        <!-- The whole tile opens the detail view through the stretched button at
             the end: a button may not contain the html inscription's iframe, so
             the control sits over the tile instead of around it. -->
        <div v-for="inscription in inscriptions" :key="inscription.id" class="glass-tier ord-tile">
          <div class="ord-tile__preview">
            <img
              v-if="isImageType(inscription.content_type)"
              :src="getContentUrl(inscription.id)"
              class="ord-tile__image"
              :alt="$t('ordinals.inscriptionNumber', { number: formatInt(inscription.number) })"
              loading="lazy"
            />
            <iframe
              v-else-if="isHtmlType(inscription.content_type)"
              :src="getContentUrl(inscription.id)"
              class="ord-tile__frame"
              sandbox="allow-scripts"
              tabindex="-1"
              :title="$t('ordinals.inscriptionNumber', { number: formatInt(inscription.number) })"
            />
            <div v-else class="ord-tile__placeholder">
              <v-icon size="28">mdi-file-outline</v-icon>
              <span class="t-label">{{ fileKind(inscription) }}</span>
            </div>
            <span :class="['t-label', 'ord-rarity', { 'ord-rarity--notable': isNotableRarity(inscription.sat_rarity) }]">
              {{ inscription.sat_rarity }}
            </span>
          </div>
          <span class="t-caption g-num ord-tile__number">#{{ formatInt(inscription.number) }}</span>
          <button
            type="button"
            class="ord-tile__hit"
            :aria-label="$t('ordinals.inscriptionNumber', { number: formatInt(inscription.number) })"
            @click="viewInscription(inscription)"
          />
        </div>
      </div>

      <div v-if="inscriptions.length > 0 && inscriptions.length < inscriptionTotal" class="ord-more">
        <GButton tier="tertiary" compact :loading="loadingMore" @click="loadMoreInscriptions()">
          <v-icon size="small" start>mdi-chevron-down</v-icon>
          {{ $t('common.loadMore') }}
          <span class="g-num ord-more__count">
            ({{ $t('ordinals.remainingCount', { count: formatInt(inscriptionTotal - inscriptions.length) }) }})
          </span>
        </GButton>
      </div>
    </section>

    <!-- Runes -->
    <section
      v-show="tab === 1"
      id="ord-panel-runes"
      class="glass-panel ord-panel"
      role="tabpanel"
      aria-labelledby="ord-tab-runes"
    >
      <v-skeleton-loader v-if="loading && runeBalances.length === 0" type="list-item-two-line@5" />

      <div v-if="!loading && runeBalances.length === 0" class="ord-empty">
        <span class="ord-empty__icon"><v-icon size="28">mdi-hexagon-outline</v-icon></span>
        <span class="t-body-lg">{{ $t('ordinals.noRunes') }}</span>
        <span class="t-body-sm ord-empty__hint">{{ $t('ordinals.noRunesHint') }}</span>
      </div>

      <div v-if="runeBalances.length > 0" class="ord-runes">
        <button
          v-for="rune in runeBalances"
          :key="rune.rune.id"
          type="button"
          class="glass-tier ord-rune"
          @click="viewRune(rune.rune.id)"
        >
          <span class="ord-rune__icon"><img :src="runesLogo" width="18" height="18" alt="" /></span>
          <span class="ord-rune__text">
            <span class="t-body-sm ord-rune__name">{{ rune.rune.spaced_name }}</span>
            <span class="t-caption">
              {{ $t('ordinals.balance') }}:
              <span class="g-num ord-rune__balance">{{ formatRuneBalance(rune.balance) }}</span>
            </span>
          </span>
          <v-icon size="small" class="ord-rune__chevron">mdi-open-in-new</v-icon>
        </button>
      </div>
    </section>

    <!-- Inscription detail -->
    <BaseDialog
      size="sm"
      :isOpen="detailDialog"
      :title="selectedInscription ? $t('ordinals.inscriptionNumber', { number: formatInt(selectedInscription.number) }) : ''"
      :img="ordinalsLogo"
      img-color="var(--g-accent)"
      :min-height="0"
      @close="detailDialog = false"
    >
      <v-card-text v-if="selectedInscription" class="px-5 pt-1 pb-5 ord-detail">
        <div class="ord-detail__preview">
          <img
            v-if="isImageType(selectedInscription.content_type)"
            :src="getContentUrl(selectedInscription.id)"
            class="ord-detail__image"
            alt=""
          />
          <div v-else class="ord-tile__placeholder">
            <v-icon size="48">mdi-file-outline</v-icon>
            <span class="t-caption g-mono">{{ selectedInscription.content_type }}</span>
          </div>
        </div>

        <dl class="ord-facts">
          <div class="ord-fact">
            <dt class="t-label">{{ $t('ordinals.satRarity') }}</dt>
            <dd class="t-body-sm">
              <span :class="['t-label', 'ord-rarity', { 'ord-rarity--notable': isNotableRarity(selectedInscription.sat_rarity) }]">
                {{ selectedInscription.sat_rarity }}
              </span>
            </dd>
          </div>
          <div class="ord-fact">
            <dt class="t-label">{{ $t('ordinals.genesisBlock') }}</dt>
            <dd class="t-body-sm g-num">#{{ formatInt(selectedInscription.genesis_block_height) }}</dd>
          </div>
          <div class="ord-fact ord-fact--wide">
            <dt class="t-label">{{ $t('ordinals.contentType') }}</dt>
            <dd class="t-body-sm"><span class="g-mono">{{ selectedInscription.content_type }}</span></dd>
          </div>
          <div class="ord-fact ord-fact--wide">
            <dt class="t-label">{{ $t('ordinals.inscriptionId') }}</dt>
            <!-- The whole id, so it can be checked against the explorer -->
            <dd class="t-body-sm">
              <span class="g-mono ord-fact__id">{{ selectedInscription.id }}</span>
              <CopyButton x-small :value="selectedInscription.id" />
            </dd>
          </div>
        </dl>

        <div class="ord-detail__actions">
          <GButton tier="primary" @click="openOnOrdinals(selectedInscription.id)">
            <v-icon size="small" start>mdi-open-in-new</v-icon>
            {{ $t('ordinals.viewOnOrdinals') }}
          </GButton>
        </div>
      </v-card-text>
    </BaseDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { toRefs } from 'vue';
import { deriveBitcoinAddress } from '@/chains/bitcoin/bitcoinKeyManager';
import ordinalsApi, { type Inscription, type RuneBalance } from '@/api/ordinals-api';
import ordinalsLogo from '@/assets/svg/ordinals.svg';
import runesLogo from '@/assets/svg/runes.svg';
import { walletStore } from '@/stores/walletStore';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatInt } from '@/shared/utils/format';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import CopyButton from '@/shared/components/CopyButton.vue';

const { t } = useTranslation();
const { loggedWallet, transactions: storeTxs } = toRefs(walletStore);

// True when there are unconfirmed Bitcoin transactions (inscriptions only index after confirmation)
const hasPendingBitcoinTx = computed(() =>
  storeTxs.value.some(tx => 'pending' in tx && tx.pending)
);

const tab = ref(0);
const loading = ref(false);
const loadingMore = ref(false);

const inscriptions = ref<Inscription[]>([]);
const inscriptionTotal = ref(0);
const runeBalances = ref<RuneBalance[]>([]);

const detailDialog = ref(false);
const selectedInscription = ref<Inscription | null>(null);

const btcAddress = computed(() => loggedWallet.value?.baseAddress ?? '');

// Derive taproot address for the same xpub — inscriptions are held on P2TR outputs
const taprootAddress = computed<string | null>(() => {
  const wallet = loggedWallet.value;
  if (!wallet?.publicKey || wallet.addressType === 'taproot') return null;
  try {
    return deriveBitcoinAddress(wallet.publicKey, wallet.network, 'taproot', 0, 0);
  } catch { return null; }
});

// All addresses to query for inscriptions/runes
const addressesToQuery = computed(() => {
  const addrs = [btcAddress.value].filter(Boolean);
  if (taprootAddress.value && taprootAddress.value !== btcAddress.value) {
    addrs.push(taprootAddress.value);
  }
  return addrs;
});

function getContentUrl(id: string): string {
  return ordinalsApi.getInscriptionContentUrl(id);
}

function isImageType(contentType: string): boolean {
  return contentType?.startsWith('image/') ?? false;
}

function isHtmlType(contentType: string): boolean {
  return contentType === 'text/html' || (contentType?.startsWith('text/html') ?? false);
}

// Anything rarer than a common sat gets the accent-tinted badge
function isNotableRarity(rarity: string): boolean {
  return !!rarity && rarity !== 'common';
}

// The mime subtype ("PNG", "JSON") for a tile with no preview
function fileKind(inscription: Inscription): string {
  return inscription.mime_type?.split('/')[1]?.toUpperCase() || t('ordinals.file');
}

function formatRuneBalance(balance: string): string {
  const n = BigInt(balance);
  return n.toLocaleString();
}

function viewInscription(inscription: Inscription) {
  selectedInscription.value = inscription;
  detailDialog.value = true;
}

function openOnOrdinals(id: string) {
  window.open(ordinalsApi.getInscriptionExplorerUrl(id), '_blank');
}

function viewRune(runeId: string) {
  window.open(ordinalsApi.getRuneExplorerUrl(runeId), '_blank');
}

async function refresh() {
  const addrs = addressesToQuery.value;
  if (!addrs.length) return;
  loading.value = true;
  try {
    // Fetch inscriptions for all addresses (segwit + taproot) and merge
    const inscrResults = await Promise.all(
      addrs.map(addr =>
        ordinalsApi.getInscriptionsByAddress(addr, 0, 60).catch(() => null)
      )
    );
    const seen = new Set<string>();
    const merged: Inscription[] = [];
    for (const res of inscrResults) {
      if (!res) continue;
      for (const insc of res.results) {
        if (!seen.has(insc.id)) { seen.add(insc.id); merged.push(insc); }
      }
    }
    inscriptions.value = merged;
    inscriptionTotal.value = merged.length;

    // Fetch rune balances for all addresses and merge
    const runeResults = await Promise.all(
      addrs.map(addr =>
        ordinalsApi.getRuneBalancesByAddress(addr).catch(() => null)
      )
    );
    const runeMap = new Map<string, RuneBalance>();
    for (const res of runeResults) {
      if (!res) continue;
      for (const rb of res.results) {
        runeMap.set(rb.rune.id, rb);
      }
    }
    runeBalances.value = Array.from(runeMap.values());
  } catch (e) {
    console.error('🖼 Ordinals:', e);
  } finally {
    loading.value = false;
  }
}

async function loadMoreInscriptions() {
  if (loadingMore.value) return;
  loadingMore.value = true;
  try {
    const addrs = addressesToQuery.value;
    const offset = inscriptions.value.length;
    const results = await Promise.all(
      addrs.map(addr =>
        ordinalsApi.getInscriptionsByAddress(addr, offset, 20).catch(() => null)
      )
    );
    const seen = new Set(inscriptions.value.map((i: Inscription) => i.id));
    for (const res of results) {
      if (!res) continue;
      for (const insc of res.results) {
        if (!seen.has(insc.id)) { seen.add(insc.id); inscriptions.value.push(insc); }
      }
      inscriptionTotal.value = Math.max(inscriptionTotal.value, res.total);
    }
  } finally {
    loadingMore.value = false;
  }
}

onMounted(() => refresh());
</script>

<style scoped lang="scss">
.ord-page {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}

/* ─── Header ─────────────────────────────────────────────────── */
.ord-page__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--g-s-4);
  flex-wrap: wrap;
}

.ord-page__headline {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.ord-page__headline h1,
.ord-page__subtitle {
  margin: 0;
}

.ord-page__header-side {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

/* ─── Segmented control ──────────────────────────────────────── */
.ord-tabs {
  align-self: flex-start;
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-1);
}

.ord-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
  height: 32px;
  padding: 0 var(--g-s-4);
  border: 0;
  border-radius: var(--g-r-pill);
  background: transparent;
  color: var(--g-text-2);
  font-family: inherit;
  font-weight: 600;
  line-height: inherit;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease), color var(--g-dur-fast) var(--g-ease);
}

.ord-tab:hover {
  color: var(--g-text-1);
}

.ord-tab--active {
  background: var(--g-hairline-2);
  color: var(--g-text-1);
}

.ord-tab .v-icon {
  color: inherit;
}

.ord-tab__count {
  font-weight: 500;
}

/* ─── Panels ─────────────────────────────────────────────────── */
/* Surface comes from the shared .glass-panel material; only layout lives here. */
.ord-panel {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}

.ord-notice {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  color: var(--g-text-2);
}

.ord-notice .v-icon {
  color: inherit;
}

.ord-notice__text {
  flex: 1;
  min-width: 0;
}

.ord-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-6) var(--g-s-4);
  text-align: center;
}

.ord-empty__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  margin-bottom: var(--g-s-2);
  border-radius: var(--g-r-card);
  background: var(--g-hairline-1);
  color: var(--g-text-3);
}

.ord-empty__icon .v-icon {
  color: inherit;
}

.ord-empty__hint {
  max-width: 280px;
}

/* ─── Inscription grid ───────────────────────────────────────── */
.ord-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--g-s-2);
}

.ord-skeleton {
  border-radius: var(--g-r-card);
}

.ord-tile {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: background-color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease);
}

.ord-tile:hover {
  @include g-glass-tier-hover;
}

/* The artwork well: a solid, like a QR box, so every piece sits on the same
   known backdrop whatever is behind the glass. */
.ord-tile__preview {
  position: relative;
  height: 150px;
  overflow: hidden;
  background: var(--g-surface);
}

.ord-tile__image {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.ord-tile__frame {
  width: 100%;
  height: 100%;
  border: 0;
  pointer-events: none;
}

.ord-tile__placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-1);
  height: 100%;
  color: var(--g-text-3);
}

.ord-tile__placeholder .v-icon {
  color: inherit;
}

.ord-tile__number {
  padding: var(--g-s-2) var(--g-s-3);
  color: var(--g-text-1);
  font-weight: 500;
}

/* The stretched control. The tile clips overflow, so the baseline's outward
   focus ring is drawn inward here rather than lost. */
.ord-tile__hit {
  position: absolute;
  inset: 0;
  padding: 0;
  border: 0;
  border-radius: inherit;
  background: transparent;
  cursor: pointer;
}

.ord-tile__hit:focus-visible {
  outline-offset: -2px;
}

.ord-rarity {
  position: absolute;
  bottom: var(--g-s-2);
  left: var(--g-s-2);
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--g-r-chip);
  background: var(--g-hairline-2);
  color: var(--g-text-2);
  white-space: nowrap;
}

.ord-rarity--notable {
  background: color-mix(in srgb, var(--g-accent) 12%, transparent);
  color: var(--g-accent);
}

.ord-more {
  display: flex;
  justify-content: center;
}

.ord-more__count {
  color: var(--g-text-3);
}

/* ─── Runes ──────────────────────────────────────────────────── */
.ord-runes {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.ord-rune {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  width: 100%;
  padding: var(--g-s-3);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease);
}

.ord-rune:hover {
  @include g-glass-tier-hover;
}

.ord-rune__icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
}

.ord-rune__text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ord-rune__name {
  overflow: hidden;
  color: var(--g-text-1);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ord-rune__balance {
  color: var(--g-text-2);
}

.ord-rune__chevron {
  flex: 0 0 auto;
  color: var(--g-text-3);
  transition: color var(--g-dur-fast) var(--g-ease);
}

.ord-rune:hover .ord-rune__chevron {
  color: var(--g-accent);
}

/* ─── Detail dialog ──────────────────────────────────────────── */
/* Sits above BaseDialog's decorative rings, which are positioned. */
.ord-detail {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

/* Same artwork well as the tiles */
.ord-detail__preview {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 240px;
  overflow: hidden;
  border-radius: var(--g-r-card);
  background: var(--g-surface);
}

.ord-detail__image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.ord-detail__preview .ord-tile__placeholder {
  width: 100%;
}

.ord-detail__actions {
  display: flex;
  justify-content: flex-end;
}

.ord-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: var(--g-s-5);
  margin: 0;
  border-top: 1px solid var(--g-hairline-1);
}

.ord-fact {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--g-s-3) 0;
  border-bottom: 1px solid var(--g-hairline-1);
}

.ord-fact--wide {
  grid-column: 1 / -1;
}

.ord-fact dd {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  min-width: 0;
  margin: 0;
  color: var(--g-text-1);
}

.ord-fact dd .g-mono {
  color: var(--g-text-1);
}

.ord-fact__id {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
