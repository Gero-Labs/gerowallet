/**
 * The request code: twenty digits in four groups of five, read by voice to confirm that a
 * guardian, recovery or recovery-related owner statement is the one the asker made. Both devices
 * compute it on their own from the request they hold; neither takes it from the other.
 *
 *   d = BLAKE2b-160( "gero-vault/v1|midnight|request-code|" || network tag || contract || digest )
 *
 * - network tag: the UTF-8 network id ("preprod", "preview", "mainnet") zero-padded to 32 bytes,
 *   the word every vault statement carries;
 * - contract: the 32-byte contract address;
 * - digest: the statement digest, 32 bytes little-endian (the request file's `digest`).
 *
 * Group `g` takes bytes `5g` to `5g + 4` of `d` with the verification number's digit routine
 * (`digits.ts`). About 66 bits: enough that nobody can grind a substituted owner list to show
 * the same code. Cardano requests use the same format with the tag `gero-vault/v1|request-code|`.
 */
import { blake2b } from '@noble/hashes/blake2.js';
import { MidnightKeyError } from './errors';
import { concatBytes, fromHex, le32, pad32, utf8Bytes } from './bytes';
import { digitGroups, GROUP_BYTES } from './digits';
import { isMidnightNetwork } from './paths';
import { isFieldElement } from './poseidon';
import { FieldElement, MidnightNetwork } from './types';

export const REQUEST_CODE_TAG = 'gero-vault/v1|midnight|request-code|';
export const REQUEST_CODE_GROUPS = 4;

export interface RequestCodeInput {
  readonly network: MidnightNetwork;
  /** The contract address, 32 bytes of lowercase hex. */
  readonly contract: string;
  /** The statement digest the request asks to sign. */
  readonly digest: FieldElement;
}

/** The four groups of five digits. Throws `MidnightKeyError('INVALID_REQUEST_CODE_INPUT')`. */
export function requestCode(input: RequestCodeInput): readonly string[] {
  const contract = fromHex(input?.contract, 32);
  if (!isMidnightNetwork(input?.network) || !contract || !isFieldElement(input?.digest)) {
    throw new MidnightKeyError('INVALID_REQUEST_CODE_INPUT', 'A request code takes a network, a 32-byte contract address and a statement digest');
  }
  const preimage = concatBytes(utf8Bytes(REQUEST_CODE_TAG), pad32(input.network), contract, le32(input.digest));
  return digitGroups(blake2b(preimage, { dkLen: GROUP_BYTES * REQUEST_CODE_GROUPS }), REQUEST_CODE_GROUPS);
}

/** The code as shown and read: the four groups separated by single spaces. */
export function formatRequestCode(groups: readonly string[]): string {
  return groups.join(' ');
}
