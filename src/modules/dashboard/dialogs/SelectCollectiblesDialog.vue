<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="onClose()"
    :title="$t('assets.chooseCollectibles')"
    :min-height="300"
    :height="600"
    :width="550"
    :persistent="false"
  >
    <v-card-text class="px-4 pt-2 pb-0">
      <!-- Search bar -->
      <v-text-field
        v-model="search"
        :placeholder="$t('assets.searchCollectibles')"
        outlined
        dense
        hide-details
        class="collectibles-search mb-3"
        prepend-inner-icon="mdi-magnify"
        clearable
      />

      <!-- NFT grid -->
      <div class="collectibles-grid-wrapper">
        <template v-if="filteredCollections.length > 0">
          <div
            v-for="(collection, cIdx) in filteredCollections"
            :key="`col-${cIdx}`"
            class="collection-group"
          >
            <div class="collection-header">
              {{ collection.name }} ({{ collection.items.length }})
            </div>
            <div class="collectibles-grid">
              <div
                v-for="(item, iIdx) in collection.items"
                :key="`${item.fingerprint || item.name}-${iIdx}`"
                class="collectible-card"
                :class="{ 'collectible-card--selected': isSelected(item) }"
                @click="toggleItem(item)"
              >
                <div
                  class="collectible-card__image"
                  :style="{ backgroundImage: `linear-gradient(transparent 40%, #000000cc), url(${item.img})` }"
                >
                  <!-- Scam badge -->
                  <v-chip
                    v-if="item.isScam"
                    x-small
                    color="#F97066"
                    class="scam-badge"
                  >
                    <v-icon color="white" x-small class="mr-1">mdi-alert-decagram</v-icon>
                    {{ $t('assets.scamToken') }}
                  </v-chip>

                  <!-- Check badge -->
                  <v-scroll-y-transition>
                    <v-avatar
                      v-if="isSelected(item)"
                      color="#00c7f3"
                      size="18"
                      class="check-badge"
                    >
                      <v-icon color="black" x-small>mdi-check-bold</v-icon>
                    </v-avatar>
                  </v-scroll-y-transition>

                  <!-- Name -->
                  <div class="collectible-card__name">{{ item.name }}</div>
                </div>

                <!-- Quantity controls (multi-quantity NFTs) -->
                <div v-if="item.quantity > 1 && isSelected(item)" class="quantity-controls">
                  <v-btn icon x-small @click.stop="decreaseQty(item)">
                    <v-icon color="#00DFF3" small>mdi-minus-box-outline</v-icon>
                  </v-btn>
                  <input
                    :value="getSelectedItem(item)?.toSendQuantity || 1"
                    type="number"
                    :min="1"
                    :max="item.quantity"
                    class="qty-input"
                    @input="onQtyInput(item, $event)"
                    @click.stop
                  />
                  <v-btn icon x-small @click.stop="increaseQty(item)">
                    <v-icon color="#00DFF3" small>mdi-plus-box-outline</v-icon>
                  </v-btn>
                </div>
              </div>
            </div>
            <v-divider class="my-2" />
          </div>
        </template>
        <div v-else class="no-collectibles">
          {{ $t('assets.noCollectibles') }}
        </div>
      </div>
    </v-card-text>

    <!-- Done button -->
    <v-card-actions class="px-4 pb-4 pt-2" style="z-index: 1;">
      <v-spacer />
      <v-btn
        outlined
        color="#00DFF3"
        class="done-button"
        @click="onDone()"
      >
        {{ $t('common.done') }}
        <span v-if="localSelected.length > 0" class="ml-1">({{ localSelected.length }})</span>
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ref, computed, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';

interface Props {
  isOpen: boolean;
  collections: any[];
  selectedCollectibles: any[];
}

const props = defineProps<Props>();
const emit = defineEmits(['close', 'update:selectedCollectibles']);

const search = ref('');
const localSelected = ref<any[]>([]);

// Sync from parent when dialog opens
watch(() => props.isOpen, (open) => {
  if (open) {
    // Deep clone to avoid mutating parent state until "Done"
    localSelected.value = props.selectedCollectibles.map(item => ({ ...item }));
    search.value = '';
  }
});

const filteredCollections = computed(() => {
  let cols = props.collections || [];
  if (search.value) {
    const term = search.value.toLowerCase();
    cols = cols
      .map(collection => ({
        ...collection,
        items: collection.items.filter((item: any) =>
          item.name.toLowerCase().includes(term)
        ),
      }))
      .filter(collection => collection.items.length > 0);
  }
  // Ensure toSendQuantity default
  return cols.map(collection => ({
    ...collection,
    items: collection.items.map((item: any) => {
      if (item.toSendQuantity === undefined) {
        item.toSendQuantity = 1;
      }
      return item;
    }),
  }));
});

function isSelected(item: any): boolean {
  return localSelected.value.some(
    s => (s.fingerprint && s.fingerprint === item.fingerprint) || s.name === item.name
  );
}

function getSelectedItem(item: any): any | undefined {
  return localSelected.value.find(
    s => (s.fingerprint && s.fingerprint === item.fingerprint) || s.name === item.name
  );
}

function toggleItem(item: any) {
  const idx = localSelected.value.findIndex(
    s => (s.fingerprint && s.fingerprint === item.fingerprint) || s.name === item.name
  );
  if (idx >= 0) {
    localSelected.value.splice(idx, 1);
  } else {
    localSelected.value.push({ ...item, toSendQuantity: item.toSendQuantity || 1 });
  }
}

function decreaseQty(item: any) {
  const sel = getSelectedItem(item);
  if (sel && sel.toSendQuantity > 1) {
    sel.toSendQuantity--;
  }
}

function increaseQty(item: any) {
  const sel = getSelectedItem(item);
  if (sel && sel.toSendQuantity < item.quantity) {
    sel.toSendQuantity++;
  }
}

function onQtyInput(item: any, event: Event) {
  const sel = getSelectedItem(item);
  if (!sel) return;
  const val = parseInt((event.target as HTMLInputElement).value, 10);
  if (!isNaN(val)) {
    sel.toSendQuantity = Math.max(1, Math.min(val, item.quantity));
  }
}

function onDone() {
  emit('update:selectedCollectibles', [...localSelected.value]);
  emit('close');
}

function onClose() {
  emit('close');
}
</script>

<style scoped>
.collectibles-search :deep(.v-input__slot) {
  background-color: #292929 !important;
  border-radius: 8px;
}

.collectibles-grid-wrapper {
  max-height: 400px;
  overflow-y: auto;
  padding-right: 4px;
}

.collection-group {
  margin-bottom: 4px;
}

.collection-header {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.collectibles-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.collectible-card {
  cursor: pointer;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid transparent;
  transition: border-color 0.15s ease;
}

.collectible-card--selected {
  border-color: #00c7f3;
}

.collectible-card__image {
  position: relative;
  height: 100px;
  background-size: cover;
  background-position: center;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 6px;
}

.collectible-card__name {
  font-size: 11px;
  font-weight: 500;
  color: white;
  line-height: 1.1;
  letter-spacing: -0.3px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.scam-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  font-size: 9px !important;
  height: 18px !important;
}

.check-badge {
  position: absolute;
  top: 4px;
  right: 4px;
}

.quantity-controls {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px 0;
  background-color: rgba(255, 255, 255, 0.04);
}

.qty-input {
  text-align: center;
  height: 16px;
  color: white;
  width: 40px;
  font-size: 10px;
  background: transparent;
  border: none;
  outline: none;
}

/* Hide number input spinners */
.qty-input::-webkit-outer-spin-button,
.qty-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.qty-input[type='number'] {
  -moz-appearance: textfield;
}

.no-collectibles {
  text-align: center;
  color: rgba(255, 255, 255, 0.3);
  font-size: 13px;
  padding: 32px 0;
}

.done-button {
  text-transform: none !important;
  letter-spacing: 0 !important;
  border-radius: 8px;
  min-width: 100px;
}
</style>
