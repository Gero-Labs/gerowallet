/**
 * Bitcoin record → the chain-neutral flow model drawn by `TxFlowDiagram.vue`.
 *
 * Pure. Values are satoshis (the model's `lovelace` field holds the chain's base
 * unit). Value accounting: inputs (or newly mined coins) = outputs + fee.
 *
 * Bitcoin has no tokens, deposits, rewards, collateral or reference inputs, so
 * none of those nodes are ever produced and the diagram draws none of them.
 *
 * Script types: every address is an ordinary `own` / `other` node, never a
 * `script` ("contract") one. A P2TR address is the default single-key wallet
 * type and on chain looks the same whether it is spent by key or by script; a
 * P2SH address usually wraps a single-key P2WPKH; a P2WSH address is most often
 * a multisig vault. None of them is a contract in the Cardano sense, and naming
 * them by address type would be a guess for P2TR and P2SH, so the diagram
 * does not classify them.
 */
import type { UnifiedTransaction } from '@/chains/bitcoin/bitcoinTransactionParser';
import type { FlowKind, FlowNode, TxFlowModel } from '@/shared/utils/txFlow';

export type BitcoinFlowRecord = Pick<UnifiedTransaction, 'fee' | 'inputs' | 'outputs'>;

/** A coinbase input spends no output: Esplora gives it the all-zero txid and index 0xffffffff. */
const COINBASE_VOUT = 0xffffffff;
const NULL_TXID = /^0+$/;

export function isCoinbaseInput(input: { address?: string; txid?: string; vout?: number }): boolean {
  if (input.address) return false;
  return !input.txid || NULL_TXID.test(input.txid) || input.vout === COINBASE_VOUT;
}

const sats = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

function group(side: 'in' | 'out', ios: { address?: string; value?: number }[], own: ReadonlySet<string>): FlowNode[] {
  const nodes = new Map<string, FlowNode>();
  for (const io of ios) {
    const address = io.address ?? '';
    let kind: FlowKind = own.has(address) ? 'own' : 'other';
    // An output with no address pays a script with no standard address: OP_RETURN data
    if (!address && side === 'out') kind = 'data';
    const key = `${side}:${kind}:${address}`;
    let node = nodes.get(key);
    if (!node) {
      node = { key, kind, address, lovelace: 0, count: 0, tokens: [] };
      nodes.set(key, node);
    }
    node.count += 1;
    node.lovelace += sats(io.value);
  }
  return [...nodes.values()];
}

export function buildBitcoinTxFlow(
  tx: BitcoinFlowRecord | null | undefined,
  ownAddresses: ReadonlySet<string>,
): TxFlowModel | null {
  const inputs = tx?.inputs ?? [];
  const outputs = tx?.outputs ?? [];
  if (!outputs.length) return null;

  const outTotal = outputs.reduce((total, output) => total + sats(output.value), 0);
  const coinbase = inputs.length > 0 && inputs.every(isCoinbaseInput);
  const spent = inputs.filter((input) => !isCoinbaseInput(input));
  // Without a coinbase marker and without inputs there is nothing to draw from
  if (!coinbase && !spent.length) return null;

  const left: FlowNode[] = coinbase
    ? [{ key: 'src:coinbase', kind: 'coinbase', address: '', lovelace: outTotal, count: 1, tokens: [] }]
    : group('in', spent, ownAddresses);
  const right = group('out', outputs, ownAddresses);

  // A coinbase pays no fee: it collects the block's fees into its outputs
  let fee = coinbase ? 0 : sats(tx?.fee);
  if (!coinbase && tx?.fee === undefined) {
    const inTotal = spent.reduce((total, input) => total + sats(input.value), 0);
    fee = Math.max(0, inTotal - outTotal);
  }
  if (fee > 0) right.push({ key: 'src:fee', kind: 'fee', address: '', lovelace: fee, count: 1, tokens: [] });

  return { inputs: left, outputs: right, collateralCount: 0, referenceInputCount: 0 };
}
