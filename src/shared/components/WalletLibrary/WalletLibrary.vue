<template>
  <div class="wallet-library" :class="{ 'wallet-library--sorting': dragging }">
    <div class="library-toolbar">
      <v-text-field v-model="query" class="library-search" outlined dense hide-details clearable
        prepend-inner-icon="mdi-magnify" :label="t('walletLibrary.search')" type="search"
        :placeholder="t('walletLibrary.searchPlaceholder')" @keydown.esc.stop="query = ''" />
      <div class="library-toolbar-bottom">
        <div class="library-filters" role="group" :aria-label="t('walletLibrary.filter')">
          <button type="button" class="filter-button" :aria-pressed="!favoritesOnly" @click="favoritesOnly = false">
            {{ t('walletLibrary.allWallets') }} <span class="library-count">{{ wallets.length }}</span>
          </button>
          <button type="button" class="filter-button" :aria-pressed="favoritesOnly" @click="favoritesOnly = true">
            <v-icon small>mdi-star-outline</v-icon> {{ t('walletLibrary.favorites') }} <span class="library-count">{{ favoriteCount }}</span>
          </button>
        </div>
        <v-btn icon small :disabled="saving || !ready" :aria-label="t('walletLibrary.newCategory')"
          :title="t('walletLibrary.newCategory')" @click="editCategory(null)"><v-icon small>mdi-folder-plus-outline</v-icon></v-btn>
      </div>
      <div class="library-guidance">
        <p class="library-help" :class="{ 'library-help--saving': pendingCount }">{{ t(filtering ? 'walletLibrary.filteredHint' : 'walletLibrary.reorderHint') }}</p>
        <p class="library-results library-save-status" role="status">{{ pendingCount ? t('walletLibrary.saving') : '' }}</p>
      </div>
      <p v-if="query" class="library-results" role="status">{{ t('walletLibrary.results', { count: filtered.length, total: wallets.length }) }}<span v-if="indexing"> &middot; {{ t('walletLibrary.indexing') }}</span></p>
      <v-alert v-if="error" dense text type="error" role="alert" class="library-error">{{ t('walletLibrary.' + error) }}</v-alert>
    </div>

    <div class="library-scroll" :aria-busy="!ready || saving">
      <v-progress-linear v-if="!ready" indeterminate :aria-label="t('walletLibrary.loading')" />
      <template v-else>
        <div v-if="filtering && !filtered.length" class="library-empty">
          <EmptyState :message="t(favoritesOnly && !query ? 'walletLibrary.noFavorites' : 'walletLibrary.noResults')" :icon="favoritesOnly && !query ? 'mdi-star-outline' : 'mdi-magnify'" />
          <GButton tier="tertiary" compact @click="clearFilters">{{ t('walletLibrary.clearFilters') }}</GButton>
        </div>
        <section v-for="group in groups" :key="group.key" class="library-group" :data-group="group.key">
          <div class="group-heading">
            <button type="button" class="group-toggle" :aria-expanded="group.expanded"
              :aria-controls="groupDomId(group.key)" :disabled="saving || filtering || group.favorites"
              @click="run(() => repository.setCollapsed(group.id, !group.collapsed))">
              <v-icon small>{{ group.expanded ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
              <v-icon small>{{ group.favorites ? 'mdi-star' : 'mdi-folder-outline' }}</v-icon>
              <span class="group-name">{{ group.favorites ? t('walletLibrary.favorites') : group.name || t('walletLibrary.uncategorized') }}</span>
              <span class="library-count">{{ filtering ? group.wallets.length : group.total }}</span>
            </button>
            <v-menu v-if="group.id" offset-y>
              <template #activator="{ on, attrs }">
                <v-btn icon x-small v-bind="attrs" v-on="on" :disabled="saving"
                  :aria-label="t('walletLibrary.categoryActions', { name: group.name })"><v-icon small>mdi-dots-horizontal</v-icon></v-btn>
              </template>
              <v-list dense>
                <v-list-item @click="editCategory(group)"><v-list-item-title>{{ t('walletLibrary.renameCategory') }}</v-list-item-title></v-list-item>
                <v-list-item @click="deleting = group"><v-list-item-title>{{ t('walletLibrary.deleteCategory') }}</v-list-item-title></v-list-item>
              </v-list>
            </v-menu>
          </div>
          <Draggable :id="groupDomId(group.key)" tag="ul" class="library-wallets"
            :class="{ 'library-wallets--target': dragging && (!group.expanded || !group.wallets.length) }"
            :value="group.expanded ? group.wallets : []" group="wallet-library" handle=".wallet-drag" draggable=".library-wallet"
            :disabled="filtering || !ready" :animation="150" :force-fallback="true" :fallback-on-body="true"
            :fallback-tolerance="4" :scroll-sensitivity="80" :scroll-speed="16" :empty-insert-threshold="24"
            ghost-class="library-wallet--ghost" fallback-class="library-wallet--fallback"
            @start="dragging = true" @end="dragging = false" @change="reordered($event, group)">
              <li v-for="(wallet, index) in (group.expanded ? group.wallets : [])" :key="wallet.id" class="library-wallet"
                :data-wallet-id="wallet.id" :class="{ 'library-wallet--locked': wallet.id === lockedWalletId }">
                <button type="button" class="wallet-drag" :disabled="filtering || !ready"
                  :aria-label="t('walletLibrary.reorderWallet', { name: wallet.name })" :title="t('walletLibrary.keyboardHint')"
                  @keydown.alt.up.prevent="moveStep(wallet, group, index, -1)"
                  @keydown.alt.down.prevent="moveStep(wallet, group, index, 1)">
                  <v-icon small>mdi-drag-vertical</v-icon>
                </button>
                <button type="button" class="wallet-open" :disabled="loadingWalletId != null"
                  :aria-busy="loadingWalletId === wallet.id" :title="displayAddress(wallet)" @click="$emit('select', wallet.id)"
                  @mouseenter="!dragging && $emit('focus-wallet', wallet)" @focus="$emit('focus-wallet', wallet)"
                  :aria-label="t('walletLibrary.openWallet', { name: wallet.name })">
                  <span class="wallet-avatar"><v-avatar size="36"><v-img :src="assets.resolveIcon(wallet.icon)" /></v-avatar>
                    <v-progress-circular v-if="loadingWalletId === wallet.id" class="wallet-chain" size="16" width="2" indeterminate color="var(--g-accent)" />
                    <v-avatar v-else class="wallet-chain" size="16"><v-img :src="networkIcon(wallet)" /></v-avatar></span>
                  <span class="wallet-copy">
                    <span class="wallet-name">{{ wallet.name }} <v-icon v-if="wallet.id === lockedWalletId" x-small :title="t('walletLibrary.locked')">mdi-lock-outline</v-icon></span>
                    <span v-if="loadingWalletId === wallet.id" class="wallet-network" role="status">{{ t('miniGero.unlocking') }}</span>
                    <span v-else class="wallet-network">{{ wallet.chain }} &middot; {{ wallet.network }}<span v-if="walletKind(wallet)"> &middot; {{ walletKind(wallet) }}</span></span>
                    <span v-if="displayAddress(wallet)" class="wallet-address" :class="{ 'wallet-address--match': matchedAddress(wallet) }" :title="displayAddress(wallet)">{{ shortAddress(displayAddress(wallet)) }}</span>
                  </span>
                  <img v-if="walletTypeIcon(wallet)" class="wallet-hardware" :src="walletTypeIcon(wallet)"
                    :alt="wallet.type" :title="wallet.type" width="18" height="18" />
                </button>
                <v-btn icon small class="wallet-favorite" :class="{ 'wallet-favorite--active': wallet.isFavorite }"
                  :disabled="!ready" :aria-pressed="!!wallet.isFavorite" :aria-label="t(wallet.isFavorite ? 'walletLibrary.unfavorite' : 'walletLibrary.favorite', { name: wallet.name })"
                  @click="toggleFavorite(wallet.id)"><v-icon small>{{ wallet.isFavorite ? 'mdi-star' : 'mdi-star-outline' }}</v-icon></v-btn>
                <v-menu offset-y>
                  <template #activator="{ on, attrs }"><v-btn icon small v-bind="attrs" v-on="on" :disabled="saving"
                    :aria-label="t('walletLibrary.walletActions', { name: wallet.name })"><v-icon small>mdi-dots-vertical</v-icon></v-btn></template>
                  <v-list dense>
                    <v-subheader>{{ t('walletLibrary.moveTo') }}</v-subheader>
                    <v-list-item :disabled="group.id === null" @click="moveCategory(wallet.id, null)"><v-list-item-title>{{ t('walletLibrary.uncategorized') }}</v-list-item-title></v-list-item>
                    <v-list-item v-for="category in preferences.categories" :key="category.id" :disabled="group.id === category.id" @click="moveCategory(wallet.id, category.id)"><v-list-item-title>{{ category.name }}</v-list-item-title></v-list-item>
                    <v-divider />
                    <v-list-item :disabled="filtering || index === 0" @click="moveStep(wallet, group, index, -1)"><v-list-item-title>{{ t('walletLibrary.moveUp') }}</v-list-item-title></v-list-item>
                    <v-list-item :disabled="filtering || index === group.wallets.length - 1" @click="moveStep(wallet, group, index, 1)"><v-list-item-title>{{ t('walletLibrary.moveDown') }}</v-list-item-title></v-list-item>
                  </v-list>
                </v-menu>
              </li>
            <li v-if="(group.expanded && !group.wallets.length) || (dragging && !group.expanded)" slot="footer" class="group-empty">
              {{ t(group.favorites ? 'walletLibrary.noFavorites' : 'walletLibrary.emptyCategory') }}
            </li>
          </Draggable>
        </section>
      </template>
    </div>
    <p class="library-announcement" role="status" aria-live="polite">{{ announcement }}</p>

    <v-dialog v-model="categoryDialog" max-width="420" :persistent="saving">
      <v-card class="library-dialog">
        <v-card-title>{{ t(editingId ? 'walletLibrary.renameCategory' : 'walletLibrary.newCategory') }}</v-card-title>
        <v-card-text><form id="wallet-category-form" @submit.prevent="saveCategory">
          <v-text-field v-model="categoryName" outlined autofocus :label="t('walletLibrary.categoryName')" counter="48" maxlength="48" :disabled="saving" :error-messages="categoryError ? [categoryError] : []" />
        </form></v-card-text>
        <v-card-actions><v-spacer /><GButton tier="tertiary" :disabled="saving" @click="categoryDialog = false">{{ t('walletLibrary.cancel') }}</GButton><GButton tier="primary" type="submit" form="wallet-category-form" :loading="saving" :disabled="!categoryName.trim()">{{ t('walletLibrary.save') }}</GButton></v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog :value="!!deleting" max-width="420" :persistent="saving" @input="!$event && (deleting = null)">
      <v-card class="library-dialog"><v-card-title>{{ t('walletLibrary.deleteCategory') }}</v-card-title>
        <v-card-text>{{ t('walletLibrary.deleteExplanation', { name: deleting ? deleting.name : '' }) }}</v-card-text>
        <v-card-actions><v-spacer /><GButton tier="tertiary" :disabled="saving" @click="deleting = null">{{ t('walletLibrary.cancel') }}</GButton><GButton tier="destructive" :loading="saving" @click="deleteCategory">{{ t('walletLibrary.delete') }}</GButton></v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, toRef } from 'vue';
import Draggable from 'vuedraggable';
import { WalletType } from '@/models/types';
import type { Wallet } from '@/models/types';
import assets from '@/utils/assets';
import networks from '@/utils/networks';
import EmptyState from '@/shared/components/feedback/EmptyState.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useWalletLibrary } from '@/shared/composables/useWalletLibrary';
import { walletLibraryRepository as repository } from '@/db/wallet-library';
import type { LibraryWallet, WalletCategory } from '@/services/walletLibrary/model';

const props = defineProps<{ availableWallets: Wallet[]; lockedWalletId?: number | null; loadingWalletId?: number | null }>();
defineEmits<{ (event: 'select', id: number): void; (event: 'focus-wallet', wallet: Wallet): void }>();
const { t } = useTranslation();
const { preferences, query, favoritesOnly, ready, saving, error, indexing, wallets, filtered, filtering, groups, favoriteCount, run, pendingCount, toggleFavorite, moveWallet } = useWalletLibrary(toRef(props, 'availableWallets'));
const dragging = ref(false);
type WalletGroup = typeof groups.value[number];
const announcement = ref('');
const categoryDialog = ref(false);
const editingId = ref<string | null>(null);
const categoryName = ref('');
const categoryError = ref('');
const deleting = ref<WalletCategory | null>(null);
const groupDomId = (id: string | null) => `wallet-category-${id || 'uncategorized'}`;
const networkIcon = (wallet: Wallet) => networks.resolveNetwork(wallet.chain, wallet.network)?.icon || '';
const walletKind = (wallet: Wallet) => [WalletType.Ledger, WalletType.Trezor, WalletType.Keystone, WalletType.Google].includes(wallet.type) ? wallet.type : '';
const walletTypeIcons: Record<string, string> = {
  [WalletType.Ledger]: assets.ledgerSvg,
  [WalletType.Keystone]: assets.keystoneSvg,
  [WalletType.Trezor]: assets.trezorSvg,
  [WalletType.Google]: assets.googleSvg,
};
const walletTypeIcon = (wallet: Wallet) => wallet.type === WalletType.Google && wallet.encryptionMethod !== 'mpc' ? '' : walletTypeIcons[wallet.type] || '';
const shortAddress = (address: string) => address.length > 30 ? `${address.slice(0, 15)}\u2026${address.slice(-10)}` : address;
const matchedAddress = (wallet: LibraryWallet): string => {
  const term = (query.value || '').trim().toLowerCase();
  const fields = [...wallet.addresses, wallet.stakeAddress].filter(Boolean);
  return (term && fields.find(address => address.toLowerCase().includes(term))) || '';
};
const displayAddress = (wallet: LibraryWallet) => matchedAddress(wallet) || wallet.addresses[0] || wallet.stakeAddress;
function clearFilters() { query.value = ''; favoritesOnly.value = false; }
function editCategory(category: WalletCategory | null) {
  editingId.value = category?.id || null; categoryName.value = category?.name || ''; categoryError.value = ''; categoryDialog.value = true;
}
async function saveCategory() {
  if (await run(() => repository.saveCategory(editingId.value, categoryName.value))) categoryDialog.value = false;
  else categoryError.value = t('walletLibrary.' + (error.value || 'saveFailed'));
}
async function deleteCategory() {
  const id = deleting.value?.id;
  if (id && await run(() => repository.deleteCategory(id))) deleting.value = null;
}
async function moveCategory(id: number, categoryId: string | null | undefined, before: number | null = null, favorite?: boolean) {
  const wallet = wallets.value.find(item => item.id === id);
  if (await moveWallet(id, categoryId, before, favorite)) {
    announcement.value = t('walletLibrary.moved', { name: wallet?.name || '' });
  }
}
function moveStep(wallet: LibraryWallet, group: WalletGroup, index: number, delta: number) {
  if (filtering.value || index + delta < 0 || index + delta >= group.wallets.length) return;
  void moveCategory(wallet.id, group.id, delta < 0 ? group.wallets[index - 1].id : (group.wallets[index + 2]?.id ?? null), group.favorites);
}
function reordered(event: { added?: { element: LibraryWallet; newIndex: number }; moved?: { element: LibraryWallet; newIndex: number } }, group: WalletGroup) {
  const change = event.added || event.moved;
  if (!change) return; // The destination handles a cross-category move once.
  const siblings = group.wallets.filter(wallet => wallet.id !== change.element.id);
  const before = siblings[change.newIndex]?.id ?? null;
  void moveCategory(change.element.id, group.id, before, group.favorites);
}
</script>

<style scoped>
.wallet-library { display: flex; flex-direction: column; min-height: 0; flex: 1; width: 100%; color: var(--g-text-1); }
.library-toolbar { flex: none; padding: var(--g-s-2) var(--g-s-1) var(--g-s-3); }
.library-toolbar-bottom, .library-filters, .filter-button { display: flex; align-items: center; gap: var(--g-s-2); }
.library-toolbar-bottom { justify-content: space-between; margin-top: var(--g-s-3); }
.library-filters { gap: var(--g-s-1); flex-wrap: wrap; }
.filter-button { min-height: var(--g-btn-h-compact); padding: var(--g-s-1) var(--g-s-2); border: 1px solid transparent; border-radius: var(--g-r-control); color: var(--g-text-2); font: inherit; font-size: 12px; }
.filter-button[aria-pressed="true"] { background: var(--g-raised); border-color: var(--g-hairline-3); color: var(--g-text-1); }
.filter-button .v-icon { color: inherit; }
.library-count { font-family: var(--g-font-mono); font-size: 11px; color: var(--g-text-2); }
.library-help, .library-results { color: var(--g-text-2); font-size: 12px; line-height: 1.5; margin: var(--g-s-2) 0 0; }
.library-results { color: var(--g-accent); }
.library-guidance { display: grid; }
.library-guidance > p { grid-area: 1 / 1; }
.library-help--saving { visibility: hidden; }
.library-save-status { min-height: 18px; pointer-events: none; }
.library-error { margin: var(--g-s-2) 0 0; }
.library-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 var(--g-s-1) var(--g-s-4); scrollbar-gutter: stable; }
.library-group { border: 1px solid transparent; border-radius: var(--g-r-control); margin-bottom: var(--g-s-3); padding-bottom: var(--g-s-2); }

.group-heading { display: flex; align-items: center; gap: var(--g-s-1); margin-bottom: var(--g-s-1); }
.group-toggle { display: flex; align-items: center; gap: var(--g-s-2); flex: 1; min-width: 0; min-height: var(--g-btn-h); padding: 0 var(--g-s-1); text-align: left; color: var(--g-text-2); }
.group-toggle .v-icon { color: var(--g-text-2); }
.group-name { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.library-wallets { list-style: none; padding: 0; margin: 0; }
.library-wallet { display: flex; align-items: center; gap: var(--g-s-1); min-height: 80px; margin-bottom: var(--g-s-1); padding: var(--g-s-2) var(--g-s-1); background: var(--g-raised); border: 1px solid var(--g-hairline-1); border-radius: var(--g-r-control); transition: border-color var(--g-dur-fast) ease; }
.library-wallet:hover, .library-wallet:focus-within, .library-wallet--locked { border-color: var(--g-accent); }
.library-wallet--ghost { opacity: 0.3; border-color: var(--g-accent); }
.library-wallet--fallback { opacity: 0.95; box-shadow: var(--g-shadow-menu); pointer-events: none; }
.library-wallets--target { min-height: 48px; border-radius: var(--g-r-control); outline: 1px dashed var(--g-accent); }
.wallet-library--sorting { user-select: none; }
.wallet-library--sorting .wallet-open { pointer-events: none; }
.wallet-drag { align-self: stretch; width: 28px; flex: none; cursor: grab; touch-action: none; color: var(--g-text-3); }
.wallet-drag:disabled { cursor: default; }
.wallet-drag .v-icon { color: inherit; }
.wallet-open { display: flex; align-items: center; gap: var(--g-s-3); flex: 1; min-width: 0; text-align: left; color: inherit; border-radius: var(--g-r-control); }
.wallet-open:disabled { cursor: wait; }
.wallet-open:disabled:not([aria-busy="true"]) { opacity: 0.55; }
.wallet-avatar { position: relative; flex: none; }
.wallet-chain { position: absolute; right: -4px; bottom: -4px; background: var(--g-overlay); border: 1px solid var(--g-hairline-3); }
.wallet-copy { display: flex; flex-direction: column; gap: var(--g-s-1); min-width: 0; }
.wallet-hardware { flex: none; margin-left: auto; object-fit: contain; }
.wallet-name, .wallet-network, .wallet-address { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wallet-name { font-size: 14px; font-weight: 600; line-height: 1.3; }
.wallet-network { color: var(--g-text-2); font-size: 11px; }
.wallet-address { color: var(--g-text-2); font: 11px var(--g-font-mono); }
.wallet-favorite--active .v-icon { color: var(--g-accent); }
.library-empty { padding: var(--g-s-5) 0; text-align: center; }
.group-empty { color: var(--g-text-2); font-size: 12px; padding: var(--g-s-4); margin: 0; border: 1px dashed var(--g-hairline-3); border-radius: var(--g-r-control); }
.library-dialog { background: var(--g-overlay); }
.library-announcement { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
button:focus-visible { outline: 2px solid var(--g-accent); outline-offset: 2px; }
@media (max-width: 400px) { .wallet-open { gap: var(--g-s-2); } .library-wallet { gap: 0; } .wallet-address { max-width: 20ch; } }
@media (max-height: 820px) {
  .wallet-address:not(.wallet-address--match) { display: none; }
  .library-wallet { min-height: 60px; }
}
@media (prefers-reduced-motion: reduce) { .library-wallet { transition: none; } }
</style>
