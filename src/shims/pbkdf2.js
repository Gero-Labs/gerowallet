// Simple pbkdf2 re-export with pbkdf2Sync stub
import { pbkdf2 as pbkdf2Async } from 'pbkdf2/browser.js';

export const pbkdf2 = pbkdf2Async;

// pbkdf2Sync is not available in browser version, so we provide a stub
export function pbkdf2Sync(password, salt, iterations, keylen, digest) {
  throw new Error('pbkdf2Sync is not available in browser environment. Use pbkdf2 (async) instead.');
}

// Default export
export default {
  pbkdf2: pbkdf2Async,
  pbkdf2Sync
};
