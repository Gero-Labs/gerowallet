// Which wallets push notifications can serve. A module of its own so UI code
// (global search) can ask without pulling the registration machine, its HTTP
// client and its hashing into the dashboard bundle.

/** §1.3 plus handover B2: Normal Cardano software wallets with a key-hash reward address, on a served network. */
export function isEligibleWallet(w: { chain: string; network: string; type?: string; stakeAddress?: string }): boolean {
  return w.chain === 'Cardano'
    && (w.type === undefined || w.type === 'Normal')
    && ['Mainnet', 'Preprod', 'Preview'].includes(w.network)
    && typeof w.stakeAddress === 'string' && /^stake(_test)?1[a-z0-9]+$/.test(w.stakeAddress);
}
