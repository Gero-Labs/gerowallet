/**
 * Flow model (`txFlow.ts`) for a transaction still to be signed: the dApp
 * approval screens (popup `SignTx.vue`, side panel `DAppOverlay.vue`).
 *
 * A request carries only the CBOR, whose inputs are references with no value.
 * An input is resolved from the wallet's own UTxOs, the same list the approval
 * summary counts ("You pay"), so the two never disagree. Any other input
 * (someone else's UTxO, a script's) is one `unknown` node: no address, no
 * value, never drawn as 0 and never left out.
 *
 * Deposits come from the certificates and proposals themselves, never from a
 * gap between inputs and outputs: with an unknown input that gap means nothing.
 *
 * Display only. Pure: no Vue, no stores. Nothing here decides or gates signing.
 */
import { Cardano } from '@cardano-sdk/core';
import { inputRefOf } from './txIntentGuard';
import { certificateDeposit, type ApprovalDeposits } from './txApprovalSummary';
import { groupFlowIO, type FlowKind, type FlowNode, type TxFlowModel } from './txFlow';

export interface UnsignedFlowContext {
  /** bech32 addresses of the wallet's payment and change keys */
  ownAddresses: ReadonlySet<string>;
  /** The wallet's UTxOs (collateral included), as the approval summary is given them */
  ownUtxos: readonly Cardano.Utxo[] | undefined;
  /** Protocol deposits for the certificates that do not carry their own amount */
  deposits?: ApprovalDeposits;
}

interface RawIO {
  address: string;
  amount: { unit: string; quantity: string }[];
}

function toRawIO(out: Cardano.TxOut): RawIO {
  const amount = [{ unit: 'lovelace', quantity: String(out.value?.coins ?? 0n) }];
  for (const [unit, quantity] of out.value?.assets ?? new Map()) amount.push({ unit: String(unit), quantity: String(quantity) });
  return { address: String(out.address), amount };
}

const toNumber = (value: unknown): number => {
  try {
    const parsed = Number(BigInt(String(value ?? 0)));
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
};

const extra = (kind: FlowKind, lovelace: number): FlowNode => ({ key: `src:${kind}`, kind, address: '', lovelace, count: 1, tokens: [] });

export function buildUnsignedTxFlow(tx: Cardano.Tx | null | undefined, ctx: UnsignedFlowContext): TxFlowModel | null {
  const body = tx?.body;
  // A transaction marked invalid forfeits its collateral and creates none of its outputs.
  if (!body || tx?.isValid === false) return null;
  const inputs = body.inputs ?? [];
  const outputs = body.outputs ?? [];
  if (!inputs.length || !outputs.length) return null;

  const held = new Map<string, Cardano.TxOut>();
  for (const [txIn, txOut] of ctx.ownUtxos ?? []) held.set(inputRefOf(txIn), txOut);

  const resolved: RawIO[] = [];
  let unknownCount = 0;
  for (const input of inputs) {
    const out = held.get(inputRefOf(input));
    if (out) resolved.push(toRawIO(out));
    else unknownCount += 1;
  }

  const left = groupFlowIO('in', resolved, ctx.ownAddresses);
  if (unknownCount > 0) left.push({ key: 'in:unknown', kind: 'unknown', address: '', lovelace: 0, count: unknownCount, tokens: [] });
  const right = groupFlowIO('out', outputs.map(toRawIO), ctx.ownAddresses);

  let deposit = 0;
  let refund = 0;
  for (const cert of (body.certificates ?? []) as Cardano.Certificate[]) {
    const found = certificateDeposit(cert, ctx.deposits);
    if (found?.direction === 'paid') deposit += toNumber(found.lovelace);
    else if (found?.direction === 'refunded') refund += toNumber(found.lovelace);
  }
  for (const proposal of body.proposalProcedures ?? []) deposit += toNumber(proposal.deposit);

  const rewards = (body.withdrawals ?? []).reduce((total, withdrawal) => total + toNumber(withdrawal.quantity), 0);
  const fee = toNumber(body.fee);
  const donation = toNumber(body.donation);

  if (rewards > 0) left.push(extra('rewards', rewards));
  if (refund > 0) left.push(extra('refund', refund));
  if (fee > 0) right.push(extra('fee', fee));
  if (donation > 0) right.push(extra('donation', donation));
  if (deposit > 0) right.push(extra('deposit', deposit));

  return {
    inputs: left,
    outputs: right,
    collateralCount: body.collaterals?.length ?? 0,
    referenceInputCount: body.referenceInputs?.length ?? 0,
  };
}
