/**
 * GeroVault on Midnight: keys and signing. Pure TypeScript over noble and `@scure/bip32`, no
 * WebAssembly, so the extension's background, its pages and the iOS host bundle all run the same
 * code.
 *
 * - `paths`: `m/1854'/2400'/n'/r'/i'` and its reserved levels;
 * - `derive`: a participant's own owner, guardian and delegate keys from the BIP-39 seed;
 * - `schnorr`: hash to scalar, hedged Jubjub Schnorr signing and verification;
 * - `upgradeKey`: BIP-340 signing as the ledger's `signData` does it;
 * - `guardian`: the guardian salt and commitment;
 * - `jubjub`, `poseidon`: the curve and `transientHash`;
 * - `keyCard`: key cards in bech32m and JSON, with possession signatures and point validation;
 * - `verificationSet`: the verification set, number and QR;
 * - `requestCode`: the 20-digit request code;
 * - `indexCounter`: one index counter per seed and network, never reused.
 */
export * from './types';
export * from './errors';
export * from './paths';
export * from './derive';
export * from './schnorr';
export * from './upgradeKey';
export * from './guardian';
export {
  JUBJUB_GENERATOR,
  JUBJUB_IDENTITY,
  checkJubjubPoint,
  decodeJubjubPoint,
  encodeJubjubPoint,
  isOnJubjubCurve,
  jubjubMulGenerator,
  jubjubPointFromHex,
  jubjubPointHex,
  jubjubPointsEqual,
  jubjubPublicKey,
  snapshotJubjubPoint,
} from './jubjub';
export type { JubjubPointRefusal } from './jubjub';
export { bytes32Fields, fieldElement, fieldElementFromHex, fieldElementToHex, isFieldElement, transientHash, transientHashWords } from './poseidon';
export * from './keyCard';
export * from './verificationSet';
export * from './requestCode';
export * from './indexCounter';
export { digitGroups } from './digits';
