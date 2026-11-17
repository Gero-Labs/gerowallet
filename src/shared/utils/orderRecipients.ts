import { Cardano, Serialization } from '@cardano-sdk/core';
import { Network } from '@/models/types';
import { assetMapOf, canonicalAddress, lovelaceOf, type TxIntentViolation } from './txIntentGuard';

/**
 * Who receives what a backend-built order pays out.
 *
 * verifySpendBound limits HOW MUCH leaves the wallet. It says nothing about who gets
 * it: a builder that stays within the budget could still write its own address as
 * the order's receiver, its own key as the order's canceller (and cancel the order
 * to itself), send part of the budget to a key address of its own dressed as a fee,
 * or pay a script that is not a DEX order at all. This check closes that: every
 * output of the transaction must be
 *
 * 1. the wallet's own (an address the wallet derives itself, ownAddresses.ts);
 * 2. an order at a recognised order script, with its datum present and decoding
 *    under that script's exact layout, every payout address in it the wallet's own
 *    (its payment key, and its stake key whenever the wallet has one) and every
 *    owner/canceller key one of the wallet's own keys; or
 * 3. the swap aggregator's fee output: the pinned fee address, ADA only, at most
 *    the cap the caller derives from what the user asked to swap.
 *
 * Anything else, on any network whose scripts are not pinned here, is refused.
 * Prices (minimum receive, limits) are not checked: the wallet has no price of its
 * own to check them against.
 *
 * Pure and UI-free; the swap/RealFi signer (useNativeSwapSigner.ts) runs it right
 * after verifySpendBound.
 */

/** Who built the transaction: decides which order scripts and fee outputs it may pay. */
export type OrderBuilder = 'swapAggregator' | 'realfi';

export interface OrderRecipientPolicy {
  builder: OrderBuilder;
  /** The wallet's network as the wallet record stores it ('Mainnet', 'Preprod', ...). */
  network: string | null | undefined;
  /** The wallet's own addresses, as it derives them (ownAddresses.ts). */
  ownAddresses: Iterable<string>;
  /**
   * Swap aggregator only: the most lovelace its fee output may carry, worked out
   * from what the user asked to swap (aggregatorFeeCap in orderSpendBound.ts),
   * never from the quote. Omitted: no fee output is accepted.
   */
  maxFeeLovelace?: bigint;
}

// ── PlutusData readers (core shape, as Serialization.Transaction#toCore gives it) ──

type Data = Cardano.PlutusData;

interface OwnKeys {
  /** Payment key hashes of the wallet's own addresses. */
  payment: ReadonlySet<string>;
  /** Stake key hashes of the wallet's own base addresses. */
  stake: ReadonlySet<string>;
  /** Canonical form of every own address (canonicalAddress). */
  addresses: ReadonlySet<string>;
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function isConstr(d: Data): d is Cardano.ConstrPlutusData {
  return typeof d === 'object' && d !== null && !(d instanceof Uint8Array)
    && typeof (d as { constructor?: unknown }).constructor === 'bigint'
    && Array.isArray((d as { fields?: { items?: unknown } }).fields?.items);
}

function isList(d: Data): d is Cardano.PlutusList {
  return typeof d === 'object' && d !== null && !(d instanceof Uint8Array) && !isConstr(d)
    && Array.isArray((d as { items?: unknown }).items);
}

/** The fields of `d` when it is constructor `alt` with exactly `count` fields; otherwise null. */
function fieldsOf(d: Data, alt: number, count: number): Data[] | null {
  if (!isConstr(d) || d.constructor !== BigInt(alt)) return null;
  return d.fields.items.length === count ? d.fields.items : null;
}

/** The items of `d` when it is a list of exactly `count`; any length when `count` is omitted. */
function itemsOf(d: Data, count?: number): Data[] | null {
  if (!isList(d)) return null;
  return count == null || d.items.length === count ? d.items : null;
}

/** A field-less constructor `alt` (a unit: None, NoDatum, a direction, ...). */
const isUnit = (d: Data, alt: number) => fieldsOf(d, alt, 0) !== null;
const isInt = (d: Data) => typeof d === 'bigint';
const isBytes = (d: Data, length?: number): d is Uint8Array =>
  d instanceof Uint8Array && (length == null || d.length === length);
const bytesEqual = (d: Data, hex: string) => isBytes(d) && toHex(d) === hex;
const isDirection = (d: Data) => isUnit(d, 0) || isUnit(d, 1);

/** One of the wallet's own key hashes (payment or stake): what may own or cancel an order. */
function isOwnKey(d: Data, own: OwnKeys): boolean {
  if (!isBytes(d, 28)) return false;
  const hex = toHex(d);
  return own.payment.has(hex) || own.stake.has(hex);
}

/** `Constr 0 [pkh]`: a signature (Minswap OAMSignature, Sundae MultisigScript.Signature) by an own key. */
const isOwnSignature = (d: Data, own: OwnKeys) => {
  const f = fieldsOf(d, 0, 1);
  return !!f && isOwnKey(f[0], own);
};

/**
 * A Plutus `Address` that is the wallet's own: `Constr 0 [PubKeyCredential(pkh),
 * stake]` with pkh one of its payment keys, and stake `Some(StakingHash(
 * PubKeyCredential(own stake key)))`. Every builder writes the sender's own stake
 * key there (it is what makes the payout land on the address the wallet watches),
 * so `None` is accepted only from a wallet with no stake key.
 */
function isOwnPlutusAddress(d: Data, own: OwnKeys): boolean {
  const f = fieldsOf(d, 0, 2);
  if (!f) return false;
  const payment = fieldsOf(f[0], 0, 1);
  if (!payment || !isBytes(payment[0], 28) || !own.payment.has(toHex(payment[0]))) return false;
  if (own.stake.size === 0) return isUnit(f[1], 1);
  const some = fieldsOf(f[1], 0, 1);
  const stakingHash = some && fieldsOf(some[0], 0, 1);
  const credential = stakingHash && fieldsOf(stakingHash[0], 0, 1);
  return !!credential && isBytes(credential[0], 28) && own.stake.has(toHex(credential[0]));
}

/** `Constr 0 [policy, name]`. */
const isAssetClass = (d: Data) => {
  const f = fieldsOf(d, 0, 2);
  return !!f && isBytes(f[0]) && isBytes(f[1]);
};

/** `[policy, name, amount]`, a SundaeSwap V3 asset triple. */
const isSundaeAssetTriple = (d: Data) => {
  const t = itemsOf(d, 3);
  return !!t && isBytes(t[0]) && isBytes(t[1]) && isInt(t[2]);
};

/** `[[Constr 0 [policy, name], amount]]`, a SundaeSwap V4 asset-amount list of one. */
const isSundaeV4AssetAmounts = (d: Data) => {
  const list = itemsOf(d, 1);
  const pair = list && itemsOf(list[0], 2);
  return !!pair && isAssetClass(pair[0]) && isInt(pair[1]);
};

// ── Order layouts, one per builder (cardano-market-data, src/main/java/io/gerowallet/cardano/service/txbuilder) ──

/**
 * Minswap V1 (MinswapV1TxBuilder.java:57-103): Constr 0 [sender, receiver,
 * receiverDatumHash = None, step = SwapExactIn Constr 0 [Constr 0 [policy, name],
 * minReceive], batcherFee, outputADA]. The sender is also the cancel authority
 * (CancelTransactionService reads the owner from field [0]).
 */
function minswapV1Order(d: Data, own: OwnKeys): boolean {
  const f = fieldsOf(d, 0, 6);
  const step = f && fieldsOf(f[3], 0, 2);
  return !!f && !!step && isOwnPlutusAddress(f[0], own) && isOwnPlutusAddress(f[1], own) && isUnit(f[2], 1)
    && isAssetClass(step[0]) && isInt(step[1]) && isInt(f[4]) && isInt(f[5]);
}

/** Minswap V2 step: SwapExactIn Constr 0 (market and limit), StopLoss Constr 1, OCO Constr 2. */
function isMinswapV2Step(d: Data): boolean {
  const amount = (f: Data[]) => {
    const swapAmount = fieldsOf(f[1], 0, 1);
    return isDirection(f[0]) && !!swapAmount && isInt(swapAmount[0]) && isInt(f[2]);
  };
  const exactIn = fieldsOf(d, 0, 4);
  if (exactIn) return amount(exactIn) && isDirection(exactIn[3]);
  const stopLoss = fieldsOf(d, 1, 3);
  if (stopLoss) return amount(stopLoss);
  const oco = fieldsOf(d, 2, 4);
  return !!oco && amount(oco) && isInt(oco[3]);
}

/**
 * Minswap V2 (MinswapV2TxBuilder.java:121-156): Constr 0 [canceller = Constr 0 [pkh],
 * refundReceiver, refundReceiverDatum = NoDatum, successReceiver,
 * successReceiverDatum = NoDatum, lpAsset, step, maxBatcherFee, expiry = None].
 */
function minswapV2Order(d: Data, own: OwnKeys): boolean {
  const f = fieldsOf(d, 0, 9);
  return !!f && isOwnSignature(f[0], own)
    && isOwnPlutusAddress(f[1], own) && isUnit(f[2], 0)
    && isOwnPlutusAddress(f[3], own) && isUnit(f[4], 0)
    && isAssetClass(f[5]) && isMinswapV2Step(f[6]) && isInt(f[7]) && isUnit(f[8], 1);
}

/**
 * SundaeSwap V3 (SundaeSwapV3TxBuilder.java:70-100): Constr 0 [pool_ident =
 * Constr 0 [ident], owner = Constr 0 [pkh], max_protocol_fee, destination =
 * Constr 0 [Address, NoDatum], order = Swap Constr 1 [offer, receive], extension].
 */
function sundaeV3Order(d: Data, own: OwnKeys): boolean {
  const f = fieldsOf(d, 0, 6);
  const ident = f && fieldsOf(f[0], 0, 1);
  const destination = f && fieldsOf(f[3], 0, 2);
  const swap = f && fieldsOf(f[4], 1, 2);
  return !!f && !!ident && !!destination && !!swap && isBytes(ident[0], 28) && isOwnSignature(f[1], own)
    && isInt(f[2]) && isOwnPlutusAddress(destination[0], own) && isUnit(destination[1], 0)
    && isSundaeAssetTriple(swap[0]) && isSundaeAssetTriple(swap[1]) && isBytes(f[5]);
}

/**
 * SundaeSwap V4 protocol constants the builder writes into every order
 * (SundaeSwapV4TxBuilder.java:86-97, values from application.yml
 * dex.sundaeswap-v4, lines 228-234). The config token and the constraint modules
 * decide what an executor must deliver, so they are pinned like the script hash.
 */
const SUNDAE_V4_CONFIG_TOKEN = '012dd204b7a3c6d5d410290631d135f95703fc7247a0954067c9dbf32838d0fb';
const SUNDAE_V4_SWAP_MODULE = '30f1fac08a15ef84ea6a5aa04989b1c2ceeb3b437f2c3103df5aca68';
const SUNDAE_V4_FEE_CONSTRAINT_MODULE = '267eabb980be6699144e85b24283659838b0746e0fd2f08be1423e70';

/**
 * SundaeSwap V4 (SundaeSwapV4TxBuilder.java:37-98, market intents only):
 * Constr 0 [owner = Constr 0 [payment pkh], destination = Fixed Constr 0
 * [Address, None], service_budget, max_per_execution, config_token,
 * constraints = [[swap module, Constr 2 [offered, minReceived]], [fee module,
 * Constr 0 []]], extension = Constr 0 []].
 */
function sundaeV4Order(d: Data, own: OwnKeys): boolean {
  const f = fieldsOf(d, 0, 7);
  if (!f) return false;
  const destination = fieldsOf(f[1], 0, 2);
  const constraints = itemsOf(f[5], 2);
  const swapConstraint = constraints && itemsOf(constraints[0], 2);
  const feeConstraint = constraints && itemsOf(constraints[1], 2);
  const swap = swapConstraint && fieldsOf(swapConstraint[1], 2, 2);
  return isOwnSignature(f[0], own) && !!destination && isOwnPlutusAddress(destination[0], own)
    && isUnit(destination[1], 1) && isInt(f[2]) && isInt(f[3]) && bytesEqual(f[4], SUNDAE_V4_CONFIG_TOKEN)
    && !!swapConstraint && bytesEqual(swapConstraint[0], SUNDAE_V4_SWAP_MODULE)
    && !!swap && isSundaeV4AssetAmounts(swap[0]) && isSundaeV4AssetAmounts(swap[1])
    && !!feeConstraint && bytesEqual(feeConstraint[0], SUNDAE_V4_FEE_CONSTRAINT_MODULE) && isUnit(feeConstraint[1], 0)
    && isUnit(f[6], 0);
}

/**
 * WingRiders V1 (WingRidersTxBuilder.java:115-133): Constr 0 [metadata =
 * Constr 0 [beneficiary, ownerPkh, deadline, Constr 0 [assetA, assetB]],
 * action = Constr 0 [direction, minReceive]].
 */
function wingRidersV1Order(d: Data, own: OwnKeys): boolean {
  const f = fieldsOf(d, 0, 2);
  const meta = f && fieldsOf(f[0], 0, 4);
  const pair = meta && fieldsOf(meta[3], 0, 2);
  const action = f && fieldsOf(f[1], 0, 2);
  return !!meta && !!pair && !!action && isOwnPlutusAddress(meta[0], own) && isOwnKey(meta[1], own)
    && isInt(meta[2]) && isAssetClass(pair[0]) && isAssetClass(pair[1])
    && isDirection(action[0]) && isInt(action[1]);
}

/**
 * WingRiders V2 (WingRidersTxBuilder.java:162-181): Constr 0 [oil, beneficiary,
 * ownerAddress, compensationDatum = [], compensationDatumType = No, deadline,
 * assetA policy, assetA name, assetB policy, assetB name, Swap Constr 0
 * [direction, minWanted], aScale, bScale]. The owner address is the reclaim
 * authority.
 */
function wingRidersV2Order(d: Data, own: OwnKeys): boolean {
  const f = fieldsOf(d, 0, 13);
  const action = f && fieldsOf(f[10], 0, 2);
  return !!f && !!action && isInt(f[0]) && isOwnPlutusAddress(f[1], own) && isOwnPlutusAddress(f[2], own)
    && !!itemsOf(f[3], 0) && isUnit(f[4], 0) && isInt(f[5])
    && isBytes(f[6]) && isBytes(f[7]) && isBytes(f[8]) && isBytes(f[9])
    && isDirection(action[0]) && isInt(action[1]) && isInt(f[11]) && isInt(f[12]);
}

/**
 * Splash spot order (SplashTxBuilder.java:108-143): Constr 0 [tag, beacon, input,
 * tradable_input, cost_per_ex_step, min_marginal_output, output, base_price =
 * Constr 0 [num, denom], fee, redeemer_address, cancellation_pkh,
 * permitted_executors]. The redeemer address is where the executor pays out.
 */
function splashOrder(d: Data, own: OwnKeys): boolean {
  const f = fieldsOf(d, 0, 12);
  const price = f && fieldsOf(f[7], 0, 2);
  const executors = f && itemsOf(f[11]);
  return !!f && !!price && !!executors && isBytes(f[0]) && isBytes(f[1], 28) && isAssetClass(f[2])
    && isInt(f[3]) && isInt(f[4]) && isInt(f[5]) && isAssetClass(f[6]) && isInt(price[0]) && isInt(price[1])
    && isInt(f[8]) && isOwnPlutusAddress(f[9], own) && isOwnKey(f[10], own)
    && executors.every((e) => isBytes(e, 28));
}

/**
 * RealFi stake request (USDr for sUSDr), as cardano-market-data decodes real
 * mainnet requests (RealFiConversions.java:38-51 and its test datums): Constr 0
 * [owner = Constr 0 [pkh], destination = Constr 0 [Address, NoDatum],
 * action = Stake Constr 4 [in, minOut], Constr 0 []].
 *
 * Only the stake. An unstake (Constr 5) pays a per-order timelock SCRIPT whose
 * template is in RealFi's private SDK, not in any code the wallet can review, so
 * the wallet cannot tell RealFi's timelock from someone else's script. Mint,
 * redeem and every other action are not orders Gero builds.
 */
function realfiStakeRequest(d: Data, own: OwnKeys): boolean {
  const f = fieldsOf(d, 0, 4);
  const destination = f && fieldsOf(f[1], 0, 2);
  const action = f && fieldsOf(f[2], 4, 2);
  return !!f && !!destination && !!action && isOwnSignature(f[0], own)
    && isOwnPlutusAddress(destination[0], own) && isUnit(destination[1], 0)
    && isInt(action[0]) && isInt(action[1]) && isUnit(f[3], 0);
}

// ── Recognised order scripts ──

interface OrderScript {
  name: string;
  /** Payment credential (script hash) of the order address. */
  scriptHash: string;
  /**
   * The order address: exactly this one (bech32), the script's enterprise
   * address, or the script with the wallet's own stake key (per-user addresses).
   */
  address: { exact: string } | 'enterprise' | 'ownStake';
  /** Inline datum, or a datum hash whose preimage the transaction publishes in its witness set. */
  datum: 'inline' | 'hash';
  accepts: (datum: Data, own: OwnKeys) => boolean;
}

/**
 * The aggregator's customer-facing set (RoutableDexes.VERIFIED_DEXES): Minswap V1
 * and V2, WingRiders V1 and V2, SundaeSwap V3 and V4, Splash. Script hashes and
 * order addresses from each builder; V1 validators take a datum hash
 * (SwapTransactionService.java:109 PLUTUS_V1_DEXES, preimage published at :586),
 * the rest an inline datum (:1129-1167).
 *
 * Refused on purpose: the experimental-only DEXes (MuesliSwap, SaturnSwap, which
 * the widget builds with allowExperimental) and those with no verified builder
 * (CSwap, TeddySwap, VyFi, ShadowBook). Their datums were never byte-verified, and
 * a route the aggregator does not stand behind is not one the wallet signs. A
 * multi-hop Minswap route (SwapMultiRouting) is never built by the aggregator, so
 * its step is not accepted either.
 *
 * Mainnet only: the aggregator runs on mainnet alone and pins no preprod or
 * preview scripts, so on those networks no order script is recognised.
 */
const SWAP_ORDER_SCRIPTS: Readonly<Record<string, readonly OrderScript[]>> = {
  [Network.MAINNET]: [
    {
      // MinswapV1TxBuilder.java:36-37 (payment credential, :34; CancelTransactionService.java MINSWAP_V1_SCRIPT_HASH)
      name: 'Minswap V1',
      scriptHash: 'a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b',
      address: { exact: 'addr1zxn9efv2f6w82hagxqtn62ju4m293tqvw0uhmdl64ch8uw6j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq6s3z70' },
      datum: 'hash',
      accepts: minswapV1Order,
    },
    {
      // MinswapV2TxBuilder.java:159-165
      name: 'Minswap V2',
      scriptHash: 'c3e28c36c3447315ba5a56f33da6a6ddc1770a876a8d9f0cb3a97c4c',
      address: { exact: 'addr1w8p79rpkcdz8x9d6tft0x0dx5mwuzac2sa4gm8cvkw5hcnqst2ctf' },
      datum: 'inline',
      accepts: minswapV2Order,
    },
    {
      // SundaeSwapV3TxBuilder.java:47-48, per-user address :107-134
      name: 'SundaeSwap V3',
      scriptHash: 'fa6a58bbe2d0ff05534431c8e2f0ef2cbdc1602a8456e4b13c8f3077',
      address: 'ownStake',
      datum: 'inline',
      accepts: sundaeV3Order,
    },
    {
      // application.yml dex.sundaeswap-v4.order-script-hash (:228), per-user address SundaeSwapV4TxBuilder.java:101-132
      name: 'SundaeSwap V4',
      scriptHash: '07eb2fb09d9dd6603870ce6f84c8f8506249152173ddf0c77f1f07ec',
      address: 'ownStake',
      datum: 'inline',
      accepts: sundaeV4Order,
    },
    {
      // WingRidersTxBuilder.java:49-55
      name: 'WingRiders V1',
      scriptHash: '86ae9eebd8b97944a45201e4aec1330a72291af2d071644bba015959',
      address: { exact: 'addr1wxr2a8htmzuhj39y2gq7ftkpxv98y2g67tg8zezthgq4jkg0a4ul4' },
      datum: 'hash',
      accepts: wingRidersV1Order,
    },
    {
      // WingRidersTxBuilder.java:57-68
      name: 'WingRiders V2',
      scriptHash: 'c134d839a64a5dfb9b155869ef3f34280751a622f69958baa8ffd29c',
      address: { exact: 'addr1w8qnfkpe5e99m7umz4vxnmelxs5qw5dxytmfjk964rla98q605wte' },
      datum: 'inline',
      accepts: wingRidersV2Order,
    },
    {
      // SplashTxBuilder.java:59-61, per-user address :203-231
      name: 'Splash',
      scriptHash: '464eeee89f05aff787d40045af2a40a83fd96c513197d32fbc54ff02',
      address: 'ownStake',
      datum: 'inline',
      accepts: splashOrder,
    },
  ],
};

/**
 * RealFi request script (mainnet), from cardano-market-data
 * RealFiConversions.java:53 REQUEST_CREDENTIAL; "the request address has no stake
 * part" (:28), so the enterprise address only. The preprod request script is not
 * pinned anywhere the wallet can review, so preprod RealFi orders are refused.
 */
const REALFI_ORDER_SCRIPTS: Readonly<Record<string, readonly OrderScript[]>> = {
  [Network.MAINNET]: [
    {
      name: 'RealFi request',
      scriptHash: 'd77c0bea8bf5a2f8b3b401329ba22e77b2cd8fe88f2b8e2fc3781223',
      address: 'enterprise',
      datum: 'inline',
      accepts: realfiStakeRequest,
    },
  ],
};

/**
 * The aggregator's fee address (cardano-market-data application.yml
 * aggregator.fee-address, :553; payment credential 70150d96…, the GERO entry of
 * aggregator-detection, :547-548). SwapTransactionService.java:492-498 pays it as
 * output 1 of every swap. The optional partner-fee output (:500-523) is not
 * accepted: the wallet reaches the aggregator as a device, never with a partner
 * key, so no build for it carries one.
 */
const AGGREGATOR_FEE_ADDRESS: Readonly<Record<string, string>> = {
  [Network.MAINNET]: 'addr1q9cp2rvkjw0f75nsqyq5nhgp37e4w4hujqh8jmlju2zfscsem9ng9drvumcdpcrx7x9xygw68v8sxlhrftrnpqd045tqwrfqf7',
};

const NETWORK_IDS: Readonly<Record<string, Cardano.NetworkId>> = {
  [Network.MAINNET]: Cardano.NetworkId.Mainnet,
};

/** The pinned tables, read-only, for tests that cross-check them against each other. */
export const ORDER_SCRIPT_TABLES = { swapAggregator: SWAP_ORDER_SCRIPTS, realfi: REALFI_ORDER_SCRIPTS, feeAddress: AGGREGATOR_FEE_ADDRESS };

// ── the check ──

function addressProps(address: string): Cardano.AddressProps | null {
  try {
    return Cardano.Address.fromString(String(address).trim())?.getProps() ?? null;
  } catch {
    return null;
  }
}

function ownKeysOf(addresses: Iterable<string>): OwnKeys {
  const payment = new Set<string>();
  const stake = new Set<string>();
  const canonical = new Set<string>();
  for (const address of addresses) {
    if (!address) continue;
    canonical.add(canonicalAddress(address));
    const props = addressProps(address);
    if (props?.paymentPart?.type === Cardano.CredentialType.KeyHash) payment.add(String(props.paymentPart.hash).toLowerCase());
    if (props?.delegationPart?.type === Cardano.CredentialType.KeyHash) stake.add(String(props.delegationPart.hash).toLowerCase());
  }
  return { payment, stake, addresses: canonical };
}

function addressMatches(spec: OrderScript, props: Cardano.AddressProps, address: string, networkId: Cardano.NetworkId, own: OwnKeys): boolean {
  if (typeof spec.address === 'object') return canonicalAddress(address) === canonicalAddress(spec.address.exact);
  if (props.networkId !== networkId) return false;
  const enterprise = props.type === Cardano.AddressType.EnterpriseScript && !props.delegationPart;
  if (spec.address === 'enterprise' || own.stake.size === 0) return enterprise;
  return props.type === Cardano.AddressType.BasePaymentScriptStakeKey
    && own.stake.has(String(props.delegationPart?.hash).toLowerCase());
}

/** Witness-set datums by hash, from the bytes the transaction carries. */
function witnessDatums(tx: Cardano.Tx): Map<string, Data> {
  const byHash = new Map<string, Data>();
  for (const datum of tx.witness?.datums ?? []) {
    try {
      byHash.set(String(Serialization.PlutusData.fromCore(datum).hash()).toLowerCase(), datum);
    } catch {
      /* a datum the SDK cannot re-read proves nothing */
    }
  }
  return byHash;
}

function orderDatum(output: Cardano.TxOut, spec: OrderScript, published: () => Map<string, Data>): Data | null {
  if (output.scriptReference != null) return null;
  if (spec.datum === 'inline') return output.datum != null && output.datumHash == null ? output.datum : null;
  if (output.datum != null || output.datumHash == null) return null;
  return published().get(String(output.datumHash).toLowerCase()) ?? null;
}

/** An output that is the aggregator's fee: its address, ADA only, nothing attached. */
function isFeeShape(output: Cardano.TxOut): boolean {
  return assetMapOf(output.value).size === 0 && output.datum == null && output.datumHash == null && output.scriptReference == null;
}

/**
 * Every way `tx` pays someone other than the wallet, a recognised order for the
 * wallet, or the aggregator's capped fee: `foreignOrderRecipient`, plus
 * `spendExceeded` when the fee output carries more than the cap (so a host can say
 * the order is too large, as it does when the budget is exceeded). Empty when every
 * output is accounted for.
 */
export function verifyOrderRecipients(tx: Cardano.Tx, policy: OrderRecipientPolicy): TxIntentViolation[] {
  const violations = new Set<TxIntentViolation>();
  const network = String(policy.network ?? '');
  const own = ownKeysOf(policy.ownAddresses);
  const scripts = (policy.builder === 'swapAggregator' ? SWAP_ORDER_SCRIPTS : REALFI_ORDER_SCRIPTS)[network] ?? [];
  const networkId = NETWORK_IDS[network];
  const feeAddress = policy.builder === 'swapAggregator' ? AGGREGATOR_FEE_ADDRESS[network] : undefined;
  let published: Map<string, Data> | null = null;
  const publishedDatums = () => (published ??= witnessDatums(tx));

  let orders = 0;
  const fees: Cardano.TxOut[] = [];
  for (const output of tx.body.outputs ?? []) {
    const address = String(output.address);
    if (own.addresses.has(canonicalAddress(address))) continue;
    if (feeAddress && canonicalAddress(address) === canonicalAddress(feeAddress)) {
      fees.push(output);
      continue;
    }
    const props = addressProps(address);
    const scriptHash = props?.paymentPart?.type === Cardano.CredentialType.ScriptHash
      ? String(props.paymentPart.hash).toLowerCase()
      : null;
    const spec = scriptHash ? scripts.find((s) => s.scriptHash === scriptHash) : undefined;
    const datum = spec && props && networkId != null && addressMatches(spec, props, address, networkId, own)
      ? orderDatum(output, spec, publishedDatums)
      : null;
    let accepted = false;
    try {
      accepted = !!spec && datum != null && spec.accepts(datum, own);
    } catch {
      accepted = false;
    }
    if (accepted) orders += 1;
    else violations.add('foreignOrderRecipient');
  }

  // The aggregator pays exactly one fee output, next to the order it charges for.
  if (fees.length > 0) {
    if (fees.length > 1 || orders === 0 || policy.maxFeeLovelace == null || !fees.every(isFeeShape)) {
      violations.add('foreignOrderRecipient');
    } else if (lovelaceOf(fees[0].value) > policy.maxFeeLovelace) {
      violations.add('foreignOrderRecipient');
      violations.add('spendExceeded');
    }
  }
  return [...violations];
}
