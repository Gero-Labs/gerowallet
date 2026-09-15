<template>
  <!-- The one question a wallet owner actually brings to this tab: how did MY
       DRep vote? Each branch below is a different honest statement, and the
       `unknown` branch exists so an incomplete list never becomes a claim. -->
  <section class="your-position">
    <span class="t-label your-position__eyebrow">{{ eyebrow }}</span>

    <template v-if="position.kind === 'voted'">
      <VoteRow :row="position.row" :name="name" is-yours />
      <p v-if="position.who === 'delegated'" class="t-caption your-position__note">
        {{ $t('governance.yourStakeFollowed') }}
      </p>
    </template>

    <template v-else-if="position.kind === 'notVoted'">
      <p class="t-body-sm your-position__body">
        {{ position.who === 'self' ? $t('governance.youHaventVoted') : $t('governance.yourDRepNotVoted') }}
      </p>
      <p class="t-caption your-position__note">{{ $t('governance.uncastCountsAgainst') }}</p>
    </template>

    <template v-else-if="position.kind === 'keyword'">
      <p class="t-body-sm your-position__body">{{ $t('governance.keywordNoPosition') }}</p>
    </template>

    <template v-else>
      <p class="t-body-sm your-position__body">{{ $t('governance.positionUnknown') }}</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PropType } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import VoteRow from '@/modules/governance/components/actions/VoteRow.vue';
import type { YourPosition } from '@/modules/governance/components/actions/positions';

const props = defineProps({
  /** Never `none` — the panel renders a plain caption for that instead of an empty box. */
  position: { type: Object as PropType<Exclude<YourPosition, { kind: 'none' }>>, required: true },
  name: { type: String as PropType<string | null>, default: null },
});

const { t } = useTranslation();

const eyebrow = computed(() =>
  String(props.position.who === 'self' ? t('governance.yourPosition') : t('governance.yourDRepPosition')),
);
</script>

<style scoped>
/* Solid surface with an accent hairline, not a gradient and not a glow: the
   screen's one gradient belongs to the vote CTA in the header. */
.your-position {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-4);
  background: var(--g-raised);
  border: 1px solid var(--g-accent);
  border-radius: var(--g-r-card);
}
.your-position__eyebrow {
  color: var(--g-text-3);
}
.your-position__body {
  margin: 0;
  color: var(--g-text-1);
}
.your-position__note {
  margin: 0;
  color: var(--g-text-3);
}
</style>
