import { describe, expect, it } from 'vitest';
import { decodeVaultTransaction } from './decodeVaultTx';
import {
  bytes, COLLATERAL_TX, coinAnd, entry, EXECUTOR_ADDRESS, EXECUTOR_KEY, fundSource, GOLD, inputSet, legacyOutput, map, PAYEE_ADDRESS,
  POLICY_1, uint, withCollateral,
} from './__fixtures__/vaultTxs';

const decode = (tx: string) => decodeVaultTransaction(tx, { networkId: 0, inputSources: [fundSource()] });
const refusalsOf = async (tx: string) => {
  const result = await decode(tx);
  if (result.status === 'decoded') throw new Error('decoded, expected a refusal');
  return result.refusals;
};
const goldBack = (lovelace: number) => coinAnd(lovelace, map([bytes(POLICY_1), map([bytes(GOLD), uint(7)])]));

describe('collateral', () => {
  it('is modelled as the most the executor can lose: inputs less a return to the executor', async () => {
    const result = await decode(COLLATERAL_TX);
    expect(result.status).toBe('decoded');
    if (result.status !== 'decoded') return;
    const collateral = result.summary.collateral;
    expect(collateral).toMatchObject({
      payer: { kind: 'key', hash: EXECUTOR_KEY },
      totalCollateral: 500_000n,
      forfeitLovelace: 500_000n,
      returnPaysPayer: true,
      maxLossLovelace: 500_000n,
    });
    expect(collateral?.inputs.map((i) => [i.index, i.output.value.lovelace])).toEqual([[2, 5_000_000n]]);
    expect(collateral?.collateralReturn?.address.payment).toEqual({ kind: 'key', hash: EXECUTOR_KEY });
    // Collateral is not part of what the transaction spends when its scripts succeed.
    expect(result.summary.inputs).toHaveLength(1);
  });

  it('without a total, the inputs less the return', async () => {
    const result = await decode(withCollateral(entry(13, inputSet(2)), entry(16, legacyOutput(EXECUTOR_ADDRESS, uint(4_000_000)))));
    expect(result.status === 'decoded' && result.summary.collateral).toMatchObject({ totalCollateral: null, forfeitLovelace: 1_000_000n, maxLossLovelace: 1_000_000n });
  });

  it('without a return, all of it', async () => {
    const result = await decode(withCollateral(entry(13, inputSet(2))));
    expect(result.status === 'decoded' && result.summary.collateral).toMatchObject({ collateralReturn: null, forfeitLovelace: 5_000_000n, maxLossLovelace: 5_000_000n, returnPaysPayer: false });
  });

  it('a return to someone else is lost to the executor too', async () => {
    const result = await decode(withCollateral(entry(13, inputSet(2)), entry(16, legacyOutput(PAYEE_ADDRESS, uint(4_500_000))), entry(17, uint(500_000))));
    expect(result.status === 'decoded' && result.summary.collateral).toMatchObject({ forfeitLovelace: 500_000n, returnPaysPayer: false, maxLossLovelace: 5_000_000n });
  });

  it('tokens in the collateral are fine when the return gives them back to the executor', async () => {
    const result = await decode(withCollateral(entry(13, inputSet(4)), entry(16, legacyOutput(EXECUTOR_ADDRESS, goldBack(2_700_000))), entry(17, uint(300_000))));
    expect(result.status === 'decoded' && result.summary.collateral).toMatchObject({ forfeitLovelace: 300_000n, maxLossLovelace: 300_000n });
  });

  it.each([
    ['tokens with no return', withCollateral(entry(13, inputSet(4))), [{ code: 'collateral_loss_not_ada', path: 'body.13' }]],
    ['tokens returned to someone else', withCollateral(entry(13, inputSet(4)), entry(16, legacyOutput(PAYEE_ADDRESS, goldBack(2_700_000)))), [{ code: 'collateral_loss_not_ada', path: 'body.13' }]],
    ['tokens kept back', withCollateral(entry(13, inputSet(4)), entry(16, legacyOutput(EXECUTOR_ADDRESS, uint(2_700_000)))), [{ code: 'collateral_loss_not_ada', path: 'body.13' }]],
    ['two payment keys', withCollateral(entry(13, inputSet(2, 6))), [{ code: 'collateral_multiple_payers', path: 'body.13[1]' }]],
    ['a script-locked input', withCollateral(entry(13, inputSet(5))), [{ code: 'collateral_input_script_locked', path: 'body.13[0]' }]],
    ['a total that is not inputs less return', withCollateral(entry(13, inputSet(2)), entry(16, legacyOutput(EXECUTOR_ADDRESS, uint(4_500_000))), entry(17, uint(400_000))), [{ code: 'collateral_inconsistent', path: 'body.17', detail: 'total_mismatch' }]],
    ['a return larger than the inputs', withCollateral(entry(13, inputSet(2)), entry(16, legacyOutput(EXECUTOR_ADDRESS, uint(6_000_000)))), [{ code: 'collateral_inconsistent', path: 'body.16', detail: 'return_exceeds_inputs' }]],
    ['a return without inputs', withCollateral(entry(16, legacyOutput(EXECUTOR_ADDRESS, uint(1_000_000)))), [{ code: 'collateral_inconsistent', path: 'body.16', detail: 'return_without_inputs' }]],
    ['a total without inputs', withCollateral(entry(17, uint(1_000_000))), [{ code: 'collateral_inconsistent', path: 'body.17', detail: 'total_without_inputs' }]],
  ])('refuses %s', async (_, tx, expected) => {
    expect(await refusalsOf(tx)).toEqual(expected);
  });
});
