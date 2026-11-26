/**
 * Vault index allocation (GV-15). Pure functions over facts the caller gathered; the scan that
 * gathers them lives elsewhere.
 *
 * A vault at index `y` uses every participant's keys at `m/1854'/1815'/0'/0/y` and `.../2/y`, so
 * two vaults with the same people at different indices never share a key. The rules:
 * - `y` is the smallest index at which no participant's role keys have ever appeared in a vault,
 *   a registration or a pending setup of theirs.
 * - Vaults this wallet creates start at `y = 1`. Index 0 stays with the wallet's existing CIP-1854
 *   witness at `0/0` in the dApp signing path.
 * - An index is never reused: an abandoned setup burns its index, whether or not anything was
 *   published for it.
 * - Discovery scans stop after a gap of 20 unused indices, so a vault is not created at an index
 *   that would leave 20 or more consecutive unused indices below it for any participant.
 */
import { isVaultIndex } from './paths';
import { MAX_VAULT_INDEX } from './types';

/** Vaults this wallet creates never use index 0. */
export const FIRST_VAULT_INDEX = 1;
/** Discovery stops after this many consecutive unused indices. */
export const DISCOVERY_GAP_LIMIT = 20;

/** What one participant's wallet knows about its own indices. */
export interface CosignerIndexHistory {
  /**
   * Indices whose keys appear on chain in a vault script or a registration: the ones a discovery
   * scan of this participant's seed finds.
   */
  readonly used: readonly number[];
  /** Indices that are taken without being on chain: pending setups and abandoned (burned) ones. */
  readonly burned: readonly number[];
}

export type VaultIndexRefusal =
  | { readonly code: 'NO_PARTICIPANTS' }
  | { readonly code: 'INVALID_HISTORY'; readonly participant: number }
  | { readonly code: 'INDEX_SPACE_EXHAUSTED' }
  | {
      readonly code: 'DISCOVERY_GAP_EXCEEDED';
      /** Position of the participant in the input. */
      readonly participant: number;
      /** First index of the run of unused indices below `y`. */
      readonly gapStart: number;
      readonly gapLength: number;
    };

export type VaultIndexAllocation = { readonly ok: true; readonly index: number } | ({ readonly ok: false } & VaultIndexRefusal);

interface History {
  readonly used: ReadonlySet<number>;
  readonly taken: ReadonlySet<number>;
}

function readHistories(histories: readonly CosignerIndexHistory[]): History[] | VaultIndexRefusal {
  if (!Array.isArray(histories) || histories.length === 0) return { code: 'NO_PARTICIPANTS' };
  const out: History[] = [];
  for (let participant = 0; participant < histories.length; participant++) {
    const h = histories[participant];
    if (!Array.isArray(h?.used) || !Array.isArray(h?.burned) || ![...h.used, ...h.burned].every(isVaultIndex)) {
      return { code: 'INVALID_HISTORY', participant };
    }
    out.push({ used: new Set(h.used), taken: new Set([...h.used, ...h.burned]) });
  }
  return out;
}

/**
 * The smallest index from `FIRST_VAULT_INDEX` up that no participant has used or burned, or
 * `undefined` for malformed input or an exhausted index domain. It does not apply the gap rule;
 * `allocateVaultIndex` does.
 */
export function nextVaultIndex(histories: readonly CosignerIndexHistory[]): number | undefined {
  const read = readHistories(histories);
  if (!Array.isArray(read)) return undefined;
  let index = FIRST_VAULT_INDEX;
  while (index <= MAX_VAULT_INDEX && read.some(h => h.taken.has(index))) index++;
  return index <= MAX_VAULT_INDEX ? index : undefined;
}

/**
 * The gap refusal for creating a vault at `index`: the first participant for whom 20 or more
 * consecutive indices below `index` are unused, or `undefined` when there is none. Unused means
 * not on chain (`used`), since that is what a discovery scan sees: a burned index is part of a
 * gap. The scan starts at index 0, so a run from 0 counts too.
 */
export function discoveryGapRefusal(
  histories: readonly CosignerIndexHistory[],
  index: number,
): Extract<VaultIndexRefusal, { code: 'DISCOVERY_GAP_EXCEEDED' }> | undefined {
  const read = readHistories(histories);
  if (!Array.isArray(read) || !isVaultIndex(index)) return undefined;
  for (let participant = 0; participant < read.length; participant++) {
    let run = 0;
    for (let i = index - 1; i >= 0 && run < DISCOVERY_GAP_LIMIT; i--) {
      if (read[participant].used.has(i)) run = 0;
      else run++;
      if (run >= DISCOVERY_GAP_LIMIT) {
        let gapStart = i;
        while (gapStart > 0 && !read[participant].used.has(gapStart - 1)) gapStart--;
        let gapEnd = i;
        while (gapEnd + 1 < index && !read[participant].used.has(gapEnd + 1)) gapEnd++;
        return { code: 'DISCOVERY_GAP_EXCEEDED', participant, gapStart, gapLength: gapEnd - gapStart + 1 };
      }
    }
  }
  return undefined;
}

/** The index of a new vault for these participants, or the typed reason there is none. */
export function allocateVaultIndex(histories: readonly CosignerIndexHistory[]): VaultIndexAllocation {
  const read = readHistories(histories);
  if (!Array.isArray(read)) return { ok: false, ...read };
  const index = nextVaultIndex(histories);
  if (index === undefined) return { ok: false, code: 'INDEX_SPACE_EXHAUSTED' };
  const gap = discoveryGapRefusal(histories, index);
  return gap ? { ok: false, ...gap } : { ok: true, index };
}
