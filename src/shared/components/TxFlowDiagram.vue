<template>
  <section :class="['tx-flow', { 'tx-flow--compact': compact }]" :aria-label="ariaLabel">
    <div ref="canvas" class="tx-flow__canvas" :class="{ 'tx-flow__canvas--dim': highlighted.size > 0 }" :style="{ height: `${layout.height}px` }">
      <svg
        v-if="width > 0"
        class="tx-flow__svg"
        :width="layout.width"
        :height="layout.height"
        :viewBox="`0 0 ${layout.width} ${layout.height}`"
        aria-hidden="true"
      >
        <path
          v-for="band in layout.bands"
          :key="band.key"
          :d="band.path"
          :class="['tx-flow__band', { 'tx-flow__band--hi': highlighted.has(band.key) }]"
          :style="{ fill: KIND_COLOR[band.kind] }"
          @mouseenter="hoverNode(band.key)"
          @mouseleave="clearHover"
        />
        <line
          v-for="divider in layout.dividers"
          :key="divider.side"
          class="tx-flow__divider"
          :x1="divider.x1"
          :x2="divider.x2"
          :y1="divider.y"
          :y2="divider.y"
        />
        <rect
          class="tx-flow__bar"
          :x="layout.bar.x"
          :y="layout.bar.y"
          :width="layout.bar.width"
          :height="layout.bar.height"
          :rx="layout.bar.width / 2"
        />
        <rect
          class="tx-flow__bar-core"
          :x="layout.bar.x + layout.bar.width / 2 - 1"
          :y="layout.bar.y + 8"
          width="2"
          :height="Math.max(0, layout.bar.height - 16)"
          rx="1"
        />
      </svg>

      <template v-if="width > 0">
      <component
        :is="box.node.kind === 'more' ? 'button' : 'div'"
        v-for="box in layout.boxes"
        :key="box.node.key"
        :type="box.node.kind === 'more' ? 'button' : undefined"
        :class="[
          'tx-flow__box',
          'glass-tier',
          `tx-flow__box--${box.node.kind}`,
          { 'tx-flow__box--hi': highlighted.has(box.node.key) },
        ]"
        :style="{
          left: `${box.x}px`,
          top: `${box.y}px`,
          width: `${box.width}px`,
          height: `${box.height}px`,
          '--flow-c': KIND_COLOR[box.node.kind],
        }"
        @mouseenter="hoverNode(box.node.key)"
        @mouseleave="clearHover"
        @click="box.node.kind === 'more' ? expand(box.side) : undefined"
      >
        <div class="tx-flow__head">
          <span v-if="!compact" class="tx-flow__icon"><v-icon size="16">{{ KIND_ICON[box.node.kind] }}</v-icon></span>
          <span class="tx-flow__ids">
            <span class="tx-flow__label t-body-sm">
              <span class="tx-flow__name">{{ nodeLabel(box.node) }}</span>
              <span v-if="box.node.count > 1 && box.node.kind !== 'more'" class="tx-flow__count g-num">×{{ box.node.count }}</span>
            </span>
            <span v-if="compact" class="tx-flow__sub t-caption g-num">{{ ada(box.node.lovelace) }}</span>
            <span v-else class="tx-flow__sub t-caption">{{ nodeSub(box.node) }}</span>
          </span>
          <span v-if="!compact" class="tx-flow__ada t-body-sm g-num">{{ ada(box.node.lovelace) }}</span>
        </div>
        <div v-if="box.node.tokens.length" class="tx-flow__chips" :data-chips="box.node.key">
          <button
            v-for="token in shownTokens(box.node)"
            :key="token.unit"
            type="button"
            class="tx-flow__chip t-caption"
            data-chip
            :title="tokenTitle(token)"
            @mouseenter.stop="traceToken(token.unit)"
            @mouseleave.stop="clearHover"
            @focus="traceToken(token.unit)"
            @blur="clearHover"
            @click.stop="pinToken(token.unit)"
          >
            <img class="tx-flow__chip-img" :src="tokenImage(token.unit)" alt="" />
            <span class="tx-flow__chip-text">{{ tokenText(token) }}</span>
          </button>
          <span
            v-if="hiddenTokenCount(box.node) > 0"
            class="tx-flow__chip tx-flow__chip--more t-caption"
            :title="hiddenTokenNames(box.node)"
          >+{{ hiddenTokenCount(box.node) }}</span>
        </div>
      </component>
      </template>
    </div>

    <p class="tx-flow__info t-caption">{{ info }}</p>

    <div v-if="model.collateralCount || model.referenceInputCount" class="tx-flow__unspent">
      <span class="tx-flow__unspent-title t-caption">{{ $t('transactions.flow.notSpent') }}</span>
      <div class="tx-flow__ghosts">
        <div v-if="model.collateralCount" class="tx-flow__ghost">
          <v-icon size="16" class="tx-flow__ghost-icon">mdi-shield-outline</v-icon>
          <span class="tx-flow__ids">
            <span class="t-body-sm">
              {{ $t('transactions.collateral') }}<span v-if="model.collateralCount > 1" class="tx-flow__count g-num">×{{ model.collateralCount }}</span>
            </span>
            <span class="t-caption">{{ $t('transactions.flow.collateralHint') }}</span>
          </span>
        </div>
        <div v-if="model.referenceInputCount" class="tx-flow__ghost">
          <v-icon size="16" class="tx-flow__ghost-icon">mdi-book-open-variant-outline</v-icon>
          <span class="tx-flow__ids">
            <span class="t-body-sm">
              {{ $t('transactions.referenceInputs') }}<span v-if="model.referenceInputCount > 1" class="tx-flow__count g-num">×{{ model.referenceInputCount }}</span>
            </span>
            <span class="t-caption">{{ $t('transactions.flow.referenceHint') }}</span>
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import filters from '@/shared/utils/filters';
import assts from '@/utils/assets';
import {
  collapseFlowNodes,
  layoutTxFlow,
  type FlowKind,
  type FlowNode,
  type FlowToken,
  type TxFlowModel,
} from '@/shared/utils/txFlow';

export interface FlowTokenInfo {
  name: string;
  img?: string;
  decimals: number;
}

interface Props {
  model: TxFlowModel;
  /** Display name, image and decimals of a token unit */
  tokenInfo: (unit: string) => FlowTokenInfo;
  /** Printed before an amount (₳); empty when the unit follows it */
  currencySymbol: string;
  /** Printed after an amount, e.g. " BTC" */
  currencySuffix?: string;
  /** Decimals of the chain's coin: node values are in its base unit (6 for lovelace, 8 for sats) */
  decimals?: number;
  /** Decimals shown for an amount that is not shortened */
  fractionDigits?: number;
}

const props = withDefaults(defineProps<Props>(), {
  currencySuffix: '',
  decimals: 6,
  fractionDigits: 2,
});
const { t, tc } = useTranslation();

const KIND_COLOR: Record<FlowKind, string> = {
  own: 'var(--g-accent)',
  other: 'var(--g-text-3)',
  script: 'var(--g-info)',
  more: 'var(--g-text-3)',
  data: 'var(--g-text-3)',
  coinbase: 'var(--g-success)',
  rewards: 'var(--g-success)',
  refund: 'var(--g-success)',
  fee: 'var(--g-warning)',
  donation: 'var(--g-warning)',
  deposit: 'var(--g-warning)',
};

const KIND_ICON: Record<FlowKind, string> = {
  own: 'mdi-wallet-outline',
  other: 'mdi-account-outline',
  script: 'mdi-file-code-outline',
  more: 'mdi-dots-horizontal',
  data: 'mdi-text-box-outline',
  coinbase: 'mdi-pickaxe',
  rewards: 'mdi-gift-outline',
  refund: 'mdi-lock-open-variant-outline',
  fee: 'mdi-fire',
  donation: 'mdi-hand-heart-outline',
  deposit: 'mdi-lock-outline',
};

/** Box heights: the header row, plus a row of token chips when the node holds any. */
const BOX_HEIGHT = 52;
const BOX_HEIGHT_TOKENS = 80;
/** Width kept for the "+N" chip when chips are cut. */
const MORE_CHIP_WIDTH = 40;
const COLUMN_LIMIT = 5;
/** Below this canvas width boxes drop the icon and show the amount under the label. */
const COMPACT_WIDTH = 520;

// ---------------------------------------------------------------------------
// Size: the diagram fills its container and re-lays out when it changes
// ---------------------------------------------------------------------------
const canvas = ref<HTMLElement | null>(null);
const width = ref(0);
let observer: ResizeObserver | null = null;

onMounted(() => {
  if (!canvas.value) return;
  width.value = canvas.value.clientWidth;
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next && next !== width.value) width.value = next;
    });
    observer.observe(canvas.value);
  }
});

onBeforeUnmount(() => observer?.disconnect());

const compact = computed(() => width.value > 0 && width.value < COMPACT_WIDTH);

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
const open = ref<{ in: boolean; out: boolean }>({ in: false, out: false });
watch(() => props.model, () => {
  open.value = { in: false, out: false };
});

const inputs = computed(() => collapseFlowNodes(props.model.inputs, COLUMN_LIMIT, open.value.in));
const outputs = computed(() => collapseFlowNodes(props.model.outputs, COLUMN_LIMIT, open.value.out));

const layout = computed(() =>
  layoutTxFlow(inputs.value, outputs.value, {
    width: Math.max(width.value, 1),
    boxHeight: (node) => (node.tokens.length ? BOX_HEIGHT_TOKENS : BOX_HEIGHT),
    anchorY: BOX_HEIGHT / 2,
    minGutter: compact.value ? 36 : 56,
  })
);

function expand(side: 'in' | 'out') {
  open.value = { ...open.value, [side]: true };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------
function nodeLabel(node: FlowNode): string {
  switch (node.kind) {
    case 'own': return t('governance.you');
    case 'script': return t('transactions.flow.contract');
    case 'other': return t('transactions.flow.address');
    case 'more': return t('transactions.moreTokens', { count: node.count });
    case 'data': return t('bitcoin.dataOutput');
    case 'coinbase': return t('bitcoin.coinbase');
    case 'rewards': return t('transactions.flow.rewards');
    case 'refund': return t('transactions.flow.depositRefund');
    case 'fee': return t('signTx.networkFee');
    case 'donation': return t('transactions.flow.donation');
    case 'deposit': return t('transactions.flow.deposit');
  }
}

function nodeSub(node: FlowNode): string {
  if (node.address) return filters.truncate(node.address);
  switch (node.kind) {
    case 'more': return t('common.showAll');
    case 'fee': return t('transactions.flow.toNetwork');
    case 'deposit': return t('transactions.flow.depositHint');
    case 'refund': return t('transactions.flow.refundHint');
    case 'donation': return t('transactions.flow.toTreasury');
    case 'rewards': return t('transactions.flow.rewardsHint');
    case 'coinbase': return t('transactions.flow.coinbaseHint');
    default: return '';
  }
}

/** Amounts of 100,000 coins or more shorten (1.26M), smaller ones keep `fractionDigits` decimals. */
const ada = (base: number): string =>
  filters.toCurrency(
    base,
    false,
    props.fractionDigits,
    props.currencySymbol,
    props.currencySuffix,
    base / 10 ** props.decimals >= 1e5,
    props.decimals,
  );

const tokenImage = (unit: string): string => props.tokenInfo(unit).img || assts.questionMarkDark;

/** An NFT (one unit, no decimals) shows its name only. */
function tokenText(token: FlowToken): string {
  const info = props.tokenInfo(token.unit);
  if (token.quantity === 1 && !info.decimals) return info.name;
  const whole = token.quantity / 10 ** info.decimals;
  // Below one unit, two decimals would read as "0": keep up to six
  const quantity = filters.toCurrency(token.quantity, false, whole < 1 ? 6 : 2, '', '', whole >= 1e6, info.decimals);
  return `${quantity} ${info.name}`;
}

function tokenTitle(token: FlowToken): string {
  const info = props.tokenInfo(token.unit);
  return `${filters.toCurrency(token.quantity, false, 6, '', '', false, info.decimals)} ${info.name}`;
}

const nodeLine = (node: FlowNode): string =>
  [
    nodeLabel(node),
    node.count > 1 && node.kind !== 'more' ? tc('transactions.flow.utxoCount', node.count, { count: node.count }) : '',
    node.address ? filters.truncate(node.address) : '',
    ada(node.lovelace),
  ].filter(Boolean).join(' · ');

const ariaLabel = computed(() =>
  t('transactions.flow.ariaLabel')
);

// ---------------------------------------------------------------------------
// Token chips: as many as fit the box, the rest folded into "+N"
// ---------------------------------------------------------------------------
const fitted = ref<Record<string, number>>({});

const shownTokens = (node: FlowNode): FlowToken[] =>
  node.key in fitted.value ? node.tokens.slice(0, fitted.value[node.key]) : node.tokens;
const hiddenTokenCount = (node: FlowNode): number => node.tokens.length - shownTokens(node).length;
const hiddenTokenNames = (node: FlowNode): string =>
  node.tokens.slice(shownTokens(node).length).map((token) => props.tokenInfo(token.unit).name).join(', ');

let fitRun = 0;
async function fitChips() {
  const run = ++fitRun;
  fitted.value = {};
  await nextTick();
  if (run !== fitRun || !canvas.value) return;
  const next: Record<string, number> = {};
  canvas.value.querySelectorAll<HTMLElement>('[data-chips]').forEach((row) => {
    const chips = Array.from(row.querySelectorAll<HTMLElement>('[data-chip]'));
    const rowRect = row.getBoundingClientRect();
    const right = (chip: HTMLElement) => chip.getBoundingClientRect().right - rowRect.left;
    if (!chips.length || right(chips[chips.length - 1]) <= row.clientWidth) return;
    let count = 0;
    while (count < chips.length && right(chips[count]) <= row.clientWidth - MORE_CHIP_WIDTH) count += 1;
    next[row.dataset['chips'] ?? ''] = count;
  });
  fitted.value = next;
}

watch([width, layout], () => void fitChips(), { flush: 'post' });

// ---------------------------------------------------------------------------
// Highlight: a hovered box with its band, or every box holding a traced token
// ---------------------------------------------------------------------------
const hovered = ref<string | null>(null);
const traced = ref<string | null>(null);
const pinned = ref<string | null>(null);

const allBoxes = computed(() => layout.value.boxes.map((box) => box.node));

const highlighted = computed<Set<string>>(() => {
  const unit = traced.value ?? pinned.value;
  if (unit) {
    return new Set(allBoxes.value.filter((node) => node.tokens.some((token) => token.unit === unit)).map((node) => node.key));
  }
  return hovered.value ? new Set([hovered.value]) : new Set();
});

function hoverNode(key: string) {
  hovered.value = key;
  traced.value = null;
}

function traceToken(unit: string) {
  traced.value = unit;
}

function pinToken(unit: string) {
  pinned.value = pinned.value === unit ? null : unit;
}

function clearHover() {
  hovered.value = null;
  traced.value = null;
}

const info = computed(() => {
  const unit = traced.value ?? pinned.value;
  if (unit) {
    const holders = allBoxes.value.filter((node) => node.tokens.some((token) => token.unit === unit));
    const names = (side: FlowNode[]) =>
      [...new Set(holders.filter((node) => side.includes(node)).map(nodeLabel))].join(', ');
    return t('transactions.flow.trace', {
      token: props.tokenInfo(unit).name,
      from: names(inputs.value) || t('transactions.flow.minted'),
      to: names(outputs.value) || t('transactions.flow.burned'),
    });
  }
  const node = hovered.value ? allBoxes.value.find((item) => item.key === hovered.value) : undefined;
  return node ? nodeLine(node) : t('transactions.flow.hint');
});
</script>

<style scoped lang="scss">
.tx-flow {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.tx-flow__canvas {
  position: relative;
  width: 100%;
}

.tx-flow__svg {
  position: absolute;
  inset: 0;
  overflow: visible;
}

.tx-flow__band {
  opacity: 0.3;
  transition: opacity var(--g-dur-fast) ease;
}

.tx-flow__canvas--dim .tx-flow__band {
  opacity: 0.07;
}

.tx-flow__canvas--dim .tx-flow__band--hi {
  opacity: 0.6;
}

.tx-flow__divider {
  stroke: var(--g-hairline-2);
  stroke-dasharray: 3 3;
}

.tx-flow__bar {
  fill: var(--g-raised);
  stroke: var(--g-hairline-3);
}

.tx-flow__bar-core {
  fill: var(--g-accent);
  opacity: 0.8;
}

.tx-flow__box {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  overflow: hidden;
  text-align: left;
  color: inherit;
  transition: opacity var(--g-dur-fast) ease, border-color var(--g-dur-fast) ease;
}

.tx-flow__canvas--dim .tx-flow__box {
  opacity: 0.35;
}

.tx-flow__canvas--dim .tx-flow__box--hi {
  opacity: 1;
  border-color: var(--g-hairline-3);
}

.tx-flow__box--fee,
.tx-flow__box--deposit,
.tx-flow__box--donation {
  border-style: dashed;
  border-color: var(--g-warning-line);
}

.tx-flow__box--more {
  border-style: dashed;
  border-color: var(--g-hairline-3);
  cursor: pointer;
}

.tx-flow__head {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 34px;
}

.tx-flow__icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--g-r-pill);
  background: color-mix(in srgb, var(--flow-c) 16%, transparent);
  color: var(--flow-c);
}

.tx-flow__ids {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.tx-flow__label {
  display: flex;
  align-items: center;
  min-width: 0;
  font-weight: 500;
  color: var(--g-text-1);
}

.tx-flow__name,
.tx-flow__sub {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.tx-flow__sub {
  font-family: var(--g-font-mono);
}

.tx-flow__count {
  flex: none;
  margin-left: 5px;
  padding: 0 5px;
  border-radius: var(--g-r-chip);
  background: var(--g-hairline-2);
  color: var(--g-text-2);
  font-weight: 400;
}

.tx-flow__ada {
  flex: none;
  font-family: var(--g-font-mono);
  color: var(--g-text-1);
  white-space: nowrap;
}

.tx-flow__chips {
  display: flex;
  flex-wrap: nowrap;
  gap: 4px;
  overflow: hidden;
}

.tx-flow__chip {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  max-width: 128px;
  padding: 1px 7px 1px 2px;
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-1);
  color: var(--g-text-2);
  white-space: nowrap;
  cursor: pointer;
  transition: border-color var(--g-dur-fast) ease, color var(--g-dur-fast) ease;
}

.tx-flow__chip:hover {
  border-color: var(--g-accent);
  color: var(--g-text-1);
}

.tx-flow__chip--more {
  padding: 1px 7px;
  cursor: default;
}

.tx-flow__chip-img {
  flex: none;
  width: 16px;
  height: 16px;
  border-radius: var(--g-r-pill);
  object-fit: cover;
}

.tx-flow__chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.tx-flow__info {
  min-height: 18px;
  margin: 0;
  font-family: var(--g-font-mono);
  text-align: center;
  overflow-wrap: anywhere;
}

.tx-flow__unspent {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.tx-flow__ghosts {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}

.tx-flow__ghost {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 9px;
  min-width: 180px;
  padding: 8px 10px;
  border: 1px dashed var(--g-hairline-3);
  border-radius: var(--g-r-card);
}

.tx-flow__ghost-icon {
  color: var(--g-text-3);
}
</style>
