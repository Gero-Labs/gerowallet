import { afterEach, describe, expect, it, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import * as Crypto from '@cardano-sdk/crypto';
import { LedgerKeyAgent } from '@cardano-sdk/hardware-ledger';
import { CommunicationType, KeyPurpose } from '@cardano-sdk/key-management';
import { DatumType, type SignTransactionRequest, type TxOutput } from '@cardano-foundation/ledgerjs-hw-app-cardano';
import type Transport from '@ledgerhq/hw-transport';
import { Blockchain, Keys, Network } from '@/models/types';
import networks from '@/utils/networks';
import { INLINE_DATUM_UTXOS } from '@/shared/utils/__fixtures__/mainnetDatumUtxos';
import { WALLET_ACCOUNT_XPUB, WALLET_ADDRESS } from '@/shared/utils/__fixtures__/handAssembledTxs';
import ledgerUtils from './ledger';

const KEYS: Keys = {
  payment: [{ address: WALLET_ADDRESS, cred: '11'.repeat(28), path: "m/1852'/1815'/0'/0/0" }],
  change: [],
  stake: [],
  script: [],
  ccCold: [],
  ccHot: [],
  drep105: [],
  drep129: [],
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('txToLedger', () => {
  const [{ nexusRow, datumCbor, txCbor }] = INLINE_DATUM_UTXOS;

  it('asks the device to sign a dApp’s transaction over the datums it holds', async () => {
    // Connected over WebUSB, Cardano app open.
    const transport = { decorateAppAPIMethods: vi.fn() } as unknown as Transport;
    vi.spyOn(ledgerUtils, 'connectViaUSB').mockResolvedValue(transport);
    vi.spyOn(ledgerUtils, 'ensureLedgerVersion').mockResolvedValue(undefined);
    vi.spyOn(LedgerKeyAgent, 'createDeviceConnection').mockResolvedValue({} as never);
    vi.spyOn(LedgerKeyAgent, 'createWithDevice').mockResolvedValue(
      new LedgerKeyAgent(
        {
          accountIndex: 0,
          chainId: Cardano.ChainIds.Mainnet,
          communicationType: CommunicationType.Web,
          extendedAccountPublicKey: Crypto.Bip32PublicKeyHex(WALLET_ACCOUNT_XPUB),
          purpose: KeyPurpose.STANDARD,
        },
        { bip32Ed25519: await Crypto.SodiumBip32Ed25519.create(), logger: console },
      ),
    );
    // The device: it serializes the body it was sent back to the same bytes.
    const signTransaction = vi.fn(async (_request: SignTransactionRequest) => ({
      txHashHex: nexusRow.txHash,
      witnesses: [],
      auxiliaryDataSupplement: null,
    }));
    vi.spyOn(LedgerKeyAgent, 'checkDeviceConnection').mockResolvedValue({ signTransaction } as never);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined); // each input the wallet does not own

    const tx = Serialization.Transaction.fromCbor(Serialization.TxCBOR(txCbor)).toCore();
    const mainnet = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);
    await ledgerUtils.txToLedger(tx, KEYS, [], true, mainnet, txCbor);

    const output = signTransaction.mock.lastCall![0].tx.outputs[nexusRow.txIndex] as TxOutput & { datum?: unknown };
    expect(output.datum).toEqual({ type: DatumType.INLINE, datumHex: datumCbor });
  });
});
