/**
 * Hand-assembled transactions for the hardware-wallet signing specs. Every byte is written out
 * here, no encoder involved. Their inline datums and reference scripts are valid CBOR in
 * encodings the SDK does not write (definite-length lists, a native script over an
 * indefinite-length list, a Plutus script as a chunked byte string), which is exactly what a
 * decode -> re-encode changes. The mainnet inline datums are in `mainnetDatumUtxos.ts`.
 */

/** CBOR byte string: head + bytes. */
export const cborBytes = (hex: string): string => {
  const length = hex.length / 2;
  const head = length < 24 ? (0x40 + length).toString(16) : length < 256 ? `58${length.toString(16).padStart(2, '0')}` : `59${length.toString(16).padStart(4, '0')}`;
  return `${head}${hex}`;
};

/** `[1, #6.24(bytes)]`: an inline datum over exactly these bytes, as an output writes it. */
export const inlineDatumOption = (datumCbor: string): string => `8201d818${cborBytes(datumCbor)}`;

export const OUTPUT_DATUM = '83010203'; // [1, 2, 3]
export const OUTPUT_SCRIPT = `820082019f8200581c${'dd'.repeat(28)}ff`; // [0, [1, [_ [0, h'dd…']]]]
export const COLLATERAL_DATUM = '8201820304'; // [1, [3, 4]]
export const COLLATERAL_SCRIPT = '82025f454e4d0100004a33222220051200120011ff'; // [2, (_ h'4e4d010000', h'3322…')]

/**
 * The signing wallet. Its account key is m/1852'/1815'/0' of the all-zero-entropy test wallet;
 * its address is a stand-in base address (key hashes 11…, 22…): signers match addresses by string.
 */
export const WALLET_ACCOUNT_XPUB =
  'b3f8aad750c8f498d2882d1ecd74bf550e81870e89acaed82e8e10ef5871887091286d601ecfe0aafc2121154db787bf489ccf35c6b5db5d60096052c8b34c2f';
export const WALLET_ADDRESS = 'addr1qyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyfzyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3qd5sgwv';
const WALLET_ADDRESS_BYTES = `01${'11'.repeat(28)}${'22'.repeat(28)}`;
/** blake2b-224 of the wallet's DRep key, m/1852'/1815'/0'/3/0. */
const WALLET_DREP_KEY_HASH = '47c6d376abd6b65454fd7eb6610982f721388cf46f816f61e66ad63d';

/** A Babbage output (map) with an inline datum and a reference script. */
const babbageOutput = (address: string, coin: string, datum: string, script: string): string =>
  `a4 00${address} 01${coin} 02${inlineDatumOption(datum)} 03d818${cborBytes(script)}`;
const SCRIPT_OUTPUT = babbageOutput(`581d71${'cc'.repeat(28)}`, '1a001e8480', OUTPUT_DATUM, OUTPUT_SCRIPT);
const COLLATERAL_RETURN = babbageOutput(`581d61${'ee'.repeat(28)}`, '1a004c4b40', COLLATERAL_DATUM, COLLATERAL_SCRIPT);
/** The same, with a datum and a script the SDK writes the same way: re-encoding keeps them. */
const SDK_ENCODED_OUTPUT = babbageOutput(`581d71${'cc'.repeat(28)}`, '1a001e8480', '9f010203ff', '82024f4e4d01000033222220051200120011');

/** `[body, {}, true, null]`, the body a map of the given entries. */
const transaction = (...entries: string[]): string =>
  ['84', `a${entries.length}`, ...entries, 'a0 f5 f6'].join('').replace(/ /g, '');

/** A Plutus transaction: its output and its collateral return carry those datums and scripts. */
export const SCRIPT_REF_TX = transaction(
  `00 81825820${'aa'.repeat(32)}00`, // inputs
  `01 81${SCRIPT_OUTPUT}`, // outputs
  '02 1a00030d40', // fee
  `0d 81825820${'bb'.repeat(32)}00`, // collateral inputs
  `10 ${COLLATERAL_RETURN}`, // collateral return
  '11 1a004c4b40', // total collateral
);
export const SCRIPT_REF_TX_ID = 'a427c9905dab23371c62ed5319e0f392b379d6724cfca324ffad708d55fbb270';

/** The same output in a transaction without collateral: third-party only, so multisig mode. */
export const NO_COLLATERAL_TX = transaction(
  `00 81825820${'aa'.repeat(32)}00`, // inputs
  `01 81${SCRIPT_OUTPUT}`, // outputs
  '02 1a00030d40', // fee
);
export const NO_COLLATERAL_TX_ID = 'f72fa7bb5813d7f37d5f921c2edd139a15f2dd4f9c442678c4519b2424034ee7';

/** Nothing a re-encode would change. */
export const SDK_ENCODED_TX = transaction(
  `00 81825820${'aa'.repeat(32)}00`, // inputs
  `01 81${SDK_ENCODED_OUTPUT}`, // outputs
  '02 1a00030d40', // fee
);
export const SDK_ENCODED_TX_ID = 'de7d7ef89329d62ab001de0998094627596feefb242f9ac84b289740db22c5c0';

/** Only the reference script is outside the SDK's encoding. */
export const REFERENCE_SCRIPT_TX = transaction(
  `00 81825820${'aa'.repeat(32)}00`, // inputs
  `01 81${babbageOutput(`581d71${'cc'.repeat(28)}`, '1a001e8480', '9f010203ff', OUTPUT_SCRIPT)}`, // outputs
  '02 1a00030d40', // fee
);
export const REFERENCE_SCRIPT_TX_ID = 'be07bef63643152e8cf9a1a0159f3f8279bbd99f69775d4ab512b81ff6f936d6';

/** Only the collateral return is outside the SDK's encoding. */
export const COLLATERAL_RETURN_TX = transaction(
  `00 81825820${'aa'.repeat(32)}00`, // inputs
  `01 81${SDK_ENCODED_OUTPUT}`, // outputs
  '02 1a00030d40', // fee
  `0d 81825820${'bb'.repeat(32)}00`, // collateral inputs
  `10 ${COLLATERAL_RETURN}`, // collateral return
  '11 1a004c4b40', // total collateral
);
export const COLLATERAL_RETURN_TX_ID = 'a1c4bdc8ee0a2f80ff5985a6c571c5ae968306a56cfeaa19db40f48121e84564';

/**
 * The wallet's own transaction: it spends the wallet's input (aa…#0), pays the script output,
 * returns change to the wallet and registers the wallet's DRep key.
 */
export const OWN_TX = transaction(
  `00 81825820${'aa'.repeat(32)}00`, // inputs
  `01 82${SCRIPT_OUTPUT} 825839${WALLET_ADDRESS_BYTES}1a004c4b40`, // outputs: the script output, change
  '02 1a00030d40', // fee
  `04 81 8410 8200581c${WALLET_DREP_KEY_HASH} 1a1dcd6500 f6`, // certificates: DRep registration, 500 ADA
);
export const OWN_TX_ID = '64bd20d6ecb91a8a31e73813083fba0b32bf22a066f38b0102c358c9edadb0b4';
