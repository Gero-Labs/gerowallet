/**
 * Transaction flow model and layout for the inputs → outputs diagram in the
 * transaction details (`TxFlowDiagram.vue`).
 *
 * Pure: no Vue, no stores. `buildTxFlow` turns a stored transaction record into
 * grouped nodes (one per address and kind), `collapseFlowNodes` folds long
 * columns into a "+N more" node, and `layoutTxFlow` places boxes and the bands
 * between them in pixel coordinates.
 *
 * Value accounting (lovelace): inputs + withdrawals + refund = outputs + fee +
 * donation + deposit. Cardano does not record which input pays which output, so
 * every band runs to or from the one transaction node; nothing here pairs an
 * input with an output.
 */
import { Cardano } from '@cardano-sdk/core';

export type FlowKind =
  | 'own'
  | 'other'
  | 'script'
  | 'more'
  /**
   * Inputs of a transaction still to be signed that the wallet cannot resolve (someone else's
   * UTxO, a script's): their address and value are unknown, never zero (`txFlowUnsigned.ts`)
   */
  | 'unknown'
  /** Left-side sources that are not inputs */
  | 'rewards'
  | 'refund'
  /** Right-side sinks that are not outputs */
  | 'fee'
  | 'donation'
  | 'deposit';

export const FLOW_SOURCE_KINDS: ReadonlySet<FlowKind> = new Set<FlowKind>(['rewards', 'refund']);
export const FLOW_SINK_KINDS: ReadonlySet<FlowKind> = new Set<FlowKind>(['fee', 'donation', 'deposit']);

export interface FlowToken {
  unit: string;
  quantity: number;
}

export interface FlowNode {
  key: string;
  kind: FlowKind;
  /** Bech32 address; empty for sources, sinks and the "more" node */
  address: string;
  lovelace: number;
  /** UTxOs folded into this node */
  count: number;
  tokens: FlowToken[];
}

export interface TxFlowModel {
  inputs: FlowNode[];
  outputs: FlowNode[];
  collateralCount: number;
  referenceInputCount: number;
}

interface RawAmount {
  unit: string;
  quantity: number | string;
}

interface RawIO {
  address?: string;
  amount?: RawAmount[];
}

/** Stored transaction record: Koios-shaped `utxo` plus an SDK-shaped `body`. */
export interface FlowTxRecord {
  /** false: phase-2 validation failed; only the collateral moved */
  isValid?: boolean;
  utxo?: { inputs?: RawIO[]; outputs?: RawIO[] } | null;
  body?: {
    fee?: number | string | bigint;
    withdrawals?: { quantity: number | string | bigint }[];
    donation?: number | string | bigint;
    collaterals?: unknown[];
    referenceInputs?: unknown[];
  } | null;
}

/** Parsed answers per address: a 100-UTxO transaction re-renders without re-parsing bech32. */
const scriptAddressCache = new Map<string, boolean>();
const SCRIPT_ADDRESS_CACHE_LIMIT = 2_000;

export function isScriptAddress(address: string): boolean {
  const cached = scriptAddressCache.get(address);
  if (cached !== undefined) return cached;
  let script = false;
  try {
    script = Cardano.Address.fromBech32(address.trim()).getProps().paymentPart?.type === Cardano.CredentialType.ScriptHash;
  } catch {
    script = false;
  }
  if (scriptAddressCache.size >= SCRIPT_ADDRESS_CACHE_LIMIT) scriptAddressCache.clear();
  scriptAddressCache.set(address, script);
  return script;
}

const toNumber = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function mergeTokens(into: FlowToken[], add: Iterable<FlowToken>): void {
  for (const token of add) {
    const existing = into.find((held) => held.unit === token.unit);
    if (existing) existing.quantity += token.quantity;
    else into.push({ unit: token.unit, quantity: token.quantity });
  }
}

function addressKind(address: string, own: ReadonlySet<string>): FlowKind {
  if (own.has(address)) return 'own';
  return isScriptAddress(address) ? 'script' : 'other';
}

/** One node per (kind, address), in first-seen order, with lovelace and tokens summed. */
export function groupFlowIO(side: 'in' | 'out', ios: RawIO[], own: ReadonlySet<string>): FlowNode[] {
  const nodes = new Map<string, FlowNode>();
  for (const io of ios) {
    const address = io.address ?? '';
    const kind = addressKind(address, own);
    const key = `${side}:${kind}:${address}`;
    let node = nodes.get(key);
    if (!node) {
      node = { key, kind, address, lovelace: 0, count: 0, tokens: [] };
      nodes.set(key, node);
    }
    node.count += 1;
    for (const amount of io.amount ?? []) {
      const quantity = toNumber(amount.quantity);
      if (amount.unit === 'lovelace') node.lovelace += quantity;
      else if (quantity !== 0) mergeTokens(node.tokens, [{ unit: amount.unit, quantity }]);
    }
  }
  return [...nodes.values()];
}

const sumLovelace = (ios: RawIO[]): number =>
  ios.reduce((total, io) => total + toNumber(io.amount?.find((amount) => amount.unit === 'lovelace')?.quantity), 0);

/** Smallest stake-key or DRep deposit is 2 ADA; a gap below this is not a deposit. */
const MIN_DEPOSIT_LOVELACE = 1_000_000;

export function buildTxFlow(tx: FlowTxRecord | null | undefined, ownAddresses: ReadonlySet<string>): TxFlowModel | null {
  // A transaction whose scripts failed created none of its outputs and only forfeited its
  // collateral: drawing its body would show value moving that never moved.
  if (tx?.isValid === false) return null;
  const inputs = tx?.utxo?.inputs ?? [];
  const outputs = tx?.utxo?.outputs ?? [];
  if (!inputs.length || !outputs.length) return null;

  const left = groupFlowIO('in', inputs, ownAddresses);
  const right = groupFlowIO('out', outputs, ownAddresses);

  const fee = toNumber(tx?.body?.fee);
  const donation = toNumber(tx?.body?.donation);
  const rewards = (tx?.body?.withdrawals ?? []).reduce((total, withdrawal) => total + toNumber(withdrawal.quantity), 0);
  // What the inputs and withdrawals pay that no output, fee or donation accounts for
  // is a deposit; a negative gap is a deposit coming back.
  const gap = sumLovelace(inputs) + rewards - sumLovelace(outputs) - fee - donation;
  const every = inputs.every((input) => input.amount?.some((amount) => amount.unit === 'lovelace'));

  const source = (kind: FlowKind, lovelace: number): FlowNode => ({ key: `src:${kind}`, kind, address: '', lovelace, count: 1, tokens: [] });
  if (rewards > 0) left.push(source('rewards', rewards));
  if (every && gap <= -MIN_DEPOSIT_LOVELACE) left.push(source('refund', -gap));

  if (fee > 0) right.push(source('fee', fee));
  if (donation > 0) right.push(source('donation', donation));
  if (every && gap >= MIN_DEPOSIT_LOVELACE) right.push(source('deposit', gap));

  return {
    inputs: left,
    outputs: right,
    collateralCount: tx?.body?.collaterals?.length ?? 0,
    referenceInputCount: tx?.body?.referenceInputs?.length ?? 0,
  };
}

/**
 * At most `limit` boxes of addresses per side: every own node and every unknown
 * input stays (an unknown value folded into "more" would read as part of its
 * total), the largest others fill what is left, and the rest fold into one
 * "more" node at the end. Sources and sinks are never folded. `open` shows everything.
 */
export function collapseFlowNodes(nodes: FlowNode[], limit = 5, open = false): FlowNode[] {
  const addresses = nodes.filter((node) => !FLOW_SOURCE_KINDS.has(node.kind) && !FLOW_SINK_KINDS.has(node.kind));
  const extras = nodes.filter((node) => FLOW_SOURCE_KINDS.has(node.kind) || FLOW_SINK_KINDS.has(node.kind));
  if (open || addresses.length <= limit) return nodes;

  const pinned = (node: FlowNode) => node.kind === 'own' || node.kind === 'unknown';
  const own = addresses.filter(pinned);
  const room = Math.max(0, limit - 1 - own.length);
  const kept = new Set<FlowNode>([
    ...own,
    ...addresses.filter((node) => !pinned(node)).sort((a, b) => b.lovelace - a.lovelace).slice(0, room),
  ]);
  const hidden = addresses.filter((node) => !kept.has(node));
  if (!hidden.length) return nodes;

  const more: FlowNode = {
    key: `${hidden[0].key.split(':')[0]}:more`,
    kind: 'more',
    address: '',
    lovelace: hidden.reduce((total, node) => total + node.lovelace, 0),
    count: hidden.reduce((total, node) => total + node.count, 0),
    tokens: [],
  };
  for (const node of hidden) mergeTokens(more.tokens, node.tokens);
  return [...addresses.filter((node) => kept.has(node)), more, ...extras];
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export interface FlowLayoutOptions {
  width: number;
  /** Box height for a node (taller when it shows token chips) */
  boxHeight: (node: FlowNode) => number;
  /** Distance from a box's top to where its band attaches */
  anchorY?: number;
  gap?: number;
  /** Extra space above the first source or sink */
  dividerGap?: number;
  barWidth?: number;
  maxBand?: number;
  minBand?: number;
  bandGap?: number;
  minGutter?: number;
  maxBoxWidth?: number;
  minBoxWidth?: number;
}

export interface FlowBox {
  node: FlowNode;
  side: 'in' | 'out';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlowBand {
  key: string;
  kind: FlowKind;
  side: 'in' | 'out';
  thickness: number;
  path: string;
}

export interface FlowLayout {
  width: number;
  height: number;
  boxes: FlowBox[];
  bands: FlowBand[];
  bar: { x: number; y: number; width: number; height: number };
  /** Dashed rule between a column's addresses and its sources or sinks */
  dividers: { side: 'in' | 'out'; x1: number; x2: number; y: number }[];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A filled band between two vertical spans, with horizontal tangents at both ends. */
export function bandPath(x1: number, y1: number, x2: number, y2: number, thickness: number): string {
  const mid = (x1 + x2) / 2;
  const r = (value: number) => Math.round(value * 100) / 100;
  return `M${r(x1)},${r(y1)}C${r(mid)},${r(y1)} ${r(mid)},${r(y2)} ${r(x2)},${r(y2)}`
    + `L${r(x2)},${r(y2 + thickness)}C${r(mid)},${r(y2 + thickness)} ${r(mid)},${r(y1 + thickness)} ${r(x1)},${r(y1 + thickness)}Z`;
}

export function layoutTxFlow(inputs: FlowNode[], outputs: FlowNode[], options: FlowLayoutOptions): FlowLayout {
  const {
    width,
    boxHeight,
    anchorY = 25,
    gap = 10,
    dividerGap = 10,
    barWidth = 12,
    maxBand = 30,
    minBand = 3,
    bandGap = 3,
    minGutter = 56,
    maxBoxWidth = 220,
    minBoxWidth = 120,
  } = options;

  const boxWidth = clamp((width - 2 * minGutter) / 2, minBoxWidth, maxBoxWidth);
  const center = width / 2;

  const column = (nodes: FlowNode[]) => {
    let y = 0;
    const tops = nodes.map((node, index) => {
      const extra = index > 0 && (FLOW_SOURCE_KINDS.has(node.kind) || FLOW_SINK_KINDS.has(node.kind))
        && !(FLOW_SOURCE_KINDS.has(nodes[index - 1].kind) || FLOW_SINK_KINDS.has(nodes[index - 1].kind));
      if (extra) y += dividerGap;
      const top = y;
      y += boxHeight(node) + gap;
      return top;
    });
    return { tops, height: Math.max(0, y - gap) };
  };

  const left = column(inputs);
  const right = column(outputs);
  const height = Math.max(left.height, right.height);
  const middle = height / 2;
  const leftTops = left.tops.map((top) => top + (height - left.height) / 2);
  const rightTops = right.tops.map((top) => top + (height - right.height) / 2);

  // Log scale: a pool of millions and a 0.17 fee both stay visible
  const largest = Math.max(1, ...[...inputs, ...outputs].map((node) => node.lovelace));
  const thickness = (lovelace: number) =>
    minBand + (maxBand - minBand) * Math.log10(1 + Math.max(0, lovelace)) / Math.log10(1 + largest);

  const stack = (nodes: FlowNode[]) => {
    const sizes = nodes.map((node) => thickness(node.lovelace));
    const total = sizes.reduce((sum, size) => sum + size, 0) + bandGap * Math.max(0, nodes.length - 1);
    let y = middle - total / 2;
    const starts = sizes.map((size) => {
      const start = y;
      y += size + bandGap;
      return start;
    });
    return { sizes, starts, total };
  };

  const leftStack = stack(inputs);
  const rightStack = stack(outputs);
  const barHeight = Math.max(leftStack.total, rightStack.total) + 14;

  const boxes: FlowBox[] = [
    ...inputs.map((node, index) => ({ node, side: 'in' as const, x: 0, y: leftTops[index], width: boxWidth, height: boxHeight(node) })),
    ...outputs.map((node, index) => ({ node, side: 'out' as const, x: width - boxWidth, y: rightTops[index], width: boxWidth, height: boxHeight(node) })),
  ];

  const bands: FlowBand[] = [
    ...inputs.map((node, index) => {
      const size = leftStack.sizes[index];
      return {
        key: node.key,
        kind: node.kind,
        side: 'in' as const,
        thickness: size,
        path: bandPath(boxWidth, leftTops[index] + anchorY - size / 2, center - barWidth / 2, leftStack.starts[index], size),
      };
    }),
    ...outputs.map((node, index) => {
      const size = rightStack.sizes[index];
      return {
        key: node.key,
        kind: node.kind,
        side: 'out' as const,
        thickness: size,
        path: bandPath(center + barWidth / 2, rightStack.starts[index], width - boxWidth, rightTops[index] + anchorY - size / 2, size),
      };
    }),
  ];

  const dividers: FlowLayout['dividers'] = [];
  const divider = (nodes: FlowNode[], tops: number[], side: 'in' | 'out') => {
    const index = nodes.findIndex((node, i) => i > 0 && (FLOW_SOURCE_KINDS.has(node.kind) || FLOW_SINK_KINDS.has(node.kind)));
    if (index > 0) {
      const x = side === 'in' ? 0 : width - boxWidth;
      dividers.push({ side, x1: x + 8, x2: x + boxWidth - 8, y: tops[index] - (gap + dividerGap) / 2 });
    }
  };
  divider(inputs, leftTops, 'in');
  divider(outputs, rightTops, 'out');

  return {
    width,
    height,
    boxes,
    bands,
    bar: { x: center - barWidth / 2, y: middle - barHeight / 2, width: barWidth, height: barHeight },
    dividers,
  };
}
