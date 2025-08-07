// Import the actual pbkdf2 implementations
import * as pbkdf2Package from 'pbkdf2';

// Get the functions from the package
const pbkdf2Async = pbkdf2Package.pbkdf2;
const pbkdf2SyncImpl = pbkdf2Package.pbkdf2Sync;

// Export the functions
export const pbkdf2Sync = pbkdf2SyncImpl;
export const pbkdf2 = pbkdf2Async;

// Create pbkdf2 module interface
const pbkdf2Module = {
  pbkdf2: pbkdf2Async,
  pbkdf2Sync: pbkdf2SyncImpl,
};

// Default export
export default pbkdf2Module;
