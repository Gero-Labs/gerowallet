<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="close"
    :title="t('settings.changeProfilePicture')"
    :subtitle="t('settings.chooseProfilePicture')"
    icon="mdi-camera"
    :width="440"
    :min-height="560"
    :height="560"
    :persistent="false"
  >
    <v-card-text class="pt-0 px-5 d-flex flex-column" style="flex: 1; overflow: hidden;">
      <!-- Current avatar preview -->
      <div class="current-preview d-flex align-center mb-5">
        <v-avatar size="64" rounded class="current-avatar">
          <v-img :src="displayAvatar" />
        </v-avatar>
        <div class="ml-4">
          <div style="font-size: 14px; font-weight: 600; color: #f5f5f6; line-height: 1.3;">
            {{ loggedWallet?.name }}
          </div>
          <div style="font-size: 11px; color: #94969c; margin-top: 2px;">
            {{ hasSelection ? t('settings.newPictureSelected') : t('settings.currentPicture') }}
          </div>
        </div>
        <v-spacer />
        <v-btn
          v-if="hasSelection"
          small
          color="primary"
          class="confirm-btn"
          :loading="saving"
          @click="confirmSelection"
        >
          <v-icon small class="mr-1">mdi-check</v-icon>
          {{ $t('common.confirm') }}
        </v-btn>
      </div>

      <!-- Tab selector -->
      <v-btn-toggle v-model="activeTab" mandatory dense class="tab-toggle mb-4">
        <v-btn small :value="'upload'" class="tab-btn">
          <v-icon small class="mr-1">mdi-cloud-upload-outline</v-icon>
          {{ $t('settings.uploadFromDevice') }}
        </v-btn>
        <v-btn small :value="'nft'" class="tab-btn">
          <v-icon small class="mr-1">mdi-image-multiple-outline</v-icon>
          {{ $t('settings.selectFromNFTs') }}
        </v-btn>
      </v-btn-toggle>

      <!-- Tab content (fixed height to prevent jumping) -->
      <div class="tab-content">

      <!-- Upload tab -->
      <div
        v-show="activeTab === 'upload'"
        class="drop-zone"
        :class="{ 'drop-zone-active': isDragging, 'drop-zone-has-preview': !!previewImage }"
        @dragenter.prevent="onDragEnter"
        @dragover.prevent
        @dragleave.prevent="onDragLeave"
        @drop.prevent="onDrop"
        @click="triggerFileUpload"
      >
        <input ref="fileInput" type="file" accept="image/*" style="display: none" @change="onFileSelected" />

        <!-- Preview state -->
        <div v-if="previewImage" class="drop-zone-preview">
          <v-avatar size="120" rounded>
            <v-img :src="previewImage" />
          </v-avatar>
          <div class="drop-zone-change-hint mt-3">
            <v-icon x-small color="white" class="mr-1">mdi-swap-horizontal</v-icon>
            {{ $t('settings.clickToChange') }}
          </div>
        </div>

        <!-- Empty state -->
        <div v-else class="drop-zone-empty">
          <div class="drop-zone-icon-ring">
            <v-icon size="34" :color="isDragging ? '#00c7f3' : '#666'">
              {{ isDragging ? 'mdi-tray-arrow-down' : 'mdi-cloud-upload-outline' }}
            </v-icon>
          </div>
          <div class="drop-zone-text mt-4">
            <span v-if="isDragging" style="color: #00c7f3;">{{ $t('common.drop') }}</span>
            <template v-else>
              <span style="color: #00c7f3; font-weight: 500;">{{ $t('settings.clickToUpload') }}</span>
              <span style="color: #94969c;"> {{ $t('settings.orDragAndDrop') }}</span>
            </template>
          </div>
          <div class="drop-zone-formats">PNG · JPG · GIF · SVG</div>
        </div>
      </div>

      <!-- NFT tab -->
      <div v-show="activeTab === 'nft'" class="nft-tab">

        <!-- Breadcrumb / Back button when inside a collection -->
        <div v-if="openCollectionId" class="collection-breadcrumb mb-3">
          <v-btn text x-small class="px-1" @click="openCollectionId = null" style="text-transform: none; letter-spacing: 0;">
            <v-icon small class="mr-1">mdi-arrow-left</v-icon>
            {{ $t('common.back') }}
          </v-btn>
          <span class="breadcrumb-name">{{ openCollectionName }}</span>
          <span class="breadcrumb-count">({{ openCollectionItems.length }})</span>
        </div>

        <!-- Search -->
        <v-text-field
          v-model="nftSearch"
          :placeholder="openCollectionId ? $t('settings.searchNFTs') : $t('settings.searchCollections')"
          outlined
          dense
          hide-details
          prepend-inner-icon="mdi-magnify"
          class="mb-3 nft-search"
          clearable
        />

        <!-- ─── Collections list (level 1) ─── -->
        <template v-if="!openCollectionId">
          <div v-if="collectionList.length === 0" class="nft-empty-state">
            <v-icon size="40" color="#333">mdi-image-off-outline</v-icon>
            <div style="color: #94969c; font-size: 13px; margin-top: 8px;">
              {{ $t('settings.noNFTsFound') }}
            </div>
          </div>

          <div v-else-if="filteredCollections.length === 0" class="nft-empty-state">
            <v-icon size="40" color="#333">mdi-magnify-close</v-icon>
            <div style="color: #94969c; font-size: 13px; margin-top: 8px;">
              {{ $t('common.noResults') }}
            </div>
          </div>

          <div v-else class="collection-list">
            <div
              v-for="col in filteredCollections"
              :key="col.policyId"
              class="collection-row"
              @click="openCollection(col.policyId)"
            >
              <v-avatar size="40" rounded class="collection-thumb">
                <v-img v-if="col.img" :src="col.img" />
                <v-icon v-else small>mdi-image-outline</v-icon>
              </v-avatar>
              <div class="collection-info">
                <div class="collection-name">{{ col.name }}</div>
                <div class="collection-count">{{ col.itemCount }} {{ col.itemCount === 1 ? 'item' : 'items' }}</div>
              </div>
              <v-icon small color="#555" class="collection-arrow">mdi-chevron-right</v-icon>
            </div>
          </div>
        </template>

        <!-- ─── NFT items grid (level 2) ─── -->
        <template v-if="openCollectionId">
          <div v-if="filteredCollectionItems.length === 0" class="nft-empty-state">
            <v-icon size="40" color="#333">mdi-magnify-close</v-icon>
            <div style="color: #94969c; font-size: 13px; margin-top: 8px;">
              {{ $t('common.noResults') }}
            </div>
          </div>

          <div v-else class="nft-grid">
            <div
              v-for="item in filteredCollectionItems"
              :key="item.unit"
              class="nft-grid-item"
              :class="{ 'nft-selected': selectedNft === item.unit }"
              @click="selectNft(item)"
            >
              <v-img
                :src="item.img"
                aspect-ratio="1"
                class="nft-grid-img"
              >
                <template #placeholder>
                  <div class="d-flex align-center justify-center" style="height: 100%; background: rgba(255,255,255,0.03);">
                    <v-progress-circular indeterminate size="18" width="2" color="#333" />
                  </div>
                </template>
              </v-img>
              <span class="nft-name">{{ item.name }}</span>
              <transition name="fade">
                <v-avatar
                  v-if="selectedNft === item.unit"
                  color="#00c7f3"
                  size="18"
                  class="nft-check"
                >
                  <v-icon color="black" style="font-size: 11px;">mdi-check-bold</v-icon>
                </v-avatar>
              </transition>
            </div>
          </div>
        </template>
      </div>

      </div><!-- /tab-content -->
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, watch, toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { walletStore } from '@/stores/walletStore';
import geroStoreDefault from '@/stores/geroStore';
import assets from '@/utils/assets';
import snackbar from '@/plugins/snackbar';

interface NftItem {
  unit: string;
  name: string;
  img: string;
}

interface CollectionEntry {
  policyId: string;
  name: string;
  img: string;
  itemCount: number;
  items: NftItem[];
}

const { t } = useTranslation();

const isOpen = ref(false);
const activeTab = ref<'upload' | 'nft'>('upload');
const nftSearch = ref('');
const selectedNft = ref<string | null>(null);
const previewImage = ref<string | null>(null);
const pendingBase64 = ref<string | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const isDragging = ref(false);
const dragCounter = ref(0);
const saving = ref(false);
const openCollectionId = ref<string | null>(null);

const { loggedWallet, collections } = toRefs(walletStore);

const emit = defineEmits(['updated']);

const hasSelection = computed(() => !!previewImage.value || !!selectedNft.value);

// Current avatar resolved for display
const currentAvatar = computed(() => {
  if (!loggedWallet.value?.icon) return '';
  return loggedWallet.value.icon.includes('http') || loggedWallet.value.icon.startsWith('data:')
    ? loggedWallet.value.icon
    : assets.resolveIcon(loggedWallet.value.icon);
});

// Shows preview if selected, otherwise current
const displayAvatar = computed(() => {
  if (previewImage.value) return previewImage.value;
  if (selectedNft.value) {
    for (const col of collectionList.value) {
      const nft = col.items.find(n => n.unit === selectedNft.value);
      if (nft) return nft.img;
    }
  }
  return currentAvatar.value;
});

// Build collection list from walletStore.collections
const collectionList = computed((): CollectionEntry[] => {
  if (!collections.value) return [];
  const entries: CollectionEntry[] = [];
  for (const [policyId, col] of Object.entries(collections.value) as [string, { name?: string; img?: string; items?: NftItem[] }][]) {
    const items = (col.items || []).filter(i => i.img);
    if (items.length === 0) continue;
    entries.push({
      policyId,
      name: col.name || policyId.slice(0, 12) + '...',
      img: col.img || items[0]?.img || '',
      itemCount: items.length,
      items,
    });
  }
  // Sort by item count descending
  entries.sort((a, b) => b.itemCount - a.itemCount);
  return entries;
});

// Filtered collections by search
const filteredCollections = computed(() => {
  const q = nftSearch.value.toLowerCase().trim();
  if (!q) return collectionList.value;
  return collectionList.value.filter(c => c.name.toLowerCase().includes(q));
});

// Items for the currently open collection
const openCollectionItems = computed((): NftItem[] => {
  if (!openCollectionId.value) return [];
  const col = collectionList.value.find(c => c.policyId === openCollectionId.value);
  return col?.items || [];
});

const openCollectionName = computed(() => {
  const col = collectionList.value.find(c => c.policyId === openCollectionId.value);
  return col?.name || '';
});

// Filtered items inside an open collection
const filteredCollectionItems = computed(() => {
  const q = nftSearch.value.toLowerCase().trim();
  if (!q) return openCollectionItems.value;
  return openCollectionItems.value.filter(i => i.name.toLowerCase().includes(q));
});

// Clear search when switching between collection levels
watch(openCollectionId, () => {
  nftSearch.value = '';
});

function open() {
  isOpen.value = true;
  activeTab.value = 'upload';
  nftSearch.value = '';
  selectedNft.value = null;
  previewImage.value = null;
  pendingBase64.value = null;
  saving.value = false;
  dragCounter.value = 0;
  openCollectionId.value = null;
}

function close() {
  isOpen.value = false;
}

function openCollection(policyId: string) {
  openCollectionId.value = policyId;
}

function triggerFileUpload() {
  fileInput.value?.click();
}

function onDragEnter() {
  dragCounter.value++;
  isDragging.value = true;
}

function onDragLeave() {
  dragCounter.value--;
  if (dragCounter.value <= 0) {
    isDragging.value = false;
    dragCounter.value = 0;
  }
}

function onDrop(event: DragEvent) {
  isDragging.value = false;
  dragCounter.value = 0;
  const file = event.dataTransfer?.files?.[0];
  if (!file || !file.type.startsWith('image/')) return;
  selectedNft.value = null;
  readFileAsPreview(file);
}

function onFileSelected(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  selectedNft.value = null;
  readFileAsPreview(file);
  target.value = '';
}

function readFileAsPreview(file: File) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const base64 = e.target?.result as string;
    previewImage.value = base64;
    pendingBase64.value = base64;
  };
  reader.readAsDataURL(file);
}

function selectNft(item: NftItem) {
  selectedNft.value = selectedNft.value === item.unit ? null : item.unit;
  previewImage.value = null;
  pendingBase64.value = null;
}

async function confirmSelection() {
  if (!loggedWallet.value) return;
  saving.value = true;
  try {
    if (pendingBase64.value) {
      await geroStoreDefault.setWalletIcon(loggedWallet.value.id, pendingBase64.value);
      loggedWallet.value.icon = pendingBase64.value;
    } else if (selectedNft.value) {
      for (const col of collectionList.value) {
        const nft = col.items.find(n => n.unit === selectedNft.value);
        if (nft) {
          await geroStoreDefault.setWalletIcon(loggedWallet.value.id, nft.img);
          loggedWallet.value.icon = nft.img;
          break;
        }
      }
    }
    snackbar.fireSuccess(t('settings.profilePictureUpdated'));
    emit('updated');
    close();
  } finally {
    saving.value = false;
  }
}

defineExpose({ open });
</script>

<style scoped lang="scss">
/* ── Tab toggle ── */
.tab-toggle {
  display: flex;
  width: 100%;
  border-radius: 8px !important;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
}

.tab-btn {
  flex: 1;
  text-transform: none !important;
  letter-spacing: 0 !important;
  font-size: 12px !important;
  font-weight: 500 !important;
}

/* ── Current preview bar ── */
.current-preview {
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}

.current-avatar {
  border: 2px solid rgba(0, 199, 243, 0.35);
  box-shadow: 0 0 0 4px rgba(0, 199, 243, 0.06);
}

.confirm-btn {
  text-transform: none !important;
  letter-spacing: 0 !important;
  font-weight: 600 !important;
  border-radius: 8px !important;
}

/* ── Tab content wrapper ── */
.tab-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── NFT tab layout ── */
.nft-tab {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }
}

/* ── Drop zone ── */
.drop-zone {
  border: 2px dashed rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  padding: 24px 20px;
  cursor: pointer;
  transition: all 0.2s ease;
  text-align: center;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.015);
}

.drop-zone:hover {
  border-color: rgba(0, 199, 243, 0.3);
  background: rgba(0, 199, 243, 0.02);
}

.drop-zone-active {
  border-color: #00c7f3 !important;
  background: rgba(0, 199, 243, 0.06) !important;
  border-style: solid;
}

.drop-zone-has-preview {
  padding: 20px 16px;
}

.drop-zone-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.drop-zone-change-hint {
  font-size: 11px;
  color: #94969c;
  display: flex;
  align-items: center;
  transition: color 0.15s;
}

.drop-zone:hover .drop-zone-change-hint {
  color: #00c7f3;
}

.drop-zone-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
}

.drop-zone-icon-ring {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.02);
  transition: border-color 0.2s, background 0.2s;
}

.drop-zone:hover .drop-zone-icon-ring,
.drop-zone-active .drop-zone-icon-ring {
  border-color: rgba(0, 199, 243, 0.2);
  background: rgba(0, 199, 243, 0.04);
}

.drop-zone-text {
  font-size: 14px;
  line-height: 1.4;
}

.drop-zone-formats {
  font-size: 10px;
  font-weight: 500;
  color: #666;
  margin-top: 10px;
  letter-spacing: 1px;
  text-transform: uppercase;
}

/* ── Breadcrumb ── */
.collection-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
}

.breadcrumb-name {
  font-size: 13px;
  font-weight: 600;
  color: #f5f5f6;
}

.breadcrumb-count {
  font-size: 12px;
  color: #666;
}

/* ── NFT search ── */
.nft-search ::v-deep .v-input__slot {
  border-radius: 8px !important;
}

/* ── NFT empty state ── */
.nft-empty-state {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
}

/* ── Collection list (level 1) ── */
.collection-list {
  padding-right: 4px;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }
}

.collection-row {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  gap: 12px;

  &:hover {
    background: rgba(255, 255, 255, 0.04);

    .collection-arrow {
      color: #f5f5f6 !important;
    }
  }

  &:active {
    background: rgba(255, 255, 255, 0.06);
  }

  & + & {
    margin-top: 2px;
  }
}

.collection-thumb {
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.collection-info {
  flex: 1;
  min-width: 0;
}

.collection-name {
  font-size: 13px;
  font-weight: 600;
  color: #f5f5f6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collection-count {
  font-size: 11px;
  color: #666;
}

.collection-arrow {
  flex-shrink: 0;
  transition: color 0.15s;
}

/* ── NFT grid (level 2) ── */
.nft-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding-right: 4px;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
  }
}

.nft-grid-item {
  position: relative;
  cursor: pointer;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid transparent;
  transition: border-color 0.15s, transform 0.15s;
  aspect-ratio: 1;
}

.nft-grid-item:hover {
  border-color: rgba(255, 255, 255, 0.15);
  transform: scale(1.02);
}

.nft-grid-item:active {
  transform: scale(0.98);
}

.nft-selected {
  border-color: #00c7f3 !important;
  box-shadow: 0 0 0 1px rgba(0, 199, 243, 0.3);
}

.nft-grid-img {
  width: 100%;
  height: 100%;
  border-radius: 6px;
}

.nft-name {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  font-size: 9px;
  font-weight: 600;
  text-align: center;
  padding: 12px 6px 4px;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.85));
  color: white;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.nft-check {
  position: absolute;
  top: 4px;
  right: 4px;
}

/* ── Transitions ── */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s;
}

.fade-enter,
.fade-leave-to {
  opacity: 0;
}
</style>
