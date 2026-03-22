<template>
  <v-container fluid class="pa-3">
    <!-- Page Header -->
    <div class="d-flex align-center mb-4" style="gap: 12px;">
      <div class="page-icon-wrapper">
        <img :src="ordinalsLogo" width="22" height="22" alt="Ordinals" />
      </div>
      <div>
        <div class="text-h6 font-weight-bold">{{ $t('ordinals.title') }}</div>
        <div class="text-caption text--secondary">{{ $t('ordinals.subtitle') }}</div>
      </div>
      <v-spacer />
      <v-btn small icon :loading="loading" @click="refresh">
        <v-icon small>mdi-refresh</v-icon>
      </v-btn>
    </div>

    <!-- Tabs -->
    <v-card outlined class="liquid-glass mb-3" style="border-radius: 12px !important; overflow: hidden;">
      <v-tabs v-model="tab" background-color="transparent" height="44">
        <v-tab class="text-capitalize tab-item">
          <v-icon small left>mdi-image-outline</v-icon>
          {{ $t('ordinals.inscriptions') }}
          <v-chip
            v-if="inscriptionTotal > 0"
            x-small
            class="ml-2"
            color="primary"
            style="height: 16px; font-size: 9px;"
          >
            {{ inscriptionTotal }}
          </v-chip>
        </v-tab>
        <v-tab class="text-capitalize tab-item">
          <v-icon small left>mdi-hexagon-outline</v-icon>
          {{ $t('ordinals.runes') }}
          <v-chip
            v-if="runeBalances.length > 0"
            x-small
            class="ml-2"
            color="warning"
            style="height: 16px; font-size: 9px;"
          >
            {{ runeBalances.length }}
          </v-chip>
        </v-tab>
      </v-tabs>
    </v-card>

    <v-tabs-items v-model="tab" style="background: transparent !important;">
      <!-- Inscriptions Tab -->
      <v-tab-item style="background: transparent;">
        <!-- Skeleton -->
        <v-row no-gutters v-if="loading && inscriptions.length === 0">
          <v-col v-for="i in 8" :key="i" cols="6" sm="4" md="3" class="pa-1">
            <v-skeleton-loader type="image" style="border-radius: 10px;" />
          </v-col>
        </v-row>

        <!-- Pending inscriptions notice -->
        <v-alert
          v-if="!loading && hasPendingBitcoinTx"
          dense
          outlined
          type="info"
          class="mb-3"
          style="border-radius: 10px; font-size: 12px;"
        >
          {{ $t('ordinals.pendingInscriptionHint') }}
        </v-alert>

        <!-- Empty state -->
        <div v-if="!loading && inscriptions.length === 0" class="empty-state text-center py-10">
          <div class="empty-icon-wrapper mx-auto mb-4">
            <v-icon size="36" color="#F7931A">mdi-image-off-outline</v-icon>
          </div>
          <div class="text-h6 mb-2">{{ $t('ordinals.noInscriptions') }}</div>
          <div class="text-caption text--secondary" style="max-width: 280px; margin: auto;">
            {{ $t('ordinals.noInscriptionsHint') }}
          </div>
        </div>

        <!-- Inscription grid -->
        <v-row no-gutters>
          <v-col
            v-for="inscription in inscriptions"
            :key="inscription.id"
            cols="6"
            sm="4"
            md="3"
            class="pa-1"
          >
            <v-card outlined class="inscription-card" @click="viewInscription(inscription)">
              <!-- Image preview -->
              <div class="inscription-preview">
                <img
                  v-if="isImageType(inscription.content_type)"
                  :src="getContentUrl(inscription.id)"
                  class="preview-image"
                  :alt="'Inscription #' + inscription.number"
                  loading="lazy"
                />
                <iframe
                  v-else-if="isHtmlType(inscription.content_type)"
                  :src="getContentUrl(inscription.id)"
                  class="preview-iframe"
                  sandbox="allow-scripts"
                />
                <div v-else class="preview-placeholder d-flex align-center justify-center fill-height">
                  <div class="text-center">
                    <v-icon color="#F7931A" size="28">mdi-file-outline</v-icon>
                    <div class="text-caption mt-1" style="opacity: 0.6; font-size: 9px;">
                      {{ inscription.mime_type?.split('/')[1]?.toUpperCase() || 'FILE' }}
                    </div>
                  </div>
                </div>

                <!-- Rarity badge overlay -->
                <div class="rarity-overlay">
                  <v-chip
                    x-small
                    :color="rarityColor(inscription.sat_rarity)"
                    text-color="white"
                    style="height: 16px; font-size: 8px; font-weight: 600; letter-spacing: 0.03em;"
                  >
                    {{ inscription.sat_rarity }}
                  </v-chip>
                </div>
              </div>

              <div class="pa-2">
                <div class="font-weight-medium" style="font-size: 11px; opacity: 0.85;">
                  #{{ inscription.number.toLocaleString() }}
                </div>
              </div>
            </v-card>
          </v-col>
        </v-row>

        <!-- Load more -->
        <div v-if="inscriptions.length > 0 && inscriptions.length < inscriptionTotal" class="text-center mt-4">
          <v-btn text color="primary" @click="loadMoreInscriptions" :loading="loadingMore" small>
            <v-icon left small>mdi-chevron-down</v-icon>
            {{ $t('common.loadMore') }} ({{ inscriptionTotal - inscriptions.length }} remaining)
          </v-btn>
        </div>
      </v-tab-item>

      <!-- Runes Tab -->
      <v-tab-item style="background: transparent;">
        <v-skeleton-loader v-if="loading && runeBalances.length === 0" type="list-item-two-line@5" />

        <div v-if="!loading && runeBalances.length === 0" class="empty-state text-center py-10">
          <div class="empty-icon-wrapper mx-auto mb-4">
            <v-icon size="36" color="#F7931A">mdi-hexagon-outline</v-icon>
          </div>
          <div class="text-h6 mb-2">{{ $t('ordinals.noRunes') }}</div>
          <div class="text-caption text--secondary" style="max-width: 280px; margin: auto;">
            {{ $t('ordinals.noRunesHint') }}
          </div>
        </div>

        <v-card
          v-for="rune in runeBalances"
          :key="rune.rune.id"
          outlined
          class="liquid-glass mb-2 rune-card"
          style="border-radius: 10px !important;"
          @click="viewRune(rune.rune.id)"
        >
          <div class="d-flex align-center pa-3" style="gap: 12px;">
            <div class="rune-icon-wrapper">
              <img :src="runesLogo" width="18" height="18" alt="Rune" style="filter: invert(0) brightness(1); opacity: 0.85;" />
            </div>
            <div class="flex-grow-1 min-width-0">
              <div class="font-weight-medium" style="font-size: 13px;">
                {{ rune.rune.spaced_name }}
              </div>
              <div class="text-caption text--secondary">
                {{ $t('ordinals.balance') }}: <span class="font-weight-medium">{{ formatRuneBalance(rune.balance) }}</span>
              </div>
            </div>
            <v-btn icon x-small @click.stop="viewRuneOnOrdinals(rune.rune.id)">
              <v-icon x-small color="grey">mdi-open-in-new</v-icon>
            </v-btn>
          </div>
        </v-card>
      </v-tab-item>
    </v-tabs-items>

    <!-- Inscription Detail Dialog -->
    <v-dialog v-model="detailDialog" max-width="480">
      <v-card class="liquid-glass" v-if="selectedInscription" style="border-radius: 16px !important;">
        <div class="d-flex align-center pa-4 pb-2">
          <span class="text-subtitle-1 font-weight-bold">
            {{ $t('ordinals.inscription') }} #{{ selectedInscription.number.toLocaleString() }}
          </span>
          <v-spacer />
          <v-btn icon small @click="detailDialog = false">
            <v-icon small>mdi-close</v-icon>
          </v-btn>
        </div>
        <v-divider style="opacity: 0.12;" />

        <div class="pa-4">
          <!-- Preview -->
          <div class="detail-preview mb-4" style="height: 240px; background: rgba(0,0,0,0.3); border-radius: 12px; overflow: hidden;">
            <img
              v-if="isImageType(selectedInscription.content_type)"
              :src="getContentUrl(selectedInscription.id)"
              style="width: 100%; height: 100%; object-fit: contain;"
              alt=""
            />
            <div v-else class="d-flex align-center justify-center fill-height">
              <div class="text-center">
                <v-icon color="#F7931A" size="48">mdi-file-outline</v-icon>
                <div class="text-caption mt-2 text--secondary">{{ selectedInscription.content_type }}</div>
              </div>
            </div>
          </div>

          <!-- Metadata -->
          <div class="detail-row d-flex justify-space-between align-center py-2">
            <span class="text-caption text--secondary">{{ $t('ordinals.satRarity') }}</span>
            <v-chip x-small :color="rarityColor(selectedInscription.sat_rarity)" text-color="white">
              {{ selectedInscription.sat_rarity }}
            </v-chip>
          </div>
          <v-divider style="opacity: 0.08;" />
          <div class="detail-row d-flex justify-space-between align-center py-2">
            <span class="text-caption text--secondary">{{ $t('ordinals.contentType') }}</span>
            <span class="text-caption font-weight-medium">{{ selectedInscription.content_type }}</span>
          </div>
          <v-divider style="opacity: 0.08;" />
          <div class="detail-row d-flex justify-space-between align-center py-2">
            <span class="text-caption text--secondary">{{ $t('ordinals.genesisBlock') }}</span>
            <span class="text-caption font-weight-medium">#{{ selectedInscription.genesis_block_height.toLocaleString() }}</span>
          </div>
          <v-divider style="opacity: 0.08;" />
          <div class="py-2">
            <div class="text-caption text--secondary mb-1">{{ $t('ordinals.inscriptionId') }}</div>
            <div class="text-caption" style="font-family: monospace; word-break: break-all; opacity: 0.7;">
              {{ selectedInscription.id }}
            </div>
          </div>
        </div>

        <v-card-actions class="pb-4 px-4">
          <v-spacer />
          <v-btn color="primary" outlined small @click="openOnOrdinals(selectedInscription.id)">
            <v-icon left x-small>mdi-open-in-new</v-icon>
            {{ $t('ordinals.viewOnOrdinals') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { toRefs } from 'vue';
import { deriveBitcoinAddress } from '@/chains/bitcoin/bitcoinKeyManager';
import ordinalsApi, { type Inscription, type RuneBalance } from '@/api/ordinals-api';
import ordinalsLogo from '@/assets/svg/ordinals.svg';
import runesLogo from '@/assets/svg/runes.svg';
import { walletStore } from '@/stores/walletStore';

const { loggedWallet, transactions: storeTxs } = toRefs(walletStore);

// True when there are unconfirmed Bitcoin transactions (inscriptions only index after confirmation)
const hasPendingBitcoinTx = computed(() =>
  (storeTxs.value as any[]).some((tx: any) => tx.pending)
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

function rarityColor(rarity: string): string {
  switch (rarity) {
    case 'mythic': return 'purple darken-1';
    case 'legendary': return 'deep-purple';
    case 'epic': return 'orange darken-2';
    case 'rare': return 'blue darken-1';
    case 'uncommon': return 'green darken-1';
    default: return 'grey darken-1';
  }
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

function viewRuneOnOrdinals(runeId: string) {
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

<style scoped>
.page-icon-wrapper {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  background: rgba(247, 147, 26, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tab-item {
  font-weight: 600;
}

.inscription-card {
  cursor: pointer;
  border-radius: 10px !important;
  overflow: hidden;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.inscription-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25) !important;
}

.inscription-preview {
  height: 160px;
  background: rgba(0, 0, 0, 0.4);
  position: relative;
  overflow: hidden;
}

.preview-image {
  width: 100%;
  height: 100%;
  object-fit: contain;
  transition: transform 0.3s ease;
}

.inscription-card:hover .preview-image {
  transform: scale(1.04);
}

.preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
  pointer-events: none;
}

.preview-placeholder {
  height: 100%;
}

.rarity-overlay {
  position: absolute;
  bottom: 6px;
  left: 6px;
  z-index: 2;
}

.empty-state {
  padding: 48px 16px;
}

.empty-icon-wrapper {
  width: 72px;
  height: 72px;
  border-radius: 20px;
  background: rgba(247, 147, 26, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
}

.rune-card {
  cursor: pointer;
  transition: transform 0.15s ease;
}

.rune-card:hover {
  transform: translateX(2px);
}

.rune-icon-wrapper {
  width: 36px;
  height: 36px;
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.detail-row {
  min-height: 36px;
}
</style>
