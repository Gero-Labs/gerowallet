// src/chrome/walletBg.listed.spec.ts
//
// The Gero NFT market's `listed` partition, end to end through a real WalletBg and a real Dexie
// (fake-indexeddb). A listing sits at the listing script's address with the seller's own stake
// key in the stake slot, so gero-sync returns it as the user's: it must never be spent by coin
// selection or counted as spendable, and a fake "your listing" (someone else's datum at the
// user's stake key) must never be treated as the user's (Review Focus 1: a datum naming the
// wallet as owner but another seller address, or the reverse).
//
// The datums are built here byte by byte, the way the contract's own types encode them
// (indefinite-length constructors), so the wallet's strict decoder is exercised on real shapes.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));
// The CIP-113 registry read through the backend's Nexus proxy: nothing registered here.
vi.mock('@/api/cip113-registry-api', () => ({ fetchAllPolicyAssets: vi.fn(async () => []) }));

import { WalletBg } from './walletBg';
import WalletStore, { walletStore, type Account } from '@/stores/walletStore';
import { getAddress, getStakeKey } from './serialization';
import { inlineDatumFromCbor } from '@/shared/utils/utxoCbor';
import networks from '@/utils/networks';
import { CIP113_BASE_PREPROD } from '@/utils/cip113Deployments';
import { NFT_MARKET_DEPLOYMENTS_PREPROD, type NftMarketDeployment } from '@/utils/nftMarketDeployments';
import { Blockchain, Network, type Keys } from '@/models/types';

// clearForWalletSwitch() clears the wallet-scoped alarms; there is no extension API here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal stand-in for the chrome namespace
(globalThis as any).chrome = {
  alarms: {
    getAll: (cb: (alarms: unknown[]) => void) => cb([]),
    clear: vi.fn(),
    create: vi.fn(),
    onAlarm: { addListener: vi.fn(), removeListener: vi.fn(), hasListener: () => false },
  },
  storage: { local: { set: vi.fn(), get: vi.fn() } },
  runtime: {},
  tabs: { query: vi.fn() },
};

// A real CIP-1852 account xpub (derived from a fixed seed), so BIP44 derivation and the address
// plumbing behave exactly as they do for a user's wallet.
const XPUB = 'acct_xvk14hczmhwlqeadp0f3m7vzgda9suxdpl73hvwzk9jhmfm3kzv05hwhyxdd40a0hac6u39ws58ek3y0kkcvwx08ds6s80qhasqqgmtgyzcreur64';
const NETWORK = Network.PREPROD;
const V1: NftMarketDeployment = NFT_MARKET_DEPLOYMENTS_PREPROD[0];

const STRANGER_PAYMENT = '000000000000000000000000000000000000000000000000000000ff';
const STRANGER_STAKE = '000000000000000000000000000000000000000000000000000000fe';

const SPENDABLE_TX = '1'.repeat(64);
const LISTING_TX = '2'.repeat(64);
const PLB_TX = '3'.repeat(64);
const SPENDABLE_COINS = 10_000_000n;
const DEPOSIT = 2_000_000n;
const PLB_COINS = 4_000_000n;
/** What the provider reports for the stake address: every half, in one number. */
const CONTROLLED_TOTAL = SPENDABLE_COINS + DEPOSIT;

const NFT = `${'b'.repeat(56)}${Buffer.from('Gero NFT 1').toString('hex')}`;
const OTHER_NFT = `${'c'.repeat(56)}${Buffer.from('Gero NFT 2').toString('hex')}`;
const PLB_TOKEN = `${'a'.repeat(56)}${Buffer.from('LOCKED').toString('hex')}`;

let walletSeq = 0;

function makeWallet() {
  // A fresh id per test: getDb() caches by `wallet-<id>`, so this is what isolates the per-wallet
  // DB between tests.
  walletSeq += 1;
  return {
    id: 930_000 + walletSeq,
    name: `listed-test-${walletSeq}`,
    chain: Blockchain.CARDANO,
    network: NETWORK,
    publicKey: XPUB,
  };
}

/** A WalletBg with the asset-metadata fetch stubbed: the only network call in this path. */
function bootWallet(wallet: ReturnType<typeof makeWallet>): WalletBg {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture stands in for the persisted Wallet record
  const bg = new WalletBg(wallet as any);
  bg.syncService.syncAssets = vi.fn().mockResolvedValue(undefined);
  return bg;
}

const ownBase = getAddress(XPUB, Blockchain.CARDANO, NETWORK, 0);
const ownAddress = ownBase.toBech32();
const OWN_PAYMENT = ownBase.asBase()!.getPaymentCredential().hash as string;
const OWN_STAKE = getStakeKey(XPUB, 0).hash().hex() as string;
/** A second address of the wallet, on the internal chain: a legitimate seller address too. */
const strangerAddress = Cardano.BaseAddress.fromCredentials(
  Cardano.NetworkId.Testnet,
  { hash: Hash28ByteBase16(STRANGER_PAYMENT), type: Cardano.CredentialType.KeyHash },
  { hash: Hash28ByteBase16(STRANGER_STAKE), type: Cardano.CredentialType.KeyHash },
).toAddress().toBech32();

function scriptAddress(scriptHash: string, stakeKeyHash: string): string {
  return Cardano.BaseAddress.fromCredentials(
    Cardano.NetworkId.Testnet,
    { hash: Hash28ByteBase16(scriptHash), type: Cardano.CredentialType.ScriptHash },
    { hash: Hash28ByteBase16(stakeKeyHash), type: Cardano.CredentialType.KeyHash },
  ).toAddress().toBech32();
}

/** The listing's address: the listing script, the wallet's own stake key. */
const listingAddress = scriptAddress(V1.scriptHash, OWN_STAKE);

// ---------------------------------------------------------------------------------------------
// Datum bytes, by hand. Constr 0 [...] is `d8799f ... ff`; a bytes item is 58 1c <28 bytes>.
// ---------------------------------------------------------------------------------------------

function uint(n: bigint): string {
  if (n < 24n) return n.toString(16).padStart(2, '0');
  if (n < 0x100n) return `18${n.toString(16).padStart(2, '0')}`;
  if (n < 0x10000n) return `19${n.toString(16).padStart(4, '0')}`;
  if (n < 0x100000000n) return `1a${n.toString(16).padStart(8, '0')}`;
  return `1b${n.toString(16).padStart(16, '0')}`;
}

/** Address = Constr 0 [ VerificationKey(pay), Some(Inline(VerificationKey(stake))) ] for a base address. */
function addressCbor(bech32: string): string {
  const base = Cardano.Address.fromBech32(bech32).asBase()!;
  const pay = base.getPaymentCredential().hash;
  const stake = base.getStakeCredential().hash;
  return `d8799fd8799f581c${pay}ffd8799fd8799fd8799f581c${stake}ffffffff`;
}

interface DatumOptions {
  owner?: string;
  sellerAddress?: string;
  price?: bigint;
}

/** Listing = Constr 0 [ owner, seller Address, price, [] royalties, None buyer ]. */
function listingDatum({ owner = OWN_PAYMENT, sellerAddress = ownAddress, price = 50_000_000n }: DatumOptions = {}): string {
  return `d8799f581c${owner}${addressCbor(sellerAddress)}${uint(price)}80d87a80ff`;
}

function utxo(
  txId: string,
  address: string,
  coins: bigint,
  { assets, datum, index = 0 }: { assets?: [string, bigint][]; datum?: string; index?: number } = {},
): Cardano.Utxo {
  return [
    { txId: Cardano.TransactionId(txId), index, address: address as Cardano.PaymentAddress },
    {
      address: address as Cardano.PaymentAddress,
      value: {
        coins,
        assets: assets ? new Map(assets.map(([u, q]) => [Cardano.AssetId(u), q])) : undefined,
      },
      ...(datum ? { datum: inlineDatumFromCbor(datum as never) } : {}),
    },
  ] as Cardano.Utxo;
}

const spendableUtxo = () => utxo(SPENDABLE_TX, ownAddress, SPENDABLE_COINS);
const ownListingUtxo = (opts: DatumOptions = {}, txId = LISTING_TX) =>
  utxo(txId, listingAddress, DEPOSIT, { assets: [[NFT, 1n]], datum: listingDatum(opts) });
const plbUtxo = () =>
  utxo(PLB_TX, scriptAddress(CIP113_BASE_PREPROD[0], OWN_STAKE), PLB_COINS, { assets: [[PLB_TOKEN, 7n]] });

const account = (controlled: bigint) => ({ controlled_amount: controlled.toString() } as Account);

/** The cached-load block of walletManager.login(), in its real order. */
async function loginFromCache(bg: WalletBg) {
  await bg.loadProgrammableRefs();
  await bg.loadCachedKeys();
  await bg.loadCachedUtxos();
  await bg.loadCachedAccount();
}

function refs(utxos: unknown[]): string[] {
  return (utxos as Cardano.Utxo[]).map(([txIn]) => `${txIn.txId}#${txIn.index}`);
}

describe('listedScriptHashes and the subscription', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is every configured version of the network, and nothing where the market is off', () => {
    expect(bootWallet(makeWallet()).listedScriptHashes()).toEqual(new Set([V1.scriptHash]));
    const preview = bootWallet({ ...makeWallet(), network: Network.PREVIEW });
    expect(preview.listedScriptHashes().size).toBe(0);
    const mainnet = bootWallet({ ...makeWallet(), network: Network.MAINNET });
    expect(mainnet.listedScriptHashes().size).toBe(0);
  });

  it('includes superseded versions, not only the newest', () => {
    const v2: NftMarketDeployment = { ...V1, version: 2, scriptHash: '9'.repeat(56) };
    vi.spyOn(networks, 'resolveNftMarketDeployments').mockReturnValue([v2, V1]);

    expect(bootWallet(makeWallet()).listedScriptHashes()).toEqual(new Set([v2.scriptHash, V1.scriptHash]));
  });

  it('sends no credentials with CIP-113 off and a market deployment configured', () => {
    vi.spyOn(networks, 'resolveProgrammableLogicBaseScriptHashes').mockReturnValue([]);
    const bg = bootWallet(makeWallet());

    expect(bg.listedScriptHashes().size).toBe(1);
    expect(bg.subscriptionCredentials()).toEqual([]);
  });

  it('still sends no credentials with CIP-113 on and no market deployment', () => {
    vi.spyOn(networks, 'resolveNftMarketDeployments').mockReturnValue([]);

    expect(bootWallet(makeWallet()).subscriptionCredentials()).toEqual([]);
  });

  it('keeps the payment-credential allowlist where neither is configured', () => {
    vi.spyOn(networks, 'resolveProgrammableLogicBaseScriptHashes').mockReturnValue([]);
    vi.spyOn(networks, 'resolveNftMarketDeployments').mockReturnValue([]);
    const bg = bootWallet(makeWallet());

    const credentials = bg.subscriptionCredentials();
    expect(credentials.length).toBeGreaterThan(0);
    expect(credentials).toContain(OWN_PAYMENT);
  });

  it('still derives a fresh wallet\'s keys locally, since an empty subscription names no address', async () => {
    vi.spyOn(networks, 'resolveProgrammableLogicBaseScriptHashes').mockReturnValue([]);
    const bg = bootWallet(makeWallet());
    expect(bg.subscriptionCredentials()).toEqual([]);

    await bg.loadCachedKeys();

    expect(walletStore.keys?.payment[0]?.address).toBe(ownAddress);
  });
});

describe('own listings: the partition', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the wallet\'s own listing out of the spendable set and shows it as a listing', async () => {
    const bg = bootWallet(makeWallet());

    await bg.applyUtxos([spendableUtxo(), ownListingUtxo()], true);

    // The partition itself: only the spendable half can be selected as an input.
    expect(refs(walletStore.utxos)).toEqual([`${SPENDABLE_TX}#0`]);
    expect(walletStore.tokens).not.toHaveProperty(NFT);
    expect(walletStore.listedListings).toEqual([
      {
        ref: `${LISTING_TX}#0`,
        unit: NFT,
        datum: { owner: OWN_PAYMENT, sellerAddress: ownAddress, price: 50_000_000n, royalties: [], buyer: null },
        depositLovelace: DEPOSIT.toString(),
        deploymentVersion: 1,
      },
    ]);
    expect(walletStore.listedLockedLovelace).toBe(DEPOSIT.toString());
  });

  it('resolves the listed NFT\'s metadata through the same pipeline', async () => {
    const bg = bootWallet(makeWallet());

    await bg.applyUtxos([spendableUtxo(), ownListingUtxo()], true);

    const asked = (bg.syncService.syncAssets as ReturnType<typeof vi.fn>).mock.calls.flatMap(([units]) => units);
    expect(asked).toContain(NFT);
  });

  // Review Focus 1 (spec 5.10, "fake your listing"). Each half alone is a fake.
  describe('a listing that is not the wallet\'s own', () => {
    it('drops one whose datum names another owner, though the seller address is the wallet\'s', async () => {
      const bg = bootWallet(makeWallet());
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      await bg.applyUtxos([spendableUtxo(), ownListingUtxo({ owner: STRANGER_PAYMENT })], true);

      expect(walletStore.listedListings).toEqual([]);
      expect(walletStore.listedLockedLovelace).toBe('0');
      expect(refs(walletStore.utxos)).toEqual([`${SPENDABLE_TX}#0`]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('NFT market'), { OWNER: 1 });
    });

    it('drops one whose datum names the wallet as owner but another seller address', async () => {
      const bg = bootWallet(makeWallet());
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      await bg.applyUtxos([spendableUtxo(), ownListingUtxo({ sellerAddress: strangerAddress })], true);

      expect(walletStore.listedListings).toEqual([]);
      expect(walletStore.listedLockedLovelace).toBe('0');
      expect(refs(walletStore.utxos)).toEqual([`${SPENDABLE_TX}#0`]);
    });

    it('does not subtract a fake listing from the balance', async () => {
      const bg = bootWallet(makeWallet());
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await bg.applyUtxos([spendableUtxo(), ownListingUtxo({ owner: STRANGER_PAYMENT })], true);

      WalletStore.setAccount(account(CONTROLLED_TOTAL));

      expect(walletStore.account?.controlled_amount).toBe(CONTROLLED_TOTAL.toString());
    });

    it('never calls the wallet\'s own stake key an owner', async () => {
      const bg = bootWallet(makeWallet());
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      await bg.applyUtxos([ownListingUtxo({ owner: OWN_STAKE })], true);

      expect(walletStore.listedListings).toEqual([]);
    });

    it.each([
      ['no inline datum', utxo(LISTING_TX, listingAddress, DEPOSIT, { assets: [[NFT, 1n]] })],
      ['a datum that is not a Listing', utxo(LISTING_TX, listingAddress, DEPOSIT, { assets: [[NFT, 1n]], datum: 'd87980' })],
      ['a Listing with a field missing', utxo(LISTING_TX, listingAddress, DEPOSIT, {
        assets: [[NFT, 1n]],
        datum: `d8799f581c${OWN_PAYMENT}${addressCbor(ownAddress)}1a02faf080ff`,
      })],
      ['no NFT', utxo(LISTING_TX, listingAddress, DEPOSIT, { datum: listingDatum() })],
      ['two NFTs', utxo(LISTING_TX, listingAddress, DEPOSIT, { assets: [[NFT, 1n], [OTHER_NFT, 1n]], datum: listingDatum() })],
      ['a quantity of two', utxo(LISTING_TX, listingAddress, DEPOSIT, { assets: [[NFT, 2n]], datum: listingDatum() })],
    ])('drops one with %s', async (_name, candidate) => {
      const bg = bootWallet(makeWallet());
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      await bg.applyUtxos([spendableUtxo(), candidate], true);

      expect(walletStore.listedListings).toEqual([]);
      expect(walletStore.listedLockedLovelace).toBe('0');
      expect(refs(walletStore.utxos)).toEqual([`${SPENDABLE_TX}#0`]);
    });

    it('drops a listing under another stake key and counts it', async () => {
      const bg = bootWallet(makeWallet());
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const someoneElses = utxo(LISTING_TX, scriptAddress(V1.scriptHash, STRANGER_STAKE), DEPOSIT, {
        assets: [[NFT, 1n]],
        datum: listingDatum(),
      });

      await bg.applyUtxos([spendableUtxo(), someoneElses], true);

      expect(walletStore.listedListings).toEqual([]);
      expect(refs(walletStore.utxos)).toEqual([`${SPENDABLE_TX}#0`]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('other stake keys'));
    });

    it('keeps the genuine listing and drops only the fake one next to it', async () => {
      const bg = bootWallet(makeWallet());
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const fake = utxo('4'.repeat(64), listingAddress, DEPOSIT, {
        assets: [[OTHER_NFT, 1n]],
        datum: listingDatum({ sellerAddress: strangerAddress }),
      });

      await bg.applyUtxos([spendableUtxo(), fake, ownListingUtxo()], true);

      expect(walletStore.listedListings.map((l) => l.unit)).toEqual([NFT]);
      expect(walletStore.listedLockedLovelace).toBe(DEPOSIT.toString());
    });
  });

  it('recognises a listing under a superseded deployment and reports its version', async () => {
    const v2: NftMarketDeployment = { ...V1, version: 2, scriptHash: '9'.repeat(56) };
    vi.spyOn(networks, 'resolveNftMarketDeployments').mockReturnValue([v2, V1]);
    const bg = bootWallet(makeWallet());
    const atV2 = utxo('5'.repeat(64), scriptAddress(v2.scriptHash, OWN_STAKE), DEPOSIT, {
      assets: [[OTHER_NFT, 1n]],
      datum: listingDatum(),
    });

    await bg.applyUtxos([spendableUtxo(), ownListingUtxo(), atV2], true);

    expect(walletStore.listedListings.map((l) => [l.unit, l.deploymentVersion]).sort())
      .toEqual([[NFT, 1], [OTHER_NFT, 2]].sort());
    expect(walletStore.listedLockedLovelace).toBe((DEPOSIT * 2n).toString());
    expect(refs(walletStore.utxos)).toEqual([`${SPENDABLE_TX}#0`]);
  });

  it('reads the datum from every shape a stored UTxO has held one in', async () => {
    const bg = bootWallet(makeWallet());
    const hex = listingDatum();
    const nexusShape = utxo(LISTING_TX, listingAddress, DEPOSIT, { assets: [[NFT, 1n]] });
    // gero-sync pushes Nexus rows verbatim: an inline datum is `{ bytes, value | json }`.
    (nexusShape[1] as { datum?: unknown }).datum = { bytes: hex, json: {} };
    const bareHex = utxo('6'.repeat(64), listingAddress, DEPOSIT, { assets: [[OTHER_NFT, 1n]] });
    (bareHex[1] as { datum?: unknown }).datum = hex;

    await bg.applyUtxos([nexusShape, bareHex], true);

    expect(walletStore.listedListings.map((l) => l.unit).sort()).toEqual([NFT, OTHER_NFT].sort());
  });

  it('recognises the wallet before gero-sync has named any key', async () => {
    const bg = bootWallet(makeWallet());
    WalletStore.setKeys(null);

    await bg.applyUtxos([ownListingUtxo()], true);

    expect(walletStore.listedListings).toHaveLength(1);
  });

  it('recognises a seller address from the key set gero-sync reported', async () => {
    const bg = bootWallet(makeWallet());
    const base = Cardano.Address.fromBech32(ownAddress).asBase()!;
    // An address past the locally derived range, but in the key set the server named.
    const far = Cardano.BaseAddress.fromCredentials(
      Cardano.NetworkId.Testnet,
      { hash: Hash28ByteBase16('0000000000000000000000000000000000000000000000000000abcd'), type: Cardano.CredentialType.KeyHash },
      base.getStakeCredential(),
    ).toAddress().toBech32();
    WalletStore.setKeys({
      payment: [{ address: far, path: "m/1852'/1815'/0'/0/99", cred: '0000000000000000000000000000000000000000000000000000abcd', used: true }],
      change: [], stake: [], ccCold: [], ccHot: [], drep105: [], drep129: [], script: [],
    } as Keys);

    await bg.applyUtxos([
      utxo(LISTING_TX, listingAddress, DEPOSIT, {
        assets: [[NFT, 1n]],
        datum: listingDatum({ owner: '0000000000000000000000000000000000000000000000000000abcd', sellerAddress: far }),
      }),
    ], true);

    expect(walletStore.listedListings).toHaveLength(1);
  });

  it('classifies nothing as listed where the market is off, and keeps every result as before', async () => {
    vi.spyOn(networks, 'resolveNftMarketDeployments').mockReturnValue([]);
    const bg = bootWallet(makeWallet());

    await bg.applyUtxos([spendableUtxo(), plbUtxo(), ownListingUtxo()], true);

    expect(walletStore.listedListings).toEqual([]);
    expect(refs(walletStore.utxos)).toEqual([`${SPENDABLE_TX}#0`]);
    expect(Object.keys(walletStore.programmableTokens)).toEqual([PLB_TOKEN]);
  });

  it('clears the listings when a push arrives with no UTxOs', async () => {
    const bg = bootWallet(makeWallet());
    await bg.applyUtxos([spendableUtxo(), ownListingUtxo()], true);

    await bg.applyUtxos([], true);

    expect(walletStore.listedListings).toEqual([]);
    expect(walletStore.listedLockedLovelace).toBe('0');
  });

  it('drops a listing that has been bought or cancelled when the next push omits it', async () => {
    const bg = bootWallet(makeWallet());
    await bg.applyUtxos([spendableUtxo(), ownListingUtxo()], true);

    await bg.applyUtxos([spendableUtxo()], true);

    expect(walletStore.listedListings).toEqual([]);
    expect(walletStore.listedLockedLovelace).toBe('0');
  });
});

describe('own listings: the balance', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('takes the listed deposit off controlled_amount when the listings land first', async () => {
    const bg = bootWallet(makeWallet());

    await bg.applyUtxos([spendableUtxo(), ownListingUtxo()], true);
    WalletStore.setAccount(account(CONTROLLED_TOTAL));

    expect(walletStore.account?.controlled_amount).toBe(SPENDABLE_COINS.toString());
    expect(walletStore.account?.controlled_amount_total).toBe(CONTROLLED_TOTAL.toString());
  });

  it('takes it off when the account lands first', async () => {
    const bg = bootWallet(makeWallet());

    WalletStore.setAccount(account(CONTROLLED_TOTAL));
    await bg.applyUtxos([spendableUtxo(), ownListingUtxo()], true);

    expect(walletStore.account?.controlled_amount).toBe(SPENDABLE_COINS.toString());
  });

  it('does not subtract twice across repeated pushes and repeated accounts', async () => {
    const bg = bootWallet(makeWallet());

    WalletStore.setAccount(account(CONTROLLED_TOTAL));
    await bg.applyUtxos([spendableUtxo(), ownListingUtxo()], true);
    await bg.applyUtxos([spendableUtxo(), ownListingUtxo()], true);
    WalletStore.setAccount(walletStore.account);
    WalletStore.setAccount(walletStore.account);

    expect(walletStore.account?.controlled_amount).toBe(SPENDABLE_COINS.toString());
  });

  it('takes off the CIP-113 share and the listed share together', async () => {
    const bg = bootWallet(makeWallet());

    await bg.applyUtxos([spendableUtxo(), plbUtxo(), ownListingUtxo()], true);
    WalletStore.setAccount(account(CONTROLLED_TOTAL + PLB_COINS));

    expect(walletStore.programmableLockedLovelace).toBe(PLB_COINS.toString());
    expect(walletStore.listedLockedLovelace).toBe(DEPOSIT.toString());
    expect(walletStore.account?.controlled_amount).toBe(SPENDABLE_COINS.toString());
    expect(refs(walletStore.utxos)).toEqual([`${SPENDABLE_TX}#0`]);
  });

  it('gives the lovelace back once the listing is gone', async () => {
    const bg = bootWallet(makeWallet());
    await bg.applyUtxos([spendableUtxo(), ownListingUtxo()], true);
    WalletStore.setAccount(account(CONTROLLED_TOTAL));

    await bg.applyUtxos([spendableUtxo()], true);
    WalletStore.setAccount(account(SPENDABLE_COINS + DEPOSIT));

    expect(walletStore.account?.controlled_amount).toBe((SPENDABLE_COINS + DEPOSIT).toString());
  });

  // reconcileControlledAmountFromUtxos() rebuilds the persisted account row from the spendable
  // UTxOs plus what is locked, so the row keeps the provider's stake-level meaning.
  it('keeps the account row on the stake-level total when it is rebuilt from the UTxOs', async () => {
    const bg = bootWallet(makeWallet());
    await bg.applyUtxos([spendableUtxo(), ownListingUtxo()], true);

    await bg.syncService['reconcileControlledAmountFromUtxos']();

    const row = await bg.getAccountInfo();
    expect(row.controlled_amount).toBe(CONTROLLED_TOTAL.toString());
    WalletStore.setAccount(row as Account);
    expect(walletStore.account?.controlled_amount).toBe(SPENDABLE_COINS.toString());
  });
});

describe('own listings across a service-worker restart', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** What walletManager.login() does on a fresh worker: everything in memory is gone. */
  function simulateWorkerRestart() {
    WalletStore.clearForWalletSwitch();
    expect(walletStore.listedListings).toEqual([]);
    expect(walletStore.listedLockedLovelace).toBe('0');
  }

  it('persists the verified listing tagged `listed`, and nothing else from the listing script', async () => {
    const wallet = makeWallet();
    const bg = bootWallet(wallet);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fake = utxo('4'.repeat(64), listingAddress, DEPOSIT, {
      assets: [[OTHER_NFT, 1n]],
      datum: listingDatum({ owner: STRANGER_PAYMENT }),
    });

    await bg.applyUtxos([spendableUtxo(), fake, ownListingUtxo()], true);

    const rows = await (await bg.getDb()).table('utxos').toArray();
    expect(rows.map((r) => `${r.partition}:${r.txId}`).sort()).toEqual([
      `listed:${LISTING_TX}`,
      `spendable:${SPENDABLE_TX}`,
    ]);
  });

  it('restores the listings and the locked share with no live sync', async () => {
    const wallet = makeWallet();
    const bg = bootWallet(wallet);
    await bg.applyUtxos([spendableUtxo(), ownListingUtxo()], true);
    await bg.setAccountInfo({ controlled_amount: CONTROLLED_TOTAL.toString() });

    simulateWorkerRestart();
    await loginFromCache(bootWallet(wallet));

    expect(walletStore.listedListings.map((l) => l.ref)).toEqual([`${LISTING_TX}#0`]);
    expect(walletStore.listedLockedLovelace).toBe(DEPOSIT.toString());
    expect(walletStore.account?.controlled_amount).toBe(SPENDABLE_COINS.toString());
    expect(refs(walletStore.utxos)).toEqual([`${SPENDABLE_TX}#0`]);
  });

  it('does not resurrect a cleared listing from the cache', async () => {
    const wallet = makeWallet();
    const bg = bootWallet(wallet);
    await bg.applyUtxos([spendableUtxo(), ownListingUtxo()], true);
    await bg.applyUtxos([spendableUtxo()], true);

    simulateWorkerRestart();
    await loginFromCache(bootWallet(wallet));

    expect(walletStore.listedListings).toEqual([]);
    expect(walletStore.listedLockedLovelace).toBe('0');
  });

  it('does not resurrect listings the wallet no longer holds after an empty push', async () => {
    const wallet = makeWallet();
    const bg = bootWallet(wallet);
    await bg.applyUtxos([spendableUtxo(), ownListingUtxo()], true);
    await bg.applyUtxos([], true);

    simulateWorkerRestart();
    await loginFromCache(bootWallet(wallet));

    expect(walletStore.listedLockedLovelace).toBe('0');
  });

  it('still keeps the CIP-113 half and the listed half apart after a restart', async () => {
    const wallet = makeWallet();
    const bg = bootWallet(wallet);
    await bg.applyUtxos([spendableUtxo(), plbUtxo(), ownListingUtxo()], true);

    simulateWorkerRestart();
    await loginFromCache(bootWallet(wallet));

    expect(Object.keys(walletStore.programmableTokens)).toEqual([PLB_TOKEN]);
    expect(walletStore.listedListings.map((l) => l.unit)).toEqual([NFT]);
    expect(walletStore.programmableLockedLovelace).toBe(PLB_COINS.toString());
    expect(walletStore.listedLockedLovelace).toBe(DEPOSIT.toString());
  });
});
