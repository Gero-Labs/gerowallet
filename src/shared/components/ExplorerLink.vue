<template>
  <!-- Sits beside a CopyButton: same size, and nothing at all when the wallet's
       chain or chosen explorer has no page for this id (Midnight, Bitcoin, an
       Apex DRep, ...). -->
  <v-btn
    v-if="url"
    class="px-1"
    icon
    variant="text"
    :size="buttonSize"
    :href="url"
    target="_blank"
    rel="noopener noreferrer"
    :aria-label="$t('miniGero.viewOnExplorer')"
    :title="$t('miniGero.viewOnExplorer')"
    :style="xSmall ? { width: '16px', height: '16px', marginTop: '0px' } : {}"
    @click.stop
  >
    <v-icon :size="iconSize">mdi-open-in-new</v-icon>
  </v-btn>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useExplorer } from '@/shared/composables/useExplorer';
import type { ExplorerEntity } from '@/shared/utils/explorer';

const props = defineProps({
  /** What `id` is: 'tx' (a `txHash#index` UTxO ref opens its tx), 'address', 'stake', 'pool', 'asset', 'policy', 'drep', 'govAction', ... */
  type: { type: String, required: true },
  id: { type: String, default: '' },
  /** Override the wallet's chain/network for an id that lives elsewhere (see useExplorer). */
  chain: { type: String, default: undefined },
  network: { type: String, default: undefined },
  xSmall: { type: Boolean, default: false },
  small: { type: Boolean, default: false },
});

const { explorerUrl } = useExplorer();

const buttonSize = computed(() => props.xSmall ? 'x-small' : props.small ? 'small' : 'default');
const iconSize = computed(() => props.xSmall ? 12 : props.small ? 16 : 24);

const url = computed(() =>
  explorerUrl(props.type as ExplorerEntity, props.id, { chain: props.chain, network: props.network }),
);
</script>
