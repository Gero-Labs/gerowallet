import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import {
  buildTxFlow,
  collapseFlowNodes,
  elbowDownPath,
  elbowUpPath,
  isScriptAddress,
  layoutTxFlow,
  layoutTxFlowVertical,
  type FlowNode,
} from './txFlow';

const hash = (digit: string) => Hash28ByteBase16(digit.repeat(56));
const address = (payment: string, type = Cardano.CredentialType.KeyHash) =>
  Cardano.BaseAddress.fromCredentials(
    Cardano.NetworkId.Mainnet,
    { type, hash: hash(payment) },
    { type: Cardano.CredentialType.KeyHash, hash: hash('f') },
  ).toAddress().toBech32();

const OWN_A = address('1');
const OWN_B = address('2');
const OTHER = address('3');
const SCRIPT = address('4', Cardano.CredentialType.ScriptHash);
const own = new Set([OWN_A, OWN_B]);

const io = (addr: string, lovelace: number, tokens: Record<string, number> = {}) => ({
  address: addr,
  amount: [{ unit: 'lovelace', quantity: lovelace }, ...Object.entries(tokens).map(([unit, quantity]) => ({ unit, quantity }))],
});

describe('isScriptAddress', () => {
  it('tells a script payment credential from a key one', () => {
    expect(isScriptAddress(SCRIPT)).toBe(true);
    expect(isScriptAddress(OTHER)).toBe(false);
    expect(isScriptAddress('not an address')).toBe(false);
  });
});

describe('buildTxFlow', () => {
  it('draws nothing for a transaction whose scripts failed (only collateral moved)', () => {
    const failed = { isValid: false, utxo: { inputs: [io(OWN_A, 50_000_000)], outputs: [io(SCRIPT, 45_000_000)] }, body: { fee: 300_000 } };
    expect(buildTxFlow(failed, own)).toBeNull();
    expect(buildTxFlow({ ...failed, isValid: true }, own)).not.toBeNull();
  });

  it('returns null without both sides', () => {
    expect(buildTxFlow({ utxo: { inputs: [io(OWN_A, 1)], outputs: [] } }, own)).toBeNull();
    expect(buildTxFlow(null, own)).toBeNull();
  });

  it('groups UTxOs by address, sums lovelace and tokens, and keeps first-seen order', () => {
    const model = buildTxFlow({
      utxo: {
        inputs: [io(OWN_A, 10_000_000, { tokA: 5 }), io(OWN_B, 3_000_000), io(OWN_A, 2_000_000, { tokA: 1, tokB: 2 })],
        outputs: [io(OTHER, 14_800_000, { tokA: 6, tokB: 2 })],
      },
      body: { fee: 200_000 },
    }, own)!;

    expect(model.inputs.map((node) => [node.kind, node.address, node.count, node.lovelace])).toEqual([
      ['own', OWN_A, 2, 12_000_000],
      ['own', OWN_B, 1, 3_000_000],
    ]);
    expect(model.inputs[0].tokens).toEqual([{ unit: 'tokA', quantity: 6 }, { unit: 'tokB', quantity: 2 }]);
    expect(model.outputs.map((node) => node.kind)).toEqual(['other', 'fee']);
    expect(model.outputs[1].lovelace).toBe(200_000);
  });

  it('marks script addresses', () => {
    const model = buildTxFlow({ utxo: { inputs: [io(SCRIPT, 5_000_000)], outputs: [io(OWN_A, 4_800_000)] }, body: { fee: 200_000 } }, own)!;
    expect(model.inputs[0].kind).toBe('script');
  });

  it('shows the unaccounted gap as a deposit, and a negative one as a refund', () => {
    const paid = buildTxFlow({ utxo: { inputs: [io(OWN_A, 50_000_000)], outputs: [io(OWN_A, 47_830_000)] }, body: { fee: 170_000 } }, own)!;
    expect(paid.outputs.map((node) => [node.kind, node.lovelace])).toEqual([['own', 47_830_000], ['fee', 170_000], ['deposit', 2_000_000]]);

    const back = buildTxFlow({ utxo: { inputs: [io(OWN_A, 10_000_000)], outputs: [io(OWN_A, 11_800_000)] }, body: { fee: 200_000 } }, own)!;
    expect(back.inputs.map((node) => [node.kind, node.lovelace])).toEqual([['own', 10_000_000], ['refund', 2_000_000]]);
  });

  it('adds withdrawn rewards as a source and accounts for them', () => {
    const model = buildTxFlow({
      utxo: { inputs: [io(OWN_A, 10_000_000)], outputs: [io(OWN_A, 14_800_000)] },
      body: { fee: 200_000, withdrawals: [{ quantity: 5_000_000n }] },
    }, own)!;
    expect(model.inputs.map((node) => node.kind)).toEqual(['own', 'rewards']);
    expect(model.outputs.map((node) => node.kind)).toEqual(['own', 'fee']);
  });

  it('invents no deposit when an input has no amounts (a record still being filled)', () => {
    const model = buildTxFlow({ utxo: { inputs: [{ address: OWN_A }], outputs: [io(OTHER, 5_000_000)] }, body: { fee: 200_000 } }, own)!;
    expect(model.inputs.map((node) => node.kind)).toEqual(['own']);
    expect(model.outputs.map((node) => node.kind)).toEqual(['other', 'fee']);
  });

  it('counts collateral and reference inputs', () => {
    const model = buildTxFlow({
      utxo: { inputs: [io(OWN_A, 5_000_000)], outputs: [io(OWN_A, 4_800_000)] },
      body: { fee: 200_000, collaterals: [{}], referenceInputs: [{}, {}] },
    }, own)!;
    expect([model.collateralCount, model.referenceInputCount]).toEqual([1, 2]);
  });
});

const node = (key: string, kind: FlowNode['kind'], lovelace: number, tokens: FlowNode['tokens'] = []): FlowNode =>
  ({ key: `in:${key}`, kind, address: key, lovelace, count: 1, tokens });

describe('collapseFlowNodes', () => {
  const many = [
    node('pool', 'script', 1_000_000_000),
    node('mine', 'own', 254_000_000),
    ...Array.from({ length: 8 }, (_, index) => node(`o${index}`, 'script', (index + 1) * 1_000_000, [{ unit: 'MIN', quantity: 1 }])),
    { ...node('fee', 'fee', 900_000), key: 'src:fee' },
  ];

  it('leaves short columns alone, and everything when open', () => {
    expect(collapseFlowNodes(many.slice(0, 4))).toHaveLength(4);
    expect(collapseFlowNodes(many, 5, true)).toHaveLength(many.length);
  });

  it('keeps own nodes and the largest others in their order, folds the rest, never folds sinks', () => {
    const shown = collapseFlowNodes(many, 5);
    expect(shown.map((item) => item.address || item.kind)).toEqual(['pool', 'mine', 'o6', 'o7', 'more', 'fee']);
    const more = shown[4];
    expect(more.count).toBe(6);
    expect(more.lovelace).toBe((1 + 2 + 3 + 4 + 5 + 6) * 1_000_000);
    expect(more.tokens).toEqual([{ unit: 'MIN', quantity: 6 }]);
  });
});

describe('layoutTxFlow', () => {
  const inputs = [node('a', 'own', 120_000_000, [{ unit: 'x', quantity: 1 }]), node('b', 'own', 35_000_000)];
  const outputs = [
    { ...node('c', 'other', 100_000_000), key: 'out:c' },
    { ...node('d', 'own', 54_820_000), key: 'out:d' },
    { ...node('fee', 'fee', 180_000), key: 'src:fee' },
  ];
  const layout = layoutTxFlow(inputs, outputs, { width: 600, boxHeight: (item) => (item.tokens.length ? 72 : 50) });

  it('puts inputs on the left, outputs on the right, one band each', () => {
    expect(layout.boxes.filter((box) => box.side === 'in').every((box) => box.x === 0)).toBe(true);
    expect(layout.boxes.filter((box) => box.side === 'out').every((box) => box.x + box.width === 600)).toBe(true);
    expect(layout.bands).toHaveLength(5);
    expect(layout.bands[0].path.startsWith(`M${layout.boxes[0].width},`)).toBe(true);
  });

  it('sizes the taller column and centres the other', () => {
    // right: 50 + 10 + 50 + 10 (divider) + 10 + 50
    expect(layout.height).toBe(180);
    const left = layout.boxes.filter((box) => box.side === 'in');
    expect(left[0].y).toBe((180 - (72 + 10 + 50)) / 2);
  });

  it('draws a divider above the fee, and keeps the smallest band visible', () => {
    expect(layout.dividers).toHaveLength(1);
    expect(layout.dividers[0].side).toBe('out');
    expect(Math.min(...layout.bands.map((band) => band.thickness))).toBeGreaterThanOrEqual(3);
  });

  it('keeps boxes inside narrow widths', () => {
    const narrow = layoutTxFlow(inputs, outputs, { width: 320, boxHeight: () => 50 });
    expect(narrow.boxes[0].width).toBe(120);
    expect(narrow.bar.x).toBe(160 - 6);
  });
});

describe('layoutTxFlowVertical', () => {
  const inputs = [node('a', 'own', 120_000_000, [{ unit: 'x', quantity: 1 }]), node('b', 'own', 35_000_000)];
  const outputs = [
    { ...node('c', 'other', 100_000_000), key: 'out:c' },
    { ...node('d', 'own', 54_820_000), key: 'out:d' },
    { ...node('fee', 'fee', 180_000), key: 'src:fee' },
  ];
  const boxHeight = (item: FlowNode) => (item.tokens.length ? 72 : 50);
  const layout = layoutTxFlowVertical(inputs, outputs, { width: 340, boxHeight });
  const ins = layout.boxes.filter((box) => box.side === 'in');
  const outs = layout.boxes.filter((box) => box.side === 'out');
  const laneX = (path: string) => Number(/L([\d.]+),/.exec(path)?.[1]);

  it('stacks inputs above a full-width bar and outputs below it', () => {
    // inputs: 72 + 8 + 50; bar after a 20 gap
    expect(ins.map((box) => box.y)).toEqual([0, 80]);
    expect(layout.bar).toEqual({ x: 0, y: 150, width: 340, height: 12 });
    const outTop = 150 + 12 + 20;
    // outputs: 50 + 8 + 50 + 10 (divider) + 50
    expect(outs.map((box) => box.y)).toEqual([outTop, outTop + 58, outTop + 126]);
    expect(layout.height).toBe(outTop + 176);
    expect(ins.every((box) => box.y + box.height <= layout.bar.y)).toBe(true);
    expect(outs.every((box) => box.y >= layout.bar.y + layout.bar.height)).toBe(true);
  });

  it('fills the width right of the band gutter', () => {
    const gutter = layout.boxes[0].x;
    expect(gutter).toBeGreaterThanOrEqual(32);
    expect(layout.boxes.every((box) => box.x === gutter && box.x + box.width === 340)).toBe(true);
  });

  it('runs one band per box between the box and the bar', () => {
    expect(layout.bands.map((band) => band.key)).toEqual([...inputs, ...outputs].map((item) => item.key));
    const gutter = layout.boxes[0].x;
    for (const band of layout.bands) {
      const xs = [...band.path.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((match) => Number(match[1]));
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeLessThanOrEqual(gutter);
    }
    // inputs end on the bar's top, outputs start on its bottom
    expect(layout.bands[0].path).toContain(`,${layout.bar.y}L`);
    expect(layout.bands[2].path.startsWith(`M${laneX(layout.bands[2].path)},${layout.bar.y + layout.bar.height}L`)).toBe(true);
  });

  it('gives the top input the outer lane and the top output the inner one, so bands never cross', () => {
    const [a, b, c, d, fee] = layout.bands.map((band) => laneX(band.path));
    expect(a).toBeLessThan(b);
    expect(c).toBeGreaterThan(d);
    expect(d).toBeGreaterThan(fee);
  });

  it('draws a divider above the fee, right of the gutter', () => {
    expect(layout.dividers).toHaveLength(1);
    expect(layout.dividers[0].side).toBe('out');
    expect(layout.dividers[0].x1).toBe(layout.boxes[0].x + 8);
    expect(layout.dividers[0].y).toBe(outs[2].y - 9);
  });

  it('thins bands so many of them never take more than the gutter share', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({ ...node(`m${index}`, 'other', 1e12), key: `out:m${index}` }));
    const wide = layoutTxFlowVertical(inputs, many, { width: 300, boxHeight: () => 50 });
    expect(wide.boxes[0].x).toBeLessThanOrEqual(300 * 0.3 + 1);
    expect(Math.min(...wide.bands.map((band) => band.thickness))).toBeGreaterThanOrEqual(2);
  });
});

describe('elbow paths', () => {
  it('start and end on the edges they join', () => {
    expect(elbowDownPath(60, 10, 20, 8, 200)).toMatch(/^M60,10C.*L20,200L28,200L.*60,18Z$/);
    expect(elbowUpPath(60, 300, 20, 8, 212)).toMatch(/^M20,212L.*60,308L60,300C.*L28,212Z$/);
  });
});
