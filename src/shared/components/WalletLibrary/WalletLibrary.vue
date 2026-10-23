<template>
  <div class="wallet-library" :class="{ 'wallet-library--sorting': dragging }">
    <div class="library-toolbar">
      <v-text-field v-model="query" class="library-search" variant="outlined" density="compact" hide-details clearable
        prepend-inner-icon="mdi-magnify" :label="t('walletLibrary.search')" type="search"
        :placeholder="t('walletLibrary.searchPlaceholder')" @keydown.esc.stop="query = ''" />
      <div class="library-toolbar-bottom">
        <div class="library-filters" role="group" :aria-label="t('walletLibrary.filter')">
          <button type="button" class="filter-button" :aria-pressed="!favoritesOnly" @click="favoritesOnly = false">
            {{ t('walletLibrary.allWallets') }} <span class="library-count">{{ wallets.length }}</span>
          </button>
          <button type="button" class="filter-button" :aria-pressed="favoritesOnly" @click="favoritesOnly = true">
            <v-icon size="small">mdi-star-outline</v-icon> {{ t('walletLibrary.favorites') }} <span class="library-count">{{ favoriteCount }}</span>
          </button>
        </div>
        <div class="library-tools">
          <v-menu location="start"  >
            <template #activator="{ props: activatorProps }">
              <v-btn icon variant="text" size="small" v-bind="activatorProps"  :disabled="!ready" class="library-sort"
                :class="{ 'library-sort--active': sort !== 'custom' }"
                :aria-label="t('common.sortBy') + ': ' + sortLabel(sort)" :title="t('common.sortBy') + ': ' + sortLabel(sort)">
                <v-icon size="small">mdi-sort</v-icon>
              </v-btn>
            </template>
            <v-list density="compact" role="menu" :aria-label="t('common.sortBy')">
              <v-list-subheader>{{ t('common.sortBy') }}</v-list-subheader>
              <v-list-item v-for="option in WALLET_SORTS" :key="option" role="menuitemradio"
                :aria-checked="String(sort === option)" :active="sort === option" @click="sort = option">
                <v-list-item-title>{{ sortLabel(option) }}</v-list-item-title>
                <div class="my-0 g-list-action"><v-icon v-if="sort === option" size="small">mdi-check</v-icon></div>
              </v-list-item>
            </v-list>
          </v-menu>
          <v-btn icon variant="text" size="small" :disabled="saving || !ready" :aria-label="t('walletLibrary.newCategory')"
            :title="t('walletLibrary.newCategory')" @click="editCategory(null)"><v-icon size="small">mdi-folder-plus-outline</v-icon></v-btn>
        </div>
      </div>
      <div class="library-guidance">
        <p class="library-help" :class="{ 'library-help--saving': pendingCount }">{{ t(filtering ? 'walletLibrary.filteredHint' : reorderable ? 'walletLibrary.reorderHint' : 'walletLibrary.sortedHint') }}</p>
        <p class="library-results library-save-status" role="status">{{ pendingCount ? t('walletLibrary.saving') : '' }}</p>
      </div>
      <p v-if="query" class="library-results" role="status">{{ t('walletLibrary.results', { count: filtered.length, total: wallets.length }) }}<span v-if="indexing"> &middot; {{ t('walletLibrary.indexing') }}</span></p>
      <v-alert v-if="error" density="compact" variant="text" type="error" role="alert" class="library-error">{{ t('walletLibrary.' + error) }}</v-alert>
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
              @click="toggleCollapsed(group)">
              <v-icon size="small">{{ group.expanded ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
              <v-icon size="small">{{ group.favorites ? 'mdi-star' : 'mdi-folder-outline' }}</v-icon>
              <span class="group-name">{{ group.favorites ? t('walletLibrary.favorites') : group.name || t('walletLibrary.uncategorized') }}</span>
              <span class="library-count">{{ filtering ? group.wallets.length : group.total }}</span>
            </button>
            <v-menu v-if="group.id" >
              <template #activator="{ props: activatorProps }">
                <v-btn icon variant="text" size="x-small" v-bind="activatorProps"  :disabled="saving"
                  :aria-label="t('walletLibrary.categoryActions', { name: group.name })"><v-icon size="small">mdi-dots-horizontal</v-icon></v-btn>
              </template>
              <v-list density="compact">
                <v-list-item @click="editCategory(group)"><v-list-item-title>{{ t('walletLibrary.renameCategory') }}</v-list-item-title></v-list-item>
                <v-list-item @click="deleting = group"><v-list-item-title>{{ t('walletLibrary.deleteCategory') }}</v-list-item-title></v-list-item>
              </v-list>
            </v-menu>
          </div>
          <Draggable :id="groupDomId(group.key)" tag="ul" class="library-wallets"
            :class="{ 'library-wallets--target': dragging && (!group.expanded || !group.wallets.length) }"
            :model-value="group.expanded ? group.wallets : []" item-key="id" group="wallet-library" handle=".wallet-drag" draggable=".library-wallet"
            :disabled="!reorderable || !ready" :animation="150" :force-fallback="true" :fallback-on-body="true"
            :fallback-tolerance="4" :scroll-sensitivity="80" :scroll-speed="16" :empty-insert-threshold="24"
            ghost-class="library-wallet--ghost" fallback-class="library-wallet--fallback"
            @start="dragging = true" @end="dragging = false" @change="reordered($event, group)">
            <template #item="{ element: wallet, index }">
              <li class="library-wallet glass-liquid"
                :data-wallet-id="wallet.id" :class="{ 'library-wallet--locked': wallet.id === lockedWalletId, 'library-wallet--group': accountsFor(wallet).length }">
                <button type="button" class="wallet-drag" :disabled="!reorderable || !ready"
                  :aria-label="t('walletLibrary.reorderWallet', { name: wallet.name })" :title="t('walletLibrary.keyboardHint')"
                  @keydown.alt.up.prevent="moveStep(wallet, group, index, -1)"
                  @keydown.alt.down.prevent="moveStep(wallet, group, index, 1)">
                  <v-icon size="small">mdi-drag-vertical</v-icon>
                </button>
                <button type="button" class="wallet-open" :disabled="loadingWalletId != null"
                  :aria-busy="loadingWalletId === wallet.id" :title="displayAddress(wallet)" @click="$emit('select', wallet.id)"
                  @mouseenter="!dragging && $emit('focus-wallet', wallet)" @focus="$emit('focus-wallet', wallet)"
                  :aria-label="t('walletLibrary.openWallet', { name: wallet.name })">
                  <span class="wallet-avatar"><v-avatar size="36"><v-img :src="assets.resolveIcon(wallet.icon)" /></v-avatar>
                    <v-progress-circular v-if="loadingWalletId === wallet.id" class="wallet-chain" size="16" width="2" indeterminate color="var(--g-accent)" />
                    <v-avatar v-else class="wallet-chain" size="16"><v-img :src="networkIcon(wallet)" /></v-avatar></span>
                  <span class="wallet-copy">
                    <span class="wallet-name">{{ wallet.name }} <v-icon v-if="wallet.id === lockedWalletId" size="x-small" :title="t('walletLibrary.locked')">mdi-lock-outline</v-icon></span>
                    <span v-if="loadingWalletId === wallet.id" class="wallet-network" role="status">{{ t('miniGero.unlocking') }}</span>
                    <span v-else class="wallet-network">{{ wallet.chain }} &middot; {{ wallet.network }}<span v-if="walletKind(wallet)"> &middot; {{ walletKind(wallet) }}</span><span v-if="accountsFor(wallet).length"> &middot; {{ tc('accounts.count', accountsFor(wallet).length + 1, { count: accountsFor(wallet).length + 1 }) }}</span></span>
                    <span v-if="walletValues.get(wallet.id)" class="wallet-value t-body-sm g-num"
                      :title="t('walletLibrary.valuesUpdated', { time: formatRelativeTime(walletValues.get(wallet.id)!.at) })">
                      <span class="wallet-value__coins">{{ coinsText(walletValues.get(wallet.id)!) }}</span>
                      <span class="t-caption">&asymp; {{ fiatText(walletValues.get(wallet.id)!) }}</span>
                    </span>
                    <span v-else-if="valuePending(wallet)" class="wallet-network">{{ t('walletLibrary.valueCalculating') }}</span>
                    <span v-if="displayAddress(wallet)" class="wallet-address" :class="{ 'wallet-address--match': matchedAddress(wallet) }" :title="displayAddress(wallet)">{{ shortAddress(displayAddress(wallet)) }}</span>
                  </span>
                  <img v-if="walletTypeIcon(wallet)" class="wallet-hardware" :src="walletTypeIcon(wallet)"
                    :alt="wallet.type" :title="wallet.type" width="18" height="18" />
                </button>
                <v-btn icon variant="text" size="small" class="wallet-favorite" :class="{ 'wallet-favorite--active': wallet.isFavorite }"
                  :disabled="!ready" :aria-pressed="!!wallet.isFavorite" :aria-label="t(wallet.isFavorite ? 'walletLibrary.unfavorite' : 'walletLibrary.favorite', { name: wallet.name })"
                  @click="toggleFavorite(wallet.id)"><v-icon size="small">{{ wallet.isFavorite ? 'mdi-star' : 'mdi-star-outline' }}</v-icon></v-btn>
                <v-menu >
                  <template #activator="{ props: activatorProps }"><v-btn icon variant="text" size="small" v-bind="activatorProps"  :disabled="saving"
                    :aria-label="t('walletLibrary.walletActions', { name: wallet.name })"><v-icon size="small">mdi-dots-vertical</v-icon></v-btn></template>
                  <v-list density="compact">
                    <v-list-subheader>{{ t('walletLibrary.moveTo') }}</v-list-subheader>
                    <v-list-item :disabled="group.id === null" @click="moveCategory(wallet.id, null)"><v-list-item-title>{{ t('walletLibrary.uncategorized') }}</v-list-item-title></v-list-item>
                    <v-list-item v-for="category in preferences.categories" :key="category.id" :disabled="group.id === category.id" @click="moveCategory(wallet.id, category.id)"><v-list-item-title>{{ category.name }}</v-list-item-title></v-list-item>
                    <v-divider />
                    <v-list-item :disabled="!reorderable || index === 0" @click="moveStep(wallet, group, index, -1)"><v-list-item-title>{{ t('walletLibrary.moveUp') }}</v-list-item-title></v-list-item>
                    <v-list-item :disabled="!reorderable || index === group.wallets.length - 1" @click="moveStep(wallet, group, index, 1)"><v-list-item-title>{{ t('walletLibrary.moveDown') }}</v-list-item-title></v-list-item>
                    <template v-if="multiAccountEnabled && canAddAccounts(wallet)">
                      <v-divider />
                      <v-list-item @click="$emit('add-account', wallet.id)"><v-list-item-title>{{ t('accounts.addAccount') }}</v-list-item-title></v-list-item>
                    </template>
                  </v-list>
                </v-menu>
                <ul v-if="accountsFor(wallet).length" class="library-accounts" :aria-label="t('accounts.accountsOf', { name: wallet.name })">
                  <li v-for="account in accountRows(wallet)" :key="account.id" class="library-account">
                    <button type="button" class="account-open glass-tier" :class="{ 'account-open--locked': account.id === lockedWalletId }"
                      :disabled="loadingWalletId != null" :aria-busy="loadingWalletId === account.id" :title="displayAddress(account)"
                      :aria-label="t('walletLibrary.openWallet', { name: walletDisplayName(account, [wallet]) })"
                      @click="$emit('select', account.id)" @focus="$emit('focus-wallet', account)">
                      <v-progress-circular v-if="loadingWalletId === account.id" size="16" width="2" indeterminate color="var(--g-accent)" />
                      <v-icon v-else size="small">mdi-subdirectory-arrow-right</v-icon>
                      <span class="account-name t-body-sm">{{ account.name }} <v-icon v-if="account.id === lockedWalletId" size="x-small" :title="t('walletLibrary.locked')">mdi-lock-outline</v-icon></span>
                      <span v-if="breakdown(wallet) && valueOf(account)" class="account-value t-body-sm g-num">{{ coinsText(valueOf(account)!) }}</span>
                      <span v-else-if="displayAddress(account)" class="wallet-address" :class="{ 'wallet-address--match': matchedAddress(account) }">{{ shortAddress(displayAddress(account)) }}</span>
                    </button>
                  </li>
                  <li v-if="breakdown(wallet) && walletValues.get(wallet.id)" class="library-accounts-note t-caption">
                    {{ t('walletLibrary.valuesUpdated', { time: formatRelativeTime(walletValues.get(wallet.id)!.at) }) }}
                  </li>
                </ul>
              </li>
            </template>
            <template #footer>
            <li v-if="(group.expanded && !group.wallets.length) || (dragging && !group.expanded)" class="group-empty">
              {{ t(group.favorites ? 'walletLibrary.noFavorites' : 'walletLibrary.emptyCategory') }}
            </li>
            </template>
          </Draggable>
        </section>
      </template>
    </div>
    <p class="library-announcement" role="status" aria-live="polite">{{ announcement }}</p>

    <v-dialog v-model="categoryDialog" max-width="420" :persistent="saving">
      <v-card class="library-dialog">
        <v-card-title>{{ t(editingId ? 'walletLibrary.renameCategory' : 'walletLibrary.newCategory') }}</v-card-title>
        <v-card-text><form id="wallet-category-form" @submit.prevent="saveCategory">
          <v-text-field v-model="categoryName" variant="outlined" autofocus :label="t('walletLibrary.categoryName')" counter="48" maxlength="48" :disabled="saving" :error-messages="categoryError ? [categoryError] : []" />
        </form></v-card-text>
        <v-card-actions><v-spacer /><GButton tier="tertiary" :disabled="saving" @click="categoryDialog = false">{{ t('walletLibrary.cancel') }}</GButton><GButton tier="primary" type="submit" form="wallet-category-form" :loading="saving" :disabled="!categoryName.trim()">{{ t('walletLibrary.save') }}</GButton></v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog :model-value="!!deleting" max-width="420" :persistent="saving" @update:model-value="!$event && (deleting = null)">
      <v-card class="library-dialog"><v-card-title>{{ t('walletLibrary.deleteCategory') }}</v-card-title>
        <v-card-text>{{ t('walletLibrary.deleteExplanation', { name: deleting ? deleting.name : '' }) }}</v-card-text>
        <v-card-actions><v-spacer /><GButton tier="tertiary" :disabled="saving" @click="deleting = null">{{ t('walletLibrary.cancel') }}</GButton><GButton tier="destructive" :loading="saving" @click="deleteCategory">{{ t('walletLibrary.delete') }}</GButton></v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRef } from 'vue';
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
import { WALLET_SORTS } from '@/services/walletLibrary/model';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { canAddAccounts, walletDisplayName } from '@/shared/utils/walletAccount';
import type { LibraryWallet, WalletCategory, WalletSort } from '@/services/walletLibrary/model';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';
import { formatUsd } from '@/shared/utils/format';
import { formatRelativeTime } from '@/shared/utils/relativeTime';
import { useWalletValues } from '@/shared/composables/useWalletValues';
import { hasPortfolioValue, type WalletValue } from '@/services/walletLibrary/walletValues';

const props = defineProps<{ availableWallets: Wallet[]; lockedWalletId?: number | null; loadingWalletId?: number | null }>();
defineEmits<{ (event: 'select', id: number): void; (event: 'focus-wallet', wallet: Wallet): void; (event: 'add-account', id: number): void }>();
const { t, tc } = useTranslation();
const { preferences, query, favoritesOnly, sort, ready, saving, error, indexing, wallets, filtered, filtering, reorderable, groups, favoriteCount, run, pendingCount, toggleFavorite, moveWallet, accountsFor } = useWalletLibrary(toRef(props, 'availableWallets'));
const multiAccountEnabled = computed(() => featureFlagsStore.isMultiAccountEnabled());

// What each wallet is worth, tokens and NFTs included (issue 1332). Off with the
// "Balances in the wallet list" setting, and while the logged wallet hides its balances.
const showValues = computed(() => geroStore.config?.walletListBalances !== false && !walletStore.config?.hideBalances);
const everyWallet = computed(() => wallets.value.flatMap((wallet) => [wallet, ...accountsFor(wallet)]));
const { valueOf, isPending } = useWalletValues(everyWallet, showValues);
const valued = (wallet: LibraryWallet) => showValues.value && hasPortfolioValue(wallet, wallet.stakeAddress);
const members = (wallet: LibraryWallet) => [wallet, ...accountsFor(wallet)];
/** A wallet's value: with added accounts, the sum of all of them once each one is known. */
const walletValues = computed(() => new Map(wallets.value.map((wallet): [number, WalletValue | undefined] => {
  const known = valued(wallet) ? members(wallet).map(valueOf) : [];
  if (!known.length || known.some((value) => !value)) return [wallet.id, undefined];
  return [wallet.id, (known as WalletValue[]).reduce((sum, value) => ({
    ada: sum.ada + value.ada, usd: sum.usd + value.usd, eur: sum.eur + value.eur, at: Math.min(sum.at, value.at),
  }))];
})));
const valuePending = (wallet: LibraryWallet) => valued(wallet) && members(wallet).some(isPending);
/** With values shown, a wallet's account list is its breakdown, so account #0 leads it. */
const breakdown = (wallet: LibraryWallet) => valued(wallet) && accountsFor(wallet).length > 0;
const accountRows = (wallet: LibraryWallet) => (breakdown(wallet) ? members(wallet) : accountsFor(wallet));
const coinsText = (value: WalletValue) => `${formatUsd(value.ada, { symbol: false })} ADA`;
const fiatText = (value: WalletValue) => (walletStore.config?.currency === 'eur' ? `€${formatUsd(value.eur, { symbol: false })}` : formatUsd(value.usd));
// Existing labels with the same wording are reused; only "Custom order" is the library's own.
const SORT_LABELS: Record<WalletSort, string> = {
  custom: 'walletLibrary.sortCustom',
  name: 'assets.sortNameAZ',
  chain: 'welcome.blockchain',
  network: 'common.network',
  newest: 'governance.sortNewest',
  oldest: 'governance.sortOldest',
};
const sortLabel = (option: WalletSort) => t(SORT_LABELS[option]);
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
function toggleCollapsed(group: WalletGroup) { void run(() => repository.setCollapsed(group.id, !group.collapsed)); }
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
  if (!reorderable.value || index + delta < 0 || index + delta >= group.wallets.length) return;
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

<style scoped lang="scss">
.wallet-library { display: flex; flex-direction: column; min-height: 0; flex: 1; width: 100%; color: var(--g-text-1); }
.library-toolbar { flex: none; padding: var(--g-s-2) var(--g-s-1) var(--g-s-3); }
.library-toolbar-bottom, .library-filters, .filter-button { display: flex; align-items: center; gap: var(--g-s-2); }
.library-toolbar-bottom { justify-content: space-between; margin-top: var(--g-s-3); }
.library-tools { display: flex; align-items: center; gap: var(--g-s-1); flex: none; }
.library-sort--active .v-icon { color: var(--g-accent); }
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
/* Surface (background, blur, border, radius, edge light) is the shared
   Material 5 "liquid" glass (liquid-glass.css); only layout + the
   accent border states live here. */
.library-wallet { display: flex; align-items: center; gap: var(--g-s-1); min-height: 80px; margin-bottom: var(--g-s-2); padding: var(--g-s-2) var(--g-s-1); transition: border-color var(--g-dur-fast) ease; }
.library-wallet:hover, .library-wallet:focus-within, .library-wallet--locked { border-color: var(--g-accent); }
.library-wallet--ghost { opacity: 0.3; border-color: var(--g-accent); }
.library-wallet--fallback { opacity: 0.95; pointer-events: none; }
/* A wallet with added accounts lists them on the line below its own row. */
.library-wallet--group { flex-wrap: wrap; }
.library-accounts { list-style: none; flex-basis: 100%; display: flex; flex-direction: column; gap: var(--g-s-1); margin: var(--g-s-1) 0 0; padding: 0 0 0 var(--g-s-6); }
/* An added account is a card nested in its wallet's row: the glass-tier
   material lifts its hairline on hover and deepens its tint for the locked
   (current) account, rather than the parent row's accent border. */
.account-open { display: flex; align-items: center; gap: var(--g-s-2); width: 100%; min-width: 0; padding: var(--g-s-2); text-align: left; color: inherit; transition: border-color var(--g-dur-fast) ease, background-color var(--g-dur-fast) ease; }
.account-open:hover:not(:disabled), .account-open:focus-visible { @include g-glass-tier-hover; }
.account-open--locked, .account-open--locked:hover:not(:disabled) { @include g-glass-tier-active; }
.account-open:disabled { cursor: wait; }
.account-open .v-icon { color: var(--g-text-3); flex: none; }
.account-name { flex: none; color: var(--g-text-1); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.account-open .wallet-address { margin-left: auto; min-width: 0; }
.account-value { margin-left: auto; flex: none; color: var(--g-text-1); }
.library-accounts-note { color: var(--g-text-3); padding: var(--g-s-1) var(--g-s-2) 0; }
.wallet-value { display: flex; align-items: baseline; gap: var(--g-s-2); min-width: 0; overflow: hidden; white-space: nowrap; color: var(--g-text-2); }
.wallet-value__coins { color: var(--g-text-1); font-weight: 600; }
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
