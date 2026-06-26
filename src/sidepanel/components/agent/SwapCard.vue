<!-- src/sidepanel/components/agent/SwapCard.vue -->
<template>
  <div class="swap-card">
    <!-- Loading state -->
    <div v-if="busy" class="swap-card__loading">
      <span class="swap-card__spinner"></span>
      <span class="swap-card__loading-text">{{ $t('copilot.swap.preparing') }}</span>
    </div>

    <!-- Error state (network/resolution failure) -->
    <div v-else-if="swapError" class="swap-card__error">
      {{ swapError }}
    </div>

    <!-- Proposal ready or blocked -->
    <template v-else-if="proposal">
      <!-- You pay / you receive rows -->
      <div class="swap-card__row">
        <span class="swap-card__label">{{ $t('copilot.swap.youPay') }}</span>
        <span class="swap-card__value">{{ sellDisplay }}</span>
      </div>
      <div class="swap-card__row">
        <span class="swap-card__label">{{ $t('copilot.swap.youReceive') }}</span>
        <span class="swap-card__value">{{ receiveDisplay }}</span>
      </div>
      <div class="swap-card__row">
        <span class="swap-card__label">{{ $t('copilot.swap.minReceived') }}</span>
        <span class="swap-card__value">{{ minReceivedDisplay }}</span>
      </div>
      <div v-if="routeDisplay" class="swap-card__row">
        <span class="swap-card__label">{{ $t('copilot.swap.route') }}</span>
        <span class="swap-card__value">{{ routeDisplay }}</span>
      </div>
      <div v-if="feeDisplay" class="swap-card__row">
        <span class="swap-card__label">{{ $t('copilot.swap.fee') }}</span>
        <span class="swap-card__value">{{ feeDisplay }}</span>
      </div>

      <!-- Guardrail block reasons -->
      <div v-if="proposal.status === 'blocked'" class="swap-card__blocked">
        <div class="swap-card__blocked-title">{{ $t('copilot.swap.blocked') }}</div>
        <ul class="swap-card__reasons">
          <li v-for="(reason, i) in proposal.reasons" :key="i">{{ reason }}</li>
        </ul>
      </div>

      <!-- Risk warning from CardanoShield -->
      <div v-if="riskHigh" class="swap-card__risk">
        {{ $t('copilot.swap.riskHigh') }}
      </div>

      <!-- Submitted / failed -->
      <div v-if="submitResult === 'submitted'" class="swap-card__submitted">
        {{ $t('copilot.swap.submitted') }}
      </div>
      <div v-else-if="submitResult === 'failed'" class="swap-card__failed">
        {{ submitError || $t('copilot.swap.failed') }}
      </div>

      <!-- Sign button -->
      <button
        v-if="submitResult !== 'submitted'"
        class="swap-card__sign-btn"
        :disabled="proposal.status !== 'ready' || signing || !!submitResult"
        @click="onSign()"
      >
        {{ signing ? $t('copilot.swap.signing') : $t('copilot.swap.sign') }}
      </button>

      <!-- Not financial advice -->
      <p class="swap-card__advice">{{ $t('copilot.swap.notAdvice') }}</p>
    </template>
  </div>
</template>

<script lang="ts">
import { defineComponent, ref, computed, onMounted, type PropType } from 'vue';
import type { SwapIntent } from '@/services/agent/swapIntent';
import type { SwapProposal } from '@/sidepanel/composables/useAgentSwap';
import { createAgentSwap } from '@/sidepanel/composables/useAgentSwap';
import { resolveSymbolToAssetId } from '@/services/agent/tokenResolver';
import { nexusSwapApi } from '@/api/nexus-swap.api';
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { toDecodedTx } from '@/services/agent/decodeSwapTx';
import { verifySwapTx } from '@/services/agent/swapGuardrail';
import marketApi from '@/api/market-api';
import cardanoShieldApi from '@/api/cardano-shield-api';
import { Messaging, type BackgroundResponse } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { walletStore } from '@/stores/walletStore';
import { DappScore } from '@/models/cardano-shield-types';
import type { Keys } from '@/models/types';
import type { SwapRoute } from '@/api/nexus-swap.api';

export default defineComponent({
  name: 'SwapCard',

  props: {
    intent: {
      type: Object as PropType<SwapIntent>,
      required: true,
    },
  },

  setup(props) {
    const busy = ref(false);
    const swapError = ref('');
    const proposal = ref<SwapProposal | null>(null);
    const signing = ref(false);
    const riskHigh = ref(false);
    const submitResult = ref<'submitted' | 'failed' | null>(null);
    const submitError = ref('');
    // The chosen route is captured in buildFn (the proposal does not carry it) so the
    // card can render the dex/route and the aggregator/batcher fee.
    const selectedRoute = ref<SwapRoute | null>(null);

    // -------------------------------------------------------------------
    // Dep: resolveSymbol
    // -------------------------------------------------------------------
    async function resolveSymbol(sym: string): Promise<string> {
      if (sym.toUpperCase() === 'ADA') return 'lovelace';
      const id = await resolveSymbolToAssetId(sym);
      if (!id) throw new Error(`Could not find token: ${sym}`);
      return id;
    }

    // -------------------------------------------------------------------
    // Dep: getDecimals - reads from market-api token metadata
    // -------------------------------------------------------------------
    async function getDecimals(unitAssetId: string): Promise<number> {
      if (unitAssetId === 'lovelace') return 6;
      try {
        const info = await marketApi.getTokenPrice(unitAssetId);
        return info.decimals ?? 0;
      } catch {
        return 0;
      }
    }

    // -------------------------------------------------------------------
    // Dep: getHeldAmount - from walletStore.tokens
    // -------------------------------------------------------------------
    async function getHeldAmount(unitAssetId: string): Promise<bigint> {
      if (unitAssetId === 'lovelace') {
        // ADA balance is in walletStore.account.controlled_amount (string lovelace)
        const amt = walletStore.account?.controlled_amount;
        return amt ? BigInt(amt) : 0n;
      }
      const token = (walletStore.tokens as Record<string, { quantity?: bigint | string }>)[unitAssetId];
      if (!token) return 0n;
      const q = token.quantity;
      if (typeof q === 'bigint') return q;
      if (typeof q === 'string') return BigInt(q);
      return 0n;
    }

    // -------------------------------------------------------------------
    // Dep: quote / build - delegate to nexusSwapApi
    // The cutoff plan documents that Nexus does server-side UTxO selection,
    // so we pass the wallet's base address + empty utxos here.
    // -------------------------------------------------------------------
    async function quoteFn(req: { tokenIn: string; tokenOut: string; amountIn: string }) {
      return nexusSwapApi.quote({ ...req });
    }

    async function buildFn(route: unknown) {
      const senderAddress = walletStore.loggedWallet?.baseAddress ?? '';
      // Capture the chosen route so the card can show its dex + fee.
      selectedRoute.value = route as SwapRoute;
      return nexusSwapApi.buildTx({
        route: route as SwapRoute,
        senderAddress,
        changeAddress: senderAddress,
        utxos: [],
        // Note: utxos is [] here because Nexus does server-side UTxO selection
        // per the DexHunter -> Nexus cutoff plan (docs/plans/2026-06-24-dexhunter-nexus-cutoff.md).
      });
    }

    // -------------------------------------------------------------------
    // Dep: decodeAndVerify - deserialize -> toDecodedTx -> verifySwapTx
    // ownAddresses sourced from walletStore.keys (the wallet's address list)
    // -------------------------------------------------------------------
    function decodeAndVerify(
      cbor: string,
      outputAssetKey: string,
      sellAssetKey: string,
      minOutput: bigint,
      maxSpendLovelace: bigint,
      amountIn: bigint,
    ) {
      const tx = deserializeCardanoJsSdkTx(cbor);
      const decoded = toDecodedTx(tx);
      // ownAddresses: the wallet's full payment + change address list, exactly like
      // SignTx.vue (`[...keys.payment, ...keys.change].map(el => el.address)`). The buy
      // token can be delivered to ANY own address (a change address included), so the
      // Guardrail's own-address set must cover both. Falls back to baseAddress only when
      // keys are unavailable.
      const keys = walletStore.keys as Keys | null;
      const ownAddresses: string[] = [];
      if (keys && (keys.payment?.length || keys.change?.length)) {
        for (const k of [...(keys.payment ?? []), ...(keys.change ?? [])]) {
          if (k.address) ownAddresses.push(k.address);
        }
      }
      if (ownAddresses.length === 0) {
        const baseAddress = walletStore.loggedWallet?.baseAddress;
        if (baseAddress) ownAddresses.push(baseAddress);
      }
      return verifySwapTx(decoded, {
        ownAddresses,
        outputAssetId: outputAssetKey,
        sellAssetId: sellAssetKey,
        minOutput,
        maxSpendLovelace,
        amountIn,
      });
    }

    // -------------------------------------------------------------------
    // Wire the composable with the real deps
    // -------------------------------------------------------------------
    const swap = createAgentSwap({
      resolveSymbol,
      getDecimals,
      getHeldAmount,
      quote: quoteFn,
      build: buildFn,
      decodeAndVerify,
    });

    onMounted(async () => {
      busy.value = true;
      swapError.value = '';
      try {
        await swap.prepare(props.intent);
        if (swap.error.value) {
          swapError.value = swap.error.value;
        } else {
          proposal.value = swap.proposal.value;
        }
      } catch (e) {
        swapError.value = e instanceof Error ? e.message : 'Failed to prepare swap.';
      } finally {
        busy.value = false;
      }
    });

    // -------------------------------------------------------------------
    // Display helpers
    // -------------------------------------------------------------------
    const sellDisplay = computed(() => {
      if (!proposal.value) return '';
      // Show the human number the user typed, not the smallest-unit amount.
      if (props.intent.mode === 'percent') {
        return `${props.intent.percent ?? 0}% of ${proposal.value.sellSymbol}`;
      }
      return `${props.intent.amount ?? proposal.value.amountIn} ${proposal.value.sellSymbol}`;
    });

    const receiveDisplay = computed(() => {
      if (!proposal.value) return '';
      return `${proposal.value.youReceive.toString()} ${proposal.value.buySymbol}`;
    });

    const minReceivedDisplay = computed(() => {
      if (!proposal.value) return '';
      return `${proposal.value.minOutput.toString()} ${proposal.value.buySymbol}`;
    });

    const routeDisplay = computed(() => selectedRoute.value?.dex ?? '');

    const feeDisplay = computed(() => {
      const route = selectedRoute.value;
      if (!route) return '';
      // Surface whichever fee the route carries, formatted as ADA (lovelace -> ADA).
      const feeLovelace =
        route.aggregatorFeeLovelace ??
        route.batcherFeeLovelace ??
        route.estimatedTxFeeLovelace;
      if (!feeLovelace) return '';
      const ada = Number(BigInt(feeLovelace)) / 1_000_000;
      return `${ada} ADA`;
    });

    // -------------------------------------------------------------------
    // Sign handler: scanTx -> SIGN_TX -> submit
    // -------------------------------------------------------------------
    async function onSign() {
      if (!proposal.value || proposal.value.status !== 'ready') return;
      signing.value = true;
      riskHigh.value = false;
      submitResult.value = null;
      submitError.value = '';

      const cbor = proposal.value.unsignedTxCbor;
      const fromAddress = walletStore.loggedWallet?.baseAddress ?? '';
      const toAddress = fromAddress; // swap change goes back to own address

      try {
        // 1. CardanoShield scan (non-blocking warning; high risk surfaces a warning but
        //    does not force-block - the user has already seen the Guardrail pass)
        try {
          const scanResp = await cardanoShieldApi.scanTx({
            cborHex: cbor,
            toAddress,
            fromAddress,
            url: 'gero-copilot',
          });
          if (scanResp.score === DappScore.high) {
            riskHigh.value = true;
            // Abort signing on high risk (safety invariant 5)
            signing.value = false;
            return;
          }
        } catch {
          // Shield unavailable: proceed, but note the gap
        }

        // 2. Sign via background SIGN_TX (reuses the exact same pattern as SwapSheet.vue)
        // Password and PRF paths both go through the background handler:
        //   password: background decrypts keys from chrome.storage using the stored password
        //   PRF: not yet wired here (requires the PassKey popup) - documented follow-up
        // For v1 we pass no explicit password; the background will use the unlocked session key
        // (the wallet must already be unlocked for the dock to be visible).
        const signResult = await (Messaging as typeof Messaging).sendToBackgroundFromOptions({
          method: MessageTypes.SIGN_TX,
          data: {
            txCbor: cbor,
            partialSign: true,
            accountIndex: 0,
            utxos: walletStore.utxos,
            addresses: walletStore.keys,
            mergeWitnesses: false,
          },
        }) as BackgroundResponse<{ witnesses?: string; error?: string }>;

        if (signResult.data.error) {
          throw new Error(signResult.data.error);
        }

        const userWitnessHex = signResult.data.witnesses;
        if (!userWitnessHex) throw new Error('No witness returned from signing.');

        // 3. Submit (verbatim cbor; never retried per safety invariant 4)
        await nexusSwapApi.submit({ unsignedTxCbor: cbor, userWitnessHex });
        submitResult.value = 'submitted';
      } catch (e) {
        submitResult.value = 'failed';
        submitError.value = e instanceof Error ? e.message : 'Signing or submit failed.';
      } finally {
        signing.value = false;
      }
    }

    return {
      busy,
      swapError,
      proposal,
      signing,
      riskHigh,
      submitResult,
      submitError,
      sellDisplay,
      receiveDisplay,
      minReceivedDisplay,
      routeDisplay,
      feeDisplay,
      onSign,
    };
  },
});
</script>

<style scoped>
.swap-card {
  border-radius: 12px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.04);
  font-size: 13px;
}

.swap-card__loading {
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: 0.7;
}

.swap-card__spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.swap-card__error {
  color: #f97066;
  font-size: 12px;
}

.swap-card__row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
}

.swap-card__label {
  opacity: 0.65;
}

.swap-card__value {
  font-weight: 600;
}

.swap-card__blocked {
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(249, 112, 102, 0.12);
  border: 1px solid rgba(249, 112, 102, 0.35);
}

.swap-card__blocked-title {
  color: #f97066;
  font-weight: 600;
  font-size: 12px;
  margin-bottom: 4px;
}

.swap-card__reasons {
  margin: 0;
  padding-left: 16px;
  color: #f97066;
  font-size: 11px;
}

.swap-card__risk {
  margin-top: 6px;
  padding: 5px 8px;
  border-radius: 8px;
  background: rgba(249, 112, 102, 0.12);
  color: #f97066;
  font-size: 12px;
}

.swap-card__submitted {
  margin-top: 6px;
  color: #47cd89;
  font-size: 12px;
}

.swap-card__failed {
  margin-top: 6px;
  color: #f97066;
  font-size: 12px;
}

.swap-card__sign-btn {
  margin-top: 10px;
  width: 100%;
  padding: 8px;
  border-radius: 10px;
  border: none;
  background: var(--v-primary-base, #5b6cff);
  color: #fff;
  font-weight: 700;
  cursor: pointer;
  font-size: 13px;
  transition: opacity 0.15s;
}

.swap-card__sign-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.swap-card__advice {
  margin: 8px 0 0;
  font-size: 10px;
  opacity: 0.45;
}
</style>
