// This repository uses TypeScript's legacy node resolver, which does not read
// the SDK's package exports. Runtime imports still use its public /v1 export.
declare module 'midnight-v9-shielded/v1' {
  export * from 'midnight-v9-shielded/dist/v1/index';
}
