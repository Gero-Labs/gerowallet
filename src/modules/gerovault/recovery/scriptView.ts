/**
 * A native script as the review screen prints it, line by line, so the user sees the exact rule:
 *
 *   any of [
 *     at least 2 of [
 *       <key hash>   yours
 *       <key hash>
 *     ]
 *     all of [ ... after slot 123 ]
 *   ]
 *
 * Keys are named by their full hash; only this wallet's own is marked. Pure.
 */
import { Cardano } from '@cardano-sdk/core';

export type ScriptLine =
  | { readonly kind: 'open'; readonly depth: number; readonly rule: 'atLeast' | 'all' | 'any'; readonly required?: number; readonly of?: number }
  | { readonly kind: 'close'; readonly depth: number }
  | { readonly kind: 'key'; readonly depth: number; readonly keyHash: string; readonly own: boolean }
  | { readonly kind: 'after'; readonly depth: number; readonly slot: number }
  | { readonly kind: 'before'; readonly depth: number; readonly slot: number };

/** At most this deep; vault templates are two levels. Anything deeper is cut with a closing line. */
const MAX_DEPTH = 8;

export function scriptLines(script: Cardano.NativeScript, ownKeyHashes: ReadonlySet<string>, depth = 0): ScriptLine[] {
  if (depth > MAX_DEPTH) return [];
  switch (script.kind) {
    case Cardano.NativeScriptKind.RequireSignature:
      return [{ kind: 'key', depth, keyHash: script.keyHash, own: ownKeyHashes.has(script.keyHash) }];
    case Cardano.NativeScriptKind.RequireTimeAfter:
      return [{ kind: 'after', depth, slot: script.slot }];
    case Cardano.NativeScriptKind.RequireTimeBefore:
      return [{ kind: 'before', depth, slot: script.slot }];
    case Cardano.NativeScriptKind.RequireNOf:
    case Cardano.NativeScriptKind.RequireAllOf:
    case Cardano.NativeScriptKind.RequireAnyOf: {
      const rule = script.kind === Cardano.NativeScriptKind.RequireNOf ? 'atLeast' : script.kind === Cardano.NativeScriptKind.RequireAllOf ? 'all' : 'any';
      const open: ScriptLine = rule === 'atLeast'
        ? { kind: 'open', depth, rule, required: (script as Cardano.RequireAtLeastScript).required, of: script.scripts.length }
        : { kind: 'open', depth, rule };
      return [open, ...script.scripts.flatMap(s => scriptLines(s, ownKeyHashes, depth + 1)), { kind: 'close', depth }];
    }
    default:
      return [];
  }
}
