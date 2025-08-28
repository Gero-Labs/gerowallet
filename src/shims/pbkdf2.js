// Shim for pbkdf2 to provide correct exports for browser environment
// This normalizes the pbkdf2 exports for @cardano-sdk/crypto

// Import the full pbkdf2 module and extract what we need
import * as pbkdf2Module from 'pbkdf2';

// Get the actual functions - handle different export structures
const pbkdf2Func = pbkdf2Module.pbkdf2 || pbkdf2Module.default?.pbkdf2;
const pbkdf2SyncFunc = pbkdf2Module.pbkdf2Sync || pbkdf2Module.default?.pbkdf2Sync || pbkdf2Func;

// Named exports - this is what @cardano-sdk/crypto expects
export const pbkdf2 = pbkdf2Func;
export const pbkdf2Sync = pbkdf2SyncFunc;

// Default export for compatibility
export default {
  pbkdf2: pbkdf2Func,
  pbkdf2Sync: pbkdf2SyncFunc
};
