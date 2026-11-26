import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { collapseFlowNodes } from './txFlow';
import { buildUnsignedTxFlow, type UnsignedFlowContext } from './txFlowUnsigned';

const OWN_ADDR = 'addr_test1qpdmx56dml9qtej5vxhejju492w9pfv7j9270wjh0pfe9hdzqxa4r35qhuqx29n693k4gqukhk3lfw37xkp4egvh6raq4d4rzj';
const CHANGE_ADDR = 'addr_test1qqy44ytv354nqrs0f3hfsecj45w623wgqskt7nx84qd8v6lgxeg90kc8dfzpcg9xl8nuhvdesgq5cz6ejq83vk60hpns2c2kwh';
const EXT_ADDR = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x';
const TX_A = 'a'.repeat(64);
const TX_B = 'b'.repeat(64);
const TOKEN = `${'c'.repeat(56)}4d494e`;
const STAKE_HASH = 'e'.repeat(56);

const ref = (txId: string, index: number) => ({ txId, index }) as unknown as Cardano.TxIn;
const out = (address: string, coins: bigint, assets?: Map<string, bigint>) =>
  ({ address, value: { coins, ...(assets ? { assets } : {}) } }) as unknown as Cardano.TxOut;
const utxo = (txId: string, index: number, address: string, coins: bigint, assets?: Map<string, bigint>): Cardano.Utxo =>
  [{ ...ref(txId, index), address } as unknown as Cardano.HydratedTxIn, out(address, coins, assets)];
const tx = (body: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ id: TX_A, body: { inputs: [], outputs: [], fee: 200_000n, ...body }, witness: {}, ...extra }) as unknown as Cardano.Tx;

const ctx = (over: Partial<UnsignedFlowContext> = {}): UnsignedFlowContext => ({
  ownAddresses: new Set([OWN_ADDR, CHANGE_ADDR]),
  ownUtxos: [utxo(TX_A, 0, OWN_ADDR, 10_000_000n, new Map([[TOKEN, 5n]])), utxo(TX_A, 1, CHANGE_ADDR, 3_000_000n)],
  ...over,
});

describe('buildUnsignedTxFlow', () => {
  it('resolves every input from the wallet UTxOs and draws outputs, fee and token values', () => {
    const model = buildUnsignedTxFlow(tx({
      inputs: [ref(TX_A, 0), ref(TX_A, 1)],
      outputs: [out(EXT_ADDR, 4_000_000n, new Map([[TOKEN, 5n]])), out(CHANGE_ADDR, 8_800_000n)],
    }), ctx());
    expect(model).not.toBeNull();
    expect(model!.inputs.map((node) => [node.kind, node.lovelace, node.count])).toEqual([['own', 10_000_000, 1], ['own', 3_000_000, 1]]);
    expect(model!.inputs[0].tokens).toEqual([{ unit: TOKEN, quantity: 5 }]);
    expect(model!.outputs.map((node) => [node.kind, node.lovelace])).toEqual([['other', 4_000_000], ['own', 8_800_000], ['fee', 200_000]]);
    expect(model!.outputs[0].tokens).toEqual([{ unit: TOKEN, quantity: 5 }]);
    expect(model!.inputs.some((node) => node.kind === 'unknown')).toBe(false);
  });

  it('shows an input the wallet cannot resolve as one unknown box, never as 0 and never omitted', () => {
    const model = buildUnsignedTxFlow(tx({
      inputs: [ref(TX_A, 0), ref(TX_B, 3), ref(TX_B, 4)],
      outputs: [out(OWN_ADDR, 50_000_000n)],
    }), ctx());
    const unknown = model!.inputs.filter((node) => node.kind === 'unknown');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]).toMatchObject({ key: 'in:unknown', address: '', count: 2, tokens: [] });
    // Its value is unknown: the resolved own input keeps its own amount and nothing pretends to fill the gap.
    expect(model!.inputs.find((node) => node.kind === 'own')?.lovelace).toBe(10_000_000);
    expect(model!.outputs.map((node) => node.kind)).toEqual(['own', 'fee']);
  });

  it('with no wallet UTxOs at all every input is unknown', () => {
    const model = buildUnsignedTxFlow(tx({ inputs: [ref(TX_A, 0), ref(TX_A, 1)], outputs: [out(EXT_ADDR, 1_000_000n)] }), ctx({ ownUtxos: undefined }));
    expect(model!.inputs).toEqual([{ key: 'in:unknown', kind: 'unknown', address: '', lovelace: 0, count: 2, tokens: [] }]);
  });

  it('never infers a deposit or a refund from the gap between inputs and outputs', () => {
    // 10 ADA in, 3 ADA out: a stored-record flow would call the 6.8 ADA gap a deposit.
    const model = buildUnsignedTxFlow(tx({ inputs: [ref(TX_A, 0), ref(TX_B, 0)], outputs: [out(EXT_ADDR, 3_000_000n)] }), ctx());
    expect(model!.outputs.map((node) => node.kind)).toEqual(['other', 'fee']);
    expect(model!.inputs.map((node) => node.kind)).toEqual(['own', 'unknown']);
  });

  it('takes deposits and refunds from the certificates and proposals', () => {
    const stakeCredential = { type: Cardano.CredentialType.KeyHash, hash: STAKE_HASH };
    const model = buildUnsignedTxFlow(tx({
      inputs: [ref(TX_A, 0)],
      outputs: [out(CHANGE_ADDR, 1_000_000n)],
      certificates: [
        { __typename: Cardano.CertificateType.Registration, stakeCredential, deposit: 2_000_000n },
        // Pre-Conway: the amount is the protocol's keyDeposit
        { __typename: Cardano.CertificateType.StakeDeregistration, stakeCredential },
        { __typename: Cardano.CertificateType.UnregisterDelegateRepresentative, dRepCredential: stakeCredential, deposit: 500_000_000n },
      ],
      proposalProcedures: [{ deposit: 100_000_000_000n, rewardAccount: 'stake_test1x', governanceAction: { __typename: 'info_action' }, anchor: {} }],
    }), ctx({ deposits: { stakeKey: 2_000_000n } }));
    expect(model!.inputs.find((node) => node.kind === 'refund')?.lovelace).toBe(502_000_000);
    expect(model!.outputs.find((node) => node.kind === 'deposit')?.lovelace).toBe(100_002_000_000);
  });

  it('shows withdrawals as rewards and a donation as a sink, with collateral and reference inputs counted', () => {
    const model = buildUnsignedTxFlow(tx({
      inputs: [ref(TX_A, 1)],
      outputs: [out(CHANGE_ADDR, 4_000_000n)],
      withdrawals: [{ stakeAddress: 'stake_test1x', quantity: 1_500_000n }],
      donation: 300_000n,
      collaterals: [ref(TX_A, 1)],
      referenceInputs: [ref(TX_B, 0), ref(TX_B, 1)],
    }), ctx());
    expect(model!.inputs.map((node) => [node.kind, node.lovelace])).toEqual([['own', 3_000_000], ['rewards', 1_500_000]]);
    expect(model!.outputs.map((node) => node.kind)).toEqual(['own', 'fee', 'donation']);
    expect(model!.collateralCount).toBe(1);
    expect(model!.referenceInputCount).toBe(2);
  });

  it('draws nothing for a missing body, no inputs or outputs, or a transaction marked invalid', () => {
    expect(buildUnsignedTxFlow(null, ctx())).toBeNull();
    expect(buildUnsignedTxFlow({} as Cardano.Tx, ctx())).toBeNull();
    expect(buildUnsignedTxFlow(tx({ inputs: [ref(TX_A, 0)] }), ctx())).toBeNull();
    expect(buildUnsignedTxFlow(tx({ outputs: [out(OWN_ADDR, 1n)] }), ctx())).toBeNull();
    expect(buildUnsignedTxFlow(tx({ inputs: [ref(TX_A, 0)], outputs: [out(OWN_ADDR, 1n)] }, { isValid: false }), ctx())).toBeNull();
  });

  it('never folds the unknown input into "+N more"', () => {
    const model = buildUnsignedTxFlow(tx({
      inputs: [ref(TX_B, 9), ...Array.from({ length: 8 }, (_, index) => ref(TX_A, 10 + index))],
      outputs: [out(OWN_ADDR, 1_000_000n)],
    }), ctx({
      ownAddresses: new Set([OWN_ADDR]),
      ownUtxos: Array.from({ length: 8 }, (_, index) => utxo(TX_A, 10 + index, EXT_ADDR.slice(0, -2) + String(index).padStart(2, '0'), BigInt(index + 1) * 1_000_000n)),
    }));
    const shown = collapseFlowNodes(model!.inputs, 5);
    expect(shown.some((node) => node.kind === 'unknown')).toBe(true);
    expect(shown.some((node) => node.kind === 'more')).toBe(true);
  });
});
