import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { ORDER_SCRIPT_TABLES, verifyOrderRecipients, type OrderBuilder } from './orderRecipients';

/*
 * Datums come from cardano-market-data (read-only), two ways:
 * - REAL on-chain bytes where the repo has them (Minswap V1, WingRiders V1 and V2,
 *   SundaeSwap V4, a RealFi stake request), checked against the wallet that owns them;
 * - re-encoded field for field from each builder (src/main/java/io/gerowallet/cardano/
 *   service/txbuilder/*TxBuilder.java) for a test wallet, so every receiver, refund,
 *   owner and stake field can be swapped one at a time.
 */

type Data = Cardano.PlutusData;
const C = (alt: number, ...fields: Data[]): Data => ({ constructor: BigInt(alt), fields: { items: fields } });
const L = (...items: Data[]): Data => ({ items });
const B = (hex: string): Data => Uint8Array.from(Buffer.from(hex, 'hex'));
const I = (n: number | bigint): Data => BigInt(n);
const fromHex = (hex: string): Data => Serialization.PlutusData.fromCbor(hex as never).toCore();
const datumHash = (d: Data) => Serialization.PlutusData.fromCore(d).hash();

const key = (hash: string) => ({ type: Cardano.CredentialType.KeyHash, hash: hash as Cardano.Credential['hash'] });
const script = (hash: string) => ({ type: Cardano.CredentialType.ScriptHash, hash: hash as Cardano.Credential['hash'] });
const { Mainnet, Testnet } = Cardano.NetworkId;
const base = (pay: string, stake: string, net = Mainnet) =>
  Cardano.BaseAddress.fromCredentials(net, key(pay), key(stake)).toAddress().toBech32();
const enterprise = (pay: string, net = Mainnet) => Cardano.EnterpriseAddress.fromCredentials(net, key(pay)).toAddress().toBech32();
const scriptAt = (hash: string, stake: string | null, net = Mainnet) => (stake
  ? Cardano.BaseAddress.fromCredentials(net, script(hash), key(stake)).toAddress().toBech32()
  : Cardano.EnterpriseAddress.fromCredentials(net, script(hash)).toAddress().toBech32());

// The test wallet: two payment keys (receive, change) under one stake key.
const PAY = '5867c3b8e27840f556ac268b781578b14c5661fc63ee720dbeab663f';
const CHANGE_PAY = '0589622a5f22f3a54c0b3df9a8d36bbcb98e1a4bdd52ebc8db1fe5f1';
const STAKE = '11223344556677889900aabbccddeeff00112233445566778899aabb';
const OWN = [base(PAY, STAKE), base(CHANGE_PAY, STAKE)];
// Someone else.
const THIEF = 'ab'.repeat(28);
const THIEF_STAKE = 'cd'.repeat(28);

const FEE_ADDRESS = 'addr1q9cp2rvkjw0f75nsqyq5nhgp37e4w4hujqh8jmlju2zfscsem9ng9drvumcdpcrx7x9xygw68v8sxlhrftrnpqd045tqwrfqf7';
const TOKEN_POLICY = 'b7c5cd554f3e83c8aa0900a0c9053284a5348244d23d0406c28eaf4d';
const TOKEN_NAME = '50414c4d0a';
const TX = '1'.repeat(64);

/** Where an order sends what: the payout and refund addresses and the cancel key. */
interface Roles {
  owner: string;
  receiverPay: string;
  receiverStake: string | null;
  refundPay: string;
  refundStake: string | null;
}
const OWN_ROLES: Roles = { owner: PAY, receiverPay: PAY, receiverStake: STAKE, refundPay: PAY, refundStake: STAKE };

/** Plutus Address = Constr 0 [PubKeyCredential(pkh), Some(StakingHash(PubKeyCredential(stake))) | None]. */
const addr = (pay: string, stake: string | null) => C(0, C(0, B(pay)), stake ? C(0, C(0, C(0, B(stake)))) : C(1));

const SUNDAE_V4_CONFIG = '012dd204b7a3c6d5d410290631d135f95703fc7247a0954067c9dbf32838d0fb';
const SUNDAE_V4_SWAP_MODULE = '30f1fac08a15ef84ea6a5aa04989b1c2ceeb3b437f2c3103df5aca68';
const SUNDAE_V4_FEE_MODULE = '267eabb980be6699144e85b24283659838b0746e0fd2f08be1423e70';
const SPLASH_EXECUTOR = '5cb2c968e5d1c7197a6ce7615967310a375545d9bc65063a964335b2';

interface OrderCase {
  name: string;
  builder: OrderBuilder;
  scriptHash: string;
  /** The order address for a wallet with this stake key. */
  orderAddress: (stake: string | null) => string;
  datumKind: 'inline' | 'hash';
  /** The datum the builder writes for these roles. */
  datum: (r: Roles) => Data;
  /** Which roles the layout has (a refund address, a separate owner key). */
  has: { refund: boolean };
}

const ORDERS: OrderCase[] = [
  {
    // MinswapV1TxBuilder.buildDatum: [sender, receiver, None, SwapExactIn, batcherFee, outputADA]
    name: 'Minswap V1',
    builder: 'swapAggregator',
    scriptHash: 'a65ca58a4e9c755fa830173d2a5caed458ac0c73f97db7faae2e7e3b',
    orderAddress: () => 'addr1zxn9efv2f6w82hagxqtn62ju4m293tqvw0uhmdl64ch8uw6j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq6s3z70',
    datumKind: 'hash',
    datum: (r) => C(0, addr(r.refundPay, r.refundStake), addr(r.receiverPay, r.receiverStake), C(1),
      C(0, C(0, B(TOKEN_POLICY), B(TOKEN_NAME)), I(1_000)), I(2_000_000), I(2_000_000)),
    // The sender is both the refund target and the cancel authority.
    has: { refund: true },
  },
  {
    // MinswapV2TxBuilder.assembleOrderDatum
    name: 'Minswap V2',
    builder: 'swapAggregator',
    scriptHash: 'c3e28c36c3447315ba5a56f33da6a6ddc1770a876a8d9f0cb3a97c4c',
    orderAddress: () => 'addr1w8p79rpkcdz8x9d6tft0x0dx5mwuzac2sa4gm8cvkw5hcnqst2ctf',
    datumKind: 'inline',
    datum: (r) => C(0, C(0, B(r.owner)), addr(r.refundPay, r.refundStake), C(0), addr(r.receiverPay, r.receiverStake), C(0),
      C(0, B('f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c'), B('82e2b1fd27a7712a1a9cf750dfbea1a5778611b20e06dd6a611df7a643f8cb75')),
      C(0, C(1), C(0, I(50_000_000)), I(1_000), C(1)), I(2_000_000), C(1)),
    has: { refund: true },
  },
  {
    // SundaeSwapV3TxBuilder.buildDatum
    name: 'SundaeSwap V3',
    builder: 'swapAggregator',
    scriptHash: 'fa6a58bbe2d0ff05534431c8e2f0ef2cbdc1602a8456e4b13c8f3077',
    orderAddress: (stake) => scriptAt('fa6a58bbe2d0ff05534431c8e2f0ef2cbdc1602a8456e4b13c8f3077', stake),
    datumKind: 'inline',
    datum: (r) => C(0, C(0, B('2f36866691fa75a9aab66dec99f7cc2d297ca09e34d9ce68cde04773')), C(0, B(r.owner)), I(1_280_000),
      C(0, addr(r.receiverPay, r.receiverStake), C(0)),
      C(1, L(B(''), B(''), I(50_000_000)), L(B(TOKEN_POLICY), B(TOKEN_NAME), I(1_000))), B('d87980')),
    has: { refund: false },
  },
  {
    // SundaeSwapV4TxBuilder.buildDatum (owner = the payment key)
    name: 'SundaeSwap V4',
    builder: 'swapAggregator',
    scriptHash: '07eb2fb09d9dd6603870ce6f84c8f8506249152173ddf0c77f1f07ec',
    orderAddress: (stake) => scriptAt('07eb2fb09d9dd6603870ce6f84c8f8506249152173ddf0c77f1f07ec', stake),
    datumKind: 'inline',
    datum: (r) => C(0, C(0, B(r.owner)), C(0, addr(r.receiverPay, r.receiverStake), C(1)), I(3_000_000), I(1_500_000),
      B(SUNDAE_V4_CONFIG),
      L(L(B(SUNDAE_V4_SWAP_MODULE), C(2, L(L(C(0, B(''), B('')), I(50_000_000))), L(L(C(0, B(TOKEN_POLICY), B(TOKEN_NAME)), I(1_000))))),
        L(B(SUNDAE_V4_FEE_MODULE), C(0))),
      C(0)),
    has: { refund: false },
  },
  {
    // WingRidersTxBuilder.buildDatum (V1, datum hash)
    name: 'WingRiders V1',
    builder: 'swapAggregator',
    scriptHash: '86ae9eebd8b97944a45201e4aec1330a72291af2d071644bba015959',
    orderAddress: () => 'addr1wxr2a8htmzuhj39y2gq7ftkpxv98y2g67tg8zezthgq4jkg0a4ul4',
    datumKind: 'hash',
    datum: (r) => C(0, C(0, addr(r.receiverPay, r.receiverStake), B(r.owner), I(1_893_456_000_000n),
      C(0, C(0, B(''), B('')), C(0, B(TOKEN_POLICY), B(TOKEN_NAME)))), C(0, C(0), I(1_000))),
    has: { refund: false },
  },
  {
    // WingRidersTxBuilder.buildV2Datum: [oil, beneficiary, ownerAddress, [], No, deadline, A, A, B, B, Swap, 1, 1]
    name: 'WingRiders V2',
    builder: 'swapAggregator',
    scriptHash: 'c134d839a64a5dfb9b155869ef3f34280751a622f69958baa8ffd29c',
    orderAddress: () => 'addr1w8qnfkpe5e99m7umz4vxnmelxs5qw5dxytmfjk964rla98q605wte',
    datumKind: 'inline',
    datum: (r) => C(0, I(2_000_000), addr(r.receiverPay, r.receiverStake), addr(r.refundPay, r.refundStake), L(), C(0),
      I(1_893_456_000_000n), B(''), B(''), B(TOKEN_POLICY), B(TOKEN_NAME), C(0, C(0), I(1_000)), I(1), I(1)),
    // The owner address is the reclaim authority and where a reclaim pays.
    has: { refund: true },
  },
  {
    // SplashTxBuilder.buildDatum (beacon finalized: any 28 bytes)
    name: 'Splash',
    builder: 'swapAggregator',
    scriptHash: '464eeee89f05aff787d40045af2a40a83fd96c513197d32fbc54ff02',
    orderAddress: (stake) => scriptAt('464eeee89f05aff787d40045af2a40a83fd96c513197d32fbc54ff02', stake),
    datumKind: 'inline',
    datum: (r) => C(0, B('00'), B('9e'.repeat(28)), C(0, B(''), B('')), I(50_000_000), I(1_000_000), I(1_000),
      C(0, B(TOKEN_POLICY), B(TOKEN_NAME)), C(0, I(1_000), I(50_000_000)), I(2_000_000),
      addr(r.receiverPay, r.receiverStake), B(r.owner), L(B(SPLASH_EXECUTOR))),
    has: { refund: false },
  },
  {
    // RealFi stake request, as cardano-market-data RealFiConversions decodes it
    name: 'RealFi stake request',
    builder: 'realfi',
    scriptHash: 'd77c0bea8bf5a2f8b3b401329ba22e77b2cd8fe88f2b8e2fc3781223',
    orderAddress: () => scriptAt('d77c0bea8bf5a2f8b3b401329ba22e77b2cd8fe88f2b8e2fc3781223', null),
    datumKind: 'inline',
    datum: (r) => C(0, C(0, B(r.owner)), C(0, addr(r.receiverPay, r.receiverStake), C(0)), C(4, I(10_000_000), I(9_900_000)), C(0)),
    has: { refund: false },
  },
];

interface Out {
  address: string;
  coins?: bigint;
  assets?: Map<string, bigint>;
  datum?: Data;
  datumHash?: string;
}

/** A transaction with these outputs, through real CBOR and back, as the signer decodes it. */
function decodedTx(outputs: Out[], witnessDatums: Data[] = []): Cardano.Tx {
  const core = {
    id: '0'.repeat(64),
    body: {
      inputs: [{ txId: TX, index: 0 }],
      outputs: outputs.map((o) => ({
        address: o.address,
        value: { coins: o.coins ?? 5_000_000n, ...(o.assets ? { assets: o.assets } : {}) },
        ...(o.datum != null ? { datum: o.datum } : {}),
        ...(o.datumHash ? { datumHash: o.datumHash } : {}),
      })),
      fee: 200_000n,
    },
    witness: { signatures: new Map(), ...(witnessDatums.length ? { datums: witnessDatums } : {}) },
  } as unknown as Cardano.Tx;
  return Serialization.Transaction.fromCbor(Serialization.Transaction.fromCore(core).toCbor()).toCore();
}

/** The order output for `datum`: inline, or as a hash with the preimage in the witness set. */
function orderOutput(o: OrderCase, datum: Data, address = o.orderAddress(STAKE)): { out: Out; witness: Data[] } {
  if (o.datumKind === 'inline') return { out: { address, coins: 56_000_000n, datum }, witness: [] };
  return { out: { address, coins: 56_000_000n, datumHash: datumHash(datum) }, witness: [datum] };
}

const policy = (builder: OrderBuilder, extra: Partial<Parameters<typeof verifyOrderRecipients>[1]> = {}) => ({
  builder,
  network: 'Mainnet',
  ownAddresses: OWN,
  maxFeeLovelace: builder === 'swapAggregator' ? 1_200_000n : undefined,
  ...extra,
});

/** Verify a swap of order `o` with `datum`, plus change to the wallet and (swap) the aggregator fee. */
function verifyOrder(o: OrderCase, datum: Data, opts: { address?: string; extra?: Out[]; noFee?: boolean; policy?: object } = {}) {
  const { out, witness } = orderOutput(o, datum, opts.address);
  const fee: Out[] = o.builder === 'swapAggregator' && !opts.noFee ? [{ address: FEE_ADDRESS, coins: 1_200_000n }] : [];
  const tx = decodedTx([out, ...fee, { address: OWN[0], coins: 40_000_000n }, ...(opts.extra ?? [])], witness);
  return verifyOrderRecipients(tx, { ...policy(o.builder), ...opts.policy });
}

const REFUSED = ['foreignOrderRecipient'];

describe.each(ORDERS)('$name', (o) => {
  it('signs a genuine order for the wallet', () => {
    expect(verifyOrder(o, o.datum(OWN_ROLES))).toEqual([]);
  });

  it('accepts the payout to the wallet\'s change key too', () => {
    expect(verifyOrder(o, o.datum({ ...OWN_ROLES, receiverPay: CHANGE_PAY, refundPay: CHANGE_PAY }))).toEqual([]);
  });

  it('refuses an order that pays out to someone else', () => {
    expect(verifyOrder(o, o.datum({ ...OWN_ROLES, receiverPay: THIEF }))).toEqual(REFUSED);
  });

  it('refuses an order whose payout carries someone else\'s stake key', () => {
    expect(verifyOrder(o, o.datum({ ...OWN_ROLES, receiverStake: THIEF_STAKE }))).toEqual(REFUSED);
  });

  it('refuses an order whose payout drops the wallet\'s stake key', () => {
    expect(verifyOrder(o, o.datum({ ...OWN_ROLES, receiverStake: null }))).toEqual(REFUSED);
  });

  if (o.has.refund) {
    it('refuses an order that refunds to someone else', () => {
      expect(verifyOrder(o, o.datum({ ...OWN_ROLES, refundPay: THIEF }))).toEqual(REFUSED);
      expect(verifyOrder(o, o.datum({ ...OWN_ROLES, refundStake: THIEF_STAKE }))).toEqual(REFUSED);
    });
  }

  if (o.name !== 'Minswap V1' && o.name !== 'WingRiders V2') {
    // (Minswap V1 and WingRiders V2 take the cancel authority from the refund address, covered above.)
    it('refuses an order someone else can cancel', () => {
      expect(verifyOrder(o, o.datum({ ...OWN_ROLES, owner: THIEF }))).toEqual(REFUSED);
    });

    it('accepts the wallet\'s own stake key as the cancel key', () => {
      expect(verifyOrder(o, o.datum({ ...OWN_ROLES, owner: STAKE }))).toEqual([]);
    });
  }

  it('refuses the order at an address with someone else\'s stake key', () => {
    expect(verifyOrder(o, o.datum(OWN_ROLES), { address: scriptAt(o.scriptHash, THIEF_STAKE) })).toEqual(REFUSED);
  });

  it('refuses the order script on another network', () => {
    expect(verifyOrder(o, o.datum(OWN_ROLES), { address: scriptAt(o.scriptHash, STAKE, Testnet) })).toEqual(REFUSED);
  });

  it('refuses an order with no datum', () => {
    const tx = decodedTx([{ address: o.orderAddress(STAKE), coins: 56_000_000n }, { address: OWN[0] }]);
    expect(verifyOrderRecipients(tx, policy(o.builder))).toEqual(REFUSED);
  });

  it('refuses an order whose datum hash has no preimage in the transaction', () => {
    const tx = decodedTx([{ address: o.orderAddress(STAKE), datumHash: datumHash(o.datum(OWN_ROLES)) }, { address: OWN[0] }]);
    expect(verifyOrderRecipients(tx, policy(o.builder))).toEqual(REFUSED);
  });

  if (o.datumKind === 'hash') {
    it('refuses an order whose datum hash names a datum other than the genuine one it publishes', () => {
      const genuine = o.datum(OWN_ROLES);
      const theirs = o.datum({ ...OWN_ROLES, receiverPay: THIEF });
      const tx = decodedTx([{ address: o.orderAddress(STAKE), datumHash: datumHash(theirs) }, { address: OWN[0] }], [genuine]);
      expect(verifyOrderRecipients(tx, policy(o.builder))).toEqual(REFUSED);
    });
  }

  it(o.datumKind === 'inline' ? 'refuses the datum as a hash: the validator reads it inline' : 'refuses the datum inline: a Plutus V1 validator cannot read it', () => {
    const datum = o.datum(OWN_ROLES);
    const flipped = o.datumKind === 'inline'
      ? decodedTx([{ address: o.orderAddress(STAKE), datumHash: datumHash(datum) }, { address: OWN[0] }], [datum])
      : decodedTx([{ address: o.orderAddress(STAKE), datum }, { address: OWN[0] }]);
    expect(verifyOrderRecipients(flipped, policy(o.builder))).toEqual(REFUSED);
  });

  it('refuses a datum that does not decode under the order layout', () => {
    expect(verifyOrder(o, I(42))).toEqual(REFUSED);
    expect(verifyOrder(o, C(0, C(0, B(PAY))))).toEqual(REFUSED);
    // One field too many.
    const genuine = o.datum(OWN_ROLES) as Cardano.ConstrPlutusData;
    expect(verifyOrder(o, C(0, ...genuine.fields.items, I(0)))).toEqual(REFUSED);
    // The right fields under another constructor.
    expect(verifyOrder(o, C(1, ...genuine.fields.items))).toEqual(REFUSED);
  });

  it('refuses a script that is not a recognised order script', () => {
    const unknown = { address: scriptAt('99'.repeat(28), STAKE), coins: 3_000_000n, datum: o.datum(OWN_ROLES) };
    expect(verifyOrder(o, o.datum(OWN_ROLES), { extra: [unknown] })).toEqual(REFUSED);
  });

  it('refuses a payment to a key address that is not the wallet\'s', () => {
    expect(verifyOrder(o, o.datum(OWN_ROLES), { extra: [{ address: base(THIEF, THIEF_STAKE), coins: 1_000_000n }] })).toEqual(REFUSED);
    // Even one that carries the wallet's stake key.
    expect(verifyOrder(o, o.datum(OWN_ROLES), { extra: [{ address: base(THIEF, STAKE), coins: 1_000_000n }] })).toEqual(REFUSED);
  });

  it('refuses a "fee" to an address that is not the aggregator\'s', () => {
    const fakeFee = { address: enterprise(THIEF), coins: 1_200_000n };
    expect(verifyOrder(o, o.datum(OWN_ROLES), { noFee: true, extra: [fakeFee] })).toEqual(REFUSED);
  });

  if (o.builder === 'swapAggregator') {
    it('signs without a fee output', () => {
      expect(verifyOrder(o, o.datum(OWN_ROLES), { noFee: true })).toEqual([]);
    });

    it('refuses a fee output over the cap', () => {
      expect(verifyOrder(o, o.datum(OWN_ROLES), { policy: { maxFeeLovelace: 1_199_999n } }))
        .toEqual(['foreignOrderRecipient', 'spendExceeded']);
    });
  } else {
    it('refuses the aggregator fee output: RealFi pays no such fee', () => {
      expect(verifyOrder(o, o.datum(OWN_ROLES), { extra: [{ address: FEE_ADDRESS, coins: 1_200_000n }], policy: { maxFeeLovelace: 1_200_000n } }))
        .toEqual(REFUSED);
    });
  }

  it('refuses the order on preprod, where no order script is pinned', () => {
    const preprodOwn = [base(PAY, STAKE, Testnet)];
    const tx = decodedTx([
      { ...orderOutput(o, o.datum(OWN_ROLES), scriptAt(o.scriptHash, STAKE, Testnet)).out },
      { address: preprodOwn[0] },
    ], o.datumKind === 'hash' ? [o.datum(OWN_ROLES)] : []);
    expect(verifyOrderRecipients(tx, { ...policy(o.builder), network: 'Preprod', ownAddresses: preprodOwn })).toEqual(REFUSED);
  });

  it('is refused by the other builder\'s policy', () => {
    const other: OrderBuilder = o.builder === 'swapAggregator' ? 'realfi' : 'swapAggregator';
    expect(verifyOrder(o, o.datum(OWN_ROLES), { noFee: true, policy: { builder: other } })).toEqual(REFUSED);
  });
});

describe('the aggregator fee output', () => {
  const minswapV2 = ORDERS[1];
  const swap = (fees: Out[], extra: Partial<Parameters<typeof verifyOrderRecipients>[1]> = {}, withOrder = true) => {
    const { out } = orderOutput(minswapV2, minswapV2.datum(OWN_ROLES));
    const tx = decodedTx([...(withOrder ? [out] : []), ...fees, { address: OWN[0] }]);
    return verifyOrderRecipients(tx, { ...policy('swapAggregator'), ...extra });
  };

  it('accepts exactly the cap', () => {
    expect(swap([{ address: FEE_ADDRESS, coins: 1_200_000n }])).toEqual([]);
  });

  it('refuses a fee output when the caller gave no cap', () => {
    expect(swap([{ address: FEE_ADDRESS, coins: 1_200_000n }], { maxFeeLovelace: undefined })).toEqual(REFUSED);
  });

  it('refuses two fee outputs', () => {
    expect(swap([{ address: FEE_ADDRESS, coins: 600_000n }, { address: FEE_ADDRESS, coins: 600_000n }])).toEqual(REFUSED);
  });

  it('refuses a fee output that carries a token or a datum', () => {
    expect(swap([{ address: FEE_ADDRESS, coins: 1_200_000n, assets: new Map([[`${TOKEN_POLICY}${TOKEN_NAME}`, 1n]]) }]))
      .toEqual(REFUSED);
    expect(swap([{ address: FEE_ADDRESS, coins: 1_200_000n, datum: I(1) }])).toEqual(REFUSED);
  });

  it('refuses a fee output with no order to charge for', () => {
    expect(swap([{ address: FEE_ADDRESS, coins: 1_200_000n }], {}, false)).toEqual(REFUSED);
  });

  it('accepts a transaction that only pays the wallet (an order cancel)', () => {
    expect(swap([], {}, false)).toEqual([]);
    expect(verifyOrderRecipients(decodedTx([{ address: OWN[0] }, { address: OWN[1] }]), policy('realfi'))).toEqual([]);
  });
});

describe('real on-chain datums', () => {
  // Each against the wallet that placed it: a base address of its payment and stake keys.
  const realOrder = (o: OrderCase, hex: string, pay: string, stake: string | null) => {
    const datum = fromHex(hex);
    const own = [stake ? base(pay, stake) : enterprise(pay)];
    const { out, witness } = orderOutput(o, datum, o.orderAddress(stake));
    const tx = decodedTx([out, { address: own[0] }], witness);
    return (ownAddresses: string[] = own) => verifyOrderRecipients(tx, { ...policy(o.builder), ownAddresses });
  };
  const byName = (name: string) => ORDERS.find((o) => o.name === name)!;

  it('Minswap V1 order 739f7c0e…, an enterprise sender (cardano-market-data CancelTransactionServiceTest V1_DATUM)', () => {
    const verify = realOrder(byName('Minswap V1'),
      'd8799fd8799fd8799f581c6f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eeffd87a80ffd8799fd8799f581c6f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eeffd87a80ffd87a80d8799fd8799f581c10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b6444745524fff1a47cdcd6fff1a001cfde01a001e8480ff',
      '6f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1ee', null);
    expect(verify()).toEqual([]);
    expect(verify(OWN)).toEqual(REFUSED);
  });

  it('WingRiders V1 order 30126d83…#0 (CancelScriptDataHashLedgerTest)', () => {
    const verify = realOrder(byName('WingRiders V1'),
      'd8799fd8799fd8799fd8799f581c54d1d5b336c376215ac1d1d82244943cf0505446b42f590c3f036597ffd8799fd8799fd8799f581c839bea3cc153d1efd2d4c9c8eefe587d2ccecdab9c9efb8a3e1e34f5ffffffff581c54d1d5b336c376215ac1d1d82244943cf0505446b42f590c3f0365971b000001b8dac5b400d8799fd8799f4040ffd8799f581cb7c5cd554f3e83c8aa0900a0c9053284a5348244d23d0406c28eaf4d4550414c4d0affffffd8799fd87a801a0ad344d6ffff',
      '54d1d5b336c376215ac1d1d82244943cf0505446b42f590c3f036597', '839bea3cc153d1efd2d4c9c8eefe587d2ccecdab9c9efb8a3e1e34f5');
    expect(verify()).toEqual([]);
    expect(verify(OWN)).toEqual(REFUSED);
  });

  it('WingRiders V2 request 7d3edef2…#0 (GROUND_TRUTH_DATUMS.md)', () => {
    const verify = realOrder(byName('WingRiders V2'),
      'd8799f1a001e8480d8799fd8799f581c5455a2fd7ea563dbcf4dacf267d9d2326b7b7ce2b82140f536a1b888ffd8799fd8799fd8799f581c3219ec303b9f9facd2c6f49ad14a4ed5982b6553da4e90e3196a1b88ffffffffd8799fd8799f581c5455a2fd7ea563dbcf4dacf267d9d2326b7b7ce2b82140f536a1b888ffd8799fd8799fd8799f581c3219ec303b9f9facd2c6f49ad14a4ed5982b6553da4e90e3196a1b88ffffffff80d879801b000001a09d31c50f4040581cb7c5cd554f3e83c8aa0900a0c9053284a5348244d23d0406c28eaf4d4550414c4d0ad8799fd87a801a1f32f44dff0101ff',
      '5455a2fd7ea563dbcf4dacf267d9d2326b7b7ce2b82140f536a1b888', '3219ec303b9f9facd2c6f49ad14a4ed5982b6553da4e90e3196a1b88');
    expect(verify()).toEqual([]);
    expect(verify(OWN)).toEqual(REFUSED);
  });

  // The filled mainnet order 4c5a06a5…#0 (sundae-v4-filled-order.json). Sundae's SDK owns it on the
  // stake key; Gero's builder writes the payment key in the same slot. Both are the wallet's keys.
  const SUNDAE_V4_ORDER = 'd8799fd8799f581cef95eaf3131daba2cc0dd1f4bc87cd23ded3593768a45d55ed506173ffd8799fd8799fd8799f581c5df0b72d43e9fd95a42860e8e0f38b2be16f95d5ef15748c5f35055fffd8799fd8799fd8799f581cef95eaf3131daba2cc0dd1f4bc87cd23ded3593768a45d55ed506173ffffffffd87a80ff1a002dc6c01a001388005820012dd204b7a3c6d5d410290631d135f95703fc7247a0954067c9dbf32838d0fb9f9f581c30f1fac08a15ef84ea6a5aa04989b1c2ceeb3b437f2c3103df5aca68d87b9f9f9fd8799f581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34455553444378ff1a06a4ea96ffff9f9fd8799f581c7d9e4a0ee1a3f5d5ff8159ea91a83310cf2795ee7a87170c7aea05ae4455534472ff1a06a410dfffffffff9f581c267eabb980be6699144e85b24283659838b0746e0fd2f08be1423e70d87980ffffd87980ff';
  const V4_PAY = '5df0b72d43e9fd95a42860e8e0f38b2be16f95d5ef15748c5f35055f';
  const V4_STAKE = 'ef95eaf3131daba2cc0dd1f4bc87cd23ded3593768a45d55ed506173';

  it('SundaeSwap V4 order 4c5a06a5…#0, owned on the stake key and, as Gero builds it, on the payment key', () => {
    const v4 = byName('SundaeSwap V4');
    expect(v4.orderAddress(V4_STAKE)).toBe('addr1zyr7ktasnkwavcpcwr8xlpxglpgxyjg4y9eamux80u0s0m80jh40xyca4w3vcrw37j7g0nfrmmf4jdmg53w4tm2sv9esqmydex');
    expect(realOrder(v4, SUNDAE_V4_ORDER, V4_PAY, V4_STAKE)()).toEqual([]);
    const geroBuilt = SUNDAE_V4_ORDER.replace(`d8799f581c${V4_STAKE}ff`, `d8799f581c${V4_PAY}ff`);
    expect(realOrder(v4, geroBuilt, V4_PAY, V4_STAKE)()).toEqual([]);
    expect(realOrder(v4, geroBuilt, V4_PAY, V4_STAKE)(OWN)).toEqual(REFUSED);
  });

  it('RealFi stake request (cardano-market-data RealFiConversionsTest STAKE_DATUM)', () => {
    const verify = realOrder(byName('RealFi stake request'),
      'd8799fd8799f581c6f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eeffd8799fd8799fd8799f581c6f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eeffd8799fd8799fd8799f581cf536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9adffffffffd87980ffd87d9f1a0028d5c01a00289045ffd87980ff',
      '6f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1ee', 'f536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad');
    expect(verify()).toEqual([]);
    expect(verify(OWN)).toEqual(REFUSED);
  });

  it('refuses a RealFi unstake request: its timelock destination cannot be verified (RealFiConversionsTest UNSTAKE_DATUM)', () => {
    const verify = realOrder(byName('RealFi stake request'),
      'd8799fd8799f581c7c14dd3e8db4c27e10f8256e8477aaa0669f05cb5079a86a3b0ac488ffd8799fd8799fd87a9f581c5984220df67c084830aa621b3ac1302a469355dd2a548a99d003d303ffd8799fd8799fd8799f581c1172d467a0e78a9a89a89c6b209e0805617c43cc4aad7e31726b86b1ffffffffd87980ffd87e9f1a000f42401a000f2eb800ffd87980ff',
      '7c14dd3e8db4c27e10f8256e8477aaa0669f05cb5079a86a3b0ac488', '1172d467a0e78a9a89a89c6b209e0805617c43cc4aad7e31726b86b1');
    expect(verify()).toEqual(REFUSED);
  });
});

describe('pinned tables', () => {
  const paymentHash = (address: string) => String(Cardano.Address.fromString(address)?.getProps().paymentPart?.hash);

  it('every pinned order address is its own script hash on mainnet', () => {
    for (const spec of [...ORDER_SCRIPT_TABLES.swapAggregator['Mainnet'], ...ORDER_SCRIPT_TABLES.realfi['Mainnet']]) {
      if (typeof spec.address !== 'object') continue;
      expect(paymentHash(spec.address.exact)).toBe(spec.scriptHash);
      expect(Cardano.Address.fromString(spec.address.exact)?.getNetworkId()).toBe(Mainnet);
    }
  });

  it('the fee address is the GERO payment credential the aggregator detection config names', () => {
    expect(ORDER_SCRIPT_TABLES.feeAddress['Mainnet']).toBe(FEE_ADDRESS);
    expect(paymentHash(FEE_ADDRESS)).toBe('70150d96939e9f5270010149dd018fb35756fc902e796ff2e2849862');
  });

  it('pins every order the aggregator builds for customers, and nothing on testnets', () => {
    expect(ORDER_SCRIPT_TABLES.swapAggregator['Mainnet'].map((s) => s.name).sort()).toEqual([
      'Minswap V1', 'Minswap V2', 'Splash', 'SundaeSwap V3', 'SundaeSwap V4', 'WingRiders V1', 'WingRiders V2',
    ]);
    expect(ORDER_SCRIPT_TABLES.swapAggregator['Preprod']).toBeUndefined();
    expect(ORDER_SCRIPT_TABLES.realfi['Preprod']).toBeUndefined();
  });

  it('does not recognise the experimental-only DEXes', () => {
    // MuesliSwap V2 and SaturnSwap V3 order scripts (cardano-market-data CLAUDE.md): built only
    // with allowExperimental, never fill-verified for customers.
    for (const hash of ['00fb107bfbd51b3a5638867d3688e986ba38ff34fb738f5bd42b20d5', '6023f59dce0064f1d6d27594dbea25bc4305a9f6a10f3a064037553a']) {
      const tx = decodedTx([{ address: scriptAt(hash, STAKE), datum: ORDERS[1].datum(OWN_ROLES) }, { address: OWN[0] }]);
      expect(verifyOrderRecipients(tx, policy('swapAggregator'))).toEqual(REFUSED);
    }
  });
});
