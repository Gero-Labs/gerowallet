<template>
  <!-- A Solana collection's NFTs, then one NFT: its image, name, mint, collection, attributes and
       description, all the NFT's own metadata shown as text, and Send (a programmable NFT notes
       that its creator's transfer rules apply). -->
  <BaseDialog
    size="md"
    :isOpen="modelValue && !!collection"
    :title="nft ? nftTitle : collection?.name ?? ''"
    :min-height="0"
    :scrollable="true"
    @close="close()"
  >
    <v-card-text class="px-5 pt-1 pb-5">
      <!-- One NFT -->
      <div v-if="nft" class="sol-nft" data-test="sol-nft-detail">
        <button v-if="(collection?.items.length ?? 0) > 1" type="button" class="sol-nft__back t-caption" @click="selectedMint = null">
          <v-icon size="small">mdi-arrow-left</v-icon>
          {{ collection?.name }}
        </button>

        <div class="sol-nft__media">
          <img
            v-if="nft.image"
            :src="assets.resolveIcon(nft.image)"
            :alt="nftTitle"
            referrerpolicy="no-referrer"
            @error="assets.fallbackImage($event)"
          />
          <v-icon v-else size="48">mdi-image-outline</v-icon>
        </div>

        <div v-if="!collection?.verified" class="sol-nft__notice t-caption" role="note">
          <v-icon size="small">mdi-alert-outline</v-icon>
          <span>{{ $t('solana.nft.unverifiedHint') }}</span>
        </div>

        <dl class="sol-nft__facts">
          <div class="sol-nft__fact">
            <dt class="t-label">{{ $t('solana.nft.mint') }}</dt>
            <dd class="g-mono sol-nft__mono">
              {{ nft.mint }}
              <CopyButton x-small :value="nft.mint" />
            </dd>
          </div>
          <div v-if="collection?.verified" class="sol-nft__fact">
            <dt class="t-label">{{ $t('solana.nft.collection') }}</dt>
            <dd class="g-mono sol-nft__mono">{{ collection.id }}</dd>
          </div>
          <div v-if="nft.symbol" class="sol-nft__fact">
            <dt class="t-label">{{ $t('solana.nft.symbol') }}</dt>
            <dd>{{ nft.symbol }}</dd>
          </div>
        </dl>

        <p v-if="nft.description" class="sol-nft__description t-body-sm">{{ nft.description }}</p>

        <ul v-if="nft.attributes.length" class="sol-nft__attributes" data-test="sol-nft-attributes">
          <li v-for="(attribute, i) in nft.attributes" :key="i" class="sol-nft__attribute">
            <span v-if="attribute.traitType" class="t-caption">{{ attribute.traitType }}</span>
            <span class="sol-nft__value">{{ attribute.value }}</span>
          </li>
        </ul>

        <a :href="explorerUrl" target="_blank" rel="noopener noreferrer" class="sol-nft__link t-caption">
          {{ $t('solana.viewOnExplorer') }}
          <v-icon size="x-small">mdi-open-in-new</v-icon>
        </a>

        <p v-if="programmable" class="t-caption" data-test="sol-nft-programmable">{{ $t('solana.nft.programmableRules') }}</p>
        <p v-if="nft.kind" class="t-caption" data-test="sol-nft-kind">{{ $t(nft.kind === 'compressed' ? 'solana.nft.compressed' : 'solana.nft.core') }}</p>
        <GButton tier="primary" block data-test="sol-nft-send" @click="emit('send', nft.mint)">
          <v-icon size="small" start>mdi-arrow-top-right</v-icon>
          {{ $t('send.send') }}
        </GButton>
      </div>

      <!-- The collection's NFTs -->
      <div v-else class="sol-nft__grid">
        <button
          v-for="item in collection?.items ?? []"
          :key="item.mint"
          type="button"
          class="glass-tier sol-nft__tile"
          :data-test="`sol-nft-${item.mint}`"
          @click="selectedMint = item.mint"
        >
          <span class="sol-nft__thumb">
            <img
              v-if="item.image"
              :src="assets.resolveIcon(item.image)"
              :alt="solanaNftName(item)"
              loading="lazy"
              referrerpolicy="no-referrer"
              @error="assets.fallbackImage($event)"
            />
            <v-icon v-else size="28">mdi-image-outline</v-icon>
          </span>
          <span class="sol-nft__tile-name">{{ solanaNftName(item) }}</span>
        </button>
      </div>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { solscanUrl } from '@/chains/solana/solanaExplorer';
import { isProgrammableSolanaNft, solanaNftName, type SolanaNftCollection } from '@/chains/solana/solanaNfts';

const props = defineProps<{ modelValue: boolean; collection: SolanaNftCollection | null }>();
const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'send', mint: string): void;
}>();

const selectedMint = ref<string | null>(null);
// A collection of one opens straight on its NFT.
const nft = computed(() => {
  const items = props.collection?.items ?? [];
  if (items.length === 1) return items[0];
  return items.find((item) => item.mint === selectedMint.value) ?? null;
});
const nftTitle = computed(() => (nft.value ? solanaNftName(nft.value) : ''));
const programmable = computed(() => !!nft.value && isProgrammableSolanaNft(nft.value));
const explorerUrl = computed(() => (nft.value ? solscanUrl('account', nft.value.mint, walletStore.loggedWallet?.network ?? '') : ''));

watch(() => [props.modelValue, props.collection?.id], () => { selectedMint.value = null; });

function close(): void {
  emit('update:modelValue', false);
}
</script>

<style scoped lang="scss">
.sol-nft {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.sol-nft__back {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: var(--g-s-1);
  padding: 0;
  border: 0;
  background: none;
  color: var(--g-accent);
  cursor: pointer;
}

/* Image wells are controls, not surfaces. */
.sol-nft__media,
.sol-nft__thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  color: var(--g-text-3);
}

.sol-nft__media {
  width: 100%;
  max-height: 420px;
  aspect-ratio: 1;
}

.sol-nft__media img,
.sol-nft__thumb img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.sol-nft__thumb {
  aspect-ratio: 1;
}

.sol-nft__thumb img {
  object-fit: cover;
}

.sol-nft__notice {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-warning-line);
  border-radius: var(--g-r-control);
  background: var(--g-warning-fill);
  color: var(--g-warning);
}

.sol-nft__facts {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
}

.sol-nft__fact dd {
  margin: 0;
  color: var(--g-text-1);
}

.sol-nft__mono {
  font-size: 12px;
  overflow-wrap: anywhere;
}

.sol-nft__description {
  margin: 0;
  color: var(--g-text-2);
  white-space: pre-line;
  overflow-wrap: anywhere;
}

.sol-nft__attributes {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: var(--g-s-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.sol-nft__attribute {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--g-s-2);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
}

.sol-nft__value {
  color: var(--g-text-1);
  font-size: 13px;
  overflow-wrap: anywhere;
}

.sol-nft__link {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  color: var(--g-accent);
}

.sol-nft__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: var(--g-s-3);
}

.sol-nft__tile {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-2);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease);
}

.sol-nft__tile:hover {
  @include g-glass-tier-hover;
}

.sol-nft__tile-name {
  overflow: hidden;
  color: var(--g-text-1);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
