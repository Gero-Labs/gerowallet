import { beforeEach, describe, expect, test, vi } from 'vitest';

// Mock the Trezor module so dispatchTrezor's routing can be verified without
// touching Trezor Connect.
vi.mock('@/shared/utils/trezor', () => ({
  default: {
    init: vi.fn(),
    getDeviceInfo: vi.fn(),
    getXpub: vi.fn(),
    getAccountXpubs: vi.fn(),
    signTransaction: vi.fn(),
    signData: vi.fn(),
    getBitcoinAddress: vi.fn(),
    initBitcoinTrezor: vi.fn(),
    signBitcoinTransaction: vi.fn(),
    verifyBitcoinAddress: vi.fn(),
  },
}));

vi.mock('@/chrome/cardanoJsSdkCbor', () => ({
  deserializeCardanoJsSdkTx: vi.fn(),
}));

vi.mock('@/utils/networks', () => ({
  default: {
    resolveNetwork: vi.fn(),
  },
}));

vi.mock('@/stores/walletStore', () => ({
  default: {
    state: {
      loggedWallet: { chain: 'Cardano', network: 'Mainnet', publicKey: 'pub-key-hex' },
      keys: { payment: [], change: [], stake: [] },
      utxos: [],
    },
  },
}));

vi.mock('@/chrome/messaging', () => ({
  Messaging: { sendToBackgroundFromOptions: vi.fn() },
}));

import trezor from '@/shared/utils/trezor';
import networks from '@/utils/networks';
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { CIP113_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { dispatchTrezor } from '@/shared/utils/trezorDispatch';

const mockedTrezor = vi.mocked(trezor);
const mockedNetworks = vi.mocked(networks);
const mockedDeserialize = vi.mocked(deserializeCardanoJsSdkTx);
const mockedSendToBackground = vi.mocked(Messaging.sendToBackgroundFromOptions);

describe('dispatchTrezor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('is a function', () => {
    expect(typeof dispatchTrezor).toBe('function');
  });

  describe('initTrezor', () => {
    test('Cardano: calls trezor.getXpub and returns the handler-shaped response', async () => {
      mockedNetworks.resolveNetwork.mockReturnValue({ blockchain: 'Cardano' } as never);
      const coldWalletProps = { productName: 'Trezor', btSupported: false, hwPublicKey: 'xpub1abc', keys: [] };
      mockedTrezor.getXpub.mockResolvedValue(coldWalletProps);

      const resp = await dispatchTrezor({ method: 'initTrezor', chain: 'Cardano', network: 'Mainnet' });

      expect(mockedNetworks.resolveNetwork).toHaveBeenCalledWith('Cardano', 'Mainnet');
      expect(mockedTrezor.getXpub).toHaveBeenCalledWith("m/1852'/1815'/0'");
      expect(mockedTrezor.initBitcoinTrezor).not.toHaveBeenCalled();
      expect(resp).toEqual({
        data: { success: true, coldWalletProps },
        target: 'gerowallet',
        sender: 'extension',
      });
    });

    test('Cardano with account indices: exports those accounts in one request', async () => {
      mockedNetworks.resolveNetwork.mockReturnValue({ blockchain: 'Cardano' } as never);
      const coldWalletProps = { productName: 'Trezor', btSupported: false, accounts: [] };
      mockedTrezor.getAccountXpubs.mockResolvedValue(coldWalletProps);

      const resp = await dispatchTrezor({ method: 'initTrezor', chain: 'Cardano', network: 'Mainnet', accountIndices: [0, 1, 2] });

      expect(mockedTrezor.getAccountXpubs).toHaveBeenCalledWith([0, 1, 2]);
      expect(mockedTrezor.getXpub).not.toHaveBeenCalled();
      expect(resp.data).toEqual({ success: true, coldWalletProps });
    });

    test.each([[[]], [[0, 0]], [[-1]], [['1']]])('refuses account indices %j before asking the device', async (accountIndices) => {
      mockedNetworks.resolveNetwork.mockReturnValue({ blockchain: 'Cardano' } as never);

      const resp = await dispatchTrezor({ method: 'initTrezor', chain: 'Cardano', network: 'Mainnet', accountIndices });

      expect(mockedTrezor.getAccountXpubs).not.toHaveBeenCalled();
      expect(resp.data.success).toBe(false);
    });

    test('Bitcoin: calls trezor.initBitcoinTrezor and reformats the response', async () => {
      mockedNetworks.resolveNetwork.mockReturnValue({ blockchain: 'Bitcoin', network: 'Mainnet' } as never);
      mockedTrezor.initBitcoinTrezor.mockResolvedValue({
        xpub: 'xpub1btc',
        deviceLabel: 'My Trezor',
        firmwareVersion: '2.6.0',
      });

      const resp = await dispatchTrezor({ method: 'initTrezor', chain: 'Bitcoin', network: 'Mainnet' });

      expect(mockedTrezor.initBitcoinTrezor).toHaveBeenCalledWith('segwit', 0, 'Mainnet');
      expect(mockedTrezor.getXpub).not.toHaveBeenCalled();
      expect(resp.data.success).toBe(true);
      expect(resp.data.coldWalletProps).toEqual({
        productName: 'My Trezor',
        hwPublicKey: 'xpub1btc',
        keys: [{ publicKey: 'xpub1btc', chainCode: '', path: "m/84'/0'/0'" }],
        btSupported: true,
        version: '2.6.0',
      });
    });

    // Issue 1327: a testnet account sits at coin type 1', where the device is asked for it.
    test('Bitcoin testnet: pairs the account at coin type 1\'', async () => {
      mockedNetworks.resolveNetwork.mockReturnValue({ blockchain: 'Bitcoin', network: 'Testnet' } as never);
      mockedTrezor.initBitcoinTrezor.mockResolvedValue({ xpub: 'xpub1test', deviceLabel: 'My Trezor', firmwareVersion: '2.6.0' });

      const resp = await dispatchTrezor({ method: 'initTrezor', chain: 'Bitcoin', network: 'Testnet' });

      expect(mockedTrezor.initBitcoinTrezor).toHaveBeenCalledWith('segwit', 0, 'Testnet');
      expect(resp.data.coldWalletProps.keys).toEqual([{ publicKey: 'xpub1test', chainCode: '', path: "m/84'/1'/0'" }]);
    });
  });

  test('signTx: calls trezor.signTransaction and returns a signatures array', async () => {
    mockedDeserialize.mockReturnValue({
      body: {},
      witness: {},
    } as never);
    mockedNetworks.resolveNetwork.mockReturnValue({ networkId: 1 } as never);
    mockedSendToBackground.mockResolvedValue({ data: { success: true, refused: false } });
    const signatures = new Map([['pubkey1', 'sig1']]);
    mockedTrezor.signTransaction.mockResolvedValue(signatures as never);

    const resp = await dispatchTrezor({ method: 'signTx', txCbor: 'deadbeef' });

    // The worker's CIP-113 refusal is asked first, about this transaction.
    expect(mockedSendToBackground).toHaveBeenCalledWith({
      method: MessageTypes.CIP113_SIGN_PREFLIGHT,
      data: { txCbor: 'deadbeef' },
    });
    expect(mockedTrezor.signTransaction).toHaveBeenCalled();
    expect(resp).toEqual({
      data: { success: true, signatures: [['pubkey1', 'sig1']] },
      target: 'gerowallet',
      sender: 'extension',
    });
  });

  test('signTx: refuses a transaction that spends CIP-113 programmable-token UTxOs, as the background handler does', async () => {
    mockedSendToBackground.mockResolvedValue({ data: { success: true, refused: true } });

    const resp = await dispatchTrezor({ method: 'signTx', txCbor: 'deadbeef' });

    expect(mockedTrezor.signTransaction).not.toHaveBeenCalled();
    expect(resp).toEqual({
      data: { success: false, error: CIP113_SIGN_REFUSAL_MESSAGE },
      target: 'gerowallet',
      sender: 'extension',
    });
  });

  test('signTx: does not sign when the worker cannot answer the CIP-113 check', async () => {
    // Messaging resolves (never rejects) with { error } when the worker is unreachable.
    mockedSendToBackground.mockResolvedValue({ error: 'Could not establish connection. Receiving end does not exist.' });

    const resp = await dispatchTrezor({ method: 'signTx', txCbor: 'deadbeef' });

    expect(mockedTrezor.signTransaction).not.toHaveBeenCalled();
    expect(resp.data.success).toBe(false);
  });

  test('signData: calls trezor.signData', async () => {
    mockedNetworks.resolveNetwork.mockReturnValue({ networkId: 1 } as never);
    const signatureData = { signatureHex: 'sig', signingPublicKeyHex: 'key', addressFieldHex: 'addr' };
    mockedTrezor.signData.mockResolvedValue(signatureData);

    const resp = await dispatchTrezor({ method: 'signData', address: 'addr1', payload: 'deadbeef' });

    expect(mockedTrezor.signData).toHaveBeenCalledWith('addr1', 'deadbeef', 1, expect.anything());
    expect(resp).toEqual({
      data: { success: true, signatureData },
      target: 'gerowallet',
      sender: 'extension',
    });
  });

  test('verifyBitcoinAddress: verifies on the wallet\'s network', async () => {
    mockedTrezor.verifyBitcoinAddress.mockResolvedValue('tb1qaddress');

    await dispatchTrezor({ method: 'verifyBitcoinAddress', addressType: 'taproot', network: 'Testnet' });

    expect(mockedTrezor.verifyBitcoinAddress).toHaveBeenCalledWith('taproot', 0, 0, false, 'Testnet');
  });

  test('verifyBitcoinAddress: calls trezor.verifyBitcoinAddress with defaults applied', async () => {
    mockedTrezor.verifyBitcoinAddress.mockResolvedValue('bc1qaddress');

    const resp = await dispatchTrezor({ method: 'verifyBitcoinAddress' });

    expect(mockedTrezor.verifyBitcoinAddress).toHaveBeenCalledWith('segwit', 0, 0, false, 'Mainnet');
    expect(resp).toEqual({
      data: { success: true, address: 'bc1qaddress' },
      target: 'gerowallet',
      sender: 'extension',
    });
  });

  test('unknown method: resolves with a failure instead of hanging', async () => {
    const resp = await dispatchTrezor({ method: 'notARealMethod' });

    expect(resp).toEqual({
      data: { success: false, error: 'Unknown Trezor method: notARealMethod' },
      target: 'gerowallet',
      sender: 'extension',
    });
  });

  test('errors are caught and returned as a failure response, not thrown', async () => {
    mockedNetworks.resolveNetwork.mockImplementation(() => {
      throw new Error('boom');
    });

    const resp = await dispatchTrezor({ method: 'initTrezor', chain: 'Cardano', network: 'Mainnet' });

    expect(resp).toEqual({
      data: { success: false, error: 'boom' },
      target: 'gerowallet',
      sender: 'extension',
    });
  });
});
