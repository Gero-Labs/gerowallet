<template>
  <!-- NFT Gallery Container -->
  <div class="nft-gallery-container">
    <!-- Gallery Controls -->
    <div class="gallery-controls mb-4">
      <div class="d-flex align-center justify-space-between">
        <div class="d-flex align-center gap-3">
          <v-text-field
            v-model="collectiblesSearch"
            dense
            outlined
            hide-details
            placeholder="Search collections..."
            prepend-inner-icon="mdi-magnify"
            clearable
            style="max-width: 280px;"
            class="collection-search"
          ></v-text-field>
        </div>

        <div class="d-flex align-center gap-3">
          <v-select
            v-model="collectiblesSortBy"
            :items="sortOptionsDropdown"
            dense
            outlined
            hide-details
            style="max-width: 158px; font-size: 12px; margin-right: 12px; min-height: 32px; max-height: 32px"
            class="sort-select-small"
            attach
          ></v-select>

          <v-btn-toggle class="mx-2" v-model="cardSizeMode" mandatory dense color="primary">
            <v-btn value="small" x-small>S</v-btn>
            <v-btn value="medium" x-small>M</v-btn>
            <v-btn value="large" x-small>L</v-btn>
          </v-btn-toggle>

          <v-btn-toggle v-model="collectiblesViewMode" mandatory dense color="primary">
            <v-btn value="grid" x-small>
              <v-icon small>mdi-view-comfy</v-icon>
            </v-btn>
            <v-btn value="list" x-small>
              <v-icon small>mdi-view-list</v-icon>
            </v-btn>
          </v-btn-toggle>
        </div>
      </div>
    </div>

    <!-- Grid View -->
    <div v-if="collectiblesViewMode === 'grid'" class="gallery-grid px-3 pb-3" :class="gridSizeClass">
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
            :gradient="collection.isScam ? 'to bottom, transparent 60%, rgba(249, 112, 102, 0.8) 100%' : 'to bottom, transparent 60%, rgba(0,0,0,0.8) 100%'"
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

    <!-- List View -->
    <v-list v-if="collectiblesViewMode === 'list'" class="gallery-list">
      <v-list-item
        v-for="collection in paginatedCollectibles"
        :key="collection.id || collection.name"
        class="nft-collection-item liquid-glass-card mb-0"
        @click="handleOnRowClick(collection)"
      >
        <v-list-item-avatar rounded :size="avatarSize">
          <v-img :src="collection.img" :alt="collection.name" />
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title>{{ collection.name }}</v-list-item-title>
          <v-list-item-subtitle v-if="collection.description" class="text-body-2 text--secondary mb-0">
            {{ Number(collection.quantity || 1).toLocaleString() }} Items
          </v-list-item-subtitle>
          <v-list-item-subtitle>
            {{ Array.isArray(collection.description) ? collection.description.join('') : collection.description }}
          </v-list-item-subtitle>
        </v-list-item-content>
        <v-list-item-action>
          <v-chip v-if="collection.isScam" small color="error">Scam</v-chip>
        </v-list-item-action>
      </v-list-item>
    </v-list>

    <!-- Pagination for gallery views -->
    <v-pagination
      v-if="totalPages > 1"
      v-model="collectiblesPage"
      :length="totalPages"
      :total-visible="7"
      class="mt-0"
    ></v-pagination>
    <TokensDialog @close="closeDialog" :modalData="dialogData" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, toRefs, watch } from 'vue';
import { walletStore } from '@/stores/walletStore';
import TokensDialog from '@/modules/assets/dialogs/TokensDialog.vue';

// Props
interface Props {
  hideScam?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  hideScam: false
});

// Emits
const emit = defineEmits(['rowClick']);

// Store references
const { collections } = toRefs(walletStore);

// Advanced Gallery Features
const collectiblesViewMode = ref<string>('grid'); // grid, masonry, list
const cardSizeMode = ref<string>('small'); // small, medium, large
const collectiblesSearch = ref<string>('');
const collectiblesPage = ref<number>(1);
const collectiblesSortBy = ref<string>('name');
const dialogData = ref<any>(null);

// Methods
const handleOnRowClick = (collection: any) => {
  dialogData.value = collection;
};

const closeDialog = () => {
  dialogData.value = null;
}

// Computed properties
const collectibles = computed(() => {
  let res = Object.values(collections.value).filter((collection: any) => collection.items.every(item => !item.metadata))
  if (res && props.hideScam) {
    res = res.filter((collection: any) => !collection.isScam)
  }
  return res
});

const sortOptionsDropdown = computed(() => [
  { text: 'Name (A-Z)', value: 'name' },
  { text: 'Name (Z-A)', value: 'name_desc' },
  { text: 'Quantity (High-Low)', value: 'quantity_desc' },
  { text: 'Quantity (Low-High)', value: 'quantity' }
]);

const cardSize = computed(() => {
  switch (cardSizeMode.value) {
    case 'small': return 140
    case 'medium': return 200
    case 'large': return 260
    default: return 200
  }
});

const avatarSize = computed(() => {
  switch (cardSizeMode.value) {
    case 'small': return 40
    case 'medium': return 60
    case 'large': return 80
    default: return 60
  }
})

const gridSizeClass = computed(() => {
  return `grid-${cardSizeMode.value}`
});

const dynamicItemsPerPage = computed(() => {
  if (collectiblesViewMode.value === 'list') {
    switch (cardSizeMode.value) {
      case 'small': return 28
      case 'medium': return 15
      case 'large': return 8
      default: return 20
    }
  } else {
    switch (cardSizeMode.value) {
      case 'small': return 14
      case 'medium': return 10
      case 'large': return 8
      default: return 20
    }
  }
});

const sortedCollectibles = computed(() => {
  if (!collectibles.value) return []

  let sorted: any[] = [...collectibles.value]

  // Apply a search filter first
  if (collectiblesSearch.value) {
    const searchTerm = collectiblesSearch.value.toLowerCase()
    sorted = sorted.filter((collection: any) => {
      // Search in name
      if (collection.name && collection.name.toLowerCase().includes(searchTerm)) {
        return true
      }

      // Search in description
      if (collection.description) {
        let descriptionText = ''
        if (typeof collection.description === 'string') {
          descriptionText = collection.description
        } else if (Array.isArray(collection.description)) {
          descriptionText = collection.description.join(' ')
        }
        if (descriptionText.toLowerCase().includes(searchTerm)) {
          return true
        }
      }

      return false
    })
  }

  // Then apply sorting
  switch (collectiblesSortBy.value) {
    case 'name_desc':
      sorted.sort((a, b) => b.name.localeCompare(a.name))
      break
    case 'quantity':
      sorted.sort((a, b) => (a.quantity || 0) - (b.quantity || 0))
      break
    case 'quantity_desc':
      sorted.sort((a, b) => (b.quantity || 0) - (a.quantity || 0))
      break
    default: // 'name'
      sorted.sort((a, b) => a.name.localeCompare(b.name))
  }

  return sorted
});

const paginatedCollectibles: any = computed(() => {
  const start = (collectiblesPage.value - 1) * dynamicItemsPerPage.value
  const end = start + dynamicItemsPerPage.value
  return sortedCollectibles.value.slice(start, end)
});

const totalPages = computed(() => {
  return Math.ceil(sortedCollectibles.value.length / dynamicItemsPerPage.value)
});

// Watch for search and card size changes to reset pagination
watch(cardSizeMode, () => {
  collectiblesPage.value = 1
});

watch(collectiblesSearch, () => {
  collectiblesPage.value = 1
});
</script>

<style scoped>
/* NFT Gallery Liquid Glass Effects */
.nft-gallery-container {
  position: relative;
  z-index: 1;
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
  gap: 16px;
}

.grid-small {
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
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
  .grid-small, .grid-medium, .grid-large {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }
}

@media (max-width: 480px) {
  .gallery-masonry {
    column-count: 1;
  }
  .grid-small, .grid-medium, .grid-large {
    grid-template-columns: 1fr;
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
</style>

