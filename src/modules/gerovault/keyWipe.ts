/**
 * Deriving a private key from a root key and overwriting every private key it went through.
 *
 * `Bip32PrivateKey.derive(path)` keeps each intermediate key in buffers its caller never sees, so
 * nothing could wipe them. Here the path is walked one level at a time: each level's key is
 * overwritten as soon as the next exists, and the last one once `use` returns (or throws). `use`
 * must finish with the key synchronously and must not keep it. The root's own bytes stay the
 * caller's to wipe.
 *
 * Kept free of page-only imports: the background imports this file.
 */
import type { Bip32PrivateKey } from '@cardano-sdk/crypto';

export function withDerivedKey<T>(root: Bip32PrivateKey, path: readonly number[], use: (key: Bip32PrivateKey) => T): T {
  let key = root;
  try {
    for (const index of path) {
      const next = key.derive([index]);
      if (key !== root) key.bytes().fill(0);
      key = next;
    }
    return use(key);
  } finally {
    if (key !== root) key.bytes().fill(0);
  }
}
