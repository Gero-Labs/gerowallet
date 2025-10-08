<template>
  <!-- NFT Gallery Container -->
  <div class="nft-gallery-container adaptive-container" :style="{ minHeight: containerHeight + 'px' }">
    <!-- Dynamic height container to match assets table -->
    <div class="gallery-wrapper">
      <!-- Grid View -->
      <div class="gallery-grid px-3" :class="gridSizeClass" :style="{ '--card-size': cardSize + 'px' }">
        <v-card
          v-for="collection in paginatedCollectibles"
          :key="collection.id || collection.name"
          class="nft-collection-card liquid-glass-card"
          @click="handleOnRowClick(collection)"
        >
          <!-- Image Container -->
          <div class="card-image-container" :style="{ height: cardSize + 'px' }">
            <v-img
              :src="collection.img"
              :alt="collection.name"
              :aspect-ratio="1"
              class="collection-image"
              :gradient="
                collection.isScam
                  ? 'to bottom, transparent 60%, rgba(249, 112, 102, 0.8) 100%'
                  : 'to bottom, transparent 60%, rgba(0,0,0,0.8) 100%'
              "
            >
              <!-- Overlay badges -->
              <div class="card-badges">
                <v-chip small outlined class="quantity-chip">
                  {{ Number(collection.quantity || 1).toLocaleString() }} items
                </v-chip>
                <v-chip v-if="collection.isScam" small color="error">
                  <v-icon left x-small>mdi-alert-decagram</v-icon>
                  Scam
                </v-chip>
              </div>
            </v-img>
          </div>

          <!-- Card Content with Liquid Glass Effect -->
          <div class="card-content-overlay">
            <h3 class="collection-name-glass">{{ collection.name }}</h3>
          </div>
        </v-card>
      </div>

      <!-- Pagination for gallery views -->
      <div v-if="totalPages > 1" class="text-center mb-2">
        <v-pagination
          v-model="collectiblesPage"
          :length="totalPages"
          :total-visible="5"
          circle
          class="compact-pagination"
        ></v-pagination>
      </div>
    </div>
    <TokensDialog @close="closeDialog" :modalData="dialogData" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRefs, watch, onMounted, onUnmounted } from 'vue';
import { walletStore } from '@/stores/walletStore';
import TokensDialog from '@/modules/assets/dialogs/TokensDialog.vue';

// Props
interface Props {
  hideScam?: boolean;
  searchTerm?: string;
  sortBy?: string;
  containerHeight?: number;
}

const props = withDefaults(defineProps<Props>(), {
  hideScam: false,
  searchTerm: '',
  sortBy: 'name',
  containerHeight: 348,
});

// Emits
const emit = defineEmits(['rowClick']);

// Store references
const { collections } = toRefs(walletStore);

// Advanced Gallery Features
const collectiblesPage = ref<number>(1);
const dialogData = ref<any>(null);
const screenWidth = ref<number>(window.innerWidth);

// Pagination settings
const itemsPerPage = 14; // 2 rows of 7 items

// Methods
const handleOnRowClick = (collection: any) => {
  dialogData.value = collection;
};

const closeDialog = () => {
  dialogData.value = null;
};

// Computed properties
const collectibles = computed(() => {
  let res = Object.values(collections.value).filter((collection: any) =>
    collection.items.every(item => !item.metadata)
  );
  if (res && props.hideScam) {
    res = res.filter((collection: any) => !collection.isScam);
  }
  return res;
});

// const sortOptionsDropdown = computed(() => [
//   { text: 'Name (A-Z)', value: 'name' },
//   { text: 'Name (Z-A)', value: 'name_desc' },
//   { text: 'Quantity (High-Low)', value: 'quantity_desc' },
//   { text: 'Quantity (Low-High)', value: 'quantity' },
// ]);

const cardSize = computed(() => {
  // Dynamically size cards based on available height
  const baseSize = props.containerHeight <= 200 ? 80 : 110;

  if (screenWidth.value <= 480) {
    return baseSize - 10;
  } else if (screenWidth.value <= 768) {
    return baseSize;
  } else if (screenWidth.value <= 1200) {
    return baseSize + 10;
  } else {
    return baseSize + 20;
  }
});

const gridSizeClass = computed(() => {
  return 'grid-7-cols'; // 7 columns for large screens
});

const dynamicItemsPerPage = computed(() => itemsPerPage);

// Use the shared container height from the parent
const containerHeight = computed(() => props.containerHeight);

const sortedCollectibles = computed(() => {
  if (!collectibles.value) return [];

  let sorted: any[] = [...collectibles.value];

  // Apply search filter using prop instead of local ref
  if (props.searchTerm && props.searchTerm.trim()) {
    const searchTerm = props.searchTerm.toLowerCase().trim();
    sorted = sorted.filter((collection: any) => {
      // Search in name
      if (collection.name && collection.name.toLowerCase().includes(searchTerm)) {
        return true;
      }

      // Search in description
      if (collection.description) {
        let descriptionText = '';
        if (typeof collection.description === 'string') {
          descriptionText = collection.description;
        } else if (Array.isArray(collection.description)) {
          descriptionText = collection.description.join(' ');
        }
        if (descriptionText.toLowerCase().includes(searchTerm)) {
          return true;
        }
      }

      return false;
    });
  }

  // Then apply sorting
  switch (props.sortBy) {
    case 'name_desc':
      sorted.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case 'quantity':
      sorted.sort((a, b) => (a.quantity || 0) - (b.quantity || 0));
      break;
    case 'quantity_desc':
      sorted.sort((a, b) => (b.quantity || 0) - (a.quantity || 0));
      break;
    default: // 'name'
      sorted.sort((a, b) => a.name.localeCompare(b.name));
  }

  return sorted;
});

const paginatedCollectibles: any = computed(() => {
  const start = (collectiblesPage.value - 1) * dynamicItemsPerPage.value;
  const end = start + dynamicItemsPerPage.value;
  return sortedCollectibles.value.slice(start, end);
});

const totalPages = computed(() => {
  return Math.ceil(sortedCollectibles.value.length / dynamicItemsPerPage.value);
});

// Watch for search changes to reset pagination
watch(
  () => props.searchTerm,
  () => {
    collectiblesPage.value = 1;
  }
);

// Resize handler
const handleResize = () => {
  screenWidth.value = window.innerWidth;
  collectiblesPage.value = 1; // Reset to page 1 when screen size changes
};

// Lifecycle hooks
onMounted(() => {
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
});
</script>

<style scoped>
/* NFT Gallery Liquid Glass Effects */
.nft-gallery-container {
  position: relative;
  z-index: 1;
  transition: min-height 0.3s ease, height 0.3s ease;
}

.nft-gallery-container.adaptive-container {
  min-height: 148px;
  height: auto;
  overflow: visible;
  display: flex;
  flex-direction: column;
}

.gallery-wrapper {
  transition: height 0.3s ease;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.liquid-glass-card,
.v-card.liquid-glass-card {
  background-color: rgba(255, 255, 255, 0.05) !important;
  background-image: none !important;
  backdrop-filter: blur(10px) !important;
  -webkit-backdrop-filter: blur(10px) !important;
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
  border-radius: 12px !important;
  transition: all 0.3s ease !important;
  cursor: pointer !important;
  overflow: hidden !important;
}

.liquid-glass-card:hover,
.v-card.liquid-glass-card:hover {
  background-color: rgba(255, 255, 255, 0.08) !important;
  backdrop-filter: blur(15px) !important;
  -webkit-backdrop-filter: blur(15px) !important;
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
  transform: translateY(-2px) !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3) !important;
}

.nft-collection-card {
  position: relative;
  height: 100%;
  border-radius: 12px;
  overflow: hidden;
}

.card-image-container {
  position: relative;
  overflow: hidden;
  border-radius: 12px 12px 0 0;
  transition: transform 0.3s ease;
}

.liquid-glass-card:hover .card-content-overlay {
  height: 55px;
}

.collection-image {
  transition: transform 0.3s ease;
}

.nft-collection-card:hover .collection-image {
  transform: scale(1.05);
}

.card-badges {
  position: relative;
  padding-top: 8px;
  z-index: 2;
  display: flex;
  justify-content: space-between;
  padding-left: 8px;
  padding-right: 8px;
}

.quantity-chip {
  background: rgba(0, 0, 0, 0.7) !important;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.2) !important;
  color: white !important;
}

.card-content-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.8));
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  padding: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  transition: height 0.3s ease;
}

.collection-name-glass {
  color: white;
  font-size: 12px;
  font-weight: 600;
  margin: 0;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-align: center;
  transition: white-space 0.3s ease;
}

.liquid-glass-card:hover .collection-name-glass {
  white-space: normal;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

/* Gallery Grid Layouts */
.gallery-grid {
  display: grid;
  gap: 10px;
  transition: all 0.3s ease;
  align-content: center; /* Center cards vertically in available space */
  padding-top: 8px;
  padding-bottom: 8px;
  height: 100%;
  box-sizing: border-box;
}

.grid-4-cols {
  grid-template-columns: repeat(4, 1fr);
}

.grid-5-cols {
  grid-template-columns: repeat(5, 1fr);
}

.grid-6-cols {
  grid-template-columns: repeat(6, 1fr);
}

.grid-small {
  grid-template-columns: repeat(auto-fill, minmax(var(--card-size, 126px), 1fr));
}

.grid-medium {
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}

.grid-large {
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}

/* Masonry Layout */
.gallery-masonry {
  column-count: 4;
  column-gap: 16px;
}

.masonry-item {
  break-inside: avoid;
  margin-bottom: 16px;
}

@media (max-width: 1200px) {
  .gallery-masonry {
    column-count: 3;
  }
}

@media (max-width: 768px) {
  .gallery-masonry {
    column-count: 2;
  }
  .gallery-grid {
    gap: 12px; /* Smaller gap on mobile */
  }
}

@media (max-width: 480px) {
  .gallery-masonry {
    column-count: 1;
  }
  .gallery-grid {
    gap: 8px; /* Even smaller gap on very small screens */
  }
}

/* List View */
.gallery-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: transparent;
}

.nft-collection-item {
  border-radius: 12px;
  margin-left: 8px;
  margin-right: 8px;
}

/* Gallery Controls */
.gallery-controls {
  padding: 8px 16px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 0;
}

.collection-search .v-input__control,
.sort-select .v-input__control {
  background: rgba(255, 255, 255, 0.05) !important;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.collection-search .v-input__control .v-input__slot,
.sort-select .v-input__control .v-input__slot {
  border: 1px solid rgba(255, 255, 255, 0.1) !important;
}

.gallery-controls .v-text-field .v-input__prepend-inner {
  align-self: center !important;
  margin-top: 0 !important;
  padding-top: 0 !important;
}

.gallery-controls .v-text-field .v-input__prepend-inner .v-input__icon {
  align-items: center !important;
  justify-content: center !important;
}

.gallery-controls .v-text-field .v-input__prepend-inner .v-icon {
  font-size: 16px !important;
}

/* Reduce z-index of collectible cards when select is open */
.nft-collection-card {
  position: relative;
  z-index: 1;
}

.compact-pagination >>> .v-pagination__item {
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
  font-size: 12px !important;
  margin: 0 4px !important;
}

.compact-pagination >>> .v-pagination__navigation {
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
  margin: 0 8px !important;
}

.compact-pagination >>> .v-pagination__navigation .v-icon {
  font-size: 16px !important;
}
</style>

<style>
/* Override Vuetify v-select height with higher specificity */
.sort-select-small.v-text-field--outlined.v-input--dense.v-text-field--single-line > .v-input__control > .v-input__slot,
.sort-select-small.v-text-field--outlined.v-input--dense.v-text-field--outlined > .v-input__control > .v-input__slot {
  min-height: 32px !important;
  height: 32px !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
}

.sort-select-small.v-select .v-input__control {
  height: 32px !important;
  min-height: 32px !important;
}

.sort-select-small .v-select__selection {
  line-height: 30px !important;
}

.sort-select-small.v-text-field--outlined.v-input--dense:not(.v-text-field--solo) .v-input__append-inner {
  margin-top: 4px !important;
}
.grid-7-cols {
  grid-template-columns: repeat(7, 1fr);
}
</style>
