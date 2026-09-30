import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import * as Crypto from '@cardano-sdk/crypto';
import { LedgerKeyAgent } from '@cardano-sdk/hardware-ledger';
import { AddressType, CommunicationType, KeyPurpose, KeyRole } from '@cardano-sdk/key-management';
import {
  DatumType,
  type MessageData,
  type SignTransactionRequest,
  type TxOutput,
} from '@cardano-foundation/ledgerjs-hw-app-cardano';
import type Transport from '@ledgerhq/hw-transport';
import { Blockchain, Keys, Network } from '@/models/types';
import networks from '@/utils/networks';
import { INLINE_DATUM_UTXOS } from '@/shared/utils/__fixtures__/mainnetDatumUtxos';
import {
  TESTNET_TX,
  TESTNET_WALLET_ADDRESS,
  WALLET_ACCOUNT_XPUB,
  WALLET_ADDRESS,
} from '@/shared/utils/__fixtures__/handAssembledTxs';
import ledgerUtils from './ledger';

const walletKeys = (address: string, stakeAddress: string): Keys => ({
  payment: [{ address, cred: '11'.repeat(28), path: "m/1852'/1815'/0'/0/0" }],
  change: [],
  stake: [{ address: stakeAddress, cred: '22'.repeat(28), path: "m/1852'/1815'/0'/2/0" }],
  script: [],
  ccCold: [],
  ccHot: [],
  drep105: [],
  drep129: [],
});
const MAINNET_KEYS = walletKeys(WALLET_ADDRESS, 'stake1uy3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsflrjnr');
const TESTNET_KEYS = walletKeys(TESTNET_WALLET_ADDRESS, 'stake_test1uq3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsw4fsh7');
const MAINNET = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);
const PREPROD = networks.resolveNetwork(Blockchain.CARDANO, Network.PREPROD);
const PREVIEW = networks.resolveNetwork(Blockchain.CARDANO, Network.PREVIEW);
const TESTNET_WALLET_ADDRESS_HEX = `00${'11'.repeat(28)}${'22'.repeat(28)}`;

let bip32Ed25519: Crypto.Bip32Ed25519;
beforeAll(async () => {
  bip32Ed25519 = await Crypto.SodiumBip32Ed25519.create();
});
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * A Ledger over WebUSB with the Cardano app open, holding the wallet's account for whatever chain
 * the wallet asks for. The device serializes the body it is sent back to the same bytes, so it
 * answers with `txId`. Returns its signTransaction and signMessage.
 */
function connectedLedger(txId = '00'.repeat(32)) {
  const transport = { decorateAppAPIMethods: vi.fn() } as unknown as Transport;
  vi.spyOn(ledgerUtils, 'connectViaUSB').mockResolvedValue(transport);
  vi.spyOn(ledgerUtils, 'ensureLedgerVersion').mockResolvedValue(undefined);
  vi.spyOn(LedgerKeyAgent, 'createDeviceConnection').mockResolvedValue({} as never);
  vi.spyOn(LedgerKeyAgent, 'createWithDevice').mockImplementation(
    async ({ chainId }) =>
      new LedgerKeyAgent(
        {
          accountIndex: 0,
          chainId,
          communicationType: CommunicationType.Web,
          extendedAccountPublicKey: Crypto.Bip32PublicKeyHex(WALLET_ACCOUNT_XPUB),
          purpose: KeyPurpose.STANDARD,
        },
        { bip32Ed25519, logger: console },
      ),
  );
  const signTransaction = vi.fn(async (_request: SignTransactionRequest) => ({
    txHashHex: txId,
    witnesses: [],
    auxiliaryDataSupplement: null,
  }));
  const signMessage = vi.fn(async (_request: MessageData) => ({
    signatureHex: 'ab'.repeat(64),
    signingPublicKeyHex: 'cd'.repeat(32),
    addressFieldHex: TESTNET_WALLET_ADDRESS_HEX,
  }));
  vi.spyOn(LedgerKeyAgent, 'checkDeviceConnection').mockResolvedValue({ signTransaction, signMessage } as never);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined); // each input the wallet does not own
  return { signTransaction, signMessage };
}

const coreTx = (txCbor: string) => Serialization.Transaction.fromCbor(Serialization.TxCBOR(txCbor)).toCore();

describe('txToLedger', () => {
  it('asks the device to sign a dApp’s transaction over the datums it holds', async () => {
    const [{ nexusRow, datumCbor, txCbor }] = INLINE_DATUM_UTXOS;
    const { signTransaction } = connectedLedger(nexusRow.txHash);

    await ledgerUtils.txToLedger(coreTx(txCbor), MAINNET_KEYS, [], true, MAINNET, txCbor);

    const output = signTransaction.mock.lastCall![0].tx.outputs[nexusRow.txIndex] as TxOutput & { datum?: unknown };
    expect(output.datum).toEqual({ type: DatumType.INLINE, datumHex: datumCbor });
  });

  it('signs a testnet wallet’s transaction for its own network', async () => {
    const { signTransaction } = connectedLedger(Serialization.Transaction.fromCbor(Serialization.TxCBOR(TESTNET_TX)).getId());

    await ledgerUtils.txToLedger(coreTx(TESTNET_TX), TESTNET_KEYS, [], true, PREPROD, TESTNET_TX);

    expect(signTransaction.mock.lastCall![0].tx).toMatchObject({
      includeNetworkId: true,
      network: { networkId: 0, protocolMagic: 1 },
    });
  });
});

describe('poolOwnerWitness', () => {
  it('signs a testnet wallet’s transaction for its own network', async () => {
    // poolOwnerWitness rebuilds the body from its Core value.
    const tx = coreTx(TESTNET_TX);
    const { signTransaction } = connectedLedger(Serialization.Transaction.fromCore(tx).getId());

    await ledgerUtils.poolOwnerWitness(tx, TESTNET_KEYS, [], true, PREPROD);

    expect(signTransaction.mock.lastCall![0].tx).toMatchObject({ network: { networkId: 0, protocolMagic: 1 } });
  });
});

describe('signData', () => {
  it('signs for the wallet’s own network', async () => {
    const { signMessage } = connectedLedger();
    const knownAddress = {
      accountIndex: 0,
      address: Cardano.PaymentAddress(TESTNET_WALLET_ADDRESS),
      index: 0,
      networkId: Cardano.NetworkId.Testnet,
      rewardAccount: Cardano.RewardAccount('stake_test1uq3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsw4fsh7'),
      stakeKeyDerivationPath: { index: 0, role: KeyRole.Stake },
      type: AddressType.External,
    };

    await ledgerUtils.signData(TESTNET_WALLET_ADDRESS, 'deadbeef', PREVIEW, 0, true, [knownAddress]);

    // Preview is magic 2, not Preprod's 1.
    expect(signMessage.mock.lastCall![0]).toMatchObject({ network: { networkId: 0, protocolMagic: 2 } });
  });
});
