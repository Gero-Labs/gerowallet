<template>
  <!-- "Update your local proof server to 9.0.x" (proofServerLedger9Notice.ts):
       local mode only, until dismissed or a check finds the right release. -->
  <GNote v-if="visible" icon="mdi-update" role="status" class="ps9-notice" data-test="proof-server-ledger9-notice">
    <p class="ps9-notice__text">{{ $t('midnight.proofServer.ledger9Notice', { required }) }}</p>
    <CommandBlock :command="command" class="ps9-notice__command" />
    <div class="ps9-notice__actions">
      <v-btn variant="text" size="x-small" color="var(--g-accent)" data-test="proof-server-ledger9-notice-done" @click="markProofServerLedger9NoticeDone()">
        {{ $t('common.ok') }}
      </v-btn>
    </div>
  </GNote>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import GNote from '@/shared/components/GNote.vue';
import CommandBlock from '@/shared/components/CommandBlock.vue';
import { midnightStore } from '@/stores/midnightStore';
import { midnightProofServerCommandForLedger, midnightProofServerVersionLine } from '@/chains/midnight/midnightConfig';
import { midnightLedgerOrNewest } from '@/chains/midnight/midnightLedger';
import {
  isProofServerLedger9NoticeDone,
  markProofServerLedger9NoticeDone,
  proofServerLedger9NoticeWanted,
} from '@/chains/midnight/proofServerLedger9Notice';

const props = defineProps<{
  /** The open wallet's network; its chain's ledger decides whether the notice applies. */
  network?: string;
}>();

const visible = computed(() => proofServerLedger9NoticeWanted({
  mode: midnightStore.proofServer.mode,
  ledger: midnightLedgerOrNewest(props.network),
  done: isProofServerLedger9NoticeDone(),
}));
const required = midnightProofServerVersionLine(9);
const command = midnightProofServerCommandForLedger(9);
</script>

<style scoped lang="scss">
.ps9-notice__text {
  margin: 0;
}

.ps9-notice__command {
  margin-top: var(--g-s-2);
}

.ps9-notice__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--g-s-1);
}
</style>
