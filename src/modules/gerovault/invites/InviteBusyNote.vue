<template>
  <GNote icon="mdi-timer-sand" role="status" data-test="invite-busy">{{ $t(message.key, { n: message.n }) }}</GNote>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import GNote from '@/shared/components/GNote.vue';
import { busyMessage } from './messages';

/**
 * gero-sync answered "too many requests": the screen keeps what it has and says when it asks
 * again, instead of an empty list or "not reachable". The page reads again by itself once the
 * wait is over.
 */
const props = defineProps<{
  /** When the next read may go out, in milliseconds. */
  until: number;
}>();

const now = ref(Date.now());
const ticker = setInterval(() => { now.value = Date.now(); }, 1000);
onBeforeUnmount(() => clearInterval(ticker));

const message = computed(() => busyMessage(props.until, now.value));
</script>
