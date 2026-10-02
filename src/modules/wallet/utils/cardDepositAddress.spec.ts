import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { describe, expect, it } from 'vitest';
import { isCardDepositAddress, networkIdOfAddress } from './cardDepositAddress';

const payment = { type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16('ab'.repeat(28)) };
const stake = { type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16('cd'.repeat(28)) };
const { Mainnet, Testnet } = Cardano.NetworkId;

const mainnetBase = Cardano.BaseAddress.fromCredentials(Mainnet, payment, stake).toAddress().toBech32();
const mainnetEnterprise = Cardano.EnterpriseAddress.fromCredentials(Mainnet, payment).toAddress().toBech32();
const testnetEnterprise = Cardano.EnterpriseAddress.fromCredentials(Testnet, payment).toAddress().toBech32();
const mainnetStake = Cardano.RewardAddress.fromCredentials(Mainnet, stake).toAddress().toBech32();
const corrupted = mainnetBase.slice(0, -1) + (mainnetBase.endsWith('q') ? 'p' : 'q');

describe('isCardDepositAddress', () => {
  it('accepts base and enterprise addresses on the wallet network', () => {
    expect(isCardDepositAddress(mainnetBase, Mainnet)).toBe(true);
    expect(isCardDepositAddress(mainnetEnterprise, Mainnet)).toBe(true);
  });

  it('refuses an address on another network', () => {
    expect(isCardDepositAddress(testnetEnterprise, Mainnet)).toBe(false);
    expect(isCardDepositAddress(mainnetBase, Testnet)).toBe(false);
  });

  it('refuses stake addresses, bad checksums and non-strings', () => {
    expect(isCardDepositAddress(mainnetStake, Mainnet)).toBe(false);
    expect(isCardDepositAddress(corrupted, Mainnet)).toBe(false);
    expect(isCardDepositAddress('', Mainnet)).toBe(false);
    expect(isCardDepositAddress(null, Mainnet)).toBe(false);
    expect(isCardDepositAddress({ address: mainnetBase }, Mainnet)).toBe(false);
  });
});

describe('networkIdOfAddress', () => {
  it('reads the network from a bech32 address', () => {
    expect(networkIdOfAddress(mainnetBase)).toBe(Mainnet);
    expect(networkIdOfAddress(testnetEnterprise)).toBe(Testnet);
  });
});
