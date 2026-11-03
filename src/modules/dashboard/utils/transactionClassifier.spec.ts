import { describe, expect, it, vi } from 'vitest';
import { Cardano } from '@cardano-sdk/core';

vi.mock('@/shared/composables/useCnightDustRegistration', () => ({
  DUST_MAPPING_VALIDATOR: { Preprod: { scriptHash: '', address: 'addr_test1dustvalidator' } },
}));

import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import type { StoredTransaction } from '@/models/transaction.types';
import { LEGACY_SCRIPTS } from '@/utils/legacyMarketScripts';
import { NFT_MARKET_DEPLOYMENTS_PREPROD } from '@/utils/nftMarketDeployments';
import { listingRow, preprodAddress } from '@/modules/market/utils/__fixtures__/listingFixtures';
import {
  buildClassifyContext,
  buildTxTags,
  buildTxTitle,
  classifyTxKind,
  geroMarketActions,
  isGeroMarket,
  isDexOrderCancellation,
  isDexTransaction,
  isInternalTransfer,
  isJpgStore,
  isMinswap,
  isPendingTooLong,
  withMinusSign,
} from './transactionClassifier';

const OWN_PAYMENT = 'addr_test1ownpayment';
const OWN_CHANGE = 'addr_test1ownchange';
const OTHER = 'addr_test1someoneelse';
// Minswap V2 order script c3e28c36…, with no stake part and with a wallet's stake key
const MINSWAP_V2_ORDER = 'addr1w8p79rpkcdz8x9d6tft0x0dx5mwuzac2sa4gm8cvkw5hcnqst2ctf';
const MINSWAP_V2_ORDER_STAKED = 'addr1z8p79rpkcdz8x9d6tft0x0dx5mwuzac2sa4gm8cvkw5hcn84xmy84q2crvzy6he2j69798923xvt3jk5n3nd9eecmxks7hfyu8';
const MINSWAP_V2_POOL = 'addr1z84q0denmyep98ph3tmzwsmw0j7zau9ljmsqx6a4rvaau66j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq777e2a';
const MINSWAP_V1_MARKET_ORDER = 'addr1wxn9efv2f6w82hagxqtn62ju4m293tqvw0uhmdl64ch8uwc0h43gt';
// The V3 listing script ("AskV1" in the marketplace's release V3), carrying a stake credential
const JPGSTORE_V3_LISTING = 'addr1x8rjw3pawl0kelu4mj3c8x20fsczf5pl744s9mxz9v8n7efvjel5h55fgjcxgchp830r7h2l5msrlpt8262r3nvr8ekstg4qrx';
const metadata = (...msg: string[]) => ({ auxiliaryData: { blob: { 674: { msg } } } });

const t = (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key);

const ctx = buildClassifyContext(
  { stakeAddress: 'stake_test1me', network: 'Preprod' },
  { payment: [{ address: OWN_PAYMENT }], change: [{ address: OWN_CHANGE }] },
  { alice: { address: OTHER, name: 'Alice' } },
);

const io = (address: string) => ({ address, amount: [{ unit: 'lovelace', quantity: '1000000' }] });

function tx(overrides: Record<string, unknown>): StoredTransaction {
  return {
    id: 'tx1',
    tx_hash: 'tx1',
    tx_timestamp: Math.floor(Date.now() / 1000) - 60,
    pending: false,
    ada: 0,
    sentAmount: 0,
    receivedAmount: 0,
    assets: [],
    sentAssets: [],
    receivedAssets: [],
    utxo: { inputs: [], outputs: [] },
    ...overrides,
  } as unknown as StoredTransaction;
}

describe('transaction titles and types', () => {
  it('titles an all-own-address transaction a self transfer, without an extra Internal tag', () => {
    const item = tx({
      ada: -310000, sentAmount: 310000,
      utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io(OWN_CHANGE), io(OWN_PAYMENT)] },
    });
    expect(isInternalTransfer(item, ctx)).toBe(true);
    expect(buildTxTitle(item, ctx, t)).toBe('transactions.selfTransfer');
    const kind = classifyTxKind(item, ctx);
    expect(kind).toBe('self');
    expect(buildTxTags(item, ctx, t, kind).map((tag) => tag.key)).not.toContain('internal');
  });

  it('never calls a transaction internal without a verifiable output list', () => {
    const item = tx({ utxo: { inputs: [io(OWN_PAYMENT)], outputs: [] } });
    expect(isInternalTransfer(item, ctx)).toBe(false);
  });

  it('classifies received and sent funds, and names a known contact', () => {
    const received = tx({
      ada: 10_000_000, receivedAmount: 10_000_000,
      utxo: { inputs: [io(OTHER)], outputs: [io(OWN_PAYMENT)] },
    });
    expect(buildTxTitle(received, ctx, t)).toBe('transactions.receivedFunds');
    expect(classifyTxKind(received, ctx)).toBe('in');
    expect(buildTxTags(received, ctx, t, 'in')).toContainEqual(
      { key: 'contact-Alice', label: 'Alice', icon: 'mdi-account-outline' },
    );

    const sent = tx({
      ada: -20_000_000, sentAmount: 20_000_000,
      utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io(OTHER), io(OWN_CHANGE)] },
    });
    expect(buildTxTitle(sent, ctx, t)).toBe('transactions.sentFunds');
    expect(classifyTxKind(sent, ctx)).toBe('out');
  });

  it('titles a token receipt that only carries min-UTxO ADA by its tokens', () => {
    const item = tx({
      ada: 1_500_000, receivedAmount: 1_500_000,
      assets: [{ unit: 'abc123', policy_id: 'abc', asset_name: '123', quantity: 5 }],
      utxo: { inputs: [io(OTHER)], outputs: [io(OWN_PAYMENT)] },
    });
    expect(buildTxTitle(item, ctx, t)).toBe('transactions.receivedToken');
    expect(classifyTxKind(item, ctx)).toBe('in');
  });

  describe('DEX orders, fills and cancellations', () => {
    const tagKeys = (item: StoredTransaction) => buildTxTags(item, ctx, t, classifyTxKind(item, ctx)).map((tag) => tag.key);

    it('tags a Gero Swap order on Minswap V2 as Minswap and Gero Swap, never SteelSwap (tx e113f7f1…)', () => {
      const item = tx({
        ada: -15_405_077, sentAmount: 15_405_077,
        utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io(MINSWAP_V2_ORDER), io(OTHER), io(OWN_PAYMENT)] },
        body: { outputs: [] },
        ...metadata('Gero Swap'),
      });
      expect(buildTxTitle(item, ctx, t)).toBe('transactions.dexOrder');
      expect(classifyTxKind(item, ctx)).toBe('swap');
      expect(tagKeys(item)).toEqual(expect.arrayContaining(['minswap', 'geroswap']));
      expect(tagKeys(item)).not.toContain('steelswap');
    });

    it('titles an order spent without its pool a cancellation, not a DEX order (tx cf268634…)', () => {
      const item = tx({
        ada: 13_194_754, receivedAmount: 13_194_754,
        utxo: { inputs: [io(MINSWAP_V2_ORDER), io(OWN_PAYMENT), io(OWN_PAYMENT)], outputs: [io(OWN_PAYMENT)] },
      });
      expect(isDexOrderCancellation(item)).toBe(true);
      expect(buildTxTitle(item, ctx, t)).toBe('transactions.orderCancelled');
      expect(classifyTxKind(item, ctx)).toBe('cancelled');
      expect(tagKeys(item)).toContain('minswap');
      expect(tagKeys(item)).not.toContain('steelswap');
    });

    it('keeps a live-synced fill whose pool input is still unresolved a DEX order', () => {
      for (const unresolved of ['', undefined]) {
        const item = tx({
          ada: 13_190_000, receivedAmount: 13_190_000,
          utxo: {
            inputs: [io(MINSWAP_V2_ORDER), { address: unresolved, amount: [{ unit: 'lovelace', quantity: '900000000' }] }],
            outputs: [io(MINSWAP_V2_POOL), io(OWN_PAYMENT)],
          },
        });
        expect(isDexOrderCancellation(item)).toBe(false);
        expect(buildTxTitle(item, ctx, t)).toBe('transactions.dexOrder');
      }
    });

    it('keeps a fill, which spends the pool too, a DEX order', () => {
      const item = tx({
        ada: 13_190_000, receivedAmount: 13_190_000,
        utxo: { inputs: [io(MINSWAP_V2_ORDER), io(MINSWAP_V2_POOL)], outputs: [io(MINSWAP_V2_POOL), io(OWN_PAYMENT)] },
      });
      expect(isDexOrderCancellation(item)).toBe(false);
      expect(buildTxTitle(item, ctx, t)).toBe('transactions.dexOrder');
    });

    it('recognises Minswap orders by script, whatever stake key they carry, and V1 orders too', () => {
      const staked = tx({ utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io(MINSWAP_V2_ORDER_STAKED)] } });
      expect(isMinswap(staked)).toBe(true);
      // That address is one wallet's own Minswap order address, not a DexHunter contract
      expect(tagKeys(staked)).not.toContain('dexhunter');
      expect(isMinswap(tx({ utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io(MINSWAP_V1_MARKET_ORDER)] } }))).toBe(true);
    });

    it('tags SteelSwap from its own 674 message only', () => {
      const item = tx({
        utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io(MINSWAP_V2_ORDER)] },
        body: { outputs: [] },
        ...metadata('CarDeM', 'SteelSwap: 1.18.0'),
      });
      expect(tagKeys(item)).toEqual(expect.arrayContaining(['steelswap', 'minswap']));
      expect(tagKeys(item)).not.toContain('geroswap');
    });
  });

  it('tags a tx with an output to the V3 listing address', () => {
    const item = tx({
      ada: -2_000_000, sentAmount: 2_000_000,
      utxo: { inputs: [], outputs: [] },
      body: { outputs: [io(JPGSTORE_V3_LISTING)] },
    });
    expect(isJpgStore(item)).toBe(true);
    expect(buildTxTags(item, ctx, t, classifyTxKind(item, ctx)).map((tag) => tag.key)).toContain('jpgstore');
  });

  it('tags a DUST registration by its output to the mapping validator', () => {
    const item = tx({ utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io('addr_test1dustvalidator')] } });
    expect(buildTxTags(item, ctx, t, classifyTxKind(item, ctx)).map((tag) => tag.key)).toContain('dust');
  });

  it('does not take the mainnet DUST mapping validator for a Minswap pool', () => {
    // The validator's real mainnet address; it was once mislabelled as the Minswap V2 pool
    const item = tx({
      ada: -1_990_000, sentAmount: 1_990_000,
      utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io('addr1w9e7ft4rrdd4rkdseguxr9hudfxyytm5ckh2qy0yhz7lfeg9lvhq7')] },
    });
    expect(isMinswap(item)).toBe(false);
    expect(isDexTransaction(item)).toBe(false);
    expect(buildTxTitle(item, ctx, t)).toBe('transactions.sentFunds');
  });

  it('detects a Minswap V2 pool operation by the published pool address', () => {
    const pool = 'addr1z84q0denmyep98ph3tmzwsmw0j7zau9ljmsqx6a4rvaau66j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq777e2a';
    const item = tx({ utxo: { inputs: [io(pool), io(OWN_PAYMENT)], outputs: [io(pool), io(OWN_CHANGE)] } });
    expect(isMinswap(item)).toBe(true);
    expect(buildTxTitle(item, ctx, t)).toBe('transactions.dexOrder');
  });

  it('types certificate transactions as staking or governance', () => {
    const delegation = tx({
      body: { outputs: [], certificates: [{ __typename: Cardano.CertificateType.StakeDelegation, poolId: 'pool1' }] },
    });
    expect(classifyTxKind(delegation, ctx)).toBe('stake');
    expect(buildTxTitle(delegation, ctx, t)).toBe('transactions.delegatingToPool');

    const vote = tx({
      ada: -180000, sentAmount: 180000,
      utxo: { inputs: [io(OWN_PAYMENT)], outputs: [io(OWN_CHANGE)] },
      body: { outputs: [], certificates: [{ __typename: Cardano.CertificateType.VoteDelegation }] },
    });
    const kind = classifyTxKind(vote, ctx);
    expect(kind).toBe('vote');
    expect(buildTxTitle(vote, ctx, t)).toBe('transactions.voteDelegation');
    // Certificates title it, so the all-own-address shape still earns the Internal tag
    expect(buildTxTags(vote, ctx, t, kind).map((tag) => tag.key)).toContain('internal');
  });

  it('marks a pending transaction pending, and failed once it is over an hour old', () => {
    const now = Date.now();
    const fresh = tx({ pending: true, tx_timestamp: Math.floor(now / 1000) - 30 });
    expect(classifyTxKind(fresh, ctx, now)).toBe('pending');
    expect(isPendingTooLong(fresh, now)).toBe(false);

    const stale = tx({ pending: true, tx_timestamp: Math.floor(now / 1000) - 2 * 3600 });
    expect(isPendingTooLong(stale, now)).toBe(true);
    expect(classifyTxKind(stale, ctx, now)).toBe('failed');
  });

  it('keeps a Bitcoin transaction pending however long it waits in the mempool', () => {
    const now = Date.now();
    for (const type of ['send', 'receive', 'self']) {
      const waiting = tx({ type, pending: true, tx_timestamp: Math.floor(now / 1000) - 3 * 24 * 3600 });
      expect(isPendingTooLong(waiting, now)).toBe(false);
      expect(classifyTxKind(waiting, ctx, now)).toBe('pending');
    }
  });

  it('titles Bitcoin records by their type field', () => {
    expect(buildTxTitle(tx({ type: 'self' }), ctx, t)).toBe('transactions.selfTransfer');
    expect(buildTxTitle(tx({ type: 'receive' }), ctx, t)).toBe('transactions.receivedFunds');
  });
});

describe('withMinusSign', () => {
  it('swaps the leading hyphen for a real minus sign and leaves positives alone', () => {
    expect(withMinusSign('- ₳1.00')).toBe('− ₳1.00');
    expect(withMinusSign('+ ₳1.00')).toBe('+ ₳1.00');
  });
});

// ---------------------------------------------------------------------------
// Gero NFT market: activity tags (nftMarket.activity.*)
// ---------------------------------------------------------------------------

describe('Gero NFT market activity tags', () => {
  const V1 = NFT_MARKET_DEPLOYMENTS_PREPROD[0];
  const OWNER = '18'.repeat(28);
  const OWNER_B = 'b5'.repeat(28);
  const STAKE = '5c'.repeat(28);
  const OTHER_STAKE = '88'.repeat(28);
  const STRANGER = '77'.repeat(28);

  const scriptAddress = (scriptHash: string, stake: string) =>
    Cardano.BaseAddress.fromCredentials(
      Cardano.NetworkId.Testnet,
      { hash: Hash28ByteBase16(scriptHash), type: Cardano.CredentialType.ScriptHash },
      { hash: Hash28ByteBase16(stake), type: Cardano.CredentialType.KeyHash },
    ).toAddress().toBech32();

  const OWN = preprodAddress(OWNER, STAKE);
  const OWN_CHANGE = preprodAddress(OWNER_B, STAKE);
  const BUYER = preprodAddress('99'.repeat(28), 'aa'.repeat(28));
  const OWN_LISTING = scriptAddress(V1.scriptHash, STAKE);
  const FOREIGN_LISTING = scriptAddress(V1.scriptHash, OTHER_STAKE);
  const LEGACY = scriptAddress(LEGACY_SCRIPTS.legacy_v3.scriptHash, STAKE);
  const UNRELATED_SCRIPT = scriptAddress('ab'.repeat(28), STAKE);
  const FEE = V1.feeAddress;

  /** The datum a listing of this wallet carries: its payment key as owner and its own address as seller. */
  const OWN_DATUM = listingRow({ owner: OWNER, stake: STAKE }).datumCbor;
  /** A fake "your listing": the wallet as owner, someone else as seller. */
  const FAKE_DATUM = listingRow({ owner: OWNER, stake: STAKE, sellerAddress: BUYER }).datumCbor;
  /** A listing of a stranger's, sitting under this wallet's stake key. */
  const STRANGER_DATUM = listingRow({ owner: STRANGER, stake: STAKE, sellerAddress: preprodAddress(STRANGER, STAKE) }).datumCbor;

  const amount = [{ unit: 'lovelace', quantity: '2000000' }];
  const spend = (address: string, inline_datum: string | null = null) => ({
    address, amount, tx_hash: 'aa'.repeat(32), output_index: 0, data_hash: null, inline_datum, reference_script_hash: null, collateral: false, reference: false,
  });
  const produce = (address: string, inline_datum: string | null = null) => ({
    address, amount, output_index: 0, data_hash: null, inline_datum, collateral: false, reference_script_hash: null, consumed_by_tx: null,
  });

  const market = buildClassifyContext(
    { stakeAddress: Cardano.RewardAddress.fromCredentials(Cardano.NetworkId.Testnet, { hash: Hash28ByteBase16(STAKE), type: Cardano.CredentialType.KeyHash }).toAddress().toBech32(), network: 'Preprod' },
    { payment: [{ address: OWN, cred: OWNER }], change: [{ address: OWN_CHANGE, cred: OWNER_B }] },
    {},
  );

  const actions = (inputs: unknown[], outputs: unknown[], context = market) =>
    geroMarketActions(tx({ utxo: { inputs, outputs } }), context);

  const tagsOf = (inputs: unknown[], outputs: unknown[], context = market) => {
    const item = tx({ utxo: { inputs, outputs } });
    return buildTxTags(item, context, t, classifyTxKind(item, context)).filter((tag) => tag.key.startsWith('gero-market-'));
  };

  describe('the six actions, from which side the wallet is on', () => {
    it('listed: the wallet funds a transaction that creates a listing under its own stake key', () => {
      expect(actions([spend(OWN)], [produce(OWN_LISTING, OWN_DATUM), produce(OWN_CHANGE)])).toEqual(['listed']);
      expect(tagsOf([spend(OWN)], [produce(OWN_LISTING, OWN_DATUM), produce(OWN_CHANGE)])).toEqual([{ key: 'gero-market-listed', label: 'nftMarket.activity.listed' }]);
    });

    it('repriced: the wallet spends its own listing and creates one under its own stake key', () => {
      expect(actions([spend(OWN_LISTING, OWN_DATUM), spend(OWN)], [produce(OWN_LISTING, OWN_DATUM), produce(OWN_CHANGE)])).toEqual(['repriced']);
      expect(tagsOf([spend(OWN_LISTING, OWN_DATUM), spend(OWN)], [produce(OWN_LISTING, OWN_DATUM)])).toEqual([{ key: 'gero-market-repriced', label: 'nftMarket.activity.repriced' }]);
    });

    it('cancelled: the wallet spends its own listing, funds the transaction and creates no listing', () => {
      expect(actions([spend(OWN_LISTING, OWN_DATUM), spend(OWN)], [produce(OWN), produce(OWN_CHANGE)])).toEqual(['cancelled']);
      expect(tagsOf([spend(OWN_LISTING, OWN_DATUM), spend(OWN)], [produce(OWN)])).toEqual([{ key: 'gero-market-cancelled', label: 'nftMarket.activity.cancelled' }]);
    });

    it('sold: a buyer spends the wallet\'s own listing, and none of the funding is the wallet\'s', () => {
      expect(actions([spend(OWN_LISTING, OWN_DATUM), spend(BUYER)], [produce(OWN), produce(FEE), produce(BUYER)])).toEqual(['sold']);
      expect(tagsOf([spend(OWN_LISTING, OWN_DATUM), spend(BUYER)], [produce(OWN), produce(FEE), produce(BUYER)])).toEqual([{ key: 'gero-market-sold', label: 'nftMarket.activity.sold' }]);
    });

    it('bought: the wallet funds a transaction that spends someone else\'s listing', () => {
      expect(actions([spend(FOREIGN_LISTING, 'd8799f00ff'), spend(OWN)], [produce(BUYER), produce(FEE), produce(OWN)])).toEqual(['bought']);
      expect(tagsOf([spend(FOREIGN_LISTING), spend(OWN)], [produce(OWN), produce(FEE)])).toEqual([{ key: 'gero-market-bought', label: 'nftMarket.activity.bought' }]);
    });

    it('moved: a closed marketplace\'s listing is spent and a Gero listing is created, in one transaction (not also "listed")', () => {
      expect(actions([spend(LEGACY), spend(OWN)], [produce(OWN_LISTING, OWN_DATUM), produce(OWN_CHANGE)])).toEqual(['moved']);
      expect(tagsOf([spend(LEGACY), spend(OWN)], [produce(OWN_LISTING, OWN_DATUM)])).toEqual([{ key: 'gero-market-moved', label: 'nftMarket.activity.moved' }]);
    });

    it('a move of an item whose legacy owner is another key of the wallet is still moved', () => {
      expect(actions([spend(LEGACY), spend(OWN_CHANGE)], [produce(OWN_LISTING, OWN_DATUM)])).toEqual(['moved']);
    });
  });

  describe('nothing for what is not a Gero market transaction', () => {
    it('an unrelated script, and plain transfers, get no market tag', () => {
      expect(actions([spend(OWN)], [produce(UNRELATED_SCRIPT, OWN_DATUM), produce(OWN_CHANGE)])).toEqual([]);
      expect(actions([spend(UNRELATED_SCRIPT), spend(OWN)], [produce(OWN)])).toEqual([]);
      expect(actions([spend(OWN)], [produce(BUYER), produce(OWN_CHANGE)])).toEqual([]);
      expect(actions([], [])).toEqual([]);
      expect(tagsOf([spend(UNRELATED_SCRIPT)], [produce(OWN)])).toEqual([]);
    });

    it('a legacy spend with no Gero listing created is a rescue (Get back), not a move', () => {
      expect(actions([spend(LEGACY), spend(OWN)], [produce(OWN)])).toEqual([]);
    });

    it('the Minswap order address used by other specs is not a market script', () => {
      expect(actions([spend(OWN)], [produce(MINSWAP_V2_ORDER_STAKED)])).toEqual([]);
    });
  });

  describe('isGeroMarket matches the network\'s deployment script hashes and nothing else', () => {
    it('is true for any input or output at a configured deployment, and false for another script', () => {
      expect(isGeroMarket(tx({ utxo: { inputs: [spend(OWN)], outputs: [produce(OWN_LISTING)] } }), market)).toBe(true);
      expect(isGeroMarket(tx({ utxo: { inputs: [spend(FOREIGN_LISTING)], outputs: [produce(OWN)] } }), market)).toBe(true);
      expect(isGeroMarket(tx({ utxo: { inputs: [spend(OWN)], outputs: [produce(UNRELATED_SCRIPT)] } }), market)).toBe(false);
      expect(isGeroMarket(tx({ utxo: { inputs: [spend(OWN)], outputs: [produce(BUYER)] } }), market)).toBe(false);
    });

    it('reads the hashes from the deployments of the wallet\'s network: preprod has v1, mainnet has none yet', () => {
      expect([...(market.marketScriptHashes ?? [])]).toEqual([V1.scriptHash]);
      const mainnet = buildClassifyContext({ stakeAddress: market.stakeAddress, network: 'Mainnet' }, null, null);
      expect(mainnet.marketScriptHashes?.size ?? 0).toBe(0);
      // A transaction at the preprod script means nothing on a network that configures no deployment.
      expect(isGeroMarket(tx({ utxo: { inputs: [spend(OWN)], outputs: [produce(OWN_LISTING)] } }), mainnet)).toBe(false);
      expect(geroMarketActions(tx({ utxo: { inputs: [spend(OWN)], outputs: [produce(OWN_LISTING, OWN_DATUM)] } }), mainnet)).toEqual([]);
    });

    it('a Bitcoin wallet has no market scripts', () => {
      const bitcoin = buildClassifyContext({ stakeAddress: undefined, network: 'Mainnet', chain: 'Bitcoin' }, null, null);
      expect(bitcoin.marketScriptHashes?.size ?? 0).toBe(0);
    });

    it('follows every deployment of the network: a superseded script still tags its listings', () => {
      const v2Hash = 'c2'.repeat(28);
      const both = { ...market, marketScriptHashes: new Set([V1.scriptHash, v2Hash]) };
      expect(geroMarketActions(tx({ utxo: { inputs: [spend(OWN)], outputs: [produce(scriptAddress(v2Hash, STAKE), OWN_DATUM)] } }), both)).toEqual(['listed']);
    });

    it('a context built by hand for a mainnet deployment (none is configured yet) classifies the same way', () => {
      const hash = 'd3'.repeat(28);
      const mainnetLike = { ...market, network: 'Mainnet', marketScriptHashes: new Set([hash]) };
      expect(geroMarketActions(tx({ utxo: { inputs: [spend(OWN)], outputs: [produce(scriptAddress(hash, STAKE))] } }), mainnetLike)).toEqual(['listed']);
    });
  });

  describe('a transaction cannot be made to look like the wallet\'s own', () => {
    it('a stranger\'s listing locked under the wallet\'s stake key is not "listed" (no input of the wallet funds it)', () => {
      expect(actions([spend(BUYER)], [produce(OWN_LISTING, STRANGER_DATUM)])).toEqual([]);
    });

    it('not even a listing whose datum names the wallet: a transaction the wallet did not fund is not one it made', () => {
      // Someone else locks an NFT for the wallet (owner and seller both the wallet's): it is the wallet's to cancel, but not its listing action.
      expect(actions([spend(BUYER)], [produce(OWN_LISTING, OWN_DATUM)])).toEqual([]);
      expect(actions([spend(BUYER)], [produce(OWN_LISTING)])).toEqual([]);
      expect(actions([spend(LEGACY), spend(BUYER)], [produce(OWN_LISTING, OWN_DATUM)])).toEqual([]);
    });

    it('nor is a reprice or a cancel of the wallet\'s listing one it made when its own inputs fund none of it', () => {
      expect(actions([spend(OWN_LISTING, OWN_DATUM), spend(BUYER)], [produce(OWN_LISTING, OWN_DATUM)])).toEqual([]);
    });

    it('a listing created under another stake key is not "listed" by this wallet', () => {
      expect(actions([spend(OWN)], [produce(FOREIGN_LISTING, OWN_DATUM)])).toEqual([]);
    });

    it('a created listing whose datum does not name the wallet as owner and seller is not "listed"', () => {
      expect(actions([spend(OWN)], [produce(OWN_LISTING, FAKE_DATUM)])).toEqual([]);
      expect(actions([spend(OWN)], [produce(OWN_LISTING, STRANGER_DATUM)])).toEqual([]);
    });

    it('a created listing whose datum cannot be read is not "listed" either', () => {
      expect(actions([spend(OWN)], [produce(OWN_LISTING, 'zz')])).toEqual([]);
      expect(actions([spend(OWN)], [produce(OWN_LISTING, 'd8799f00ff')])).toEqual([]);
    });

    it('"sold" needs a spent listing whose datum names the wallet as owner AND seller', () => {
      const buyerFunded = [spend(BUYER)];
      const outputs = [produce(OWN), produce(FEE), produce(BUYER)];
      expect(actions([spend(OWN_LISTING, FAKE_DATUM), ...buyerFunded], outputs)).toEqual([]);
      expect(actions([spend(OWN_LISTING, STRANGER_DATUM), ...buyerFunded], outputs)).toEqual([]);
      expect(actions([spend(OWN_LISTING, null), ...buyerFunded], outputs)).toEqual([]);
      expect(actions([spend(OWN_LISTING, OWN_DATUM), ...buyerFunded], outputs)).toEqual(['sold']);
    });

    it('a collateral or reference input at the script is not a spend of the listing', () => {
      const reference = { ...spend(OWN_LISTING, OWN_DATUM), reference: true };
      const collateral = { ...spend(OWN_LISTING, OWN_DATUM), collateral: true };
      expect(actions([reference, spend(BUYER)], [produce(OWN)])).toEqual([]);
      expect(actions([collateral, spend(BUYER)], [produce(OWN)])).toEqual([]);
    });

    it('"bought" needs the wallet to fund the transaction', () => {
      expect(actions([spend(FOREIGN_LISTING), spend(BUYER)], [produce(OWN)])).toEqual([]);
    });

    it('a wallet whose stake address cannot be read gets no wallet-side tag, and nothing throws', () => {
      const unreadable = buildClassifyContext({ stakeAddress: 'stake_test1me', network: 'Preprod' }, { payment: [{ address: OWN, cred: OWNER }], change: [] }, {});
      expect(actions([spend(OWN_LISTING, OWN_DATUM), spend(BUYER)], [produce(OWN)], unreadable)).toEqual([]);
      expect(actions([spend(OWN)], [produce(OWN_LISTING, OWN_DATUM)], unreadable)).toEqual([]);
      const none = buildClassifyContext(undefined, undefined, undefined);
      expect(actions([spend(OWN)], [produce(OWN_LISTING, OWN_DATUM)], none)).toEqual([]);
    });

    it('a pending transaction (no utxo set yet) and a record without inputs get no tag', () => {
      expect(geroMarketActions(tx({ pending: true, utxo: null }), market)).toEqual([]);
      expect(geroMarketActions(tx({ utxo: { inputs: [], outputs: [produce(OWN_LISTING, OWN_DATUM)] } }), market)).toEqual([]);
    });

    it('blank input addresses (a live-synced record) never throw', () => {
      expect(actions([{ ...spend(''), address: undefined }, spend(OWN)], [produce(OWN)])).toEqual([]);
    });
  });
});
