<template>
  <section data-testid="approval-page">
    <h2>{{ t('approval') }}</h2>
    <v-form ref="form" validate-on="submit" @submit.prevent="submit">
      <v-text-field v-model="amount" :label="t('amount')" :rules="rules" data-testid="amount" />
      <v-btn type="submit" :disabled="pending" data-testid="submit">{{ t('submit') }}</v-btn>
      <v-btn type="button" data-testid="cancel" @click="cancel">{{ t('cancel') }}</v-btn>
    </v-form>
    <p data-testid="pending">{{ String(pending) }}</p>
    <p data-testid="result">{{ result }}</p>
    <v-btn data-testid="dialog-open" @click="dialog = true">{{ t('openDialog') }}</v-btn>
    <v-dialog v-model="dialog" max-width="400"><v-card :title="t('dialogTitle')"><v-card-text>{{ t('dialogText') }}</v-card-text><v-card-actions><v-btn data-testid="dialog-close" @click="dialog = false">{{ t('close') }}</v-btn></v-card-actions></v-card></v-dialog>
    <p>{{ t('contract') }}</p>
    <gero-swap ref="swap" mode="native" :network="`cardano-${snapshot.network}`" token-in="lovelace" :button-label="t('contractEvent')" @token-change="contractEvent" />
    <p data-testid="swap-events">{{ swapEvents }}</p>
    <p data-testid="ticks">{{ ticks }}</p>
  </section>
</template>
<script setup lang="ts">
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { diagnostics, request, snapshot } from './state';
import type { SwapContract } from './swap-contract';
const { t } = useI18n();
const form = ref<{ validate(): Promise<{ valid: boolean }> }>();
const amount = ref('');
const pending = ref(false);
const dialog = ref(false);
const result = ref('');
const swap = ref<SwapContract>();
const swapEvents = ref(0);
const ticks = ref(0);
let generation = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const rules = [async (value: string) => {
  await delay(400);
  const parsed = Number(value);
  return (value.trim() !== '' && Number.isFinite(parsed) && parsed > 0 && parsed <= 10) || t('invalid');
}];
function cancel() {
  generation += 1;
  pending.value = false;
  result.value = t('cancelled');
}
watch(amount, cancel, { flush: 'sync' });
watch(() => snapshot.revision, cancel, { flush: 'sync' });
async function submit() {
  if (pending.value || snapshot.locked) return;
  const attempt = ++generation;
  const revision = snapshot.revision;
  const submittedAmount = amount.value;
  pending.value = true;
  diagnostics.inFlight += 1;
  result.value = t('validating');
  try {
    const validation = await form.value?.validate();
    if (attempt !== generation) return;
    if (!validation?.valid) { result.value = t('invalid'); return; }
    result.value = t('authenticating');
    // Explicitly synthetic asynchronous authorization, not WebAuthn or real signing.
    await delay(800);
    if (attempt !== generation || revision !== snapshot.revision || submittedAmount !== amount.value || snapshot.locked) return;
    await request('approve', { revision, amount: Number(submittedAmount) });
    result.value = t('approved');
  } catch {
    if (attempt === generation) result.value = t('rejected');
  } finally {
    diagnostics.inFlight -= 1;
    if (attempt === generation) pending.value = false;
  }
}
function contractEvent(event: Event) {
  if ((event as CustomEvent).detail.contractOnly) swapEvents.value += 1;
}
function activate() {
  if (!timer) timer = setInterval(() => { ticks.value += 1; }, 100);
}
function deactivate() {
  clearInterval(timer);
  timer = undefined;
  cancel();
}
onMounted(() => { if (swap.value) swap.value.signer = { getNetworkId: async () => 0 }; });
onActivated(activate);
onDeactivated(deactivate);
onBeforeUnmount(deactivate);
</script>
