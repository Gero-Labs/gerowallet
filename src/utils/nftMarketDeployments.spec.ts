// The reviewed listing-contract deployments, the limits every market transaction is held to, and
// the build-time gate that decides where the market runs. networks.ts re-validates the lists at
// module scope, so every stubbed case needs a fresh module instance (vi.resetModules()).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Blockchain, Network } from '@/models/types';
import {
  CIP68_USER_TOKEN_LABEL,
  isHardwareWalletType,
  isNftMarketHardware,
  MAX_LIST_PRICE,
  MAX_LISTING_DEPOSIT,
  MAX_ROYALTIES,
  MIN_LIST_PRICE,
  MIN_SELLER_SHARE,
  NFT_MARKET_ALLOWED_NETWORKS,
  NFT_MARKET_DEPLOYMENTS_MAINNET,
  NFT_MARKET_DEPLOYMENTS_PREPROD,
  NFT_MARKET_HARDWARE_WALLET_TYPES,
  NFT_MARKET_MAX_COLLATERAL_LOVELACE,
  NFT_MARKET_MAX_FEE_LOVELACE,
  NFT_MARKET_MAX_VALIDITY_SLOTS,
  NFT_UNIT_PATTERN,
  POLICY_ID_HEX_LENGTH,
  ROYALTY_RATE_CAP,
  type NftMarketDeployment,
} from './nftMarketDeployments';

// The real preprod v1 deployment, copied from deployments/preprod-v1/deployment.json in
// Gero-Labs/gero-market-contracts (main 26fff54). A trust anchor: a change here is a deliberate edit.
const V1: NftMarketDeployment = {
  version: 1,
  scriptHash: '558802cc2e2f21e4e13662cdf73f979ce0140e7dbd7ce13911a9063d',
  referenceScript: '3a67a8ea84fba06cd3ab80e0d03cc12406a2e3b60ae0dba59475a852f7ca4eea#0',
  feeAddress: 'addr_test1zqr6j3esncsqm3r79m050wysn2xz634pqtpln8xsnnngup00zdhpv57vpc7kafrx54kk2lwr45mug3qfsewgp5cdqwusxeyzuc',
  feeBps: 100,
  minFeeLovelace: 1_500_000n,
  maxFeeLovelace: 5_000_000n,
  sourceCommit: '2b36ccf3d1f82bd93422ddc939b9f788b3c7de86',
};

// Syntactically valid stand-ins for the parsing cases below. Not shipped values (the second hash
// is the removed earlier CIP-113 preprod bootstrap).
const OTHER_HASH = 'a48744c1584c58c2995cba1fa26b37f3999ee8cedac0ef241662f53d';
const OTHER_REF = `${'ab'.repeat(32)}#2`;

/** A valid deployment, with fields overridden to build the invalid ones. */
function deployment(overrides: Partial<NftMarketDeployment> = {}): NftMarketDeployment {
  return { ...V1, ...overrides };
}

/** Stub the deployment lists and the allowlist, then load a fresh networks.ts that reads them. */
async function loadNetworks(stub: {
  mainnet?: readonly NftMarketDeployment[];
  preprod?: readonly NftMarketDeployment[];
  allowed?: readonly string[];
} = {}) {
  vi.doMock('@/utils/nftMarketDeployments', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/utils/nftMarketDeployments')>();
    return {
      ...actual,
      NFT_MARKET_DEPLOYMENTS_MAINNET: stub.mainnet ?? [],
      NFT_MARKET_DEPLOYMENTS_PREPROD: stub.preprod ?? [],
      // Defaulted WIDE on purpose: the parsing cases run through preprod and are not about the
      // allowlist. The value actually shipped is pinned below against the real module.
      NFT_MARKET_ALLOWED_NETWORKS: stub.allowed ?? [Network.MAINNET, Network.PREPROD],
    };
  });
  return (await import('./networks')).default;
}

beforeEach(() => {
  vi.doUnmock('@/utils/nftMarketDeployments');
  vi.resetModules();
});

describe('shipped NFT market deployments', () => {
  it('lists the real preprod v1 deployment and nothing else', () => {
    expect([...NFT_MARKET_DEPLOYMENTS_PREPROD]).toEqual([V1]);
  });

  it('keeps mainnet empty until the audit closes', () => {
    expect([...NFT_MARKET_DEPLOYMENTS_MAINNET]).toEqual([]);
  });

  it('is allowed on mainnet and preprod only', () => {
    expect([...NFT_MARKET_ALLOWED_NETWORKS]).toEqual([Network.MAINNET, Network.PREPROD]);
  });

  it('resolves v1 on preprod, and nothing on mainnet or preview', async () => {
    const networks = (await import('./networks')).default;

    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREPROD)).toEqual([V1]);
    expect(networks.isNftMarketSupported(Blockchain.CARDANO, Network.PREPROD)).toBe(true);
    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.MAINNET)).toEqual([]);
    expect(networks.isNftMarketSupported(Blockchain.CARDANO, Network.MAINNET)).toBe(false);
    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREVIEW)).toEqual([]);
    expect(networks.isNftMarketSupported(Blockchain.CARDANO, Network.PREVIEW)).toBe(false);
  });
});

describe('market limits', () => {
  it('pins the wallet limits every market transaction is held to', () => {
    expect(MIN_LIST_PRICE).toBe(5_000_000n);
    expect(MIN_SELLER_SHARE).toBe(1_500_000n);
    expect(MAX_LIST_PRICE).toBe(45_000_000_000_000_000n);
    expect(MAX_ROYALTIES).toBe(3);
    expect(ROYALTY_RATE_CAP).toBe(0.1);
    expect(MAX_LISTING_DEPOSIT).toBe(5_000_000n);
    expect(NFT_MARKET_MAX_FEE_LOVELACE).toBe(2_000_000n);
    expect(NFT_MARKET_MAX_COLLATERAL_LOVELACE).toBe(5_000_000n);
    expect(NFT_MARKET_MAX_VALIDITY_SLOTS).toBe(3600);
  });
});

describe('market hardware gate', () => {
  it('allows no device in this build', () => {
    expect(NFT_MARKET_HARDWARE_WALLET_TYPES).toEqual([]);
    for (const type of ['Ledger', 'Trezor', 'Keystone']) expect(isNftMarketHardware(type)).toBe(false);
  });

  it('allows a listed device, and only that one', () => {
    expect(isNftMarketHardware('Ledger', ['Ledger'])).toBe(true);
    expect(isNftMarketHardware('Trezor', ['Ledger'])).toBe(false);
    expect(isNftMarketHardware('Keystone', ['Ledger', 'Trezor', 'Keystone'])).toBe(true);
  });

  it('isHardwareWalletType is true for the three device types, listed for the market or not, and for nothing else', () => {
    for (const type of ['Ledger', 'Trezor', 'Keystone']) expect(isHardwareWalletType(type), type).toBe(true);
    for (const type of ['Normal', 'Google', 'Watch', 'ledger', '', null, undefined]) expect(isHardwareWalletType(type), String(type)).toBe(false);
  });

  it('never answers for a software, watch or unknown type, even when listed', () => {
    for (const type of ['Normal', 'Google', 'Watch', 'ledger', '', null, undefined]) {
      expect(isNftMarketHardware(type, ['Normal', 'Google', 'Watch', 'ledger', ''])).toBe(false);
    }
  });
});

describe('networks — NFT market deployments', () => {
  it('resolves a configured deployment and derives support from it', async () => {
    const networks = await loadNetworks({ preprod: [V1] });

    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREPROD)).toEqual([V1]);
    expect(networks.isNftMarketSupported(Blockchain.CARDANO, Network.PREPROD)).toBe(true);
  });

  it('treats an empty list as unsupported', async () => {
    const networks = await loadNetworks();

    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREPROD)).toEqual([]);
    expect(networks.isNftMarketSupported(Blockchain.CARDANO, Network.PREPROD)).toBe(false);
  });

  it('keeps networks independent: configuring preprod does not enable mainnet', async () => {
    const networks = await loadNetworks({ preprod: [V1] });

    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.MAINNET)).toEqual([]);
    expect(networks.isNftMarketSupported(Blockchain.CARDANO, Network.MAINNET)).toBe(false);
  });

  // The hash is taken as granted downstream (it decides which UTxOs are listings), so the format
  // check is the only guard against a mistyped literal. Each of these must fail closed.
  it.each([
    ['too short', V1.scriptHash.slice(0, 40)],
    ['too long', `${V1.scriptHash}ab`],
    ['0x-prefixed', `0x${V1.scriptHash}`],
    ['bech32 address', V1.feeAddress],
    ['non-hex characters', 'z'.repeat(56)],
    ['empty', ''],
  ])('drops a deployment whose script hash is malformed (%s)', async (_label, scriptHash) => {
    const networks = await loadNetworks({ preprod: [deployment({ scriptHash })] });

    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREPROD)).toEqual([]);
    expect(networks.isNftMarketSupported(Blockchain.CARDANO, Network.PREPROD)).toBe(false);
  });

  it('keeps the valid deployments of a list and drops only the malformed one', async () => {
    const networks = await loadNetworks({
      preprod: [deployment({ scriptHash: 'nope' }), V1],
    });

    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREPROD)).toEqual([V1]);
  });

  it('normalizes surrounding whitespace and uppercase hex', async () => {
    const networks = await loadNetworks({
      preprod: [deployment({
        scriptHash: `  ${V1.scriptHash.toUpperCase()}  `,
        referenceScript: ` ${V1.referenceScript.toUpperCase()} `,
      })],
    });

    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREPROD)).toEqual([V1]);
  });

  it.each([
    ['no index', V1.referenceScript.split('#')[0]],
    ['non-numeric index', `${'ab'.repeat(32)}#x`],
    ['negative index', `${'ab'.repeat(32)}#-1`],
    ['short tx hash', `${'ab'.repeat(31)}#0`],
    ['non-hex tx hash', `${'zz'.repeat(32)}#0`],
    ['empty', ''],
  ])('drops a deployment whose reference script is malformed (%s)', async (_label, referenceScript) => {
    const networks = await loadNetworks({ preprod: [deployment({ referenceScript })] });

    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREPROD)).toEqual([]);
  });

  it.each([
    ['empty', ''],
    ['a mainnet address on a testnet list', 'addr1' + V1.feeAddress.slice('addr_test1'.length)],
    ['a hash', V1.scriptHash],
    ['upper case', V1.feeAddress.toUpperCase()],
    ['a stray character', `${V1.feeAddress}!`],
  ])('drops a preprod deployment whose fee address is not a testnet address (%s)', async (_label, feeAddress) => {
    const networks = await loadNetworks({ preprod: [deployment({ feeAddress })] });

    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREPROD)).toEqual([]);
  });

  it('drops a mainnet deployment whose fee address is a testnet address', async () => {
    const networks = await loadNetworks({ mainnet: [V1] });

    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.MAINNET)).toEqual([]);
  });

  // docs/rules.md: 0 < fee_bps <= 1000, min_fee >= 0, max_fee absent or >= min_fee. The contract
  // does not check its own parameters, so a bad set is a bad script hash and must not be listed.
  it.each([
    ['zero fee', { feeBps: 0 }],
    ['negative fee', { feeBps: -1 }],
    ['fee above 10%', { feeBps: 1001 }],
    ['fractional fee', { feeBps: 100.5 }],
    ['non-numeric fee', { feeBps: Number.NaN }],
    ['negative minimum fee', { minFeeLovelace: -1n }],
    ['cap below the minimum', { minFeeLovelace: 2_000_000n, maxFeeLovelace: 1_999_999n }],
    ['minimum fee that is not a bigint', { minFeeLovelace: 1_500_000 as unknown as bigint }],
    ['cap that is not a bigint', { maxFeeLovelace: 5_000_000 as unknown as bigint }],
    ['version zero', { version: 0 }],
    ['fractional version', { version: 1.5 }],
  ])('drops a deployment with bad parameters (%s)', async (_label, overrides) => {
    const networks = await loadNetworks({ preprod: [deployment(overrides)] });

    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREPROD)).toEqual([]);
  });

  it.each([
    ['the highest fee', { feeBps: 1000 }],
    ['no minimum fee', { minFeeLovelace: 0n }],
    ['no cap', { maxFeeLovelace: null }],
    ['a cap equal to the minimum', { minFeeLovelace: 1_500_000n, maxFeeLovelace: 1_500_000n }],
  ])('keeps a deployment with %s', async (_label, overrides) => {
    const kept = deployment(overrides);
    const networks = await loadNetworks({ preprod: [kept] });

    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREPROD)).toEqual([kept]);
  });

  // A superseded deployment stays listed until its listings drain, and new listings use the
  // newest: callers take index 0.
  it('lists the newest version first whatever the order in the file', async () => {
    const v2 = deployment({ version: 2, scriptHash: OTHER_HASH, referenceScript: OTHER_REF });
    const networks = await loadNetworks({ preprod: [V1, v2] });

    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREPROD)).toEqual([v2, V1]);
  });

  it('lists a script hash once', async () => {
    const networks = await loadNetworks({ preprod: [V1, deployment({ version: 2 })] });

    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREPROD)).toEqual([V1]);
  });

  it('hands out copies, so a caller cannot rewrite the reviewed constants', async () => {
    const networks = await loadNetworks({ preprod: [V1] });

    const [resolved] = networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREPROD);
    expect(resolved).not.toBe(V1);
  });

  // The allowlist is a second gate, independent of the lists: recording a deployment must not
  // bring a network live by itself.
  it('refuses a network outside the allowlist, even with a valid deployment configured', async () => {
    const networks = await loadNetworks({ mainnet: [], preprod: [V1], allowed: [Network.MAINNET] });

    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREPROD)).toEqual([]);
    expect(networks.isNftMarketSupported(Blockchain.CARDANO, Network.PREPROD)).toBe(false);
  });

  it('still resolves a network that is allowlisted', async () => {
    const networks = await loadNetworks({ preprod: [V1], allowed: [Network.PREPROD] });

    expect(networks.resolveNftMarketDeployments(Blockchain.CARDANO, Network.PREPROD)).toEqual([V1]);
  });

  it('reports unsupported for non-Cardano chains and for missing arguments', async () => {
    const networks = await loadNetworks({ preprod: [V1] });

    expect(networks.resolveNftMarketDeployments(Blockchain.BITCOIN, Network.MAINNET)).toEqual([]);
    expect(networks.isNftMarketSupported(Blockchain.BITCOIN, Network.MAINNET)).toBe(false);
    expect(networks.resolveNftMarketDeployments('', '')).toEqual([]);
    expect(networks.isNftMarketSupported('', '')).toBe(false);
  });
});

// The unit shape and the CIP-68 label the market accepts are read from here by the worker (the
// prepare handler and the verifiers) and by the pages, so a button never offers what the worker
// refuses on shape.
describe('the NFT unit the market takes', () => {
  it('is a policy id and an asset name of up to 32 bytes, lower-case hex', () => {
    const policy = 'ab'.repeat(28);
    expect(POLICY_ID_HEX_LENGTH).toBe(56);
    expect(NFT_UNIT_PATTERN.test(policy)).toBe(true);
    expect(NFT_UNIT_PATTERN.test(`${policy}${'cd'.repeat(32)}`)).toBe(true);
    expect(NFT_UNIT_PATTERN.test(`${policy}${'cd'.repeat(33)}`)).toBe(false);
    expect(NFT_UNIT_PATTERN.test(`${policy}c`)).toBe(false);
    expect(NFT_UNIT_PATTERN.test(`${policy.slice(2)}`)).toBe(false);
    expect(NFT_UNIT_PATTERN.test(`${policy.toUpperCase()}`)).toBe(false);
    expect(NFT_UNIT_PATTERN.test('lovelace')).toBe(false);
  });

  it('lists only the CIP-68 (222) user token', () => {
    expect(CIP68_USER_TOKEN_LABEL).toBe(222);
  });
});
