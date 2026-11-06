// Who may use Gero's NFT market, as one predicate: the worker's prepare handlers and the pages
// that show the market's actions both read it, so a button never appears for a wallet the worker
// would refuse.
import { describe, expect, it } from 'vitest';
import { Blockchain } from '@/models/types';
import { canUseNftMarketWallet } from './nftMarketGate';

describe('canUseNftMarketWallet', () => {
  it('allows the software Cardano wallets: password, PassKey (both Normal) and Google', () => {
    expect(canUseNftMarketWallet(Blockchain.CARDANO, 'Normal')).toBe(true);
    expect(canUseNftMarketWallet(Blockchain.CARDANO, 'Google')).toBe(true);
  });

  it('refuses a watch wallet, whatever list a build passes', () => {
    expect(canUseNftMarketWallet(Blockchain.CARDANO, 'Watch')).toBe(false);
    expect(canUseNftMarketWallet(Blockchain.CARDANO, 'Watch', ['Watch', 'Normal'])).toBe(false);
  });

  it('refuses every hardware wallet while NFT_MARKET_HARDWARE_WALLET_TYPES is empty', () => {
    for (const type of ['Ledger', 'Trezor', 'Keystone']) expect(canUseNftMarketWallet(Blockchain.CARDANO, type)).toBe(false);
  });

  it('allows a hardware wallet only when its type is listed', () => {
    expect(canUseNftMarketWallet(Blockchain.CARDANO, 'Ledger', ['Ledger'])).toBe(true);
    expect(canUseNftMarketWallet(Blockchain.CARDANO, 'Trezor', ['Ledger'])).toBe(false);
  });

  it('refuses any chain other than Cardano, even for a software wallet', () => {
    for (const chain of [Blockchain.BITCOIN, Blockchain.MIDNIGHT, Blockchain.APEX_PRIME, '', undefined]) {
      expect(canUseNftMarketWallet(chain, 'Normal'), String(chain)).toBe(false);
    }
  });

  it('refuses a missing or unknown wallet type', () => {
    for (const type of [undefined, null, '', 'normal', 'Multisig']) expect(canUseNftMarketWallet(Blockchain.CARDANO, type)).toBe(false);
  });
});
