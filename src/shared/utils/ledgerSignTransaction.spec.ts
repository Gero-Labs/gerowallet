import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import * as Crypto from '@cardano-sdk/crypto';
import { LedgerKeyAgent } from '@cardano-sdk/hardware-ledger';
import {
  AddressType,
  CommunicationType,
  KeyPurpose,
  KeyRole,
  TxInId,
  type SignTransactionContext,
} from '@cardano-sdk/key-management';
import {
  DatumType,
  type SignedTransactionData,
  type SignTransactionRequest,
  type TxOutput,
} from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { INLINE_DATUM_UTXOS } from '@/shared/utils/__fixtures__/mainnetDatumUtxos';
import {
  COLLATERAL_DATUM,
  COLLATERAL_RETURN_TX,
  COLLATERAL_RETURN_TX_ID,
  COLLATERAL_SCRIPT,
  inlineDatumOption,
  NO_COLLATERAL_TX,
  NO_COLLATERAL_TX_ID,
  OUTPUT_DATUM,
  OUTPUT_SCRIPT,
  OWN_TX,
  OWN_TX_ID,
  REFERENCE_SCRIPT_TX,
  REFERENCE_SCRIPT_TX_ID,
  SCRIPT_REF_TX,
  SCRIPT_REF_TX_ID,
  SDK_ENCODED_TX,
  SDK_ENCODED_TX_ID,
  TESTNET_TX,
  TESTNET_TX_ID,
  TESTNET_WALLET_ADDRESS,
  WALLET_ACCOUNT_XPUB,
  WALLET_ADDRESS,
} from '@/shared/utils/__fixtures__/handAssembledTxs';
import { signLedgerTransaction } from './ledgerSignTransaction';

/** Signing a transaction a dApp built: the wallet owns none of it. */
const CONTEXT: SignTransactionContext = { knownAddresses: [], txInKeyPathMap: {} };
/** Signing OWN_TX: the wallet's input (aa…#0) and change address. */
const OWN_CONTEXT: SignTransactionContext = {
  knownAddresses: [
    {
      accountIndex: 0,
      address: Cardano.PaymentAddress(WALLET_ADDRESS),
      index: 0,
      networkId: Cardano.NetworkId.Mainnet,
      rewardAccount: Cardano.RewardAccount('stake1uy3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsflrjnr'),
      stakeKeyDerivationPath: { index: 0, role: KeyRole.Stake },
      type: AddressType.External,
    },
  ],
  txInKeyPathMap: {
    [TxInId({ index: 0, txId: Cardano.TransactionId('aa'.repeat(32)) })]: { index: 0, role: KeyRole.External },
  },
};

/** Signing TESTNET_TX: the wallet's input (aa…#0) and its testnet change address. */
const TESTNET_CONTEXT: SignTransactionContext = {
  knownAddresses: [
    {
      ...OWN_CONTEXT.knownAddresses[0],
      address: Cardano.PaymentAddress(TESTNET_WALLET_ADDRESS),
      networkId: Cardano.NetworkId.Testnet,
      rewardAccount: Cardano.RewardAccount('stake_test1uq3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsw4fsh7'),
    },
  ],
  txInKeyPathMap: OWN_CONTEXT.txInKeyPathMap,
};

let bip32Ed25519: Crypto.Bip32Ed25519;
/** The wallet's account on the Ledger, for a network. */
const ledgerAgent = (chainId: Cardano.ChainId) =>
  new LedgerKeyAgent(
    {
      accountIndex: 0,
      chainId,
      communicationType: CommunicationType.Web,
      extendedAccountPublicKey: Crypto.Bip32PublicKeyHex(WALLET_ACCOUNT_XPUB),
      purpose: KeyPurpose.STANDARD,
    },
    { bip32Ed25519, logger: console },
  );

let agent: LedgerKeyAgent;
beforeAll(async () => {
  bip32Ed25519 = await Crypto.SodiumBip32Ed25519.create();
  agent = ledgerAgent(Cardano.ChainIds.Mainnet);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** The device: records each request it gets, and answers it with `answer`. */
const device = (answer: (request: SignTransactionRequest) => Promise<SignedTransactionData>) => {
  const signTransaction = vi.fn(answer);
  // The agent reconnects to the device before it signs; this hands it the double instead.
  vi.spyOn(LedgerKeyAgent, 'checkDeviceConnection').mockResolvedValue({ signTransaction } as never);
  return signTransaction;
};
/** A device that serializes the body it was sent back to the same bytes: the tx id comes back. */
const signingDevice = (txId: string) =>
  device(async () => ({ txHashHex: txId, witnesses: [], auxiliaryDataSupplement: null }));

const body = (txCbor: string) => Serialization.Transaction.fromCbor(Serialization.TxCBOR(txCbor)).body();
const inlineDatumHex = (output: TxOutput): string | undefined =>
  'datum' in output && output.datum?.type === DatumType.INLINE ? output.datum.datumHex : undefined;

describe('signLedgerTransaction: outputs reach the device as the transaction holds them', () => {
  it.each(INLINE_DATUM_UTXOS)('inline datums of $nexusRow.txHash', async ({ nexusRow, datumCbor, txCbor }) => {
    const signTransaction = signingDevice(nexusRow.txHash);
    await signLedgerTransaction(agent, body(txCbor), CONTEXT);
    const datums = signTransaction.mock.lastCall![0].tx.outputs.map(inlineDatumHex);

    // The UTxO the fixture cut out of this transaction.
    expect(datums[nexusRow.txIndex]).toBe(datumCbor);
    // Outputs 0-5 hold inline datums, all definite-length lists; output 6 holds none.
    expect(datums.map(Boolean)).toEqual([true, true, true, true, true, true, false]);
    expect(datums.filter((datum) => datum && !txCbor.includes(inlineDatumOption(datum)))).toEqual([]);
  });

  it('reference scripts, and the collateral return’s datum and script', async () => {
    const signTransaction = signingDevice(SCRIPT_REF_TX_ID);
    await signLedgerTransaction(agent, body(SCRIPT_REF_TX), CONTEXT);
    const { outputs, collateralOutput } = signTransaction.mock.lastCall![0].tx;

    expect(outputs[0]).toMatchObject({
      datum: { type: DatumType.INLINE, datumHex: OUTPUT_DATUM },
      referenceScriptHex: OUTPUT_SCRIPT,
    });
    expect(collateralOutput).toMatchObject({
      datum: { type: DatumType.INLINE, datumHex: COLLATERAL_DATUM },
      referenceScriptHex: COLLATERAL_SCRIPT,
    });
  });

  it('a reference script, when the datum needs nothing', async () => {
    const signTransaction = signingDevice(REFERENCE_SCRIPT_TX_ID);
    await signLedgerTransaction(agent, body(REFERENCE_SCRIPT_TX), CONTEXT);

    expect(signTransaction.mock.lastCall![0].tx.outputs[0]).toMatchObject({ referenceScriptHex: OUTPUT_SCRIPT });
  });

  it('a collateral return’s datum and script, when the outputs need nothing', async () => {
    const signTransaction = signingDevice(COLLATERAL_RETURN_TX_ID);
    await signLedgerTransaction(agent, body(COLLATERAL_RETURN_TX), CONTEXT);

    expect(signTransaction.mock.lastCall![0].tx.collateralOutput).toMatchObject({
      datum: { type: DatumType.INLINE, datumHex: COLLATERAL_DATUM },
      referenceScriptHex: COLLATERAL_SCRIPT,
    });
  });
});

describe('signLedgerTransaction: a testnet body’s network id, 0', () => {
  it('reaches the device', async () => {
    const signTransaction = signingDevice(TESTNET_TX_ID);
    await signLedgerTransaction(ledgerAgent(Cardano.ChainIds.Preprod), body(TESTNET_TX), TESTNET_CONTEXT);

    expect(signTransaction.mock.lastCall![0].tx).toMatchObject({
      includeNetworkId: true,
      network: { networkId: 0, protocolMagic: 1 },
    });
  });

  it('is all that differs from what the agent asks for', async () => {
    const signTransaction = signingDevice(TESTNET_TX_ID);
    const preprodAgent = ledgerAgent(Cardano.ChainIds.Preprod);

    await preprodAgent.signTransaction(body(TESTNET_TX), TESTNET_CONTEXT);
    await signLedgerTransaction(preprodAgent, body(TESTNET_TX), TESTNET_CONTEXT);

    const [agentRequest, request] = signTransaction.mock.calls.map(([{ tx, ...sent }]) => ({
      ...sent,
      tx: { ...tx, includeNetworkId: 'compared above' },
    }));
    expect(request).toEqual(agentRequest);
  });
});

describe('signLedgerTransaction: otherwise LedgerKeyAgent.signTransaction', () => {
  it('leaves a transaction whose outputs the agent maps byte for byte to the agent', async () => {
    signingDevice(SDK_ENCODED_TX_ID);
    const agentSignTransaction = vi.spyOn(agent, 'signTransaction');
    const txBody = body(SDK_ENCODED_TX);

    await signLedgerTransaction(agent, txBody, CONTEXT);

    expect(agentSignTransaction).toHaveBeenCalledWith(txBody, CONTEXT);
  });

  /** The request, less what signLedgerTransaction replaces: inline datum and reference script bytes. */
  const withoutOutputBytes = ({ tx, ...request }: SignTransactionRequest) => {
    const strip = (output?: TxOutput | null) =>
      output && {
        ...output,
        datum: inlineDatumHex(output) ? 'inline' : (output as { datum?: unknown }).datum,
        referenceScriptHex: (output as { referenceScriptHex?: string | null }).referenceScriptHex ? 'script' : undefined,
      };
    return { ...request, tx: { ...tx, outputs: tx.outputs.map(strip), collateralOutput: strip(tx.collateralOutput) } };
  };

  const TXS: [string, string, string, SignTransactionContext][] = [
    ...INLINE_DATUM_UTXOS.map(({ nexusRow, txCbor }): [string, string, string, SignTransactionContext] => [
      nexusRow.txHash,
      txCbor,
      nexusRow.txHash,
      CONTEXT,
    ]),
    ['a Plutus transaction with a collateral return', SCRIPT_REF_TX, SCRIPT_REF_TX_ID, CONTEXT],
    ['a multisig-mode transaction', NO_COLLATERAL_TX, NO_COLLATERAL_TX_ID, CONTEXT],
    ['the wallet’s own transaction (input, change, DRep registration)', OWN_TX, OWN_TX_ID, OWN_CONTEXT],
  ];

  it.each(TXS)('asks the device what the agent asks for %s, datum and script bytes aside', async (_, txCbor, txId, context) => {
    const signTransaction = signingDevice(txId);

    await agent.signTransaction(body(txCbor), context);
    await signLedgerTransaction(agent, body(txCbor), context);

    const [agentRequest, request] = signTransaction.mock.calls.map(([sent]) => withoutOutputBytes(sent));
    expect(request).toEqual(agentRequest);
    const [agentReconnect, reconnect] = vi.mocked(LedgerKeyAgent.checkDeviceConnection).mock.calls;
    expect(reconnect).toEqual(agentReconnect);
  });

  it('maps the device’s witnesses to the keys the agent maps them to', async () => {
    const hardened = (index: number) => index + 0x80000000;
    const witnesses = [
      { path: [hardened(1852), hardened(1815), hardened(0), 0, 3], witnessSignatureHex: 'ab'.repeat(64) },
      { path: [hardened(1852), hardened(1815), hardened(0), 2, 0], witnessSignatureHex: 'cd'.repeat(64) },
    ];
    device(async () => ({ txHashHex: SCRIPT_REF_TX_ID, witnesses, auxiliaryDataSupplement: null }));

    const agentSignatures = await agent.signTransaction(body(SCRIPT_REF_TX), CONTEXT);
    const signatures = await signLedgerTransaction(agent, body(SCRIPT_REF_TX), CONTEXT);

    expect([...signatures.values()]).toEqual(['ab'.repeat(64), 'cd'.repeat(64)]);
    expect(signatures).toEqual(agentSignatures);
  });

  it.each([
    ['the user declines on the device', () => Promise.reject(Object.assign(new Error('Action rejected by user'), { code: 28169 }))],
    ['the transport fails', () => Promise.reject(new Error('Device disconnected'))],
    ['the device hashes a different body', () => Promise.resolve({ txHashHex: '00'.repeat(32), witnesses: [], auxiliaryDataSupplement: null })],
  ])('fails as the agent does when %s', async (_, answer) => {
    device(answer);

    const agentError = await agent.signTransaction(body(SCRIPT_REF_TX), CONTEXT).catch((error: unknown) => error);
    const error = await signLedgerTransaction(agent, body(SCRIPT_REF_TX), CONTEXT).catch((error: unknown) => error);

    expect(agentError).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf((agentError as Error).constructor);
    expect(error).toEqual(agentError);
  });
});
