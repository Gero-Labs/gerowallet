import { Cardano, Serialization } from '@cardano-sdk/core';
import { isCardanoTx, StoredTransaction } from '@/models/transaction.types';
import { DUST_MAPPING_VALIDATOR } from '@/shared/composables/useCnightDustRegistration';
import { getCertificateBaseStatus } from '@/modules/dashboard/utils/transactionStatus';

/**
 * Transaction classification shared by the history list (TransactionsCard) and
 * the details view (TransactionDetails), so a row and its details always agree
 * on what a transaction was: its title, its type glyph and its tags.
 *
 * Everything here is read-only, on-chain detection: the wallet compares
 * addresses, scripts and metadata already in the stored record and calls no
 * partner service.
 */

type Translator = (key: string, params?: Record<string, unknown>) => string;

export interface TxContact {
  label: string;
  isHandle: boolean;
}

/** The wallet-side facts a transaction is classified against. */
export interface TxClassifyContext {
  stakeAddress?: string;
  network?: string;
  /** The wallet's payment and change addresses. */
  walletAddresses: Set<string>;
  /** Contact address → display label. */
  contacts: Map<string, TxContact>;
}

interface WalletLike { stakeAddress?: string; network?: string }
interface KeysLike { payment?: { address?: string }[]; change?: { address?: string }[] }
interface ContactLike { address?: string; name?: string; handle?: string }

export function buildClassifyContext(
  wallet: WalletLike | null | undefined,
  keys: KeysLike | null | undefined,
  contacts: Record<string, ContactLike> | null | undefined,
): TxClassifyContext {
  const walletAddresses = new Set<string>();
  for (const key of [...(keys?.payment ?? []), ...(keys?.change ?? [])]) {
    if (key.address) walletAddresses.add(key.address);
  }
  const contactMap = new Map<string, TxContact>();
  for (const contact of Object.values(contacts ?? {})) {
    if (contact.address && contact.name) {
      contactMap.set(contact.address, { label: contact.handle || contact.name, isHandle: !!contact.handle });
    }
  }
  return { stakeAddress: wallet?.stakeAddress, network: wallet?.network, walletAddresses, contacts: contactMap };
}

/** Bitcoin records carry a `type`; Cardano records do not. */
const btcType = (item: StoredTransaction): string | undefined => (item as { type?: string }).type;

// Script hash of an address's payment part, or null for key/Byron/unparseable
// addresses. Cached: the same few hundred addresses recur across a history.
const paymentScriptHashes = new Map<string, string | null>();
export const paymentScriptHash = (address: string | undefined): string | null => {
  if (!address) return null;
  const cached = paymentScriptHashes.get(address);
  if (cached !== undefined) return cached;
  let hash: string | null = null;
  try {
    const payment = Cardano.Address.fromBech32(address).getProps().paymentPart;
    hash = payment?.type === Cardano.CredentialType.ScriptHash ? payment.hash : null;
  } catch {
    hash = null;
  }
  if (paymentScriptHashes.size > 5000) paymentScriptHashes.clear();
  paymentScriptHashes.set(address, hash);
  return hash;
};

const addressesOf = (item: StoredTransaction): string[] => [
  ...(item.utxo?.inputs ?? []).map((input) => input.address),
  ...(item.utxo?.outputs ?? []).map((output) => output.address),
  ...(isCardanoTx(item) ? (item.body?.outputs ?? []).map((output) => output.address) : []),
];

const spendsScript = (item: StoredTransaction, scriptHash: string): boolean =>
  item.utxo?.inputs?.some((input) => paymentScriptHash(input.address) === scriptHash) ?? false;

/** The CIP-20 (label 674) message lines of a transaction. */
const metadataMessages = (item: StoredTransaction): string[] => {
  const msg = isCardanoTx(item) ? item.auxiliaryData?.blob?.[674]?.msg : undefined;
  if (typeof msg === 'string') return [msg];
  return Array.isArray(msg) ? msg.filter((line): line is string => typeof line === 'string') : [];
};

// Minswap scripts, matched on the payment credential: an order address carries its
// owner's stake key, so no single bech32 string covers every order. Hashes as
// published by Minswap (minswap-dex-v2 README; @minswap/sdk constants).
const MINSWAP_V1_ORDER_SCRIPT_HASH = 'a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b';
export const MINSWAP_V2_ORDER_SCRIPT_HASH = 'c3e28c36c3447315ba5a56f33da6a6ddc1770a876a8d9f0cb3a97c4c';
// Not addr1w9e7ft4…9lvhq7: that is the cNIGHT→DUST mapping validator
// (DUST_MAPPING_VALIDATOR); matching it once titled every DUST registration "DEX Order".
export const MINSWAP_V2_POOL_SCRIPT_HASH = 'ea07b733d932129c378af627436e7cbc2ef0bf96e0036bb51b3bde6b';
const MINSWAP_SCRIPT_HASHES = new Set([
  MINSWAP_V1_ORDER_SCRIPT_HASH,
  MINSWAP_V2_ORDER_SCRIPT_HASH,
  MINSWAP_V2_POOL_SCRIPT_HASH,
]);

/** A pending transaction older than an hour never reached the chain. */
export const isPendingTooLong = (item: StoredTransaction, now: number = Date.now()): boolean => {
  if (!item.pending) return false;
  return now / 1000 - item.tx_timestamp > 60 * 60;
};

export const isWithdrawal = (item: StoredTransaction, ctx: TxClassifyContext): boolean => {
  if (!isCardanoTx(item)) return false;
  return (
    item.body?.withdrawals?.length > 0 &&
    ctx.stakeAddress &&
    item.body?.withdrawals.some((withdrawal) => withdrawal.stakeAddress === ctx.stakeAddress)
  ) ?? false;
};

export const getTxContacts = (item: StoredTransaction, ctx: TxClassifyContext): TxContact[] | null => {
  if (ctx.contacts.size === 0 || !item.utxo) return null;
  const found = new Map<string, TxContact>();
  for (const input of item.utxo.inputs || []) {
    const info = ctx.contacts.get(input.address);
    if (info) found.set(info.label, info);
  }
  // Outputs from the decoded body (CardanoTx only)
  if (isCardanoTx(item)) {
    for (const output of item.body?.outputs || []) {
      const info = ctx.contacts.get(output.address);
      if (info) found.set(info.label, info);
    }
  }
  return Array.from(found.values());
};

export const isInternalTransfer = (item: StoredTransaction, ctx: TxClassifyContext): boolean => {
  if (ctx.walletAddresses.size === 0 || !item.utxo) return false;

  const allInputsInternal = item.utxo.inputs?.every((input) => ctx.walletAddresses.has(input.address));

  // Prefer the utxo output set — it is the full on-chain output list and is
  // present even for records stored before the backend had the tx CBOR (no
  // `body`, so isCardanoTx() is false for them); `body.outputs` is the fallback
  // for just-submitted pending txs (utxo is null until confirmation). Match by
  // full (base) address — the wallet only monitors its base addresses, so an
  // output to an enterprise address derived from the same payment key (e.g. a
  // self-send to the collateral pool) is NOT tracked balance and reads as an
  // ordinary Sent, matching how other Cardano wallets classify it.
  const outputAddresses = item.utxo.outputs?.length
    ? item.utxo.outputs.map((output) => output.address)
    : (isCardanoTx(item) ? item.body?.outputs?.map((output) => output.address) : undefined);

  // Without a verifiable output list, never claim the tx is internal
  if (!outputAddresses?.length) return false;

  // Internal when ALL inputs AND ALL outputs belong to this wallet
  return !!allInputsInternal && outputAddresses.every((address) => ctx.walletAddresses.has(address));
};

export const isStrike = (item: StoredTransaction): boolean => {
  // body/witness are only present on full Cardano records; address checks below
  // also run on the utxo set so thin records (no CBOR stored) are still tagged
  const cardano = isCardanoTx(item) ? item : undefined;
  // Strike Finance perpetual trading transactions
  const STRIKE_SCRIPT_HASH = 'be7544ca7d42c903268caecae465f3f8b5a7e7607d09165e471ac8b5';
  const STRIKE_CONTRACT_ADDRESS = 'addr1wytzw530pgjxm4wxsxj5ufp23cxacrvzmytpjnlcgq6t7vsgz25ef';

  // Check for Strike contract address (primary indicator of platform interaction)
  const hasStrikeAddress =
    item.utxo?.inputs?.some((input) => input.address === STRIKE_CONTRACT_ADDRESS) ||
    item.utxo?.outputs?.some((output) => output.address === STRIKE_CONTRACT_ADDRESS) ||
    cardano?.body?.outputs?.some((output) => output.address === STRIKE_CONTRACT_ADDRESS);

  // Check for Strike script hash in witness (indicates contract execution)
  const hasStrikeScript = cardano?.witness?.scripts?.some(
    (script) => Serialization.Script.fromCore(script).hash() === STRIKE_SCRIPT_HASH
  );

  // Only tag as Strike if there's actual platform interaction, not just position NFT transfers
  return hasStrikeAddress || hasStrikeScript || false;
};

// Detects a cNIGHT→DUST registration: it locks its mapping NFT at the DUST
// mapping validator, so a registration has an OUTPUT to the validator address.
// (Deregistration spends that UTxO as an input, so keying on the output keeps
// this registration-specific.)
export const isDustRegistration = (item: StoredTransaction, ctx: TxClassifyContext): boolean => {
  const cardano = isCardanoTx(item) ? item : undefined;
  const validator = DUST_MAPPING_VALIDATOR[ctx.network ?? ''];
  if (!validator) return false;
  return cardano?.body?.outputs?.some((output) => output.address === validator.address)
    || item.utxo?.outputs?.some((output) => output.address === validator.address)
    || false;
};

// Detects historical DexHunter swap transactions (pre-aggregator-embed migration).
// This is read-only on-chain detection of transactions users made before the
// migration: the wallet reads addresses and metadata already on chain and calls
// no DexHunter service. Swap routing is Gero's own, via Nexus. See
// src/modules/swap/components/GeroSwapEmbed.vue.
// No order address here: aggregators place their orders on the routed DEX's own
// contract (the address once used was a Minswap V2 order address carrying one
// wallet's stake key), so the fee address and the 674 message identify DexHunter.
export const isDexHunter = (item: StoredTransaction): boolean => {
  const cardano = isCardanoTx(item) ? item : undefined;

  // Check for DexHunter fee address (indicates completed trade)
  const DEXHUNTER_FEE_ADDRESS =
    'addr1q8l7hny7x96fadvq8cukyqkcfca5xmkrvfrrkt7hp76v3qvssm7fz9ajmtd58ksljgkyvqu6gl23hlcfgv7um5v0rn8qtnzlfk';
  const hasDexHunterFeeAddress =
    item.utxo?.outputs?.some((output) => output.address === DEXHUNTER_FEE_ADDRESS) ||
    cardano?.body?.outputs?.some((output) => output.address === DEXHUNTER_FEE_ADDRESS);

  // Check metadata for DexHunter Trade message (indicates trade execution)
  const hasDexHunterMetadata = metadataMessages(item).some((m) => m.includes('Dexhunter') || m.includes('DexHunter'));

  return hasDexHunterFeeAddress || hasDexHunterMetadata || false;
};

/**
 * A swap placed through Gero's own aggregator (built by Nexus), which writes
 * `674: { msg: ['Gero Swap'] }`. The order itself sits on the routed DEX's contract.
 */
export const isGeroSwap = (item: StoredTransaction): boolean =>
  metadataMessages(item).some((m) => /gero ?swap/i.test(m));

// SteelSwap is an aggregator: its orders sit on the routed DEX's own contract (a
// Minswap V2 order is Minswap's script, whoever placed it), so only its 674 message,
// e.g. { 674: { msg: ['CarDeM', 'SteelSwap: 1.18.0'] } }, identifies it.
export const isSteelSwap = (item: StoredTransaction): boolean =>
  metadataMessages(item).some((m) => m.includes('SteelSwap'));

export const isMinswap = (item: StoredTransaction): boolean => {
  const cardano = isCardanoTx(item) ? item : undefined;

  // A Minswap order (V1 or V2) or V2 pool among the inputs/outputs. Pool operations
  // spend the pool UTxO; orders are placed at, and later spent from, the order script.
  // This also catches pool txs with no 674 metadata and no locally-stored datums,
  // without false-positiving on plain Minswap-LP-token transfers.
  const hasMinswapScriptAddress = addressesOf(item).some(
    (address) => MINSWAP_SCRIPT_HASHES.has(paymentScriptHash(address) ?? ''),
  );

  // Check for Minswap metadata message (indicates platform interaction)
  const hasMinswapMetadata = metadataMessages(item).some((m) => m.includes('Minswap'));

  // Check for Minswap pool NFT policy in datum CBOR (indicates pool interaction)
  const hasMinswapInOutputDatum = (cardano?.body?.outputs as Array<Cardano.TxOut & { datum?: { cbor?: string } }>)?.some(
    (output) => output.datum?.cbor?.includes('f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c')
  );

  // Check for Minswap pool NFT policy in witness datums (indicates pool interaction)
  const hasMinswapInWitnessDatum = (cardano?.witness?.datums as Array<{ cbor?: string }> | undefined)?.some(
    (datum) => datum.cbor?.includes('f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c')
  );

  // Only tag as Minswap if there's actual DEX interaction, not just LP token transfers
  return hasMinswapScriptAddress || hasMinswapMetadata || hasMinswapInOutputDatum || hasMinswapInWitnessDatum || false;
};

/**
 * A Minswap V2 order spent without its pool: the order was cancelled by its owner
 * (or refunded on expiry), not filled. A fill always spends the pool UTxO as well.
 */
export const isDexOrderCancellation = (item: StoredTransaction): boolean =>
  spendsScript(item, MINSWAP_V2_ORDER_SCRIPT_HASH) && !spendsScript(item, MINSWAP_V2_POOL_SCRIPT_HASH);

export const isJpgStore = (item: StoredTransaction): boolean => {
  const cardano = isCardanoTx(item) ? item : undefined;
  // Check for jpg.store marketplace script address
  const JPGSTORE_SCRIPT_ADDRESS =
    'addr1zxgx3far7qygq0k6epa0zcvcvrevmn0ypsnfsue94nsn3tvpw288a4x0xf8pxgcntelxmyclq83s0ykeehchz2wtspks905plm';

  // Check for jpg.store Ask V1 Contract address (inputs only)
  const JPGSTORE_ASK_V1_ADDRESS =
    'addr1x8rjw3pawl0kelu4mj3c8x20fsczf5pl744s9mxz9v8n7efvjel5h55fgjcxgchp830r7h2l5msrlpt8262r3nvr8ekstg4qrx';

  const hasJpgStoreAddress =
    item.utxo?.inputs?.some(
      (input) => input.address === JPGSTORE_SCRIPT_ADDRESS || input.address === JPGSTORE_ASK_V1_ADDRESS
    ) ||
    item.utxo?.outputs?.some((output) => output.address === JPGSTORE_SCRIPT_ADDRESS) ||
    cardano?.body?.outputs?.some((output) => output.address === JPGSTORE_SCRIPT_ADDRESS);

  // Check for jpg.store auxiliary data structure (fields 0-10, 30)
  const hasJpgStoreMetadata =
    cardano?.auxiliaryData?.blob &&
    (cardano.auxiliaryData.blob[0] ||
      cardano.auxiliaryData.blob[1] ||
      cardano.auxiliaryData.blob[2] ||
      cardano.auxiliaryData.blob[3] ||
      cardano.auxiliaryData.blob[4] ||
      cardano.auxiliaryData.blob[5] ||
      cardano.auxiliaryData.blob[6] ||
      cardano.auxiliaryData.blob[7] ||
      cardano.auxiliaryData.blob[8] ||
      cardano.auxiliaryData.blob[9] ||
      cardano.auxiliaryData.blob[10] ||
      cardano.auxiliaryData.blob[30]);

  // Check for datum hash (indicating a marketplace listing)
  const hasDatumHash = cardano?.body?.outputs?.some((output) => output.datumHash);

  return hasJpgStoreAddress || (hasJpgStoreMetadata && hasDatumHash) || false;
};

export const isWingRiders = (item: StoredTransaction): boolean => {
  const cardano = isCardanoTx(item) ? item : undefined;
  // WingRiders V1 order address
  const WINGRIDERS_V1_ORDER_ADDRESS = 'addr1wxr2a8htmzuhj39y2gq7ftkpxv98y2g67tg8zezthgq4jkg0a4ul4';

  // WingRiders V2 order address
  const WINGRIDERS_V2_ORDER_ADDRESS = 'addr1w8qnfkpe5e99m7umz4vxnmelxs5qw5dxytmfjk964rla98q605wte';

  // Check for WingRiders order contract addresses (indicates DEX interaction)
  const hasWingRidersOrderAddress =
    item.utxo?.inputs?.some(
      (input) => input.address === WINGRIDERS_V1_ORDER_ADDRESS || input.address === WINGRIDERS_V2_ORDER_ADDRESS
    ) ||
    item.utxo?.outputs?.some(
      (output) => output.address === WINGRIDERS_V1_ORDER_ADDRESS || output.address === WINGRIDERS_V2_ORDER_ADDRESS
    ) ||
    cardano?.body?.outputs?.some(
      (output) => output.address === WINGRIDERS_V1_ORDER_ADDRESS || output.address === WINGRIDERS_V2_ORDER_ADDRESS
    );

  // Check for WingRiders V1 pool validity asset policy in datum CBOR (indicates pool interaction)
  const enrichedOutputs = cardano?.body?.outputs as Array<Cardano.TxOut & { datum?: { cbor?: string } }>;
  const enrichedDatums = cardano?.witness?.datums as Array<{ cbor?: string }> | undefined;

  const hasWingRidersV1InDatum =
    enrichedDatums?.some((datum) =>
      datum.cbor?.includes('026a18d04a0c642759bb3d83b12e3344894e5c1c7b2aeb1a2113a5704c')
    ) ||
    enrichedOutputs?.some((output) =>
      output.datum?.cbor?.includes('026a18d04a0c642759bb3d83b12e3344894e5c1c7b2aeb1a2113a5704c')
    );

  // Check for WingRiders V2 pool validity asset policy in datum CBOR (indicates pool interaction)
  const hasWingRidersV2InDatum =
    enrichedDatums?.some((datum) =>
      datum.cbor?.includes('6fdc63a1d71dc2c65502b79baae7fb543185702b12c3c5fb639ed7374c')
    ) ||
    enrichedOutputs?.some((output) =>
      output.datum?.cbor?.includes('6fdc63a1d71dc2c65502b79baae7fb543185702b12c3c5fb639ed7374c')
    );

  return hasWingRidersOrderAddress || hasWingRidersV1InDatum || hasWingRidersV2InDatum || false;
};

export const isVyFi = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
  // Check for VyFi metadata message (indicates platform interaction)
  const msg = item.auxiliaryData?.blob?.[674]?.msg;
  return typeof msg === 'string' && msg.includes('VyFi');
};

export const isSundaeSwap = (item: StoredTransaction): boolean => {
  const cardano = isCardanoTx(item) ? item : undefined;
  // SundaeSwap V1 addresses
  const SUNDAESWAP_V1_ORDER_ADDRESS = 'addr1wxaptpmxcxawvr3pzlhgnpmzz3ql43n2tc8mn3av5kx0yzs09tqh8';
  const SUNDAESWAP_V1_POOL_ADDRESS = 'addr1w9qzpelu9hn45pefc0xr4ac4kdxeswq7pndul2vuj59u8tqaxdznu';

  // SundaeSwap V3 pool address (primary indicator)
  const SUNDAESWAP_V3_POOL_ADDRESS =
    'addr1x8srqftqemf0mjlukfszd97ljuxdp44r372txfcr75wrz26rnxqnmtv3hdu2t6chcfhl2zzjh36a87nmd6dwsu3jenqsslnz7e';

  // Check for SundaeSwap contract addresses (indicates DEX interaction)
  return (
    item.utxo?.inputs?.some(
      (input) =>
        input.address === SUNDAESWAP_V1_ORDER_ADDRESS ||
        input.address === SUNDAESWAP_V1_POOL_ADDRESS ||
        input.address === SUNDAESWAP_V3_POOL_ADDRESS
    ) ||
    item.utxo?.outputs?.some(
      (output) =>
        output.address === SUNDAESWAP_V1_ORDER_ADDRESS ||
        output.address === SUNDAESWAP_V1_POOL_ADDRESS ||
        output.address === SUNDAESWAP_V3_POOL_ADDRESS
    ) ||
    cardano?.body?.outputs?.some(
      (output) =>
        output.address === SUNDAESWAP_V1_ORDER_ADDRESS ||
        output.address === SUNDAESWAP_V1_POOL_ADDRESS ||
        output.address === SUNDAESWAP_V3_POOL_ADDRESS
    )
  ) ?? false;
};

export const isSplash = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
  // Splash DEX batcher key (primary indicator)
  const SPLASH_BATCHER_KEY = '5cb2c968e5d1c7197a6ce7615967310a375545d9bc65063a964335b2';

  // Splash order script hash
  const SPLASH_ORDER_SCRIPT_HASH = '464eeee89f05aff787d40045af2a40a83fd96c513197d32fbc54ff02';

  // Check for Splash batcher key in required signatures (indicates DEX interaction)
  const hasSplashBatcherKey = item.body?.requiredExtraSignatures?.some((sig) => sig === SPLASH_BATCHER_KEY);

  // Check for Splash order script in witness scripts
  const hasSplashScript = item.witness?.scripts?.some(
    (script) => Serialization.Script.fromCore(script).hash() === SPLASH_ORDER_SCRIPT_HASH
  );

  return hasSplashBatcherKey || hasSplashScript || false;
};

export const isMuesliSwap = (item: StoredTransaction): boolean => {
  const cardano = isCardanoTx(item) ? item : undefined;
  // MuesliSwap order address
  const MUESLISWAP_ORDER_ADDRESS =
    'addr1zyq0kyrml023kwjk8zr86d5gaxrt5w8lxnah8r6m6s4jp4g3r6dxnzml343sx8jweqn4vn3fz2kj8kgu9czghx0jrsyqqktyhv';

  // Check for MuesliSwap order contract address (indicates DEX interaction)
  const hasMuesliSwapOrderAddress =
    item.utxo?.inputs?.some((input) => input.address === MUESLISWAP_ORDER_ADDRESS) ||
    item.utxo?.outputs?.some((output) => output.address === MUESLISWAP_ORDER_ADDRESS) ||
    cardano?.body?.outputs?.some((output) => output.address === MUESLISWAP_ORDER_ADDRESS);

  const enrichedOutputs = cardano?.body?.outputs as Array<Cardano.TxOut & { datum?: { cbor?: string } }>;
  const enrichedDatums = cardano?.witness?.datums as Array<{ cbor?: string }> | undefined;

  // Check for MuesliSwap V1 pool NFT policy in datum CBOR (indicates pool interaction)
  const hasMuesliSwapV1InDatum =
    enrichedDatums?.some((datum) =>
      datum.cbor?.includes('909133088303c49f3a30f1cc8ed553a73857a29779f6c6561cd8093f')
    ) ||
    enrichedOutputs?.some((output) =>
      output.datum?.cbor?.includes('909133088303c49f3a30f1cc8ed553a73857a29779f6c6561cd8093f')
    );

  // Check for MuesliSwap V2 pool NFT policy in datum CBOR (indicates pool interaction)
  const hasMuesliSwapV2InDatum =
    enrichedDatums?.some((datum) =>
      datum.cbor?.includes('7a8041a0693e6605d010d5185b034d55c79eaf7ef878aae3bdcdbf67')
    ) ||
    enrichedOutputs?.some((output) =>
      output.datum?.cbor?.includes('7a8041a0693e6605d010d5185b034d55c79eaf7ef878aae3bdcdbf67')
    );

  // Check for MuesliSwap factory token in assets (indicates pool interaction)
  const hasMuesliSwapFactoryToken = item.assets?.some((asset) =>
    asset.unit?.includes('de9b756719341e79785aa13c164e7fe68c189ed04d61c9876b2fe53f4d7565736c69537761705f414d4d')
  );

  return hasMuesliSwapOrderAddress || hasMuesliSwapV1InDatum || hasMuesliSwapV2InDatum || hasMuesliSwapFactoryToken || false;
};

export const isCashback = (item: StoredTransaction): boolean => {
  return !!item.utxo?.inputs?.some((input) =>
    [
      'DdzFFzCqrhtBatWqyFge4w6M6VLgNUwRHiXTAg3xfQCUdTcjJxSrPHVZJBsQprUEc5pRhgMWQaGciTssoZVwrSKmG1fneZ1AeCtLgs5Y',
      'addr1qxj7hjwxkxlf2tyahw5fchm2w5tjm5xcedqywyd9gjh8hhpq3lssfl2enmaypvwdyfmpcvzkpdtlpa8ur332rnc0ksyq7eq6sd',
    ].includes(input.address)
  );
};

export const isStakeRegistration = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
  const certs = item.body?.certificates;
  return (
    (certs?.length ?? 0) > 0 &&
    certs!.some(
      (certificate) =>
        certificate.__typename === Cardano.CertificateType.StakeRegistration ||
        certificate.__typename === Cardano.CertificateType.StakeRegistrationDelegation ||
        certificate.__typename === Cardano.CertificateType.Registration
    )
  );
};

export const isStakeDeRegistration = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
  const certs = item.body?.certificates;
  return (
    (certs?.length ?? 0) > 0 &&
    certs!.some(
      (certificate) =>
        certificate.__typename === Cardano.CertificateType.Unregistration ||
        certificate.__typename === Cardano.CertificateType.StakeDeregistration
    )
  );
};

/** Any recognised DEX/aggregator interaction — titles the tx "DEX Order". */
export const isDexTransaction = (item: StoredTransaction): boolean =>
  isMinswap(item) || isSundaeSwap(item) || isSplash(item) || isDexHunter(item) || isSteelSwap(item) || isGeroSwap(item);

/**
 * Adds the fund-movement part of a transaction's title. Certificate
 * transactions are titled by their certificates instead.
 */
export const addFundTransferStatus = (
  item: StoredTransaction,
  statuses: string[],
  t: Translator,
  ctx: TxClassifyContext,
): void => {
  if (isCardanoTx(item) && item.body?.certificates && item.body.certificates.length > 0) {
    return;
  }
  // A detected DEX interaction (swap / add-remove liquidity) reads wrong as
  // "Sent Funds". Title it "DEX Order" — accurate whichever pool op it is; the
  // venue tag (Minswap, etc.) names the platform.
  // An order spent without its pool came back unfilled: a refund, not a swap.
  if (isDexOrderCancellation(item)) {
    statuses.push(t('transactions.orderCancelled'));
    return;
  }
  if (isDexTransaction(item)) {
    statuses.push(t('transactions.dexOrder'));
    return;
  }
  // Every input and output is the wallet's own: nothing left the wallet but the
  // fee, so "Sent Funds" would overstate it.
  if (isInternalTransfer(item, ctx)) {
    statuses.push(t('transactions.selfTransfer'));
    return;
  }
  const hasReceivedFunds = item.receivedAmount - item.sentAmount > 0;
  const hasSentFunds = item.receivedAmount - item.sentAmount < 0;
  const receivedTokenCount = item.assets?.filter((asset) => asset.unit !== 'lovelace' && asset.quantity > 0).length ?? 0;
  const sentTokenCount = item.assets?.filter((asset) => asset.unit !== 'lovelace' && asset.quantity < 0).length ?? 0;
  const hasReceivedTokens = receivedTokenCount > 0;
  const hasSentTokens = sentTokenCount > 0;

  // When tokens are present, a small ADA amount is just the min UTxO locked with the tokens.
  // In that case, label as token-only (e.g. "Received Tokens" instead of "Received Funds & Tokens").
  // TODO: min UTxO threshold (currently 2 ADA) should be derived from protocol params
  // (coinsPerUtxoByte) rather than hardcoded, as it can change with protocol updates.
  const netAdaAbs = Math.abs(item.receivedAmount - item.sentAmount) / 1_000_000;
  const isMinUtxoOnly = netAdaAbs <= 2;

  const receivedTokenLabel = receivedTokenCount === 1 ? t('transactions.receivedToken') : t('transactions.receivedTokens');
  const sentTokenLabel = sentTokenCount === 1 ? t('transactions.sentToken') : t('transactions.sentTokens');
  const receivedFundsAndTokensLabel = receivedTokenCount === 1 ? t('transactions.receivedFundsAndToken') : t('transactions.receivedFundsAndTokens');
  const sentFundsAndTokensLabel = sentTokenCount === 1 ? t('transactions.sentFundsAndToken') : t('transactions.sentFundsAndTokens');

  if (hasReceivedFunds && hasReceivedTokens && isMinUtxoOnly) {
    statuses.push(receivedTokenLabel);
  } else if (hasSentFunds && hasSentTokens && isMinUtxoOnly) {
    statuses.push(sentTokenLabel);
  } else if (hasReceivedFunds && hasReceivedTokens) {
    statuses.push(receivedFundsAndTokensLabel);
  } else if (hasSentFunds && hasSentTokens) {
    statuses.push(sentFundsAndTokensLabel);
  } else if (hasReceivedFunds && hasSentTokens) {
    statuses.push(t('transactions.receivedFundsAndSentTokens'));
  } else if (hasSentFunds && hasReceivedTokens) {
    statuses.push(t('transactions.sentFundsAndReceivedTokens'));
  } else if (hasReceivedFunds) {
    statuses.push(t('transactions.receivedFunds'));
  } else if (hasSentFunds) {
    statuses.push(t('transactions.sentFunds'));
  } else if (hasReceivedTokens) {
    statuses.push(receivedTokenLabel);
  } else if (hasSentTokens) {
    statuses.push(sentTokenLabel);
  }
};

/** A transaction's title without pool metadata (the list upgrades delegations to "Delegating to TICKER"). */
export const buildTxTitle = (item: StoredTransaction, ctx: TxClassifyContext, t: Translator): string => {
  switch (btcType(item)) {
    case undefined:
      break;
    case 'receive':
      return t('transactions.receivedFunds');
    case 'send':
      return t('transactions.sentFunds');
    case 'self':
      return t('transactions.selfTransfer');
    default:
      return t('transactions.transaction');
  }

  const statuses: string[] = [];
  if (isCardanoTx(item) && item.body?.certificates?.length > 0) {
    item.body.certificates.forEach((certificate: Cardano.Certificate) => {
      const status = getCertificateBaseStatus(certificate.__typename, t);
      if (status) statuses.push(status);
    });
  }
  addFundTransferStatus(item, statuses, t, ctx);
  return statuses.join(', ');
};

// ---------------------------------------------------------------------------
// Row type: the glyph a transaction is drawn with
// ---------------------------------------------------------------------------

export type TxKind =
  | 'failed'
  | 'pending'
  | 'swap'
  | 'cancelled'
  | 'stake'
  | 'vote'
  | 'withdrawal'
  | 'self'
  | 'in'
  | 'out'
  | 'neutral';

/** Semantic tone of a glyph: incoming green, protocol actions the chain accent, the rest neutral. */
export type TxTone = 'in' | 'accent' | 'neutral' | 'warning' | 'error';

const GOVERNANCE_CERTIFICATES = new Set<string>([
  Cardano.CertificateType.VoteDelegation,
  Cardano.CertificateType.VoteRegistrationDelegation,
  Cardano.CertificateType.StakeVoteDelegation,
  Cardano.CertificateType.StakeVoteRegistrationDelegation,
  Cardano.CertificateType.RegisterDelegateRepresentative,
  Cardano.CertificateType.UnregisterDelegateRepresentative,
  Cardano.CertificateType.UpdateDelegateRepresentative,
  Cardano.CertificateType.AuthorizeCommitteeHot,
  Cardano.CertificateType.ResignCommitteeCold,
]);

export const TX_KIND_ICON: Record<TxKind, string> = {
  failed: 'mdi-alert-circle-outline',
  pending: 'mdi-clock-outline',
  swap: 'mdi-swap-horizontal',
  cancelled: 'mdi-undo-variant',
  stake: 'mdi-layers-outline',
  vote: 'mdi-vote-outline',
  withdrawal: 'mdi-hand-coin-outline',
  self: 'mdi-sync',
  in: 'mdi-arrow-bottom-left',
  out: 'mdi-arrow-top-right',
  neutral: 'mdi-swap-vertical',
};

export const TX_KIND_TONE: Record<TxKind, TxTone> = {
  failed: 'error',
  pending: 'warning',
  swap: 'accent',
  cancelled: 'neutral',
  stake: 'accent',
  vote: 'accent',
  withdrawal: 'in',
  self: 'neutral',
  in: 'in',
  out: 'neutral',
  neutral: 'neutral',
};

export const classifyTxKind = (item: StoredTransaction, ctx: TxClassifyContext, now: number = Date.now()): TxKind => {
  if (isPendingTooLong(item, now)) return 'failed';
  if (item.pending) return 'pending';
  if (isCardanoTx(item) && item.body?.certificates?.length) {
    return item.body.certificates.some((c) => GOVERNANCE_CERTIFICATES.has(c.__typename)) ? 'vote' : 'stake';
  }
  if (isDexOrderCancellation(item)) return 'cancelled';
  if (isDexTransaction(item)) return 'swap';
  if (isWithdrawal(item, ctx)) return 'withdrawal';
  const type = btcType(item);
  if (type === 'self' || isInternalTransfer(item, ctx)) return 'self';
  const net = item.receivedAmount - item.sentAmount;
  if (type === 'receive' || net > 0) return 'in';
  if (type === 'send' || net < 0) return 'out';
  // Token-only movement
  if (item.assets?.some((a) => a.unit !== 'lovelace' && a.quantity > 0)) return 'in';
  if (item.assets?.some((a) => a.unit !== 'lovelace' && a.quantity < 0)) return 'out';
  return 'neutral';
};

// ---------------------------------------------------------------------------
// Tags: protocol events, venues and contacts, drawn as neutral outlined tags
// ---------------------------------------------------------------------------

export interface TxTag {
  key: string;
  label: string;
  /** Contact tags carry a person icon. */
  icon?: string;
  /** ADA Handle tags render the `$` prefix. */
  handle?: boolean;
}

export const buildTxTags = (item: StoredTransaction, ctx: TxClassifyContext, t: Translator, kind: TxKind): TxTag[] => {
  const tags: TxTag[] = [];
  if (isStakeRegistration(item)) tags.push({ key: 'stakeRegistration', label: t('transactions.stakeRegistration') });
  if (isStakeDeRegistration(item)) tags.push({ key: 'stakeDeregistration', label: t('transactions.stakeDeregistration') });
  if (isWithdrawal(item, ctx)) tags.push({ key: 'withdrawal', label: t('transactions.withdrawal') });
  if (isCashback(item)) tags.push({ key: 'cashback', label: t('cashback.cashback') });
  // A plain self transfer already says so in its title.
  if (kind !== 'self' && isInternalTransfer(item, ctx)) tags.push({ key: 'internal', label: t('common.internal') });
  for (const contact of getTxContacts(item, ctx) ?? []) {
    tags.push(contact.isHandle
      ? { key: `handle-${contact.label}`, label: contact.label.replace(/^\$/, ''), handle: true }
      : { key: `contact-${contact.label}`, label: contact.label, icon: 'mdi-account-outline' });
  }
  if (isStrike(item)) tags.push({ key: 'strike', label: t('transactions.strike') });
  if (isDustRegistration(item, ctx)) tags.push({ key: 'dust', label: t('transactions.dustRegistration') });
  if (isDexHunter(item)) tags.push({ key: 'dexhunter', label: t('transactions.dexhunter') });
  if (isGeroSwap(item)) tags.push({ key: 'geroswap', label: t('transactions.geroSwap') });
  if (isSteelSwap(item)) tags.push({ key: 'steelswap', label: t('transactions.steelswap') });
  if (isMinswap(item)) tags.push({ key: 'minswap', label: t('transactions.minswap') });
  // Brand names, not copy
  if (isJpgStore(item)) tags.push({ key: 'jpgstore', label: 'jpg.store' });
  if (isWingRiders(item)) tags.push({ key: 'wingriders', label: t('transactions.wingRiders') });
  if (isMuesliSwap(item)) tags.push({ key: 'muesliswap', label: t('transactions.muesliswap') });
  if (isVyFi(item)) tags.push({ key: 'vyfi', label: 'VyFi' });
  if (isSundaeSwap(item)) tags.push({ key: 'sundaeswap', label: t('transactions.sundaeswap') });
  if (isSplash(item)) tags.push({ key: 'splash', label: t('transactions.splash') });
  return tags;
};

/** `filters.toCurrency` writes "- ₳1.00"; display a real minus sign. */
export const withMinusSign = (value: string): string => value.replace(/^- /, '− ');
