<template>
  <BaseDialog :isOpen="isDialogVisible" class="tokens-dialog" @close="handleClose"
              :img="tokensData?.[0]?.img || null"
              :title="modalData ? `${modalData.name} (${Number(modalData.quantity || modalData.items.length).toLocaleString('en-US')})` : ''"
              :subtitle="description" :subtitle2="tokensData?.[0]?.policy_id || ''" :width="696" :min-height="646" :height="646">
    <v-card-text class="pa-3 justify-center text-center" style="z-index: 1">
        <v-row v-if="pickedToken === null">
          <v-col cols="6" xl="3" lg="3" md="3" sm="4" v-for="(token, index) in displayedTokens" :key="index" class="pa-1">
            <v-card variant="outlined" class="pa-0 token-image" @click="handleTokenClick(token)"
                    :style="{ backgroundImage: `linear-gradient(#ffffff00, #000000b3), url(${token.img})`,border: '1px solid #444', backgroundSize: 'cover', backgroundPosition: 'center', borderRadius: '8px' }">
              <div style="top: 0; position: absolute; display: flex" v-if="token.isScam">
                <v-chip size="x-small" color="#F97066" class="px-2 ma-2">
                  <v-icon color="white" size="x-small" style="margin-right: 3px">
                    mdi-alert-decagram
                  </v-icon>{{ t('assets.scamToken') }}
                </v-chip>
              </div>
              <!-- Listed on Gero's market: the price it is listed at. -->
              <div v-if="listingOf(token)" class="token-listed" :class="{ 'token-listed--below-scam': token.isScam }">
                <v-chip size="x-small" label class="token-listed__chip px-2 ma-2" data-testid="token-listed-badge">
                  {{ t('nftMarket.badge.listed', { price: formatLovelaceAsAda(listingOf(token)!.datum.price) }) }}
                </v-chip>
              </div>
              <div class="collectible-text-container">
                <span class="collectible-text">{{ token.name }}</span>
              </div>
            </v-card>
          </v-col>
        </v-row>
      <AssetDetails
        :asset="pickedToken"
        v-else
        ref="assetDetailsRef"
        @list="openSheet('list')"
        @edit-price="openSheet('reprice')"
        @unlist="openSheet('unlist')"
      />
    </v-card-text>
    <v-card-actions class="justify-center py-0">
      <v-btn variant="text" elevation="0" color="primary" v-if="pickedToken != null" @click="pickedToken = null">{{ t('common.back') }}</v-btn>
    </v-card-actions>

    <!-- Gero's NFT market: the sheets are mounted for one NFT and one action at a time, and taken
         away on close, so each starts clean. They live here, not in AssetDetails, so the NFT on
         screen outlives the sheet's own "done" screen while the sync catches up. -->
    <ListNftDialog
      v-if="marketSheet && marketSheet.kind !== 'unlist'"
      :key="`${marketSheet.kind}:${marketSheet.unit}`"
      :is-open="true"
      :unit="marketSheet.unit"
      :existing="marketSheet.existing"
      @close="closeSheet()"
    />
    <UnlistNftDialog
      v-else-if="marketSheet && marketSheet.existing"
      :key="`unlist:${marketSheet.unit}`"
      :is-open="true"
      :existing="marketSheet.existing"
      @close="closeSheet()"
    />
  </BaseDialog>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, watch } from 'vue';
import BaseDialog from "@/shared/dialogs/BaseDialog.vue";
import AssetDetails from '@/modules/assets/components/AssetDetails.vue';
import ListNftDialog from '@/modules/market/dialogs/ListNftDialog.vue';
import UnlistNftDialog from '@/modules/market/dialogs/UnlistNftDialog.vue';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import { useMyListings } from '@/shared/composables/useMyListings';
import { formatLovelaceAsAda } from '@/shared/utils/format';
import { nftMarketAvailable } from '@/shared/utils/nftMarketAvailability';


const { t } = useTranslation();

type CollectionToken = InstanceType<typeof AssetDetails>['$props']['asset'] & { metadata?: unknown; img?: string; policy_id?: string; isScam?: boolean };
const props = defineProps<{ modalData?: { name: string; quantity?: string | number; description?: string | string[]; items: CollectionToken[] } }>();

const emit = defineEmits(['close']);

const pickedToken = ref<CollectionToken | null>(null);
const assetDetailsRef = ref<InstanceType<typeof AssetDetails> | null>(null);

const description = computed(() => {
  let desc = '';
  if (props.modalData) {
    if (Array.isArray(props.modalData.description)) {
      desc = props.modalData.description.join(" ");
    } else {
      desc = props.modalData.description;
    }
  }
  return desc;
});

const tokensData = computed(() => {
  return props.modalData?.items;
});

const displayedTokens = computed(() => {
  return tokensData.value;
});

const isDialogVisible = computed(() => {
  return !!props.modalData;
});

const handleTokenClick = (token: CollectionToken) => {
  pickedToken.value = token;
};

// ---- Gero's NFT market ---------------------------------------------------------------------

const { byUnit } = useMyListings();

/** The wallet's own listing of this NFT, where the market is available; the "Listed" badge reads it. */
function listingOf(token: CollectionToken): OwnListing | undefined {
  return nftMarketAvailable() ? byUnit.value.get(String(token.unit).toLowerCase()) : undefined;
}

type MarketSheet = { kind: 'list' | 'reprice' | 'unlist'; unit: string; existing?: OwnListing };
const marketSheet = ref<MarketSheet | null>(null);

/** Open the list, edit-price or unlist sheet for the NFT on screen. Edit price and Unlist need its listing. */
function openSheet(kind: MarketSheet['kind']): void {
  const token = pickedToken.value;
  if (!token) return;
  const unit = String(token.unit).toLowerCase();
  const existing = kind === 'list' ? undefined : listingOf(token);
  if (kind !== 'list' && !existing) return;
  marketSheet.value = { kind, unit, existing };
}

const closeSheet = () => {
  marketSheet.value = null;
};

const handleClose = () => {
  // Stop any playing media before closing
  if (assetDetailsRef.value && assetDetailsRef.value.stopMedia) {
    assetDetailsRef.value.stopMedia();
  }
  emit('close');
};

watch(isDialogVisible, (val) => {
  marketSheet.value = null;
  if (val) {
    pickedToken.value = null;
  }
});
</script>
<style scoped>
/* The "Listed" badge sits in the card's top-left corner, below the scam flag when there is one. */
.token-listed {
  position: absolute;
  top: 0;
  display: flex;
}

.token-listed--below-scam {
  top: 28px;
}

/* A chip is a control: a solid token, with a hairline, reads on any NFT picture. */
.token-listed__chip {
  color: var(--g-text-1);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
}

.close-button {
  position: absolute;
  top: 10px;
  right: 10px;
}

.card-title {
  position: relative;
  font-size: 10px;
}

.white-grey {
  color: #cecfd2;
}

.breadcrumbs {
  font-size: 18px;
  white-space: pre-wrap;
}

.policy {
  font-size: 10px;
  font-weight: 300;
  letter-spacing: -0.8px;
  line-height: 0;
}

.token-image {
  max-width: 152px;
  height: 152px;
  background-position: center;
  align-content: end;
  background-size: cover;
}
.tokens-container {
  display: flex;
  flex-wrap: wrap;

  & .token-image {
    cursor: pointer;
    transition: transform 0.3s ease-in-out, opacity 0.3s ease-in-out;

    &:hover {
      transform: scale(1.05);
      opacity: 0.8;
    }
  }
}

.white-grey {
  color: #cecfd2;
}

.arrow-button {
  color: black;
  background-color: #161b26;
  border-radius: 8px;
  border: 1px solid #333741;
  margin: 0 50px;
}

.collectible-text-container {
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: normal;
  padding-bottom: 6px;
}
.collectible-text {
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  line-height: 1.00;
  letter-spacing: -0.7px;
  display: block;
}
</style>
