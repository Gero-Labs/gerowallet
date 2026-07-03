<template>
  <div class="gero-swap-embed" :class="context ? `gero-swap-embed--${context}` : null">
    <!-- ═══════ MAINTENANCE OVERLAY (feature-flag gate, mirrors SwapSheet.vue) ═══════ -->
    <div v-if="!isSwapEnabled" class="gero-swap-embed__maintenance">
      <v-icon size="56" color="warning">mdi-alert-circle-outline</v-icon>
      <div class="text-h6 mt-3">{{ $t('miniGero.swapMaintenance') }}</div>
    </div>

    <template v-else>
      <gero-swap
        ref="geroSwapEl"
        mode="native"
        :network="network"
        :base-url="baseUrl"
        :token-in="tokenIn"
        :token-out="tokenOut"
      />

      <!-- Keystone QR sign dialog — the SAME component + wiring SwapSheet.vue uses
           (SwapSheet.vue:463-469), driven here by the signer's own keystone refs. -->
      <KeystoneSignDialog
        v-if="keystone.keystoneShow.value"
        :isOpen="keystone.keystoneShow.value"
        :keystoneType="keystone.keystoneType.value"
        :keystoneCbor="keystone.keystoneCbor.value"
        @scan="keystone.onKeystoneScan"
        @error="keystone.failKeystone"
        @close="keystone.cancelKeystone"
      />

      <!-- PRF/PassKey host prompt — bridges PassKeyAuthButton's @success (the same
           component + flow SwapSheet.vue uses at SwapSheet.vue:229-235) into the
           signer's getPrfBytes() promise. -->
      <BaseDialog
        v-if="prfPromptVisible"
        :isOpen="prfPromptVisible"
        :width="380"
        :min-height="0"
        persistent
        :title="$t('security.authenticateWithPassKey')"
        :subtitle="$t('miniGero.prfAuthPrompt')"
        @close="onPassKeyCancel"
      >
        <v-card-text class="pt-4">
          <PassKeyAuthButton @success="onPassKeySuccess" @error="onPassKeyErrorHandler" />
        </v-card-text>
      </BaseDialog>

      <!-- Spending-password host prompt — no reusable "enter spending password" dialog
           exists; SwapSheet.vue collects it inline via a v-text-field in its own review
           step (SwapSheet.vue:200-221). We recreate that same input inside BaseDialog
           (the shared modal shell every other host prompt here uses) rather than
           inventing new input/validation logic. Backs the signer's getPassword(). -->
      <BaseDialog
        v-if="pwPromptVisible"
        :isOpen="pwPromptVisible"
        :width="380"
        :min-height="0"
        persistent
        :title="$t('wallet.spendingPassword')"
        @close="onPasswordCancel"
      >
        <v-card-text class="pt-4">
          <v-text-field
            v-model="pwValue"
            type="password"
            outlined
            dense
            hide-details
            autofocus
            :placeholder="$t('wallet.enterPassword')"
            @keydown.enter="onPasswordConfirm"
          />
          <div class="d-flex align-center mt-4" style="gap: 8px">
            <v-btn text @click="onPasswordCancel">{{ $t('common.cancel') }}</v-btn>
            <v-spacer />
            <v-btn color="primary" :disabled="!pwValue" @click="onPasswordConfirm">
              {{ $t('common.confirm') }}
            </v-btn>
          </div>
        </v-card-text>
      </BaseDialog>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useNativeSwapSigner } from '../composables/useNativeSwapSigner';
import { useSwapTokenResolver } from '../composables/useSwapTokenResolver';
import TokenMetadataStore from '@/stores/tokenMetadataStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { walletStore } from '@/stores/walletStore';
import { toNexusNetwork } from '@/api/nexus-tx-api';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';

interface Props {
  tokenIn?: string;
  tokenOut?: string;
  context?: 'page' | 'dialog' | 'sidepanel';
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'swap-submitted', detail: unknown): void;
  (e: 'swap-error', detail: unknown): void;
  (e: 'token-change', detail: unknown): void;
}>();

const geroSwapEl = ref<HTMLElement | null>(null);

const isSwapEnabled = computed(() => featureFlagsStore.isSwapEnabled());

// gero-backend's Nexus proxy — same base URL every other Nexus-facing client in this
// codebase uses (nexus-tx-api.ts, nexus-swap.api.ts).
const baseUrl = (import.meta.env['VITE_NEXUS_URL'] as string | undefined) || undefined;

// Nexus's aggregator endpoints expect the chain-prefixed slug ('cardano-mainnet' /
// 'cardano-preprod'), same as nexus-tx-api.ts's other endpoints — see toNexusNetwork's
// doc comment there. Reused (not duplicated) for consistency.
const network = computed(() => toNexusNetwork(walletStore.loggedWallet?.network));

// ── Spending-password host prompt (Normal wallet path) ──
const pwPromptVisible = ref(false);
const pwValue = ref('');
let pwResolve: ((v: string) => void) | null = null;
let pwReject: ((e: Error) => void) | null = null;

async function getPassword(): Promise<string> {
  pwValue.value = '';
  pwPromptVisible.value = true;
  return new Promise<string>((resolve, reject) => {
    pwResolve = resolve;
    pwReject = reject;
  });
}

function onPasswordConfirm() {
  if (!pwValue.value) return;
  const value = pwValue.value;
  pwPromptVisible.value = false;
  pwValue.value = '';
  pwResolve?.(value);
  pwResolve = null;
  pwReject = null;
}

function onPasswordCancel() {
  pwPromptVisible.value = false;
  pwValue.value = '';
  pwReject?.(new Error('Spending password entry cancelled'));
  pwResolve = null;
  pwReject = null;
}

// ── PRF/PassKey host prompt ──
// Backs getPrfBytes() with the SAME PassKeyAuthButton component + @success flow
// SwapSheet.vue uses for PRF wallets: the button drives its own WebAuthn/popup flow
// and emits the raw PRF-decrypted private key bytes on success.
const prfPromptVisible = ref(false);
let prfResolve: ((bytes: Uint8Array) => void) | null = null;
let prfReject: ((e: Error) => void) | null = null;

async function getPrfBytes(): Promise<Uint8Array> {
  prfPromptVisible.value = true;
  return new Promise<Uint8Array>((resolve, reject) => {
    prfResolve = resolve;
    prfReject = reject;
  });
}

function onPassKeySuccess(privateKeyBytes: Uint8Array) {
  prfPromptVisible.value = false;
  prfResolve?.(privateKeyBytes);
  prfResolve = null;
  prfReject = null;
}

function onPassKeyErrorHandler(error: Error) {
  prfPromptVisible.value = false;
  prfReject?.(error);
  prfResolve = null;
  prfReject = null;
}

function onPassKeyCancel() {
  prfPromptVisible.value = false;
  prfReject?.(new Error('PassKey authentication cancelled'));
  prfResolve = null;
  prfReject = null;
}

const { signer, keystone } = useNativeSwapSigner({ getPassword, getPrfBytes });
const { resolveToken } = useSwapTokenResolver();

function wireProps() {
  const node = geroSwapEl.value as (HTMLElement & Record<string, unknown>) | null;
  if (!node) return;
  node.signer = signer;
  node.resolveToken = resolveToken;
  node.tokens = Object.values(TokenMetadataStore.state.tokens || {}); // optional catalog
}

function onSwapSubmitted(e: Event) {
  emit('swap-submitted', (e as CustomEvent).detail);
}
function onSwapError(e: Event) {
  emit('swap-error', (e as CustomEvent).detail);
}
function onTokenChange(e: Event) {
  emit('token-change', (e as CustomEvent).detail);
}

function attach() {
  const node = geroSwapEl.value;
  if (!node) return;
  wireProps();
  node.addEventListener('swap-submitted', onSwapSubmitted);
  node.addEventListener('swap-error', onSwapError);
  node.addEventListener('token-change', onTokenChange);
}

function detach() {
  const node = geroSwapEl.value;
  if (!node) return;
  node.removeEventListener('swap-submitted', onSwapSubmitted);
  node.removeEventListener('swap-error', onSwapError);
  node.removeEventListener('token-change', onTokenChange);
}

onMounted(attach);
onBeforeUnmount(detach);

// Re-seed the pair when the host changes tokenIn/tokenOut props (attributes update
// automatically via the template binding; properties need an explicit re-wire).
watch(() => [props.tokenIn, props.tokenOut], wireProps);

// Token catalog hydrates asynchronously post-login (see useSwapTokenResolver.ts) —
// re-wire once it lands.
watch(() => TokenMetadataStore.state.tokens, wireProps);

// isSwapEnabled can flip the maintenance overlay in/out while mounted, which
// destroys/recreates the <gero-swap> element (v-if/v-else) — re-attach on re-entry.
watch(isSwapEnabled, async (enabled) => {
  if (!enabled) return;
  await nextTick();
  attach();
});
</script>

<style scoped>
.gero-swap-embed {
  width: 100%;
  height: 100%;
}

.gero-swap-embed__maintenance {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  text-align: center;
}
</style>
