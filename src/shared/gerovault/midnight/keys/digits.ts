/**
 * The digit routine of the Cardano verification number (`../../verificationNumber.ts`), for any
 * number of groups: group `g` takes bytes `5g` to `5g + 4` of the digest as a big-endian number,
 * reduced modulo 100000 and padded to five digits. `digits.spec.ts` checks it equals the Cardano
 * routine for eight groups.
 *
 * Kept here rather than imported so the Midnight key library does not pull in the Cardano
 * manifest and attestation modules.
 */
export const GROUP_BYTES = 5;

/** The groups of five digits of a digest of exactly `5 * groups` bytes. */
export function digitGroups(digest: Uint8Array, groups: number): readonly string[] {
  if (!Number.isInteger(groups) || groups < 1 || !(digest instanceof Uint8Array) || digest.length !== GROUP_BYTES * groups) {
    throw new RangeError('A digest has five bytes per group');
  }
  const out: string[] = [];
  for (let g = 0; g < groups; g++) {
    let n = 0n;
    for (const byte of digest.subarray(GROUP_BYTES * g, GROUP_BYTES * (g + 1))) n = (n << 8n) | BigInt(byte);
    out.push((n % 100000n).toString().padStart(5, '0'));
  }
  return Object.freeze(out);
}
