import { Network } from '@/models/types';

// A module of its own so the API layer can check a mapping-validator
// transaction without pulling the registration flow and its messaging along.
// `useCnightDustRegistration` re-exports it for its existing importers.

/**
 * DUST mapping validator (`cnight_generates_dust`) per Cardano network — the
 * script a cNIGHT→DUST registration locks its mapping NFT under. Used to detect
 * and deep-link a registration transaction, and to check that a transaction
 * Nexus built pays the real validator. Script hashes portal-verified
 * 2026-07-14; addresses derived from them (type-7 enterprise script address).
 * Preview, preprod and stagenet share one deployment — Nexus pins the same
 * hash for stagenet and preprod for the same reason.
 */
export const DUST_MAPPING_VALIDATOR: Record<string, { scriptHash: string; address: string }> = {
  [Network.MAINNET]: {
    scriptHash: '73e4aea31b5b51d9b0ca386196fc6a4c422f74c5aea011e4b8bdf4e5',
    address: 'addr1w9e7ft4rrdd4rkdseguxr9hudfxyytm5ckh2qy0yhz7lfeg9lvhq7',
  },
  [Network.PREPROD]: {
    scriptHash: '7e69087d98fac5869eac14e13dfb6f98228c41e638aa2a59d1f85e9c',
    address: 'addr_test1wplxjzranravtp574s2wz00md7vz9rzpucu252je68u9a8qzjheng',
  },
  [Network.PREVIEW]: {
    scriptHash: '7e69087d98fac5869eac14e13dfb6f98228c41e638aa2a59d1f85e9c',
    address: 'addr_test1wplxjzranravtp574s2wz00md7vz9rzpucu252je68u9a8qzjheng',
  },
  [Network.STAGENET]: {
    scriptHash: '7e69087d98fac5869eac14e13dfb6f98228c41e638aa2a59d1f85e9c',
    address: 'addr_test1wplxjzranravtp574s2wz00md7vz9rzpucu252je68u9a8qzjheng',
  },
};
