// NFT_MARKET_PREPARE_{LIST,REPRICE,CANCEL,BUY,MIGRATE}: the worker turns what the user asked for
// into one verified, unsigned market transaction. Nexus and the chain reads are stubs; the
// verifiers (verifyListing, verifyBuy, verifyMigrate), the royalty computation, the signing guard
// and the allowance are the real ones, so the context the worker builds for them is part of what
// is pinned here: a transaction Nexus builds correctly must be accepted, and one that is wrong
// must come back as VERIFY_FAILED with a rule, never as a transaction.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16, Hash32ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { minAdaRequired } from '@cardano-sdk/tx-construction';
import { Blockchain, Network } from '@/models/types';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { SENDER, TARGET } from '@/chrome/config';
import type { LegacyListingItem } from '@/api/legacy-listings-api';
import type { NftMarketBuildResponse } from '@/api/nexus-tx-api';
import type { ListingDto, RoyaltyInfo } from '@/api/nft-market-api';
import { inlineDatumFromCbor } from '@/shared/utils/utxoCbor';
import { LEGACY_SCRIPTS } from '@/utils/legacyMarketScripts';
import {
  MIN_LIST_PRICE,
  NFT_MARKET_DEPLOYMENTS_PREPROD,
  isNftMarketHardware,
  type NftMarketDeployment,
} from '@/utils/nftMarketDeployments';
import { listingFee, listingTag, sellerDue, type ListingDatum, type Payee } from './listingDatum';
import { ListingUtxoError, type ListingChainUtxo } from './listingChainUtxo';
import {
  clearMarketSignAllowance,
  grantMarketSignAllowance,
  hasMarketSignAllowance,
} from './marketAllowance';
import { findMarketTouch } from './marketGuard';
import type { OwnListing } from './ownListings';
import { MarketPrepareError, marketPrepareHandler, royaltyOutputMinUtxo, type MarketAction, type MarketHandlerDeps } from './marketPrepare';
import { verifyCancel, verifyList, verifyReprice } from './verifyListing';
import { verifyBuy } from './verifyBuy';
import { verifyMigrate } from './verifyMigrate';

// The hardware gate ships empty; a test opens it by handing the real check another answer.
vi.mock('@/utils/nftMarketDeployments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/nftMarketDeployments')>();
  return { ...actual, isNftMarketHardware: vi.fn(actual.isNftMarketHardware) };
});

// The real verifiers, observed: the context the worker builds for them is part of what is pinned.
vi.mock('./verifyListing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./verifyListing')>();
  return {
    ...actual,
    verifyList: vi.fn(actual.verifyList),
    verifyReprice: vi.fn(actual.verifyReprice),
    verifyCancel: vi.fn(actual.verifyCancel),
  };
});
vi.mock('./verifyBuy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./verifyBuy')>();
  return { ...actual, verifyBuy: vi.fn(actual.verifyBuy) };
});
vi.mock('./verifyMigrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./verifyMigrate')>();
  return { ...actual, verifyMigrate: vi.fn(actual.verifyMigrate) };
});

const TESTNET = Cardano.NetworkId.Testnet;
const MAINNET = Cardano.NetworkId.Mainnet;
const ADA = 1_000_000n;
const CPB = 4_310n;

// ---------------------------------------------------------------------------------------------
// Datum encoder (test side): indefinite-length constructors, as Nexus writes them
// ---------------------------------------------------------------------------------------------

const hex2 = (n: number) => n.toString(16).padStart(2, '0');
const bstr = (h: string) => `58${hex2(h.length / 2)}${h}`;
const NONE = 'd87a80';

function uint(n: bigint): string {
  if (n < 24n) return n.toString(16).padStart(2, '0');
  if (n < 0x100n) return `18${n.toString(16).padStart(2, '0')}`;
  if (n < 0x10000n) return `19${n.toString(16).padStart(4, '0')}`;
  if (n < 0x100000000n) return `1a${n.toString(16).padStart(8, '0')}`;
  return `1b${n.toString(16).padStart(16, '0')}`;
}

const constr = (index: 0 | 1, fields: string[]) => `${index === 0 ? 'd879' : 'd87a'}9f${fields.join('')}ff`;
const credentialData = (c: Cardano.Credential) => constr(c.type === Cardano.CredentialType.KeyHash ? 0 : 1, [bstr(c.hash)]);

function addressData(bech32: string): string {
  const address = Cardano.Address.fromBech32(bech32);
  const base = address.asBase();
  if (base) {
    return constr(0, [credentialData(base.getPaymentCredential()), constr(0, [constr(0, [credentialData(base.getStakeCredential())])])]);
  }
  return constr(0, [credentialData(address.asEnterprise()!.getPaymentCredential()), NONE]);
}

const payeeData = (p: Payee) => constr(0, [addressData(p.address), uint(p.lovelace)]);

function listingDatumHex(d: ListingDatum): string {
  return constr(0, [
    bstr(d.owner),
    addressData(d.sellerAddress),
    uint(d.price),
    `9f${d.royalties.map(payeeData).join('')}ff`,
    d.buyer === null ? NONE : constr(0, [bstr(d.buyer)]),
  ]);
}

// ---------------------------------------------------------------------------------------------
// The wallet (preprod): two payment keys under one stake key
// ---------------------------------------------------------------------------------------------

const OWNER = '1864a6eb4242da06750913784d9afb549dc3022d01bbd316530f390c';
const OWNER_B = 'b551db0a6c4f3e1d2a90b7c85e4f13d6a7b8c9d0e1f2a3b4c5d6e7f8';
const STAKE = '5ce6d8a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829';
const STRANGER = '77'.repeat(28);

function baseAddress(networkId: Cardano.NetworkId, payment: string, stake: string, paymentIsScript = false): string {
  return Cardano.BaseAddress.fromCredentials(
    networkId,
    { hash: Hash28ByteBase16(payment), type: paymentIsScript ? Cardano.CredentialType.ScriptHash : Cardano.CredentialType.KeyHash },
    { hash: Hash28ByteBase16(stake), type: Cardano.CredentialType.KeyHash },
  ).toAddress().toBech32();
}

const RECEIVE = baseAddress(TESTNET, OWNER, STAKE);
const CHANGE = baseAddress(TESTNET, OWNER_B, STAKE);
const FOREIGN = baseAddress(TESTNET, STRANGER, '88'.repeat(28));
const ROYALTY_ADDRESS = baseAddress(TESTNET, '41'.repeat(28), '42'.repeat(28));
const ROYALTY_ADDRESS_2 = baseAddress(TESTNET, '43'.repeat(28), '44'.repeat(28));

const KEYS = {
  payment: [{ address: RECEIVE, cred: OWNER, path: "m/1852'/1815'/0'/0/0" }],
  change: [{ address: CHANGE, cred: OWNER_B, path: "m/1852'/1815'/0'/1/0" }],
  stake: [{ cred: STAKE, path: "m/1852'/1815'/0'/2/0" }],
};

// v2 is the newest deployment (new listings go there); v1 is the real preprod one.
const V1: NftMarketDeployment = NFT_MARKET_DEPLOYMENTS_PREPROD[0];
const V2: NftMarketDeployment = { ...V1, version: 2, scriptHash: 'c2'.repeat(28), referenceScript: `${'d2'.repeat(32)}#0` };
const DEPLOYMENTS: readonly NftMarketDeployment[] = [V2, V1];
const LISTING_V1 = baseAddress(TESTNET, V1.scriptHash, STAKE, true);
const LISTING_V2 = baseAddress(TESTNET, V2.scriptHash, STAKE, true);

const POLICY = 'aa'.repeat(28);
const NAME = Buffer.from('Gero NFT').toString('hex');
const ASSET_NAME_222 = `000de140${NAME}`;
const UNIT_222 = `${POLICY}${ASSET_NAME_222}`;
const UNIT_100 = `${POLICY}000643b0${NAME}`;
const UNIT_PLAIN = `${'bb'.repeat(28)}${Buffer.from('Plain NFT').toString('hex')}`;

const NFT_TX = 'a1'.repeat(32);
const FEE_TX = '7d'.repeat(32);
const LISTING_TX = 'b1'.repeat(32);
const OTHER_LISTING_TX = 'b2'.repeat(32);
const SPONSORED_TX = 'aa'.repeat(32);
const LISTING_REF = `${LISTING_TX}#0`;
const OTHER_LISTING_REF = `${OTHER_LISTING_TX}#0`;
const SPONSORED_REF = `${SPONSORED_TX}#2`;

const txIn = (txId: string, index: number): Cardano.TxIn => ({ txId: Cardano.TransactionId(txId), index });
const refIn = (ref: string) => txIn(ref.split('#')[0], Number(ref.split('#')[1]));

function utxo(txId: string, index: number, address: string, coins: bigint, assets?: Record<string, bigint>): Cardano.Utxo {
  return [
    { txId: Cardano.TransactionId(txId), index, address: address as Cardano.PaymentAddress },
    {
      address: address as Cardano.PaymentAddress,
      value: { coins, ...(assets ? { assets: new Map(Object.entries(assets)) as Cardano.TokenMap } : {}) },
    },
  ] as Cardano.Utxo;
}

const NFT_IN = txIn(NFT_TX, 0);
const FEE_IN = txIn(FEE_TX, 0);
const LISTING_IN = txIn(LISTING_TX, 0);
const NFT_UTXO = utxo(NFT_TX, 0, RECEIVE, 2n * ADA, { [UNIT_222]: 1n });
const FEE_UTXO = utxo(FEE_TX, 0, RECEIVE, 10n * ADA);
/** The dApp-collateral UTxO the wallet keeps aside: never offered to a builder as a fee input. */
const RESERVED = utxo('99'.repeat(32), 0, RECEIVE, 5n * ADA);
/** The wallet's own stake key at a listing script: synced as the wallet's, never a fee input. */
const AT_SCRIPT = utxo('ee'.repeat(32), 3, LISTING_V1, 50n * ADA);

const assets = (unit: string, quantity = 1n) => new Map([[Cardano.AssetId(unit), quantity]]) as Cardano.TokenMap;
const plutusData = (cbor: string) => Serialization.PlutusData.fromCbor(HexBlob(cbor)).toCore();
const inline = (cbor: string) => inlineDatumFromCbor(HexBlob(cbor));
const redeemer = (index: number, cbor: string): Cardano.Redeemer => ({
  purpose: Cardano.RedeemerPurpose.spend,
  index,
  data: plutusData(cbor),
  executionUnits: { memory: 600_000, steps: 250_000_000 },
});

// ---------------------------------------------------------------------------------------------
// Datums and listings
// ---------------------------------------------------------------------------------------------

const PRICE = 100n * ADA;
const DEPOSIT = 2n * ADA;
const ROYALTIES: Payee[] = [{ address: ROYALTY_ADDRESS, lovelace: 5n * ADA }];
const DATUM: ListingDatum = { owner: OWNER, sellerAddress: RECEIVE, price: PRICE, royalties: ROYALTIES, buyer: null };

/** The wallet's own listing at v1 (an older deployment), as the worker's store holds it. */
const OWN_LISTING: OwnListing = {
  ref: LISTING_REF,
  unit: UNIT_222,
  datum: DATUM,
  depositLovelace: DEPOSIT.toString(),
  deploymentVersion: 1,
};
const OTHER_OWN_LISTING: OwnListing = { ...OWN_LISTING, ref: OTHER_LISTING_REF, unit: UNIT_PLAIN };

/** CIP-27 terms: 5% to one recipient. At 100 ADA that is the 5 ADA in DATUM. */
const FIVE_PERCENT: RoyaltyInfo = {
  source: 'cip27',
  rate: 0.05,
  recipients: [{ address: ROYALTY_ADDRESS, rate: 0.05, minFeeLovelace: null, maxFeeLovelace: null }],
};
const NO_ROYALTY: RoyaltyInfo = { source: 'none', rate: 0, recipients: [] };

// ---------------------------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------------------------

type Built = { cbor: string; id: string };

function build(tx: Cardano.Tx, edit: (tx: Cardano.Tx) => void = () => undefined): Built {
  edit(tx);
  const serialized = Serialization.Transaction.fromCore(tx);
  return { cbor: serialized.toCbor(), id: serialized.getId() };
}

const WINDOW = { invalidBefore: Cardano.Slot(1000), invalidHereafter: Cardano.Slot(1000 + 1920) };

const listingOutput = (address: string, datum: ListingDatum, unit = UNIT_222, coins = DEPOSIT): Cardano.TxOut => ({
  address: Cardano.PaymentAddress(address),
  value: { coins, assets: assets(unit) },
  datum: inline(listingDatumHex(datum)),
});

/** A valid list: the NFT input and a fee input; the listing at the newest deployment, then change. */
const listTxFor = (listingAddress: string, change: string, datum: ListingDatum, edit?: (tx: Cardano.Tx) => void): Built => build({
  id: Cardano.TransactionId('00'.repeat(32)),
  body: {
    inputs: [NFT_IN, FEE_IN],
    outputs: [
      listingOutput(listingAddress, datum),
      { address: Cardano.PaymentAddress(change), value: { coins: 9_800_000n } },
    ],
    fee: 200_000n,
    validityInterval: { invalidBefore: Cardano.Slot(1000), invalidHereafter: Cardano.Slot(1600) },
  },
  witness: { signatures: new Map() },
  isValid: true,
}, edit);
const listTx = (datum: ListingDatum = DATUM, edit?: (tx: Cardano.Tx) => void): Built => listTxFor(LISTING_V2, CHANGE, datum, edit);

// Body order [LISTING, FEE]; the ledger sorts by id, so FEE (7d) is 0 and LISTING (b1) is 1.
const LISTING_SORTED = 1;

function cancelBody(): Cardano.Tx {
  return {
    id: Cardano.TransactionId('00'.repeat(32)),
    body: {
      inputs: [LISTING_IN, FEE_IN],
      outputs: [
        { address: Cardano.PaymentAddress(RECEIVE), value: { coins: DEPOSIT, assets: assets(UNIT_222) } },
        { address: Cardano.PaymentAddress(CHANGE), value: { coins: 9_600_000n } },
      ],
      fee: 400_000n,
      validityInterval: WINDOW,
      collaterals: [FEE_IN],
      collateralReturn: { address: Cardano.PaymentAddress(CHANGE), value: { coins: 8_000_000n } },
      totalCollateral: 2_000_000n,
      referenceInputs: [refIn(V1.referenceScript)],
      requiredExtraSignatures: [Ed25519KeyHashHex(OWNER)],
      scriptIntegrityHash: Hash32ByteBase16('ab'.repeat(32)),
    },
    witness: { signatures: new Map(), redeemers: [redeemer(LISTING_SORTED, 'd87a80')] },
    isValid: true,
  };
}
const cancelTx = (edit?: (tx: Cardano.Tx) => void): Built => build(cancelBody(), edit);

const REPRICED_PRICE = 80n * ADA;
const repriceTx = (edit?: (tx: Cardano.Tx) => void): Built => {
  const tx = cancelBody();
  tx.body.outputs = [
    listingOutput(LISTING_V1, { ...DATUM, price: REPRICED_PRICE }),
    { address: Cardano.PaymentAddress(CHANGE), value: { coins: 9_600_000n } },
  ];
  return build(tx, edit);
};

/** The cancel with the lent Nexus pool UTxO as its collateral. */
const pooledCancelTx = (): Built => cancelTx((tx) => {
  tx.body.collaterals = [refIn(SPONSORED_REF)];
  delete tx.body.collateralReturn;
  delete tx.body.totalCollateral;
});

// ---------------------------------------------------------------------------------------------
// A buy of somebody else's listing (the wallet is the buyer)
// ---------------------------------------------------------------------------------------------

const SELLER_PKH = '2a'.repeat(28);
const SELLER_ADDRESS = baseAddress(TESTNET, SELLER_PKH, '2b'.repeat(28));
const SALE_DATUM: ListingDatum = { owner: SELLER_PKH, sellerAddress: SELLER_ADDRESS, price: PRICE, royalties: ROYALTIES, buyer: null };
const BUYER_COINS = 2000n * ADA;
const BUYER_UTXO = utxo(FEE_TX, 0, CHANGE, BUYER_COINS);
const SALE_TX = 'c1'.repeat(32);
const SALE_REF = `${SALE_TX}#0`;
const SALE_IN = txIn(SALE_TX, 0);

function saleDto(datum: ListingDatum = SALE_DATUM, over: Partial<ListingDto> = {}): ListingDto {
  return {
    txHash: SALE_TX,
    outputIndex: 0,
    version: 1,
    scriptHash: V1.scriptHash,
    unit: UNIT_222,
    policyId: POLICY,
    assetName: ASSET_NAME_222,
    priceLovelace: datum.price.toString(),
    feeLovelace: listingFee(datum.price, V1).toString(),
    royalties: datum.royalties.map((r) => ({ address: r.address, lovelace: r.lovelace.toString() })),
    depositLovelace: DEPOSIT.toString(),
    sellerAddress: datum.sellerAddress,
    ownerPkh: datum.owner,
    listedSlot: 1234,
    datumCbor: listingDatumHex(datum),
    ...over,
  };
}

/** What an independent read of the listing UTxO reports when Nexus tells the truth. */
const chainOf = (listing: ListingDto): ListingChainUtxo => ({
  ref: `${listing.txHash}#${listing.outputIndex}`,
  address: baseAddress(TESTNET, listing.scriptHash, '2c'.repeat(28), true),
  lovelace: BigInt(listing.depositLovelace),
  assets: [{ unit: listing.unit, quantity: 1n }],
  inlineDatumCbor: listing.datumCbor,
});

const tagDatum = () => inline(`5820${listingTag(SALE_TX, 0)}`);
const payOut = (address: string, coins: bigint, datum: Cardano.PlutusData | null = tagDatum()): Cardano.TxOut => ({
  address: Cardano.PaymentAddress(address),
  value: { coins },
  ...(datum ? { datum } : {}),
});
/** What a builder pays a payee: the due, raised to the output's min-UTxO (the SDK's own figure). */
function paidTo(address: string, due: bigint): bigint {
  const min = minAdaRequired(payOut(address, due), CPB);
  return due >= min ? due : minAdaRequired(payOut(address, min), CPB);
}

/** A valid buy: fee output, seller, royalty, the NFT to the buyer, change (derived so it balances). */
function buyTx(edit?: (tx: Cardano.Tx) => void): Built {
  const fee = listingFee(SALE_DATUM.price, V1);
  const outputs: Cardano.TxOut[] = [
    payOut(V1.feeAddress, fee, null),
    payOut(SELLER_ADDRESS, paidTo(SELLER_ADDRESS, sellerDue(SALE_DATUM, V1, DEPOSIT))),
    ...SALE_DATUM.royalties.map((r) => payOut(r.address, paidTo(r.address, r.lovelace))),
    { address: Cardano.PaymentAddress(RECEIVE), value: { coins: 1_500_000n, assets: assets(UNIT_222) } },
  ];
  const paid = outputs.reduce((sum, o) => sum + o.value.coins, 0n);
  outputs.push({ address: Cardano.PaymentAddress(CHANGE), value: { coins: BUYER_COINS + DEPOSIT - paid - 400_000n } });
  return build({
    id: Cardano.TransactionId('00'.repeat(32)),
    body: {
      inputs: [SALE_IN, FEE_IN],
      outputs,
      fee: 400_000n,
      validityInterval: WINDOW,
      collaterals: [FEE_IN],
      collateralReturn: { address: Cardano.PaymentAddress(CHANGE), value: { coins: BUYER_COINS - 2n * ADA } },
      totalCollateral: 2n * ADA,
      referenceInputs: [refIn(V1.referenceScript)],
      scriptIntegrityHash: Hash32ByteBase16('ab'.repeat(32)),
    },
    // Sorted inputs: FEE (7d) 0, SALE (c1) 1; first_output is 1 (after the fee output).
    witness: { signatures: new Map(), redeemers: [redeemer(1, 'd8799f01ff')] },
    isValid: true,
  }, edit);
}

// ---------------------------------------------------------------------------------------------
// A migrate (mainnet: the legacy contracts exist nowhere else; the Gero list is a TEST list)
// ---------------------------------------------------------------------------------------------

const M_RECEIVE = baseAddress(MAINNET, OWNER, STAKE);
const M_CHANGE = baseAddress(MAINNET, OWNER_B, STAKE);
const M_ROYALTY = baseAddress(MAINNET, '41'.repeat(28), '42'.repeat(28));
const M_KEYS = {
  payment: [{ address: M_RECEIVE, cred: OWNER, path: "m/1852'/1815'/0'/0/0" }],
  change: [{ address: M_CHANGE, cred: OWNER_B, path: "m/1852'/1815'/0'/1/0" }],
  stake: [{ cred: STAKE, path: "m/1852'/1815'/0'/2/0" }],
};
const M_LISTING_V2 = baseAddress(MAINNET, V2.scriptHash, STAKE, true);
const V3 = LEGACY_SCRIPTS.legacy_v3;
const V3_NFT = '22d843e9e8b39d105c645944cc848abee2673d64e60f1f022791ec85457175696e6550696f6e656572536b696e3034363031';

const itemOf = (over: Partial<LegacyListingItem> = {}): LegacyListingItem => ({
  txHash: 'fb150415126b92a47b46b3a8214d138bdbaab124615afaf8f4d612dd3c16c165',
  outputIndex: 0,
  contract: 'legacy_v3',
  kind: 'listing',
  ownerPkh: OWNER,
  lovelace: '1361960',
  assets: [{ unit: V3_NFT, quantity: '1' }],
  ...over,
});
const V3_LISTING = itemOf();
const V3_REF = `${V3_LISTING.txHash}#${V3_LISTING.outputIndex}`;
const M_FEE_UTXO = utxo(FEE_TX, 0, M_RECEIVE, 10n * ADA);
const M_DATUM: ListingDatum = {
  owner: OWNER,
  sellerAddress: M_RECEIVE,
  price: PRICE,
  royalties: [{ address: M_ROYALTY, lovelace: 5n * ADA }],
  buyer: null,
};
const M_FIVE_PERCENT: RoyaltyInfo = {
  source: 'cip27',
  rate: 0.05,
  recipients: [{ address: M_ROYALTY, rate: 0.05, minFeeLovelace: null, maxFeeLovelace: null }],
};

function migrateTx(datum: ListingDatum = M_DATUM, edit?: (tx: Cardano.Tx) => void): Built {
  return build({
    id: Cardano.TransactionId('00'.repeat(32)),
    body: {
      inputs: [txIn(V3_LISTING.txHash, 0), FEE_IN],
      outputs: [
        {
          address: Cardano.PaymentAddress(M_LISTING_V2),
          value: { coins: DEPOSIT, assets: assets(V3_NFT) },
          datum: inline(listingDatumHex(datum)),
        },
        { address: Cardano.PaymentAddress(M_RECEIVE), value: { coins: 8_961_960n } },
      ],
      fee: 400_000n,
      validityInterval: WINDOW,
      collaterals: [FEE_IN],
      collateralReturn: { address: Cardano.PaymentAddress(M_RECEIVE), value: { coins: 9_400_000n } },
      totalCollateral: 600_000n,
      referenceInputs: [refIn(V3.referenceScript)],
      requiredExtraSignatures: [Ed25519KeyHashHex(OWNER)],
      scriptIntegrityHash: Hash32ByteBase16('ab'.repeat(32)),
    },
    // Sorted inputs: FEE (7d) 0, the legacy listing (fb) 1.
    witness: { signatures: new Map(), redeemers: [redeemer(1, V3.cancelRedeemerCbor)] },
    isValid: true,
  }, edit);
}

// ---------------------------------------------------------------------------------------------
// The rig: deps with stubs for everything that leaves the worker
// ---------------------------------------------------------------------------------------------

interface Reply {
  id: unknown;
  data: {
    success: boolean;
    result?: { txCbor: string; txId: string; summary: Record<string, unknown> };
    error?: string;
    errorCode?: string;
    [field: string]: unknown;
  };
  target: string;
  sender: string;
}

interface Wallet {
  id: number;
  chain: string;
  network: string;
  type: string;
  baseAddress: string;
}
type State = ReturnType<MarketHandlerDeps['getState']>;

const PREPROD_WALLET: Wallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: 'Normal', baseAddress: RECEIVE };
const MAINNET_WALLET: Wallet = { id: 1, chain: Blockchain.CARDANO, network: Network.MAINNET, type: 'Normal', baseAddress: M_RECEIVE };

const response = (tx: Built, extra: Partial<NftMarketBuildResponse> = {}): NftMarketBuildResponse => ({
  tx_cbor: tx.cbor,
  tx_hash: tx.id,
  estimated_fee: '200000',
  requiredSigners: [],
  ...extra,
});

const nexusError = (errorCode: string, message = 'Nexus says no') =>
  Object.assign(new Error(message), { response: { status: 422, data: { errorCode } } });

interface RigOptions {
  wallet?: Wallet | null;
  state?: State;
  deployments?: readonly NftMarketDeployment[];
  built?: NftMarketBuildResponse;
  royalties?: RoyaltyInfo | Error;
  listing?: ListingDto | Error;
  chain?: ListingChainUtxo | Error;
  legacy?: LegacyListingItem[] | Error;
  buildError?: Error;
  booted?: () => Promise<unknown>;
}

function rig(options: RigOptions = {}) {
  let wallet: Wallet | null = options.wallet === undefined ? PREPROD_WALLET : options.wallet;
  const state: State = options.state ?? {
    utxos: [NFT_UTXO, FEE_UTXO],
    keys: KEYS,
    collateral: null,
    listedListings: [OWN_LISTING, OTHER_OWN_LISTING],
    coinsPerUtxoByte: 4310,
  };
  const built = options.built ?? response(listTx());
  const settle = <T>(value: T | Error): Promise<T> => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value));
  const builder = () => vi.fn(async (_request: unknown, _network: string) => {
    if (options.buildError) throw options.buildError;
    return built;
  });
  const calls = {
    list: builder(),
    reprice: builder(),
    cancel: builder(),
    buy: builder(),
    migrate: builder(),
  };
  const deps: MarketHandlerDeps = {
    booted: options.booted ?? (async () => undefined),
    getWallet: () => wallet,
    getState: () => state,
    deployments: () => options.deployments ?? DEPLOYMENTS,
    build: calls,
    lookupListing: vi.fn(async () => settle(options.listing ?? saleDto())),
    lookupChainUtxo: vi.fn(async () => settle(options.chain ?? chainOf(saleDto()))),
    lookupLegacy: vi.fn(async () => settle(options.legacy ?? [V3_LISTING])),
    royalties: vi.fn(async () => settle(options.royalties ?? FIVE_PERCENT)),
    markNexusLent: vi.fn(),
    grantAllowance: vi.fn(),
  };
  return { deps, calls, setWallet: (next: Wallet | null) => { wallet = next; } };
}

async function run(kind: MarketAction, data: unknown, deps: MarketHandlerDeps, sendResponse?: (r: unknown) => void): Promise<Reply[]> {
  const replies: Reply[] = [];
  await marketPrepareHandler(kind, deps)({ id: 'req-1', data }, sendResponse ?? ((r) => replies.push(r as Reply)));
  return replies;
}

/** The one reply a handler gives, unwrapped. */
async function reply(kind: MarketAction, data: unknown, deps: MarketHandlerDeps): Promise<Reply['data']> {
  const replies = await run(kind, data, deps);
  expect(replies).toHaveLength(1);
  return replies[0].data;
}

const LIST_REQUEST = { unit: UNIT_222, priceLovelace: PRICE.toString() };
const REPRICE_REQUEST = { ref: LISTING_REF, priceLovelace: REPRICED_PRICE.toString() };
const CANCEL_REQUEST = { ref: LISTING_REF };
const BUY_REQUEST = { ref: SALE_REF };
const MIGRATE_REQUEST = { legacyRef: V3_REF, priceLovelace: PRICE.toString() };

const txOf = (cbor: string) => Serialization.Transaction.fromCbor(HexBlob(cbor)).toCore();

beforeEach(() => {
  clearMarketSignAllowance();
  vi.mocked(isNftMarketHardware).mockClear();
  for (const verifier of [verifyList, verifyReprice, verifyCancel, verifyBuy, verifyMigrate]) vi.mocked(verifier).mockClear();
});
afterEach(() => {
  clearMarketSignAllowance();
});

// ---------------------------------------------------------------------------------------------

describe('the royalty output minimum', () => {
  it('is the ledger minimum of a payee output with a 32-byte inline tag (108 bytes at 4310 per byte)', () => {
    expect(royaltyOutputMinUtxo(4310n)).toBe(1_155_080n);
    expect(royaltyOutputMinUtxo(4310n)).toBe(minAdaRequired(payOut(ROYALTY_ADDRESS, 2n * ADA), 4310n));
  });
});

describe('every kind replies once, with the verified transaction', () => {
  it('list: Nexus is asked for the listing the user chose, and the reply carries the verified bytes', async () => {
    const tx = listTx();
    const { deps, calls } = rig({ built: response(tx) });
    const replies = await run('list', LIST_REQUEST, deps);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ id: 'req-1', target: TARGET, sender: SENDER.extension });
    const data = replies[0].data;
    expect(data.success).toBe(true);
    expect(data.result?.txCbor).toBe(tx.cbor);
    expect(data.result?.txId).toBe(tx.id);
    expect(data.result?.summary).toMatchObject({
      txId: tx.id,
      unit: UNIT_222,
      listingAddress: LISTING_V2,
      listingOutputIndex: 0,
      deploymentVersion: 2,
      priceLovelace: '100000000',
      marketFeeLovelace: '1500000',
      royaltiesLovelace: '5000000',
      sellerReceivesLovelace: '93500000',
      dropped: [],
      invalidRecipients: 0,
    });
    // What Nexus is asked: the worker's own values, never the page's.
    expect(calls.list).toHaveBeenCalledTimes(1);
    const [request, network] = calls.list.mock.calls[0] as [Record<string, unknown>, string];
    expect(network).toBe(Network.PREPROD);
    expect(request).toMatchObject({
      unit: UNIT_222,
      priceLovelace: '100000000',
      ownerPkh: OWNER,
      sellerAddress: RECEIVE,
      stakeCredential: STAKE,
      buyerPkh: null,
      royalties: [{ address: ROYALTY_ADDRESS, lovelace: '5000000' }],
      changeAddress: RECEIVE,
    });
    expect(calls.reprice).not.toHaveBeenCalled();
  });

  it('reprice: the new price goes to Nexus; the reply carries the old and new prices', async () => {
    const tx = repriceTx();
    const { deps, calls } = rig({ built: response(tx) });
    const data = await reply('reprice', REPRICE_REQUEST, deps);
    expect(data.success).toBe(true);
    expect(data.result?.txCbor).toBe(tx.cbor);
    expect(data.result?.summary).toMatchObject({
      ref: LISTING_REF,
      oldPriceLovelace: '100000000',
      priceLovelace: '80000000',
      listingAddress: LISTING_V1,
      deploymentVersion: 1,
    });
    const [request, network] = calls.reprice.mock.calls[0] as [Record<string, unknown>, string];
    expect(network).toBe(Network.PREPROD);
    expect(request).toMatchObject({
      listingRef: { txHash: LISTING_TX, outputIndex: 0 },
      priceLovelace: '80000000',
      changeAddress: RECEIVE,
      allowSponsoredCollateral: true,
    });
  });

  it('cancel: the NFT comes back to the wallet\'s own receive address', async () => {
    const tx = cancelTx();
    const { deps, calls } = rig({ built: response(tx) });
    const data = await reply('cancel', CANCEL_REQUEST, deps);
    expect(data.success).toBe(true);
    expect(data.result?.summary).toMatchObject({ ref: LISTING_REF, unit: UNIT_222, returnAddress: RECEIVE, depositLovelace: '2000000' });
    const [request] = calls.cancel.mock.calls[0] as [Record<string, unknown>, string];
    expect(request).toMatchObject({
      listingRef: { txHash: LISTING_TX, outputIndex: 0 },
      returnAddress: RECEIVE,
      changeAddress: RECEIVE,
      allowSponsoredCollateral: true,
    });
  });

  it('buy: the listing is read from Nexus and from the chain, then the buy is verified against both', async () => {
    const tx = buyTx();
    const { deps, calls } = rig({ built: response(tx), state: { utxos: [BUYER_UTXO], keys: KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 } });
    const data = await reply('buy', BUY_REQUEST, deps);
    expect(data.success).toBe(true);
    expect(data.result?.txCbor).toBe(tx.cbor);
    expect(data.result?.summary).toMatchObject({
      ref: SALE_REF,
      priceLovelace: '100000000',
      feeLovelace: '1500000',
      royaltiesLovelace: '5000000',
      minUtxoTopUpLovelace: '0',
      totalOutflowLovelace: '100400000',
    });
    expect(deps.lookupListing).toHaveBeenCalledWith({ txHash: SALE_TX, outputIndex: 0 }, Network.PREPROD);
    expect(deps.lookupChainUtxo).toHaveBeenCalledWith({ txHash: SALE_TX, outputIndex: 0 }, Network.PREPROD);
    const [request] = calls.buy.mock.calls[0] as [Record<string, unknown>, string];
    expect(request).toMatchObject({
      listingRef: { txHash: SALE_TX, outputIndex: 0 },
      buyerAddress: RECEIVE,
      changeAddress: RECEIVE,
      allowSponsoredCollateral: true,
    });
  });

  it('migrate: the legacy item is looked up under the wallet\'s own keys and its NFT becomes the Gero listing', async () => {
    const tx = migrateTx();
    const { deps, calls } = rig({
      wallet: MAINNET_WALLET,
      built: response(tx),
      state: { utxos: [M_FEE_UTXO], keys: M_KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 },
      royalties: M_FIVE_PERCENT,
    });
    const data = await reply('migrate', MIGRATE_REQUEST, deps);
    expect(data.success).toBe(true);
    expect(data.result?.txCbor).toBe(tx.cbor);
    expect(data.result?.summary).toMatchObject({
      legacyRef: V3_REF,
      legacyContract: 'legacy_v3',
      unit: V3_NFT,
      listingAddress: M_LISTING_V2,
      priceLovelace: '100000000',
      dropped: [],
      invalidRecipients: 0,
    });
    // The wallet's payment and change keys, and nothing else: never the stake key.
    const owners = vi.mocked(deps.lookupLegacy).mock.calls[0][0];
    expect([...owners].sort()).toEqual([OWNER, OWNER_B].sort());
    expect(owners).not.toContain(STAKE);
    expect(vi.mocked(deps.lookupLegacy).mock.calls[0][1]).toBe(Network.MAINNET);
    const [request, network] = calls.migrate.mock.calls[0] as [Record<string, unknown>, string];
    expect(network).toBe(Network.MAINNET);
    expect(request).toMatchObject({
      legacyRef: { txHash: V3_LISTING.txHash, outputIndex: 0 },
      priceLovelace: '100000000',
      ownerPkh: OWNER,
      sellerAddress: M_RECEIVE,
      stakeCredential: STAKE,
      royalties: [{ address: M_ROYALTY, lovelace: '5000000' }],
      changeAddress: M_RECEIVE,
      allowSponsoredCollateral: true,
    });
  });

  it('answers through sendResponse exactly once even when it throws', async () => {
    const { deps } = rig();
    const send = vi.fn(() => { throw new Error('the port is gone'); });
    await expect(run('list', LIST_REQUEST, deps, send)).resolves.toBeDefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('answers once when the worker cannot boot', async () => {
    const { deps } = rig({ booted: () => Promise.reject(new Error('no db')) });
    const data = await reply('cancel', CANCEL_REQUEST, deps);
    expect(data).toMatchObject({ success: false, errorCode: 'BUILD_FAILED' });
  });
});

describe('the signing allowance', () => {
  it('list: granted for the verified id with the listing output as its hit', async () => {
    const tx = listTx();
    const { deps } = rig({ built: response(tx) });
    await reply('list', LIST_REQUEST, deps);
    expect(deps.grantAllowance).toHaveBeenCalledTimes(1);
    expect(deps.grantAllowance).toHaveBeenCalledWith(1, tx.id, ['creates-listing:0']);
  });

  it('reprice: the old listing it spends and the new one it creates', async () => {
    const tx = repriceTx();
    const { deps } = rig({ built: response(tx) });
    await reply('reprice', REPRICE_REQUEST, deps);
    expect(deps.grantAllowance).toHaveBeenCalledWith(1, tx.id, ['creates-listing:0', `spends-listing:${LISTING_REF}`]);
  });

  it('cancel: the listing it spends', async () => {
    const tx = cancelTx();
    const { deps } = rig({ built: response(tx) });
    await reply('cancel', CANCEL_REQUEST, deps);
    expect(deps.grantAllowance).toHaveBeenCalledWith(1, tx.id, [`spends-listing:${LISTING_REF}`]);
  });

  it('migrate: the new listing it creates', async () => {
    const tx = migrateTx();
    const { deps } = rig({
      wallet: MAINNET_WALLET,
      built: response(tx),
      state: { utxos: [M_FEE_UTXO], keys: M_KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 },
      royalties: M_FIVE_PERCENT,
    });
    await reply('migrate', MIGRATE_REQUEST, deps);
    expect(deps.grantAllowance).toHaveBeenCalledWith(1, tx.id, ['creates-listing:0']);
  });

  it('buy touches no listing of the wallet, so it grants nothing and leaves another flow\'s allowance alone', async () => {
    const tx = buyTx();
    const { deps } = rig({ built: response(tx), state: { utxos: [BUYER_UTXO], keys: KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 } });
    const data = await reply('buy', BUY_REQUEST, deps);
    expect(data.success).toBe(true);
    expect(deps.grantAllowance).not.toHaveBeenCalled();
  });

  it('the hits are exactly what WalletBg.signTx will compute, so the signature finds its allowance', async () => {
    const tx = repriceTx();
    const { deps } = rig({ built: response(tx) });
    deps.grantAllowance = (walletId, txId, hits) => grantMarketSignAllowance(walletId, txId, hits);
    await reply('reprice', REPRICE_REQUEST, deps);
    const hitsAtSigning = findMarketTouch(txOf(tx.cbor), DEPLOYMENTS, new Set([LISTING_REF, OTHER_LISTING_REF]));
    expect(hitsAtSigning.length).toBeGreaterThan(0);
    expect(hasMarketSignAllowance(1, tx.id, hitsAtSigning)).toBe(true);
    // And for no other wallet or transaction.
    expect(hasMarketSignAllowance(2, tx.id, hitsAtSigning)).toBe(false);
  });

  it('is not granted when the verification fails, or when Nexus refuses', async () => {
    const bad = rig({ built: response(cancelTx()) });
    await reply('list', LIST_REQUEST, bad.deps);
    expect(bad.deps.grantAllowance).not.toHaveBeenCalled();
    const refused = rig({ buildError: nexusError('INSUFFICIENT_ADA') });
    await reply('list', LIST_REQUEST, refused.deps);
    expect(refused.deps.grantAllowance).not.toHaveBeenCalled();
  });

  it('marks the lent Nexus pool collateral, from the verified summary', async () => {
    const tx = pooledCancelTx();
    const { deps } = rig({ built: response(tx, { sponsoredCollateralRef: SPONSORED_REF }) });
    const data = await reply('cancel', CANCEL_REQUEST, deps);
    expect(data.success).toBe(true);
    expect(data.result?.summary).toMatchObject({ sponsoredCollateralRef: SPONSORED_REF });
    expect(deps.markNexusLent).toHaveBeenCalledWith(SPONSORED_REF);
  });

  it('does not mark collateral Nexus named but the transaction does not use', async () => {
    const { deps } = rig({ built: response(cancelTx(), { sponsoredCollateralRef: SPONSORED_REF }) });
    const data = await reply('cancel', CANCEL_REQUEST, deps);
    expect(data.success).toBe(true);
    expect(deps.markNexusLent).not.toHaveBeenCalled();
  });
});

describe('a Nexus 422 is passed through with its code', () => {
  const cases: [MarketAction, unknown, Partial<RigOptions>][] = [
    ['list', LIST_REQUEST, {}],
    ['reprice', REPRICE_REQUEST, {}],
    ['cancel', CANCEL_REQUEST, {}],
    ['buy', BUY_REQUEST, { state: { utxos: [BUYER_UTXO], keys: KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 } }],
    ['migrate', MIGRATE_REQUEST, {
      wallet: MAINNET_WALLET,
      state: { utxos: [M_FEE_UTXO], keys: M_KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 },
      royalties: M_FIVE_PERCENT,
    }],
  ];

  it.each(cases)('%s', async (kind, request, extra) => {
    const { deps } = rig({ ...extra, buildError: nexusError('LISTING_NOT_FOUND', 'No such listing') });
    const replies = await run(kind, request, deps);
    expect(replies).toHaveLength(1);
    expect(replies[0].data).toMatchObject({ success: false, errorCode: 'LISTING_NOT_FOUND', error: 'The transaction could not be built' });
    // The code is Nexus's; its words are not: nothing it said comes back to the page.
    expect(JSON.stringify(replies[0].data)).not.toContain('No such listing');
    expect(deps.grantAllowance).not.toHaveBeenCalled();
    expect(deps.markNexusLent).not.toHaveBeenCalled();
  });

  it('an error that carries no code is BUILD_FAILED, with a fixed message', async () => {
    const { deps } = rig({ buildError: new Error('socket hang up') });
    const data = await reply('list', LIST_REQUEST, deps);
    expect(data).toMatchObject({ errorCode: 'BUILD_FAILED', error: 'The transaction could not be built' });
    expect(JSON.stringify(data)).not.toContain('socket hang up');
  });

  it('a failure of the worker itself says nothing of what it threw', async () => {
    const { deps } = rig({ booted: () => Promise.reject(new Error('IndexedDB exploded at /secret/path')) });
    const data = await reply('cancel', CANCEL_REQUEST, deps);
    expect(data).toMatchObject({ errorCode: 'BUILD_FAILED', error: 'The transaction could not be prepared' });
    expect(JSON.stringify(data)).not.toContain('IndexedDB');
  });

  it('a Nexus message with a code is not forwarded either when the read of the listing or the royalties fails', async () => {
    const royalty = rig({ royalties: nexusError('NETWORK_UNSUPPORTED', 'Leaky royalty text') });
    expect(JSON.stringify(await reply('list', LIST_REQUEST, royalty.deps))).not.toContain('Leaky');
    const buy = rig({ state: { utxos: [BUYER_UTXO], keys: KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 }, listing: nexusError('LISTING_NOT_FOUND', 'Leaky listing text') });
    expect(JSON.stringify(await reply('buy', BUY_REQUEST, buy.deps))).not.toContain('Leaky');
  });

  it('no detail of an error can overwrite success, error or errorCode', async () => {
    const { deps } = rig();
    deps.deployments = () => {
      throw new MarketPrepareError('REAL_CODE', 'real message', { success: 'true', error: 'forged', errorCode: 'FORGED', extra: 'kept' });
    };
    const data = await reply('list', LIST_REQUEST, deps);
    expect(data).toEqual({ success: false, error: 'real message', errorCode: 'REAL_CODE', extra: 'kept' });
  });
});

describe('a transaction that is not what was asked for is VERIFY_FAILED, naming the rule', () => {
  const stateOf = (utxos: Cardano.Utxo[], keys: typeof KEYS, listed: OwnListing[] = []): State =>
    ({ utxos, keys, collateral: null, listedListings: listed, coinsPerUtxoByte: 4310 });

  it('list: a datum with another price', async () => {
    const { deps } = rig({ built: response(listTx({ ...DATUM, price: 90n * ADA })) });
    const data = await reply('list', LIST_REQUEST, deps);
    expect(data).toMatchObject({ success: false, errorCode: 'VERIFY_FAILED', error: 'DATUM' });
    expect(data.result).toBeUndefined();
  });

  it('list: an owner that is not the key holding the NFT', async () => {
    const { deps } = rig({ built: response(listTx({ ...DATUM, owner: OWNER_B })) });
    expect(await reply('list', LIST_REQUEST, deps)).toMatchObject({ errorCode: 'VERIFY_FAILED', error: 'DATUM' });
  });

  it('list: a transaction that pays somebody else', async () => {
    const { deps } = rig({ built: response(listTx(DATUM, (tx) => { tx.body.outputs[1].address = Cardano.PaymentAddress(FOREIGN); })) });
    expect(await reply('list', LIST_REQUEST, deps)).toMatchObject({ errorCode: 'VERIFY_FAILED', error: 'OUTPUTS' });
  });

  it('reprice: a transaction that is a cancel', async () => {
    const { deps } = rig({ built: response(cancelTx()) });
    expect(await reply('reprice', REPRICE_REQUEST, deps)).toMatchObject({ errorCode: 'VERIFY_FAILED', error: 'LISTING' });
  });

  it('cancel: the NFT sent to a stranger', async () => {
    const { deps } = rig({ built: response(cancelTx((tx) => { tx.body.outputs[0].address = Cardano.PaymentAddress(FOREIGN); })) });
    expect(await reply('cancel', CANCEL_REQUEST, deps)).toMatchObject({ errorCode: 'VERIFY_FAILED', error: 'OUTPUTS' });
  });

  it('buy: a seller output paid above its due', async () => {
    const tx = buyTx((t) => {
      t.body.outputs[1].value.coins += ADA;
      t.body.outputs[t.body.outputs.length - 1].value.coins -= ADA;
    });
    const { deps } = rig({ built: response(tx), state: stateOf([BUYER_UTXO], KEYS) });
    expect(await reply('buy', BUY_REQUEST, deps)).toMatchObject({ errorCode: 'VERIFY_FAILED', error: 'OUTPUTS' });
  });

  it('buy: a datum on chain that is not the one Nexus supplied', async () => {
    const forged = { ...SALE_DATUM, royalties: [...ROYALTIES, { address: ROYALTY_ADDRESS_2, lovelace: 2n * ADA }] };
    const lying = saleDto(forged, { priceLovelace: PRICE.toString() });
    const { deps } = rig({
      built: response(buyTx()),
      state: stateOf([BUYER_UTXO], KEYS),
      listing: lying,
      chain: chainOf(saleDto()),
    });
    expect(await reply('buy', BUY_REQUEST, deps)).toMatchObject({ errorCode: 'VERIFY_FAILED', error: 'DATUM' });
  });

  it('migrate: a listing at the legacy price instead of the one asked for', async () => {
    const tx = migrateTx({ ...M_DATUM, price: 90n * ADA });
    const { deps } = rig({
      wallet: MAINNET_WALLET,
      built: response(tx),
      state: stateOf([M_FEE_UTXO], M_KEYS),
      royalties: M_FIVE_PERCENT,
    });
    expect(await reply('migrate', MIGRATE_REQUEST, deps)).toMatchObject({ errorCode: 'VERIFY_FAILED', error: 'DATUM' });
  });

  it('a transaction id Nexus misreports, and bytes that are not a transaction', async () => {
    const tx = listTx();
    const wrongId = rig({ built: { ...response(tx), tx_hash: 'ab'.repeat(32) } });
    expect(await reply('list', LIST_REQUEST, wrongId.deps)).toMatchObject({ errorCode: 'VERIFY_FAILED', error: 'TX_ID' });
    const garbage = rig({ built: { ...response(tx), tx_cbor: 'deadbeef' } });
    expect(await reply('list', LIST_REQUEST, garbage.deps)).toMatchObject({ errorCode: 'VERIFY_FAILED', error: 'TX_ID' });
  });

});

describe('the context the verifiers are given comes from the logged account and nothing the page said', () => {
  const refsOf = (utxos: readonly Cardano.Utxo[]) => utxos.map((u) => `${u[0].txId}#${u[0].index}`).sort();

  it('list: this account\'s keys, addresses, stake key and listings; plain key UTxOs only', async () => {
    const { deps } = rig({ state: { utxos: [NFT_UTXO, FEE_UTXO, RESERVED, AT_SCRIPT], keys: KEYS, collateral: RESERVED, listedListings: [OWN_LISTING], coinsPerUtxoByte: 4310 } });
    await reply('list', { ...LIST_REQUEST, ownerPkh: STRANGER, sellerAddress: FOREIGN, stakeCredential: '99'.repeat(28) }, deps);
    const [, , intent, ctx] = vi.mocked(verifyList).mock.calls[0];
    expect(intent).toEqual({ unit: UNIT_222, price: PRICE, royalties: ROYALTIES, ownerPkh: OWNER, sellerAddress: RECEIVE, stakeCredential: STAKE });
    expect(ctx.networkId).toBe(TESTNET);
    expect(ctx.deployments).toEqual(DEPLOYMENTS);
    expect([...ctx.ownAddresses].sort()).toEqual([RECEIVE, CHANGE].sort());
    expect(ctx.ownKeyHashes).toEqual(new Set([OWNER, OWNER_B, STAKE]));
    expect(ctx.stakeKeyHash).toBe(STAKE);
    expect([...ctx.ownListings.keys()]).toEqual([LISTING_REF]);
    // The listing is the store's, with bigints (the verifiers compare prices as bigints).
    expect(ctx.ownListings.get(LISTING_REF)?.datum.price).toBe(PRICE);
    // The reserved dApp collateral is neither offered to Nexus nor the wallet's own to the verifier.
    expect(refsOf(ctx.ownUtxos)).toEqual(refsOf([NFT_UTXO, FEE_UTXO]));
    expect(ctx.sponsoredCollateralRef).toBeUndefined();
  });

  it('a transaction that spends the reserved dApp collateral is refused, though it is the wallet\'s own UTxO', async () => {
    const reservedIn = txIn('99'.repeat(32), 0);
    const tx = listTx(DATUM, (t) => { t.body.inputs = [NFT_IN, FEE_IN, reservedIn]; });
    const { deps } = rig({
      built: response(tx),
      state: { utxos: [NFT_UTXO, FEE_UTXO, RESERVED], keys: KEYS, collateral: RESERVED, listedListings: [], coinsPerUtxoByte: 4310 },
    });
    expect(await reply('list', LIST_REQUEST, deps)).toMatchObject({ errorCode: 'VERIFY_FAILED', error: 'INPUTS' });
    expect(deps.grantAllowance).not.toHaveBeenCalled();
  });

  it('works for an added account: nothing is account 0\'s', async () => {
    const owner = '31'.repeat(28);
    const ownerB = '32'.repeat(28);
    const stake = '33'.repeat(28);
    const receive = baseAddress(TESTNET, owner, stake);
    const change = baseAddress(TESTNET, ownerB, stake);
    const datum: ListingDatum = { owner, sellerAddress: receive, price: PRICE, royalties: ROYALTIES, buyer: null };
    const tx = listTxFor(baseAddress(TESTNET, V2.scriptHash, stake, true), change, datum);
    const { deps, calls } = rig({
      wallet: { ...PREPROD_WALLET, id: 7, baseAddress: receive },
      built: response(tx),
      state: {
        utxos: [utxo(NFT_TX, 0, receive, 2n * ADA, { [UNIT_222]: 1n }), utxo(FEE_TX, 0, receive, 10n * ADA)],
        keys: {
          payment: [{ address: receive, cred: owner, path: "m/1852'/1815'/1'/0/0" }],
          change: [{ address: change, cred: ownerB, path: "m/1852'/1815'/1'/1/0" }],
          stake: [{ cred: stake, path: "m/1852'/1815'/1'/2/0" }],
        },
        collateral: null,
        listedListings: [],
        coinsPerUtxoByte: 4310,
      },
    });
    const data = await reply('list', LIST_REQUEST, deps);
    expect(data.success).toBe(true);
    expect(calls.list.mock.calls[0][0]).toMatchObject({ ownerPkh: owner, sellerAddress: receive, stakeCredential: stake, changeAddress: receive });
    expect(deps.grantAllowance).toHaveBeenCalledWith(7, tx.id, ['creates-listing:0']);
  });

  it('cancel and reprice: the same context, with the listing asked for in it', async () => {
    const { deps } = rig({ built: response(cancelTx()) });
    await reply('cancel', CANCEL_REQUEST, deps);
    const [, , cancelIntent, cancelCtx] = vi.mocked(verifyCancel).mock.calls[0];
    expect(cancelIntent).toEqual({ ref: LISTING_REF, returnAddress: RECEIVE });
    expect(cancelCtx.stakeKeyHash).toBe(STAKE);
    expect([...cancelCtx.ownListings.keys()].sort()).toEqual([LISTING_REF, OTHER_LISTING_REF].sort());

    const repricing = rig({ built: response(repriceTx()) });
    await reply('reprice', REPRICE_REQUEST, repricing.deps);
    const [, , repriceIntent, repriceCtx] = vi.mocked(verifyReprice).mock.calls[0];
    expect(repriceIntent).toEqual({ ref: LISTING_REF, price: REPRICED_PRICE });
    expect(repriceCtx.ownKeyHashes).toEqual(new Set([OWNER, OWNER_B, STAKE]));
  });

  it('cancel: Nexus\'s word that it lent collateral reaches the verifier, and only a valid one', async () => {
    const { deps } = rig({ built: response(pooledCancelTx(), { sponsoredCollateralRef: SPONSORED_REF }) });
    await reply('cancel', CANCEL_REQUEST, deps);
    expect(vi.mocked(verifyCancel).mock.calls[0][3].sponsoredCollateralRef).toBe(SPONSORED_REF);

    const malformed = rig({ built: response(pooledCancelTx(), { sponsoredCollateralRef: 'not a ref' }) });
    const data = await reply('cancel', CANCEL_REQUEST, malformed.deps);
    expect(vi.mocked(verifyCancel).mock.calls[1][3].sponsoredCollateralRef).toBeUndefined();
    expect(data).toMatchObject({ errorCode: 'VERIFY_FAILED', error: 'COLLATERAL' });
  });

  describe('buy', () => {
    const state = (coinsPerUtxoByte: unknown): State => ({ utxos: [BUYER_UTXO], keys: KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: coinsPerUtxoByte as number });

    it('gets the Nexus row, the independent chain read, the buyer address and the live protocol parameter', async () => {
      const row = saleDto();
      const chain = chainOf(row);
      const { deps } = rig({ built: response(buyTx()), state: state(4310), listing: row, chain });
      await reply('buy', BUY_REQUEST, deps);
      const [, , intent, ctx] = vi.mocked(verifyBuy).mock.calls[0];
      expect(intent).toEqual({ listing: row, buyerAddress: RECEIVE, chainUtxo: chain });
      expect(ctx.coinsPerUtxoByte).toBe(4310n);
      expect(ctx.stakeKeyHash).toBe(STAKE);
    });

    it('passes a lower parameter as it is, and none when the epoch parameters are unusable', async () => {
      await reply('buy', BUY_REQUEST, rig({ built: response(buyTx()), state: state(4000) }).deps);
      expect(vi.mocked(verifyBuy).mock.calls[0][3].coinsPerUtxoByte).toBe(4000n);
      for (const [i, bad] of [null, undefined, 0, -1, 4310.5, Number.NaN, 'abc'].entries()) {
        await reply('buy', BUY_REQUEST, rig({ built: response(buyTx()), state: state(bad) }).deps);
        expect(vi.mocked(verifyBuy).mock.calls[i + 1][3].coinsPerUtxoByte, String(bad)).toBeUndefined();
      }
    });
  });

  it('migrate: the lookup\'s own items are the legacy context, the account\'s own context is the market\'s', async () => {
    const foreignItem = itemOf({ txHash: 'd4'.repeat(32), ownerPkh: STRANGER });
    const { deps } = rig({
      wallet: MAINNET_WALLET,
      built: response(migrateTx()),
      state: { utxos: [M_FEE_UTXO], keys: M_KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 },
      royalties: M_FIVE_PERCENT,
      legacy: [V3_LISTING, foreignItem],
    });
    await reply('migrate', MIGRATE_REQUEST, deps);
    const [, , intent, ctx] = vi.mocked(verifyMigrate).mock.calls[0];
    expect(intent).toEqual({
      legacyRef: V3_REF,
      list: { unit: V3_NFT, price: PRICE, royalties: [{ address: M_ROYALTY, lovelace: 5n * ADA }], ownerPkh: OWNER, sellerAddress: M_RECEIVE, stakeCredential: STAKE },
    });
    expect(ctx.networkId).toBe(MAINNET);
    // Only the wallet's own items: another owner's UTxO is never a legacy item of this wallet.
    expect([...ctx.items.keys()]).toEqual([V3_REF]);
    expect(ctx.stakeKeyHash).toBe(STAKE);
  });
});

describe('a wallet switch while Nexus builds', () => {
  const cases: [MarketAction, unknown, Partial<RigOptions>, Built][] = [
    ['list', LIST_REQUEST, {}, listTx()],
    ['reprice', REPRICE_REQUEST, {}, repriceTx()],
    ['cancel', CANCEL_REQUEST, {}, cancelTx()],
    ['buy', BUY_REQUEST, { state: { utxos: [BUYER_UTXO], keys: KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 } }, buyTx()],
    ['migrate', MIGRATE_REQUEST, {
      wallet: MAINNET_WALLET,
      state: { utxos: [M_FEE_UTXO], keys: M_KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 },
      royalties: M_FIVE_PERCENT,
    }, migrateTx()],
  ];

  it.each(cases)('%s answers WALLET_CHANGED and grants nothing', async (kind, request, extra, tx) => {
    const r = rig({ ...extra });
    const switching = vi.fn(async () => {
      r.setWallet({ ...(extra.wallet ?? PREPROD_WALLET), id: 2 });
      return response(tx);
    });
    r.deps.build = { ...r.deps.build, [kind]: switching };
    const replies = await run(kind, request, r.deps);
    expect(switching).toHaveBeenCalledTimes(1);
    expect(replies).toHaveLength(1);
    expect(replies[0].data).toMatchObject({ success: false, errorCode: 'WALLET_CHANGED' });
    // Not even verified: what Nexus built for another wallet's account is nobody's business.
    const verifier = { list: verifyList, reprice: verifyReprice, cancel: verifyCancel, buy: verifyBuy, migrate: verifyMigrate }[kind];
    expect(vi.mocked(verifier)).not.toHaveBeenCalled();
    expect(r.deps.grantAllowance).not.toHaveBeenCalled();
    expect(r.deps.markNexusLent).not.toHaveBeenCalled();
  });

  it('a switch while the royalty terms are read stops the list before Nexus is asked', async () => {
    const r = rig();
    r.deps.royalties = vi.fn(async () => {
      r.setWallet({ ...PREPROD_WALLET, id: 2 });
      return FIVE_PERCENT;
    });
    const data = await reply('list', LIST_REQUEST, r.deps);
    expect(data.errorCode).toBe('WALLET_CHANGED');
    expect(r.calls.list).not.toHaveBeenCalled();
  });

  it('a switch while the listing is read stops the buy before Nexus is asked', async () => {
    const r = rig({ state: { utxos: [BUYER_UTXO], keys: KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 } });
    r.deps.lookupChainUtxo = vi.fn(async () => {
      r.setWallet({ ...PREPROD_WALLET, id: 2 });
      return chainOf(saleDto());
    });
    const data = await reply('buy', BUY_REQUEST, r.deps);
    expect(data.errorCode).toBe('WALLET_CHANGED');
    expect(r.calls.buy).not.toHaveBeenCalled();
  });
});

describe('who may use the market, and where', () => {
  it('a missing wallet, another chain and a watch wallet are WALLET_UNSUPPORTED', async () => {
    expect((await reply('list', LIST_REQUEST, rig({ wallet: null }).deps)).errorCode).toBe('WALLET_UNSUPPORTED');
    expect((await reply('list', LIST_REQUEST, rig({ wallet: { ...PREPROD_WALLET, chain: Blockchain.BITCOIN } }).deps)).errorCode).toBe('WALLET_UNSUPPORTED');
    expect((await reply('list', LIST_REQUEST, rig({ wallet: { ...PREPROD_WALLET, type: 'Watch' } }).deps)).errorCode).toBe('WALLET_UNSUPPORTED');
  });

  it('a hardware wallet is refused until its device is cleared for the market', async () => {
    const ledger = { ...PREPROD_WALLET, type: 'Ledger' };
    const closed = rig({ wallet: ledger });
    expect((await reply('list', LIST_REQUEST, closed.deps)).errorCode).toBe('WALLET_UNSUPPORTED');
    expect(closed.calls.list).not.toHaveBeenCalled();

    const actual = await vi.importActual<typeof import('@/utils/nftMarketDeployments')>('@/utils/nftMarketDeployments');
    vi.mocked(isNftMarketHardware).mockImplementation(() => true);
    try {
      const open = rig({ wallet: ledger });
      expect((await reply('list', LIST_REQUEST, open.deps)).success).toBe(true);
    } finally {
      vi.mocked(isNftMarketHardware).mockImplementation(actual.isNftMarketHardware);
    }
  });

  // Ruling P41: with the UI flag off the user's existing listings stay visible and Unlist stays
  // reachable, so the worker must not read the flag: a cancel only returns the user's own NFT and
  // deposit to their own address.
  it('the UI flag has no say: every kind prepares the same with isNftMarketEnabled off and on', async () => {
    for (const flag of [false, true]) {
      featureFlagsStore.state.flags.isNftMarketEnabled = flag;
      try {
        const cancel = rig({ built: response(cancelTx()) });
        const data = await reply('cancel', CANCEL_REQUEST, cancel.deps);
        expect(data.success, `cancel, flag ${flag}`).toBe(true);
        expect(cancel.calls.cancel).toHaveBeenCalledTimes(1);
        const reprice = rig({ built: response(repriceTx()) });
        expect((await reply('reprice', REPRICE_REQUEST, reprice.deps)).success, `reprice, flag ${flag}`).toBe(true);
      } finally {
        featureFlagsStore.state.flags.isNftMarketEnabled = false;
      }
    }
  });

  it('the worker\'s market code never reads the UI flag', () => {
    for (const file of ['marketPrepare.ts', 'verifyListing.ts', 'verifyBuy.ts', 'verifyMigrate.ts', 'marketGuard.ts', 'marketAllowance.ts']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source, file).not.toMatch(/isNftMarketEnabled|featureFlagsStore|featureFlagService/);
    }
  });

  it('a network with no deployment is NETWORK_UNSUPPORTED, for every kind, before anything is asked', async () => {
    const kinds: [MarketAction, unknown][] = [
      ['list', LIST_REQUEST], ['reprice', REPRICE_REQUEST], ['cancel', CANCEL_REQUEST], ['buy', BUY_REQUEST], ['migrate', MIGRATE_REQUEST],
    ];
    for (const [kind, request] of kinds) {
      const r = rig({ wallet: MAINNET_WALLET, deployments: [], state: { utxos: [M_FEE_UTXO], keys: M_KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 } });
      const data = await reply(kind, request, r.deps);
      expect(data.errorCode, kind).toBe('NETWORK_UNSUPPORTED');
      expect(r.deps.royalties).not.toHaveBeenCalled();
      expect(r.deps.lookupListing).not.toHaveBeenCalled();
      expect(r.deps.lookupLegacy).not.toHaveBeenCalled();
    }
  });

  it('migrate exists on mainnet only, even where the market has a deployment', async () => {
    const r = rig({ legacy: [V3_LISTING] });
    expect((await reply('migrate', MIGRATE_REQUEST, r.deps)).errorCode).toBe('NETWORK_UNSUPPORTED');
    expect(r.deps.lookupLegacy).not.toHaveBeenCalled();
  });

  it('a receive address that is not among the wallet\'s keys is WALLET_UNSUPPORTED', async () => {
    const r = rig({ wallet: { ...PREPROD_WALLET, baseAddress: FOREIGN } });
    expect((await reply('list', LIST_REQUEST, r.deps)).errorCode).toBe('WALLET_UNSUPPORTED');
  });

  it('keys that do not hold the account\'s stake key are WALLET_UNSUPPORTED', async () => {
    const r = rig({ state: { utxos: [NFT_UTXO, FEE_UTXO], keys: { ...KEYS, stake: [] }, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 } });
    expect((await reply('list', LIST_REQUEST, r.deps)).errorCode).toBe('WALLET_UNSUPPORTED');
  });
});

describe('requests', () => {
  it('a body that is not an object, or lacks what the kind needs, is INVALID_REQUEST', async () => {
    const bad: [MarketAction, unknown][] = [
      ['list', null], ['list', 'x'], ['list', {}], ['list', { unit: UNIT_222 }],
      ['list', { unit: UNIT_222, priceLovelace: 100 }],
      ['list', { unit: UNIT_222, priceLovelace: '1e8' }],
      ['list', { unit: UNIT_222, priceLovelace: '-5' }],
      ['list', { unit: UNIT_222, priceLovelace: '0100' }],
      ['list', { unit: 'abc', priceLovelace: '100000000' }],
      ['reprice', { ref: 'nope', priceLovelace: '100000000' }],
      ['reprice', { ref: LISTING_REF }],
      ['cancel', {}],
      ['cancel', { ref: `${LISTING_TX}#-1` }],
      ['buy', { ref: [SALE_REF] }],
      ['migrate', { legacyRef: V3_REF }],
    ];
    for (const [kind, request] of bad) {
      // Migrate exists on mainnet only; the rest of the kinds are asked on preprod.
      const r = kind === 'migrate'
        ? rig({ wallet: MAINNET_WALLET, state: { utxos: [M_FEE_UTXO], keys: M_KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 } })
        : rig();
      const data = await reply(kind, request, r.deps);
      expect(data.errorCode, `${kind} ${JSON.stringify(request)}`).toBe('INVALID_REQUEST');
      expect(r.calls[kind]).not.toHaveBeenCalled();
    }
  });
});

describe('list', () => {
  it('refuses a price under the minimum before Nexus is asked', async () => {
    const r = rig();
    const data = await reply('list', { unit: UNIT_222, priceLovelace: (MIN_LIST_PRICE - 1n).toString() }, r.deps);
    expect(data.errorCode).toBe('PRICE_TOO_LOW');
    expect(r.calls.list).not.toHaveBeenCalled();
    expect(r.deps.royalties).not.toHaveBeenCalled();
  });

  it('refuses an NFT the wallet does not hold (or holds twice)', async () => {
    const missing = rig({ state: { utxos: [FEE_UTXO], keys: KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 } });
    expect((await reply('list', LIST_REQUEST, missing.deps)).errorCode).toBe('NFT_NOT_FOUND');
    const twice = rig({ state: { utxos: [NFT_UTXO, FEE_UTXO, utxo('a2'.repeat(32), 0, RECEIVE, 2n * ADA, { [UNIT_222]: 1n })], keys: KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 } });
    expect((await reply('list', LIST_REQUEST, twice.deps)).errorCode).toBe('NFT_NOT_FOUND');
    expect(twice.calls.list).not.toHaveBeenCalled();
  });

  it('refuses an NFT held at an address that is not one of the wallet\'s key addresses', async () => {
    const elsewhere = rig({ state: { utxos: [utxo(NFT_TX, 0, FOREIGN, 2n * ADA, { [UNIT_222]: 1n }), FEE_UTXO], keys: KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 } });
    expect((await reply('list', LIST_REQUEST, elsewhere.deps)).errorCode).toBe('NFT_NOT_FOUND');
  });

  it('refuses a CIP-68 token that is not the (222) user token (review focus 4) before Nexus is asked', async () => {
    const r = rig({ state: { utxos: [utxo(NFT_TX, 0, RECEIVE, 2n * ADA, { [UNIT_100]: 1n }), FEE_UTXO], keys: KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 } });
    const data = await reply('list', { unit: UNIT_100, priceLovelace: PRICE.toString() }, r.deps);
    expect(data).toMatchObject({ errorCode: 'VERIFY_FAILED', error: 'NFT' });
    expect(r.calls.list).not.toHaveBeenCalled();
    expect(r.deps.royalties).not.toHaveBeenCalled();
  });

  it('reads the royalties from the NFT\'s own policy and from nothing else', async () => {
    const r = rig();
    await reply('list', LIST_REQUEST, r.deps);
    expect(r.deps.royalties).toHaveBeenCalledWith(POLICY, Network.PREPROD);
  });

  it('owner is the payment key of the address that holds the NFT, in this account', async () => {
    const heldAtChange = utxo(NFT_TX, 0, CHANGE, 2n * ADA, { [UNIT_222]: 1n });
    const tx = listTx({ ...DATUM, owner: OWNER_B }, (t) => { t.body.inputs = [NFT_IN, FEE_IN]; });
    const r = rig({ built: response(tx), state: { utxos: [heldAtChange, FEE_UTXO], keys: KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 } });
    const data = await reply('list', LIST_REQUEST, r.deps);
    expect(data.success).toBe(true);
    expect((r.calls.list.mock.calls[0][0] as Record<string, unknown>)['ownerPkh']).toBe(OWNER_B);
  });

  it('offers the NFT\'s own UTxO and the wallet\'s plain key UTxOs as inputs, never the reserved collateral or a script UTxO', async () => {
    const r = rig({ state: { utxos: [NFT_UTXO, FEE_UTXO, RESERVED, AT_SCRIPT], keys: KEYS, collateral: RESERVED, listedListings: [], coinsPerUtxoByte: 4310 } });
    await reply('list', LIST_REQUEST, r.deps);
    const inputs = (r.calls.list.mock.calls[0][0] as { feeInputs: { txHash: string; outputIndex: number }[] }).feeInputs;
    const refs = inputs.map((i) => `${i.txHash}#${i.outputIndex}`).sort();
    expect(refs).toEqual([`${FEE_TX}#0`, `${NFT_TX}#0`].sort());
  });

  it('keeps the NFT\'s UTxO among the inputs of a wallet with more UTxOs than a request carries', async () => {
    const many = Array.from({ length: 80 }, (_, i) => utxo(`${(i + 16).toString(16).padStart(2, '0')}`.repeat(32), 0, RECEIVE, 100n * ADA));
    const r = rig({ state: { utxos: [...many, NFT_UTXO], keys: KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 } });
    await reply('list', LIST_REQUEST, r.deps);
    const inputs = (r.calls.list.mock.calls[0][0] as { feeInputs: { txHash: string }[] }).feeInputs;
    expect(inputs.length).toBeLessThanOrEqual(50);
    expect(inputs.some((i) => i.txHash === NFT_TX)).toBe(true);
  });

  describe('the protocol parameter of the royalty minimum', () => {
    // 1.1% of 100 ADA: 1.1 ADA, between the minimum at 4000 (1.072 ADA) and at 4310 (1.155 ADA).
    const ONE_POINT_ONE: RoyaltyInfo = {
      source: 'cip27',
      rate: 0.011,
      recipients: [{ address: ROYALTY_ADDRESS, rate: 0.011, minFeeLovelace: null, maxFeeLovelace: null }],
    };
    const stateWith = (coinsPerUtxoByte: unknown): State =>
      ({ utxos: [NFT_UTXO, FEE_UTXO], keys: KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: coinsPerUtxoByte as number });

    it('an inflated store value does not drop every royalty: it is capped at 4310 as verifyBuy caps it', async () => {
      for (const inflated of [100_000, 4311, 1_000_000_000]) {
        const r = rig({ royalties: FIVE_PERCENT, state: stateWith(inflated) });
        const data = await reply('list', LIST_REQUEST, r.deps);
        expect(data.success, String(inflated)).toBe(true);
        expect(data.result?.summary).toMatchObject({ dropped: [], royaltiesLovelace: '5000000' });
      }
    });

    it('a 1.1 ADA royalty is dropped at 4310 and kept at a lower figure, which is used as it is', async () => {
      const at4310 = rig({ royalties: ONE_POINT_ONE, state: stateWith(4310), built: response(listTx({ ...DATUM, royalties: [] })) });
      const dropped = await reply('list', LIST_REQUEST, at4310.deps);
      expect(dropped.result?.summary).toMatchObject({ dropped: [{ address: ROYALTY_ADDRESS, lovelace: '1100000' }] });

      const datum: ListingDatum = { ...DATUM, royalties: [{ address: ROYALTY_ADDRESS, lovelace: 1_100_000n }] };
      const at4000 = rig({ royalties: ONE_POINT_ONE, state: stateWith(4000), built: response(listTx(datum)) });
      const kept = await reply('list', LIST_REQUEST, at4000.deps);
      expect(kept.success).toBe(true);
      expect(kept.result?.summary).toMatchObject({ dropped: [], royaltiesLovelace: '1100000' });
    });
  });

  describe('royalties', () => {
    // 12% to one recipient: above the 10% cap.
    const TWELVE: RoyaltyInfo = {
      source: 'cip27',
      rate: 0.12,
      recipients: [{ address: ROYALTY_ADDRESS, rate: 0.12, minFeeLovelace: null, maxFeeLovelace: null }],
    };

    it('above the cap, nothing is built until the seller confirms, and the reply says what it would cost', async () => {
      const r = rig({ royalties: TWELVE });
      const data = await reply('list', LIST_REQUEST, r.deps);
      expect(data).toMatchObject({
        success: false,
        errorCode: 'ROYALTY_CONFIRMATION_REQUIRED',
        effectiveRoyaltyLovelace: '12000000',
        effectiveRoyaltyRate: '0.120000',
        royaltyRate: '0.120000',
      });
      expect(r.calls.list).not.toHaveBeenCalled();
      expect(r.deps.grantAllowance).not.toHaveBeenCalled();
    });

    it('with the seller\'s confirmation the entries are applied as they are', async () => {
      const datum: ListingDatum = { ...DATUM, royalties: [{ address: ROYALTY_ADDRESS, lovelace: 12n * ADA }] };
      const r = rig({ royalties: TWELVE, built: response(listTx(datum)) });
      const data = await reply('list', { ...LIST_REQUEST, confirmRoyaltyAboveCap: true }, r.deps);
      expect(data.success).toBe(true);
      expect((r.calls.list.mock.calls[0][0] as Record<string, unknown>)['royalties']).toEqual([{ address: ROYALTY_ADDRESS, lovelace: '12000000' }]);
    });

    it('only a true confirmation counts', async () => {
      for (const value of ['true', 1, 'yes', {}]) {
        const r = rig({ royalties: TWELVE });
        const data = await reply('list', { ...LIST_REQUEST, confirmRoyaltyAboveCap: value }, r.deps);
        expect(data.errorCode).toBe('ROYALTY_CONFIRMATION_REQUIRED');
      }
    });

    it('terms that contradict themselves are ROYALTIES_MALFORMED', async () => {
      const r = rig({ royalties: { source: 'cip27', rate: 0.5, recipients: [{ address: ROYALTY_ADDRESS, rate: 0.05, minFeeLovelace: null, maxFeeLovelace: null }] } });
      expect((await reply('list', LIST_REQUEST, r.deps)).errorCode).toBe('ROYALTIES_MALFORMED');
      expect(r.calls.list).not.toHaveBeenCalled();
    });

    it('terms that cannot be read are ROYALTIES_UNREADABLE, not a listing without royalties', async () => {
      const r = rig({ royalties: new Error('timeout of 30000ms exceeded') });
      expect((await reply('list', LIST_REQUEST, r.deps)).errorCode).toBe('ROYALTIES_UNREADABLE');
      expect(r.calls.list).not.toHaveBeenCalled();
    });

    it('a Nexus code on the royalty read is passed through', async () => {
      const r = rig({ royalties: nexusError('NETWORK_UNSUPPORTED') });
      expect((await reply('list', LIST_REQUEST, r.deps)).errorCode).toBe('NETWORK_UNSUPPORTED');
    });

    it('a seller share under the minimum is refused before Nexus is asked', async () => {
      // A CIP-102 minimum of 2.5 ADA on a 5 ADA listing leaves 5 - 1.5 - 2.5 = 1 ADA (below 1.5).
      const heavy: RoyaltyInfo = {
        source: 'cip102',
        rate: 0.01,
        recipients: [{ address: ROYALTY_ADDRESS, rate: 0.01, minFeeLovelace: 2_500_000n, maxFeeLovelace: null }],
      };
      const r = rig({ royalties: heavy });
      const data = await reply('list', { unit: UNIT_222, priceLovelace: MIN_LIST_PRICE.toString(), confirmRoyaltyAboveCap: true }, r.deps);
      expect(data.errorCode).toBe('SELLER_SHARE_TOO_LOW');
      expect(r.calls.list).not.toHaveBeenCalled();
    });

    it('the seller share is held at exactly MIN_SELLER_SHARE: 1.5 ADA is enough, one lovelace less is not', async () => {
      const minRoyalty = (lovelace: bigint): RoyaltyInfo => ({
        source: 'cip102',
        rate: 0.01,
        recipients: [{ address: ROYALTY_ADDRESS, rate: 0.01, minFeeLovelace: lovelace, maxFeeLovelace: null }],
      });
      const request = { unit: UNIT_222, priceLovelace: MIN_LIST_PRICE.toString(), confirmRoyaltyAboveCap: true };
      // 5 ADA - 1.5 ADA fee - 2 ADA royalty = 1.5 ADA: Nexus is asked (the transaction itself is not this test's).
      const exact = rig({ royalties: minRoyalty(2_000_000n) });
      expect((await reply('list', request, exact.deps)).errorCode).not.toBe('SELLER_SHARE_TOO_LOW');
      expect(exact.calls.list).toHaveBeenCalled();
      const under = rig({ royalties: minRoyalty(2_000_001n) });
      expect((await reply('list', request, under.deps)).errorCode).toBe('SELLER_SHARE_TOO_LOW');
      expect(under.calls.list).not.toHaveBeenCalled();
    });

    it('tells the seller what was left out: entries under min-UTxO and recipients with no address', async () => {
      const info: RoyaltyInfo = {
        source: 'cip27',
        rate: 0.055,
        recipients: [
          { address: ROYALTY_ADDRESS, rate: 0.05, minFeeLovelace: null, maxFeeLovelace: null },
          // 0.4% of 100 ADA is 0.4 ADA: under min-UTxO, left out of the datum.
          { address: ROYALTY_ADDRESS_2, rate: 0.004, minFeeLovelace: null, maxFeeLovelace: null },
          { address: '', rate: 0.001, minFeeLovelace: null, maxFeeLovelace: null },
        ],
      };
      const r = rig({ royalties: info });
      const data = await reply('list', LIST_REQUEST, r.deps);
      expect(data.success).toBe(true);
      expect(data.result?.summary).toMatchObject({
        dropped: [{ address: ROYALTY_ADDRESS_2, lovelace: '400000' }],
        invalidRecipients: 1,
        royaltiesLovelace: '5000000',
      });
    });

    it('lists with no royalty when the collection has none', async () => {
      const datum: ListingDatum = { ...DATUM, royalties: [] };
      const r = rig({ royalties: NO_ROYALTY, built: response(listTx(datum)) });
      const data = await reply('list', LIST_REQUEST, r.deps);
      expect(data.success).toBe(true);
      expect((r.calls.list.mock.calls[0][0] as Record<string, unknown>)['royalties']).toEqual([]);
    });
  });
});

describe('reprice and cancel', () => {
  it('a ref that is not among the wallet\'s own listings is LISTING_NOT_FOUND, and Nexus is not asked', async () => {
    for (const kind of ['reprice', 'cancel'] as const) {
      const request = kind === 'reprice' ? { ref: `${'e5'.repeat(32)}#0`, priceLovelace: '80000000' } : { ref: `${'e5'.repeat(32)}#0` };
      const r = rig();
      expect((await reply(kind, request, r.deps)).errorCode, kind).toBe('LISTING_NOT_FOUND');
      expect(r.calls[kind]).not.toHaveBeenCalled();
    }
  });

  it('works from the listings as the store broadcast them (bigints as decimal strings)', async () => {
    const stringified = JSON.parse(JSON.stringify(OWN_LISTING, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    const state: State = { utxos: [NFT_UTXO, FEE_UTXO], keys: KEYS, collateral: null, listedListings: [stringified], coinsPerUtxoByte: 4310 };
    expect((await reply('cancel', CANCEL_REQUEST, rig({ built: response(cancelTx()), state }).deps)).success).toBe(true);
    // A reprice prices against the royalties, which are bigints only once revived.
    expect((await reply('reprice', REPRICE_REQUEST, rig({ built: response(repriceTx()), state }).deps)).success).toBe(true);
  });

  it('a reprice under the minimum price is PRICE_TOO_LOW', async () => {
    const r = rig();
    const data = await reply('reprice', { ref: LISTING_REF, priceLovelace: (MIN_LIST_PRICE - 1n).toString() }, r.deps);
    expect(data.errorCode).toBe('PRICE_TOO_LOW');
    expect(r.calls.reprice).not.toHaveBeenCalled();
  });

  it('a reprice that leaves the seller under the minimum share (the royalties stay) is SELLER_SHARE_TOO_LOW', async () => {
    // 5 ADA price, 1.5 ADA fee, the listing's 5 ADA royalty: the seller would owe money.
    const r = rig();
    const data = await reply('reprice', { ref: LISTING_REF, priceLovelace: MIN_LIST_PRICE.toString() }, r.deps);
    expect(data.errorCode).toBe('SELLER_SHARE_TOO_LOW');
    expect(r.calls.reprice).not.toHaveBeenCalled();
  });

  it('offers the wallet\'s plain key UTxOs for the fee, never the reserved collateral or a script UTxO', async () => {
    const r = rig({
      built: response(cancelTx()),
      state: { utxos: [NFT_UTXO, FEE_UTXO, RESERVED, AT_SCRIPT], keys: KEYS, collateral: RESERVED, listedListings: [OWN_LISTING], coinsPerUtxoByte: 4310 },
    });
    await reply('cancel', CANCEL_REQUEST, r.deps);
    const inputs = (r.calls.cancel.mock.calls[0][0] as { feeInputs: { txHash: string; outputIndex: number }[] }).feeInputs;
    const refs = inputs.map((i) => `${i.txHash}#${i.outputIndex}`);
    expect(refs).not.toContain(`${RESERVED[0].txId}#0`);
    expect(refs).not.toContain(`${AT_SCRIPT[0].txId}#3`);
    expect(refs).toContain(`${FEE_TX}#0`);
  });
});

describe('buy', () => {
  const buyState: State = { utxos: [BUYER_UTXO], keys: KEYS, collateral: null, listedListings: [OWN_LISTING], coinsPerUtxoByte: 4310 };

  it('refuses the wallet\'s own listing, before anything is read', async () => {
    const r = rig({ state: buyState });
    const data = await reply('buy', { ref: LISTING_REF }, r.deps);
    expect(data.errorCode).toBe('OWN_LISTING');
    expect(r.deps.lookupListing).not.toHaveBeenCalled();
    expect(r.calls.buy).not.toHaveBeenCalled();
  });

  it('refuses a listing Nexus reports as the wallet\'s own even when the store has not recognised it yet', async () => {
    const byOwner = rig({ state: buyState, listing: saleDto({ ...SALE_DATUM, owner: OWNER }) });
    expect((await reply('buy', BUY_REQUEST, byOwner.deps)).errorCode).toBe('OWN_LISTING');
    const bySeller = rig({ state: buyState, listing: saleDto({ ...SALE_DATUM, sellerAddress: CHANGE }) });
    expect((await reply('buy', BUY_REQUEST, bySeller.deps)).errorCode).toBe('OWN_LISTING');
    expect(byOwner.calls.buy).not.toHaveBeenCalled();
    expect(byOwner.deps.lookupChainUtxo).not.toHaveBeenCalled();
  });

  it('passes the Nexus code of a listing it cannot find', async () => {
    const r = rig({ state: buyState, listing: nexusError('LISTING_NOT_FOUND') });
    expect((await reply('buy', BUY_REQUEST, r.deps)).errorCode).toBe('LISTING_NOT_FOUND');
    expect(r.calls.buy).not.toHaveBeenCalled();
  });

  it('a listing read that fails or does not read back is LISTING_UNREADABLE', async () => {
    const r = rig({ state: buyState, listing: new Error('Network Error') });
    expect((await reply('buy', BUY_REQUEST, r.deps)).errorCode).toBe('LISTING_UNREADABLE');
    expect(r.calls.buy).not.toHaveBeenCalled();
  });

  it('maps every failure of the chain read, and Nexus is not asked to build after any of them', async () => {
    const expected: [ListingUtxoError['code'], string][] = [
      ['UNSUPPORTED_NETWORK', 'LISTING_UNREADABLE'],
      ['UNREACHABLE', 'LISTING_UNREADABLE'],
      ['MALFORMED', 'LISTING_UNREADABLE'],
      ['NOT_FOUND', 'LISTING_NOT_FOUND'],
    ];
    for (const [code, errorCode] of expected) {
      const r = rig({ state: buyState, chain: new ListingUtxoError(code, 'detail') });
      const data = await reply('buy', BUY_REQUEST, r.deps);
      expect(data.errorCode, code).toBe(errorCode);
      expect(r.calls.buy, code).not.toHaveBeenCalled();
    }
  });

  it('an unexpected failure of the chain read is LISTING_UNREADABLE too', async () => {
    const r = rig({ state: buyState, chain: new TypeError('boom') });
    expect((await reply('buy', BUY_REQUEST, r.deps)).errorCode).toBe('LISTING_UNREADABLE');
  });

  it('a private listing is refused with its rule', async () => {
    const priv = { ...SALE_DATUM, buyer: '55'.repeat(28) };
    const r = rig({ state: buyState, listing: saleDto(priv), chain: chainOf(saleDto(priv)), built: response(buyTx()) });
    expect(await reply('buy', BUY_REQUEST, r.deps)).toMatchObject({ errorCode: 'VERIFY_FAILED', error: 'PRIVATE_LISTING' });
  });

});

describe('migrate', () => {
  const state: State = { utxos: [M_FEE_UTXO], keys: M_KEYS, collateral: null, listedListings: [], coinsPerUtxoByte: 4310 };
  const setup = (over: Partial<RigOptions> = {}) => rig({ wallet: MAINNET_WALLET, state, royalties: M_FIVE_PERCENT, built: response(migrateTx()), ...over });

  it('refuses an offer: it holds no NFT', async () => {
    const offer = itemOf({ kind: 'offer', assets: [], lovelace: '25000000' });
    const r = setup({ legacy: [offer] });
    const data = await reply('migrate', { legacyRef: `${offer.txHash}#0`, priceLovelace: PRICE.toString() }, r.deps);
    expect(data.errorCode).toBe('OFFER_NOT_MOVABLE');
    expect(r.calls.migrate).not.toHaveBeenCalled();
    expect(r.deps.royalties).not.toHaveBeenCalled();
  });

  it('a ref the lookup no longer returns is LISTING_NOT_FOUND', async () => {
    const r = setup({ legacy: [] });
    expect((await reply('migrate', MIGRATE_REQUEST, r.deps)).errorCode).toBe('LISTING_NOT_FOUND');
    expect(r.calls.migrate).not.toHaveBeenCalled();
  });

  it('a ref under another owner is NOT_OWNED', async () => {
    const r = setup({ legacy: [itemOf({ ownerPkh: STRANGER })] });
    expect((await reply('migrate', MIGRATE_REQUEST, r.deps)).errorCode).toBe('NOT_OWNED');
    expect(r.calls.migrate).not.toHaveBeenCalled();
  });

  it('a lookup that fails is not an answer: it is reported, nothing is built', async () => {
    const r = setup({ legacy: new Error('Malformed legacy listings response') });
    expect((await reply('migrate', MIGRATE_REQUEST, r.deps)).errorCode).toBe('LISTING_UNREADABLE');
    expect(r.calls.migrate).not.toHaveBeenCalled();
  });

  it('moves one NFT only, and only a (222) user token', async () => {
    const two = itemOf({ assets: [{ unit: V3_NFT, quantity: '1' }, { unit: UNIT_PLAIN, quantity: '1' }] });
    const r1 = setup({ legacy: [two] });
    expect(await reply('migrate', MIGRATE_REQUEST, r1.deps)).toMatchObject({ errorCode: 'VERIFY_FAILED', error: 'NFT' });
    const reference = itemOf({ assets: [{ unit: UNIT_100, quantity: '1' }] });
    const r2 = setup({ legacy: [reference] });
    expect(await reply('migrate', MIGRATE_REQUEST, r2.deps)).toMatchObject({ errorCode: 'VERIFY_FAILED', error: 'NFT' });
    expect(r1.calls.migrate).not.toHaveBeenCalled();
    expect(r2.calls.migrate).not.toHaveBeenCalled();
  });

  it('reads the royalties from the legacy item\'s own policy', async () => {
    const r = setup();
    await reply('migrate', MIGRATE_REQUEST, r.deps);
    expect(r.deps.royalties).toHaveBeenCalledWith(V3_NFT.slice(0, 56), Network.MAINNET);
  });

  it('lists under one of the account\'s payment keys when the legacy owner is one of its keys without an address', async () => {
    // A payment key of the key set that has no address yet: the wallet's own, but not a key of any own address.
    const quiet = 'cc'.repeat(28);
    const keys = { ...M_KEYS, payment: [...M_KEYS.payment, { cred: quiet, path: "m/1852'/1815'/0'/0/7" }] };
    const r = setup({ legacy: [itemOf({ ownerPkh: quiet })], state: { ...state, keys } });
    await reply('migrate', MIGRATE_REQUEST, r.deps);
    expect(vi.mocked(r.deps.lookupLegacy).mock.calls[0][0]).toContain(quiet);
    expect((r.calls.migrate.mock.calls[0][0] as Record<string, unknown>)['ownerPkh']).toBe(OWNER);
  });

  it('an item under the wallet\'s stake key is not the wallet\'s: the stake key is no owner', async () => {
    const r = setup({ legacy: [itemOf({ ownerPkh: STAKE })] });
    expect((await reply('migrate', MIGRATE_REQUEST, r.deps)).errorCode).toBe('NOT_OWNED');
    expect(r.calls.migrate).not.toHaveBeenCalled();
  });

  it('a price under the minimum is PRICE_TOO_LOW', async () => {
    const r = setup();
    const data = await reply('migrate', { legacyRef: V3_REF, priceLovelace: '1000' }, r.deps);
    expect(data.errorCode).toBe('PRICE_TOO_LOW');
    expect(r.calls.migrate).not.toHaveBeenCalled();
  });

  it('above the royalty cap it asks for the seller\'s confirmation first', async () => {
    const twelve: RoyaltyInfo = { source: 'cip27', rate: 0.12, recipients: [{ address: M_ROYALTY, rate: 0.12, minFeeLovelace: null, maxFeeLovelace: null }] };
    const r = setup({ royalties: twelve });
    const data = await reply('migrate', MIGRATE_REQUEST, r.deps);
    expect(data).toMatchObject({ errorCode: 'ROYALTY_CONFIRMATION_REQUIRED', effectiveRoyaltyLovelace: '12000000' });
    expect(r.calls.migrate).not.toHaveBeenCalled();
  });
});
