/**
 * Hand-assembled transactions for the vault decoder specs. Every byte is written out here from
 * CBOR heads; no encoder is involved, so the decoder is checked against bytes it did not write.
 * All of them are on a testnet (network id 0) unless a name says otherwise.
 *
 * One funding transaction (FUND_TX) creates every UTxO the spending transactions use, so a test
 * prover can serve its bytes and the decoder proves each input against FUND_TX_ID.
 */
import { cborBytes, inlineDatumOption, OUTPUT_DATUM, OUTPUT_SCRIPT } from '@/shared/utils/__fixtures__/handAssembledTxs';
import type { TxCborSource } from '@/shared/utils/provenInputs';

// ── CBOR heads ──

const head = (major: number, n: number | bigint): string => {
  const value = BigInt(n);
  const m = major << 5;
  const hex = (v: bigint, width: number) => v.toString(16).padStart(width, '0');
  if (value < 24n) return hex(BigInt(m) + value, 2);
  if (value < 0x100n) return `${hex(BigInt(m + 24), 2)}${hex(value, 2)}`;
  if (value < 0x10000n) return `${hex(BigInt(m + 25), 2)}${hex(value, 4)}`;
  if (value < 0x100000000n) return `${hex(BigInt(m + 26), 2)}${hex(value, 8)}`;
  return `${hex(BigInt(m + 27), 2)}${hex(value, 16)}`;
};

/** Unsigned integer. */
export const uint = (n: number | bigint): string => head(0, n);
/** Byte string. */
export const bytes = cborBytes;
/** Definite-length array of already-encoded items. */
export const array = (...items: string[]): string => `${head(4, items.length)}${items.join('')}`;
/** Definite-length map of already-encoded `[key, value]` pairs, in the order given. */
export const map = (...entries: Array<[string, string]>): string => `${head(5, entries.length)}${entries.map(([k, v]) => k + v).join('')}`;
/** A body entry under an integer key. */
export const entry = (key: number, value: string): [string, string] => [uint(key), value];
/** `[body, {}, true, null]`. */
export const transaction = (...body: Array<[string, string]>): string => `84${map(...body)}a0f5f6`;

// ── credentials and addresses ──

/** Owner payment key hashes of the 2-of-3 vault. */
export const K1 = '01'.repeat(28);
export const K2 = '02'.repeat(28);
export const K3 = '03'.repeat(28);
const keySig = (hash: string) => array(uint(0), bytes(hash));
/** The vault's native script: `[3, 2, [sig K1, sig K2, sig K3]]` (2 of 3). */
export const VAULT_SCRIPT = array(uint(3), uint(2), array(keySig(K1), keySig(K2), keySig(K3)));
/** blake2b-224 of 0x00 || VAULT_SCRIPT. */
export const VAULT_SCRIPT_HASH = '4a227dfb5f2db51bfd369af3f8945194190e0f743bcd8c573d51db5c';

/** Raw address bytes, hex. */
export const VAULT_ADDRESS = `30${VAULT_SCRIPT_HASH}${VAULT_SCRIPT_HASH}`; // base, script payment, script stake
export const VAULT_REWARD_ACCOUNT = `f0${VAULT_SCRIPT_HASH}`;
/** The vault's payment script with somebody else's stake key: NOT the vault's change. */
export const VAULT_FOREIGN_STAKE_ADDRESS = `10${VAULT_SCRIPT_HASH}${'f1'.repeat(28)}`;
export const EXECUTOR_KEY = 'e1'.repeat(28);
export const EXECUTOR_ADDRESS = `00${EXECUTOR_KEY}${'e2'.repeat(28)}`;
export const EXECUTOR_ENTERPRISE_ADDRESS = `60${EXECUTOR_KEY}`;
/** Another key of an executor-like wallet: same stake key, different payment key. */
export const OTHER_PAYER_ADDRESS = `00${'e3'.repeat(28)}${'e2'.repeat(28)}`;
export const PAYEE_ADDRESS = `00${'a1'.repeat(28)}${'a2'.repeat(28)}`;
export const PAYEE_MAINNET_ADDRESS = `01${'a1'.repeat(28)}${'a2'.repeat(28)}`;
export const SCRIPT_ENTERPRISE_ADDRESS = `70${'cc'.repeat(28)}`;
/** Pointer address: key payment, pointer (slot 1, tx 2, cert 3). */
export const POINTER_ADDRESS = `40${'a1'.repeat(28)}010203`;
/** The CIP-19 Byron test vector `Ae2tdPwUPEZFRbyhz3cpfC2CumGzNkFBN2L42rcUc2yjQpEkxDbkPodpMAi`. */
export const BYRON_ADDRESS = '82d818582183581cba970ad36654d8dd8f74274b733452ddeab9a62a397746be3c42ccdda0001a9026da5b';
export const POOL_KEY_HASH = '9a'.repeat(28);

// ── tokens ──

export const POLICY_1 = 'b1'.repeat(28);
export const POLICY_2 = 'b2'.repeat(28);
export const POLICY_MANY = 'b3'.repeat(28);
export const GOLD = '474f4c44'; // "GOLD"
export const NFT = '4e4654'; // "NFT"
/** 40 asset names 00..27 (one byte each) under POLICY_MANY, quantity i + 1. */
export const MANY_TOKEN_NAMES = Array.from({ length: 40 }, (_, i) => i.toString(16).padStart(2, '0'));
const manyTokens = map([bytes(POLICY_MANY), map(...MANY_TOKEN_NAMES.map((name, i): [string, string] => [bytes(name), uint(i + 1)]))]);

// ── outputs ──

export const legacyOutput = (address: string, value: string, datumHash?: string): string =>
  datumHash ? array(bytes(address), value, bytes(datumHash)) : array(bytes(address), value);
export const postAlonzoOutput = (address: string, value: string, extra: Array<[string, string]> = []): string =>
  map(entry(0, bytes(address)), entry(1, value), ...extra);
export const coinAnd = (lovelace: number, multiasset: string): string => array(uint(lovelace), multiasset);

const FUND_OUTPUT_1_TOKENS = map(
  [bytes(POLICY_1), map([bytes(GOLD), uint(500)], [bytes(''), uint(1)])],
  [bytes(POLICY_2), map([bytes(NFT), uint(1)])],
);

// ── the funding transaction ──

/**
 * Outputs:
 * 0. vault, 100 ADA (legacy encoding)
 * 1. vault, 10 ADA + 500 GOLD + 1 nameless token (policy 1) + 1 NFT (policy 2)
 * 2. executor, 5 ADA (collateral)
 * 3. executor enterprise, 20 ADA carrying VAULT_SCRIPT as its reference script
 * 4. executor, 3 ADA + 7 GOLD (collateral with a token)
 * 5. vault, 5 ADA + 40 tokens of POLICY_MANY
 * 6. another payment key, 5 ADA (a second collateral payer)
 * 7. a Byron address, 1 ADA
 * 8. a pointer address, 1 ADA
 */
export const FUND_TX = transaction(
  entry(0, array(array(bytes('f0'.repeat(32)), uint(0)))),
  entry(1, array(
    legacyOutput(VAULT_ADDRESS, uint(100_000_000)),
    postAlonzoOutput(VAULT_ADDRESS, coinAnd(10_000_000, FUND_OUTPUT_1_TOKENS)),
    legacyOutput(EXECUTOR_ADDRESS, uint(5_000_000)),
    postAlonzoOutput(EXECUTOR_ENTERPRISE_ADDRESS, uint(20_000_000), [entry(3, `d818${bytes(array(uint(0), VAULT_SCRIPT))}`)]),
    legacyOutput(EXECUTOR_ADDRESS, coinAnd(3_000_000, map([bytes(POLICY_1), map([bytes(GOLD), uint(7)])]))),
    postAlonzoOutput(VAULT_ADDRESS, coinAnd(5_000_000, manyTokens)),
    legacyOutput(OTHER_PAYER_ADDRESS, uint(5_000_000)),
    legacyOutput(BYRON_ADDRESS, uint(1_000_000)),
    legacyOutput(POINTER_ADDRESS, uint(1_000_000)),
  )),
  entry(2, uint(200_000)),
);
export const FUND_TX_ID = '90909860621b9ce9616a1ab7c005b9f36506c7ac831602ec8c11a30b1e89374a';

/** `[FUND_TX_ID, index]`. */
export const fundInput = (index: number): string => array(bytes(FUND_TX_ID), uint(index));
export const inputSet = (...indexes: number[]): string => array(...indexes.map(fundInput));

// ── spending transactions ──

/** Pays 20 ADA and 200 GOLD to the payee from outputs 0 and 1, the rest back to the vault. */
export const PAYMENT_TX = transaction(
  entry(0, inputSet(0, 1)),
  entry(1, array(
    postAlonzoOutput(PAYEE_ADDRESS, coinAnd(20_000_000, map([bytes(POLICY_1), map([bytes(GOLD), uint(200)])]))),
    postAlonzoOutput(VAULT_ADDRESS, coinAnd(89_800_000, map(
      [bytes(POLICY_1), map([bytes(GOLD), uint(300)], [bytes(''), uint(1)])],
      [bytes(POLICY_2), map([bytes(NFT), uint(1)])],
    ))),
  )),
  entry(2, uint(200_000)),
  entry(3, uint(1_000_000)),
  entry(8, uint(900_000)),
  entry(14, array(bytes(K1), bytes(K2))),
  entry(15, uint(0)),
);

/** Withdraws 1.5 ADA of the vault's rewards into the vault. */
export const WITHDRAWAL_TX = transaction(
  entry(0, inputSet(0)),
  entry(1, array(legacyOutput(VAULT_ADDRESS, uint(101_300_000)))),
  entry(2, uint(200_000)),
  entry(5, map([bytes(VAULT_REWARD_ACCOUNT), uint(1_500_000)])),
);

const vaultCredential = array(uint(1), bytes(VAULT_SCRIPT_HASH));

/** Conway registration (2 ADA in the certificate) and a pool delegation. */
export const CONWAY_DELEGATION_TX = transaction(
  entry(0, inputSet(0)),
  entry(1, array(legacyOutput(VAULT_ADDRESS, uint(97_800_000)))),
  entry(2, uint(200_000)),
  entry(4, array(array(uint(7), vaultCredential, uint(2_000_000)), array(uint(2), vaultCredential, bytes(POOL_KEY_HASH)))),
);

/** The combined Conway registration-with-delegation certificate. */
export const REGISTRATION_DELEGATION_TX = transaction(
  entry(0, inputSet(0)),
  entry(1, array(legacyOutput(VAULT_ADDRESS, uint(97_800_000)))),
  entry(2, uint(200_000)),
  entry(4, array(array(uint(11), vaultCredential, bytes(POOL_KEY_HASH), uint(2_000_000)))),
);

/** Shelley registration (deposit from the protocol: 2 ADA) and delegation, the set under tag 258. */
export const SHELLEY_DELEGATION_TX = transaction(
  entry(0, inputSet(0)),
  entry(1, array(legacyOutput(VAULT_ADDRESS, uint(97_800_000)))),
  entry(2, uint(200_000)),
  entry(4, `d90102${array(array(uint(0), vaultCredential), array(uint(2), vaultCredential, bytes(POOL_KEY_HASH)))}`),
);

/** Conway deregistration: 2 ADA refunded. */
export const CONWAY_DEREGISTRATION_TX = transaction(
  entry(0, inputSet(0)),
  entry(1, array(legacyOutput(VAULT_ADDRESS, uint(101_800_000)))),
  entry(2, uint(200_000)),
  entry(4, array(array(uint(8), vaultCredential, uint(2_000_000)))),
);

/** Shelley deregistration: the protocol's 2 ADA refunded. */
export const SHELLEY_DEREGISTRATION_TX = transaction(
  entry(0, inputSet(0)),
  entry(1, array(legacyOutput(VAULT_ADDRESS, uint(101_800_000)))),
  entry(2, uint(200_000)),
  entry(4, array(array(uint(1), vaultCredential))),
);

/** A vault payment with collateral fields, the body otherwise like {@link baseEntries}. */
export const withCollateral = (...extra: Array<[string, string]>): string => transaction(...baseEntries(), ...extra);

/** inputs: output 0; outputs: 99.8 ADA back to the vault; fee 0.2 ADA. Balanced. */
export const baseEntries = (): Array<[string, string]> => [
  entry(0, inputSet(0)),
  entry(1, array(legacyOutput(VAULT_ADDRESS, uint(99_800_000)))),
  entry(2, uint(200_000)),
];

/** The executor's 5 ADA as collateral, 4.5 ADA returned to the executor, 0.5 ADA total. */
export const COLLATERAL_TX = withCollateral(
  entry(13, inputSet(2)),
  entry(16, legacyOutput(EXECUTOR_ADDRESS, uint(4_500_000))),
  entry(17, uint(500_000)),
);

/** The vault reads output 3 (its own script as a reference script). */
export const REFERENCE_INPUT_TX = transaction(...baseEntries(), entry(18, inputSet(3)));

/** Moves the 40 tokens of output 5 to the payee. */
export const MANY_TOKENS_TX = transaction(
  entry(0, inputSet(5)),
  entry(1, array(
    postAlonzoOutput(PAYEE_ADDRESS, coinAnd(1_500_000, manyTokens)),
    legacyOutput(VAULT_ADDRESS, uint(3_300_000)),
  )),
  entry(2, uint(200_000)),
);

/** Pays a script: inline datum and a reference script, then a legacy output with a datum hash. */
export const SCRIPT_OUTPUTS_TX = transaction(
  entry(0, inputSet(0)),
  entry(1, array(
    postAlonzoOutput(SCRIPT_ENTERPRISE_ADDRESS, uint(10_000_000), [
      entry(2, inlineDatumOption(OUTPUT_DATUM)),
      entry(3, `d818${bytes(OUTPUT_SCRIPT)}`),
    ]),
    legacyOutput(SCRIPT_ENTERPRISE_ADDRESS, uint(5_000_000), 'dd'.repeat(32)),
    legacyOutput(VAULT_ADDRESS, uint(84_800_000)),
  )),
  entry(2, uint(200_000)),
);

/** "Change" that keeps the vault's payment script but carries a foreign stake key. */
export const FOREIGN_STAKE_CHANGE_TX = transaction(
  entry(0, inputSet(0)),
  entry(1, array(legacyOutput(VAULT_FOREIGN_STAKE_ADDRESS, uint(99_800_000)))),
  entry(2, uint(200_000)),
);

/** A spending transaction of the base shape with the output replaced. */
export const payingTo = (output: string, lovelaceBack = 0): string => transaction(
  entry(0, inputSet(0)),
  entry(1, lovelaceBack ? array(output, legacyOutput(VAULT_ADDRESS, uint(lovelaceBack))) : array(output)),
  entry(2, uint(200_000)),
);

// ── a prover for the specs ──

/** Serves FUND_TX (and whatever `extra` holds) by hash, as a wallet's own history would. */
export const fundSource = (extra: Record<string, string> = {}): TxCborSource => async (hashes) => {
  const known = new Map<string, string>([[FUND_TX_ID, FUND_TX], ...Object.entries(extra)]);
  return new Map(hashes.filter((h) => known.has(h)).map((h) => [h, known.get(h) as string]));
};
