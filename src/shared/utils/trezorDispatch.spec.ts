import { beforeEach, describe, expect, test, vi } from 'vitest';

// Mock trezorWeb so dispatchTrezor's routing can be verified without touching
// @trezor/connect-web / WebUSB.
vi.mock('@/shared/utils/trezorWeb', () => ({
  default: {
    init: vi.fn(),
    getFeatures: vi.fn(),
    getXpub: vi.fn(),
    cardanoSignTransaction: vi.fn(),
    cardanoSignMessage: vi.fn(),
    getAddress: vi.fn(),
    initBitcoinTrezor: vi.fn(),
    signTransaction: vi.fn(),
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

import trezorWeb from '@/shared/utils/trezorWeb';
import networks from '@/utils/networks';
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { dispatchTrezor } from '@/shared/utils/trezorDispatch';

const mockedTrezorWeb = vi.mocked(trezorWeb);
const mockedNetworks = vi.mocked(networks);
const mockedDeserialize = vi.mocked(deserializeCardanoJsSdkTx);

describe('dispatchTrezor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('is a function', () => {
    expect(typeof dispatchTrezor).toBe('function');
  });

  describe('initTrezor', () => {
    test('Cardano: calls trezorWeb.getXpub and returns the handler-shaped response', async () => {
      mockedNetworks.resolveNetwork.mockReturnValue({ blockchain: 'Cardano' } as never);
      const coldWalletProps = { productName: 'Trezor', btSupported: false, hwPublicKey: 'xpub1abc', keys: [] };
      mockedTrezorWeb.getXpub.mockResolvedValue(coldWalletProps);

      const resp = await dispatchTrezor({ method: 'initTrezor', chain: 'Cardano', network: 'Mainnet' });

      expect(mockedNetworks.resolveNetwork).toHaveBeenCalledWith('Cardano', 'Mainnet');
      expect(mockedTrezorWeb.getXpub).toHaveBeenCalledWith("m/1852'/1815'/0'");
      expect(mockedTrezorWeb.initBitcoinTrezor).not.toHaveBeenCalled();
      expect(resp).toEqual({
        data: { success: true, coldWalletProps },
        target: 'gerowallet',
        sender: 'extension',
      });
    });

    test('Bitcoin: calls trezorWeb.initBitcoinTrezor and reformats the response', async () => {
      mockedNetworks.resolveNetwork.mockReturnValue({ blockchain: 'Bitcoin' } as never);
      mockedTrezorWeb.initBitcoinTrezor.mockResolvedValue({
        xpub: 'xpub1btc',
        deviceLabel: 'My Trezor',
        firmwareVersion: '2.6.0',
      });

      const resp = await dispatchTrezor({ method: 'initTrezor', chain: 'Bitcoin', network: 'Mainnet' });

      expect(mockedTrezorWeb.initBitcoinTrezor).toHaveBeenCalledWith('segwit', 0);
      expect(mockedTrezorWeb.getXpub).not.toHaveBeenCalled();
      expect(resp.data.success).toBe(true);
      expect(resp.data.coldWalletProps).toEqual({
        productName: 'My Trezor',
        hwPublicKey: 'xpub1btc',
        keys: [{ publicKey: 'xpub1btc', chainCode: '', path: "m/84'/0'/0'" }],
        btSupported: true,
        version: '2.6.0',
      });
    });
  });

  test('signTx: calls trezorWeb.cardanoSignTransaction (renamed from signTransaction) and returns a signatures array', async () => {
    mockedDeserialize.mockReturnValue({
      body: {},
      witness: {},
    } as never);
    mockedNetworks.resolveNetwork.mockReturnValue({ networkId: 1 } as never);
    const signatures = new Map([['pubkey1', 'sig1']]);
    mockedTrezorWeb.cardanoSignTransaction.mockResolvedValue(signatures as never);

    const resp = await dispatchTrezor({ method: 'signTx', txCbor: 'deadbeef' });

    expect(mockedTrezorWeb.cardanoSignTransaction).toHaveBeenCalled();
    expect(resp).toEqual({
      data: { success: true, signatures: [['pubkey1', 'sig1']] },
      target: 'gerowallet',
      sender: 'extension',
    });
  });

  test('signData: calls trezorWeb.cardanoSignMessage (renamed from signData)', async () => {
    mockedNetworks.resolveNetwork.mockReturnValue({ networkId: 1 } as never);
    const signatureData = { signatureHex: 'sig', signingPublicKeyHex: 'key', addressFieldHex: 'addr' };
    mockedTrezorWeb.cardanoSignMessage.mockResolvedValue(signatureData);

    const resp = await dispatchTrezor({ method: 'signData', address: 'addr1', payload: 'deadbeef', accountIndex: 0 });

    expect(mockedTrezorWeb.cardanoSignMessage).toHaveBeenCalledWith('addr1', 'deadbeef', 1, 0, expect.anything());
    expect(resp).toEqual({
      data: { success: true, signatureData },
      target: 'gerowallet',
      sender: 'extension',
    });
  });

  test('verifyBitcoinAddress: calls trezorWeb.verifyBitcoinAddress with defaults applied', async () => {
    mockedTrezorWeb.verifyBitcoinAddress.mockResolvedValue('bc1qaddress');

    const resp = await dispatchTrezor({ method: 'verifyBitcoinAddress' });

    expect(mockedTrezorWeb.verifyBitcoinAddress).toHaveBeenCalledWith('segwit', 0, 0, false);
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
