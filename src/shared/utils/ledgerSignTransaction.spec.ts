import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import * as Crypto from '@cardano-sdk/crypto';
import { LedgerKeyAgent } from '@cardano-sdk/hardware-ledger';
import {
  AddressType,
  CommunicationType,
  errors,
  KeyPurpose,
  KeyRole,
  TxInId,
  util,
  type SignTransactionContext,
} from '@cardano-sdk/key-management';
import { HexBlob } from '@cardano-sdk/util';
import {
  DatumType,
  type BIP32Path,
  type GetExtendedPublicKeyRequest,
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

/** The wallet's input (aa…#0) and change back to it: an ordinary transaction, nothing re-encoded. */
const ORDINARY_TX = [
  '84a3',
  `00 81825820${'aa'.repeat(32)}00`, // inputs
  `01 81825839${Cardano.Address.fromBech32(WALLET_ADDRESS).toBytes()}1a004c4b40`, // outputs: change
  '02 1a00030d40', // fee
  'a0 f5 f6',
].join('').replace(/ /g, '');

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
const ledgerAgent = (chainId: Cardano.ChainId, accountIndex = 0) =>
  new LedgerKeyAgent(
    {
      accountIndex,
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

describe('signLedgerTransaction: the multisig witness of the wallet’s own account', () => {
  const hardened = (index: number) => index + 0x80000000;
  const multisigPath = (account: number) => [hardened(1854), hardened(1815), hardened(account), 0, 0];

  it('asks for account 1’s multisig key on account #1, where the agent would ask for account 0’s', async () => {
    const signTransaction = signingDevice(SDK_ENCODED_TX_ID);
    const accountOne = ledgerAgent(Cardano.ChainIds.Mainnet, 1);
    const agentSignTransaction = vi.spyOn(accountOne, 'signTransaction');

    await signLedgerTransaction(accountOne, body(SDK_ENCODED_TX), CONTEXT);

    expect(agentSignTransaction).not.toHaveBeenCalled();
    expect(signTransaction.mock.lastCall![0]).toMatchObject({ additionalWitnessPaths: [multisigPath(1)] });
  });

  it('takes account #0’s multisig transaction from the agent too, and asks for account 0’s key', async () => {
    const signTransaction = signingDevice(SDK_ENCODED_TX_ID);
    const agentSignTransaction = vi.spyOn(agent, 'signTransaction');

    await signLedgerTransaction(agent, body(SDK_ENCODED_TX), CONTEXT);

    expect(agentSignTransaction).not.toHaveBeenCalled();
    expect(signTransaction.mock.lastCall![0]).toMatchObject({ additionalWitnessPaths: [multisigPath(0)] });
  });

  it('asks for account 0’s multisig key on account #0 when the transaction takes its own path', async () => {
    const signTransaction = signingDevice(NO_COLLATERAL_TX_ID);

    await signLedgerTransaction(agent, body(NO_COLLATERAL_TX), CONTEXT);

    expect(signTransaction.mock.lastCall![0]).toMatchObject({ additionalWitnessPaths: [multisigPath(0)] });
  });

  it('still leaves account #1’s ordinary transaction to the agent', async () => {
    const txBody = body(ORDINARY_TX);
    signingDevice(txBody.hash());
    const accountOne = ledgerAgent(Cardano.ChainIds.Mainnet, 1);
    const agentSignTransaction = vi.spyOn(accountOne, 'signTransaction');
    const context: SignTransactionContext = {
      ...OWN_CONTEXT,
      knownAddresses: OWN_CONTEXT.knownAddresses.map((address) => ({ ...address, accountIndex: 1 })),
    };

    await signLedgerTransaction(accountOne, txBody, context);

    expect(agentSignTransaction).toHaveBeenCalledWith(txBody, context);
  });
});

describe('signLedgerTransaction: otherwise LedgerKeyAgent.signTransaction', () => {
  it('leaves a transaction whose outputs the agent maps byte for byte to the agent', async () => {
    const txBody = body(ORDINARY_TX);
    signingDevice(txBody.hash());
    const agentSignTransaction = vi.spyOn(agent, 'signTransaction');

    await signLedgerTransaction(agent, txBody, OWN_CONTEXT);

    expect(agentSignTransaction).toHaveBeenCalledWith(txBody, OWN_CONTEXT);
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

describe('signLedgerTransaction: each witness carries the public key of its own path', () => {
  /** The all-zero-entropy test wallet, whose m/1852'/1815'/0' is WALLET_ACCOUNT_XPUB, as the device holds it. */
  let rootKey: Crypto.Bip32PrivateKeyHex;
  beforeAll(() => {
    rootKey = bip32Ed25519.fromBip39Entropy(Buffer.alloc(32), '');
  });
  const keyAt = (path: BIP32Path) => bip32Ed25519.derivePrivateKey(rootKey, path);
  const publicKeyAt = (path: BIP32Path) => bip32Ed25519.getRawPublicKey(bip32Ed25519.getBip32PublicKey(keyAt(path)));
  const accountPath = (purpose: KeyPurpose, account: number): BIP32Path =>
    [util.harden(purpose), util.harden(1815), util.harden(account)];
  const firstKeyPath = (purpose: KeyPurpose, account: number): BIP32Path =>
    util.accountKeyDerivationPathToBip32Path(account, { index: 0, role: KeyRole.External }, purpose);

  /** The wallet's account on the Ledger, with the account key the device holds for it. */
  const walletAgent = (account: number, chainId: Cardano.ChainId = Cardano.ChainIds.Mainnet) =>
    new LedgerKeyAgent(
      {
        accountIndex: account,
        chainId,
        communicationType: CommunicationType.Web,
        extendedAccountPublicKey: bip32Ed25519.getBip32PublicKey(keyAt(accountPath(KeyPurpose.STANDARD, account))),
        purpose: KeyPurpose.STANDARD,
      },
      { bip32Ed25519, logger: console },
    );

  /**
   * The device: signs the transaction id with the key at each input path and extra witness path
   * it is asked for, and exports any account key it is asked for.
   */
  const walletLedger = (txId: string) => {
    const signTransaction = vi.fn(
      async ({ tx, additionalWitnessPaths = [] }: SignTransactionRequest): Promise<SignedTransactionData> => ({
        txHashHex: txId,
        witnesses: [...tx.inputs.flatMap(({ path }) => (path ? [path] : [])), ...additionalWitnessPaths].map((path) => ({
          path,
          witnessSignatureHex: bip32Ed25519.sign(bip32Ed25519.getRawPrivateKey(keyAt(path)), HexBlob(txId)),
        })),
        auxiliaryDataSupplement: null,
      }),
    );
    const getExtendedPublicKey = vi.fn(async ({ path }: GetExtendedPublicKeyRequest) => {
      const xpub = bip32Ed25519.getBip32PublicKey(keyAt(path));
      return { publicKeyHex: xpub.slice(0, 64), chainCodeHex: xpub.slice(64) };
    });
    vi.spyOn(LedgerKeyAgent, 'checkDeviceConnection').mockResolvedValue({ signTransaction, getExtendedPublicKey } as never);
    return { getExtendedPublicKey };
  };

  /** For each witness, whether its signature verifies against the key it carries, over the transaction id. */
  const verified = (signatures: Cardano.Signatures, txId: string) =>
    [...signatures].map(([publicKey, signature]) => bip32Ed25519.verify(signature, HexBlob(txId), publicKey));

  it('holds the wallet the fixtures were written for', () => {
    expect(bip32Ed25519.getBip32PublicKey(keyAt(accountPath(KeyPurpose.STANDARD, 0)))).toBe(WALLET_ACCOUNT_XPUB);
  });

  it.each([
    ['account #0, a body the agent sends as is', 0, SDK_ENCODED_TX, SDK_ENCODED_TX_ID],
    ['account #1, a body the agent sends as is', 1, SDK_ENCODED_TX, SDK_ENCODED_TX_ID],
    ['account #0, a body only the wallet sends as is', 0, NO_COLLATERAL_TX, NO_COLLATERAL_TX_ID],
    ['account #1, a body only the wallet sends as is', 1, NO_COLLATERAL_TX, NO_COLLATERAL_TX_ID],
  ])('pairs the multisig witness with its 1854\' key: %s', async (_, account, txCbor, txId) => {
    const { getExtendedPublicKey } = walletLedger(txId);

    const signatures = await signLedgerTransaction(walletAgent(account), body(txCbor), CONTEXT);

    expect([...signatures.keys()]).toEqual([publicKeyAt(firstKeyPath(KeyPurpose.MULTI_SIG, account))]);
    expect(verified(signatures, txId)).toEqual([true]);
    expect(getExtendedPublicKey).toHaveBeenCalledExactlyOnceWith({ path: accountPath(KeyPurpose.MULTI_SIG, account) });
  });

  it.each([0, 1])('keeps account #%i’s input witness on its 1852\' key, and exports no other key', async (account) => {
    const { getExtendedPublicKey } = walletLedger(TESTNET_TX_ID);
    const context: SignTransactionContext = {
      ...TESTNET_CONTEXT,
      knownAddresses: TESTNET_CONTEXT.knownAddresses.map((address) => ({ ...address, accountIndex: account })),
    };

    const signatures = await signLedgerTransaction(walletAgent(account, Cardano.ChainIds.Preprod), body(TESTNET_TX), context);

    expect([...signatures.keys()]).toEqual([publicKeyAt(firstKeyPath(KeyPurpose.STANDARD, account))]);
    expect(verified(signatures, TESTNET_TX_ID)).toEqual([true]);
    expect(getExtendedPublicKey).not.toHaveBeenCalled();
  });

  it.each([
    ['another account', firstKeyPath(KeyPurpose.STANDARD, 1)],
    ['another account’s multisig key', firstKeyPath(KeyPurpose.MULTI_SIG, 1)],
    ['a minting policy key', [util.harden(1855), util.harden(1815), util.harden(0)]],
  ])('refuses a witness under %s, which the wallet never asks for', async (_, path) => {
    device(async () => ({
      txHashHex: NO_COLLATERAL_TX_ID,
      witnesses: [{ path, witnessSignatureHex: 'ab'.repeat(64) }],
      auxiliaryDataSupplement: null,
    }));

    const error = await signLedgerTransaction(walletAgent(0), body(NO_COLLATERAL_TX), CONTEXT).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(errors.TransportError);
    expect((error as errors.TransportError).innerError).toBeInstanceOf(errors.HwMappingError);
  });
});
