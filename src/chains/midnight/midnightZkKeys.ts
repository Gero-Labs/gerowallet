/**
 * The pinned key material for the ledger-8 built-in circuits the wallet can
 * prove on this device (see midnightDeviceProver.ts).
 *
 * Pins: every SHA-256 below is the value the OFFICIAL ledger source publishes
 * for `@midnight-ntwrk/ledger-v8` 8.1.2 (the version this wallet ships), at
 * `midnightntwrk/midnight-ledger` tag `ledger-8.1.2`:
 *   - `ledger/static/dust/spend.{prover,verifier,bzkir}.sha256`
 *   - `zswap/static/{spend,output,sign}.{prover,verifier,bzkir}.sha256`
 *   - the `bls_midnight_2p{k}` entries of `base-crypto/src/data_provider.rs`
 * The bytes were fetched from `srs.midnight.network` (the ledger's own default
 * parameter host, which the ledger itself treats as untrusted and verifies
 * against these hashes) and matched all fifteen pins on 2026-11-03. Recheck
 * them whenever the ledger package or `MIDNIGHT_ZK_KEY_VERSION` changes:
 * `scripts/midnight-zk-keys.mjs --verify`.
 *
 * Where the bytes live:
 *   - `bundled`: shipped inside the extension package (`src/assets/midnight-zk`
 *     → `extension/midnight-zk/`). Only the DUST fee circuit, 3.75 MB, the one
 *     proof every public send needs.
 *   - `hosted`: the shielded (Zswap) set, about 29 MB, too large to ship to
 *     every user. Fetched on first use from `VITE_MIDNIGHT_ZK_KEYS_URL` (a
 *     Gero-hosted copy, never Midnight's dev bucket) and cached. Only the
 *     off-by-default shielded on-device flag reaches them.
 * Either way a file is used only after its size and hash match the pin.
 *
 * Dependency-free on purpose: imported by the background, the offscreen
 * prover worker and Node tests alike.
 */

/** Key generation of the ledger-8 built-in circuits (`dust/9/…`, `zswap/9/…`). */
export const MIDNIGHT_ZK_KEY_VERSION = 9;

export type MidnightZkKeySource = 'bundled' | 'hosted';

export interface MidnightZkFile {
  /** Flat file name, the same in the package and on the key host. */
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly source: MidnightZkKeySource;
}

export interface MidnightZkCircuit {
  /** The `keyLocation` the ledger hands its proving provider. */
  readonly keyLocation: string;
  /** Circuit size: the SRS it is proven against is `bls_midnight_2p{k}`. */
  readonly k: number;
  /** True for the Zswap circuits, which only the shielded flag allows. */
  readonly shielded: boolean;
  readonly prover: MidnightZkFile;
  readonly verifier: MidnightZkFile;
  readonly ir: MidnightZkFile;
}

const file = (name: string, bytes: number, sha256: string, source: MidnightZkKeySource): MidnightZkFile => ({
  name, bytes, sha256, source,
});

export const DUST_SPEND_CIRCUIT: MidnightZkCircuit = {
  keyLocation: 'midnight/dust/spend',
  k: 13,
  shielded: false,
  prover: file('dust-9-spend.prover', 2_175_671, '996602da7ca386284e656c78ea03e55bffdba29475e6a67965c50de05e13efc2', 'bundled'),
  verifier: file('dust-9-spend.verifier', 1_351, '3f1569ebcab0655c5c145b28947c74edc4e3f5c6b276e4404b661cf0905b49d3', 'bundled'),
  ir: file('dust-9-spend.bzkir', 2_555, '904181287e75b0fb596ba5fcc116c882ee5d28e3115304c93ebd913722ce5841', 'bundled'),
};

export const ZSWAP_SPEND_CIRCUIT: MidnightZkCircuit = {
  keyLocation: 'midnight/zswap/spend',
  k: 15,
  shielded: true,
  prover: file('zswap-9-spend.prover', 11_020_001, '19d234b5c68b7212ad6b0ec9334a95594748154128f3704eb576bcc843cc5c45', 'hosted'),
  verifier: file('zswap-9-spend.verifier', 2_311, '544554effd7ae9fb9063be52a9ec2a986756301071fcd97bb4598fb45a335658', 'hosted'),
  ir: file('zswap-9-spend.bzkir', 1_294, '7cb5bbcf67cb212a3336fb439a77e8f32f0aa8a56185c8e1247d6cbfc7300205', 'hosted'),
};

export const ZSWAP_OUTPUT_CIRCUIT: MidnightZkCircuit = {
  keyLocation: 'midnight/zswap/output',
  k: 14,
  shielded: true,
  prover: file('zswap-9-output.prover', 5_730_182, 'd992b04f13c3fd432f55fb8bfe6466d87bc181f1a2acf233ec228030bbdd4ed8', 'hosted'),
  verifier: file('zswap-9-output.verifier', 2_311, '72e8074856f2f5c504ade25a86a2b8902c64aeb9497c4c8e6b26dea842a0ab08', 'hosted'),
  ir: file('zswap-9-output.bzkir', 494, '91dc8b401dd8385e8d29eaac018c70b578505f48c7952452ef319bc397fa1f1b', 'hosted'),
};

export const ZSWAP_SIGN_CIRCUIT: MidnightZkCircuit = {
  keyLocation: 'midnight/zswap/sign',
  k: 13,
  shielded: true,
  prover: file('zswap-9-sign.prover', 2_814_823, 'fe7268dd2bdd107f862f881ac3c5bc71a6df77ce80bfed51cf71514648e660e0', 'hosted'),
  verifier: file('zswap-9-sign.verifier', 2_023, 'e39a727caa0de167e6dd6122a9e3b758fecf48f9093ab77c0309648de8ce07e1', 'hosted'),
  ir: file('zswap-9-sign.bzkir', 114, '37ea2094516e145a738126307cf92bd293f7cb524b1ccd49fa6f3225a9ec3a50', 'hosted'),
};

/** Public parameters (SRS) per circuit size. Sizes are `192 * 2^k + 388`. */
export const MIDNIGHT_SRS_FILES: Readonly<Record<number, MidnightZkFile>> = {
  13: file('bls_midnight_2p13', 1_573_252, 'd3324910969c4cc54143b8045b649e5c3a4bd5fb7b8f85fe1b770f640ce1c803', 'bundled'),
  14: file('bls_midnight_2p14', 3_146_116, 'fc253016885ec830e97808c9ec920bb5cab5c21af590380a6cb5eb0538e2b244', 'hosted'),
  15: file('bls_midnight_2p15', 6_291_844, '724c7c3d779148bb113c7ee9c034b2f27db16e6bdf315fde90105a9bad00b1de', 'hosted'),
};

export const MIDNIGHT_ZK_CIRCUITS: readonly MidnightZkCircuit[] = [
  DUST_SPEND_CIRCUIT, ZSWAP_SPEND_CIRCUIT, ZSWAP_OUTPUT_CIRCUIT, ZSWAP_SIGN_CIRCUIT,
];

/** Where the bundled files are served from inside the extension. */
export const MIDNIGHT_ZK_BUNDLED_PATH = '/midnight-zk/';

/**
 * The circuits a proof request may use. The DUST fee circuit always; the
 * Zswap circuits only when the caller asked for shielded proving. Any other
 * `keyLocation` (a dapp's contract circuit, a future built-in) has no key here,
 * so its proof fails instead of being attempted with a guess.
 */
export function allowedMidnightZkCircuits(shielded: boolean): readonly MidnightZkCircuit[] {
  return MIDNIGHT_ZK_CIRCUITS.filter((circuit) => shielded || !circuit.shielded);
}

/** Every file a set of circuits needs, SRS included, without duplicates. */
export function midnightZkFilesFor(circuits: readonly MidnightZkCircuit[]): MidnightZkFile[] {
  const files = new Map<string, MidnightZkFile>();
  for (const circuit of circuits) {
    for (const f of [circuit.prover, circuit.verifier, circuit.ir, MIDNIGHT_SRS_FILES[circuit.k]]) {
      files.set(f.name, f);
    }
  }
  return [...files.values()];
}
