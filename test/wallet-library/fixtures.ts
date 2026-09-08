import type { Wallet } from '@/models/types';
export const wallets: Wallet[] = [
  { id: 1, name: 'Company treasury', chain: 'Cardano', network: 'Mainnet', type: 'Ledger', icon: 'blue', baseAddress: 'addr1qtreasury92l8s0w5x7v43rfac76ydfz8z9a8z74s6m', stakeAddress: 'stake1utreasury8m2n5p3q7k9v4x6c0' },
  { id: 2, name: 'Operating expenses', chain: 'Cardano', network: 'Mainnet', icon: 'green', baseAddress: 'addr1qoperations83f70n2mx4pr692kl68s8c03e7d', stakeAddress: 'stake1uoperations0k4v92c4t8' },
  { id: 3, name: 'Long-term reserve', chain: 'Bitcoin', network: 'Mainnet', type: 'Trezor', icon: 'orange', baseAddress: 'bc1qreserve95k3v72m9x8cr03f60z8vh7' },
  { id: 4, name: 'Everyday wallet', chain: 'Cardano', network: 'Mainnet', icon: 'purple', baseAddress: 'addr1qpersonal38cm574jv9w0x2e6q3a8j', stakeAddress: 'stake1upersonal3m9x8v4c7' },
  { id: 5, name: 'Private assets', chain: 'Midnight', network: 'Mainnet', icon: 'grey', baseAddress: 'mn_addr_unshielded1privateassets7km3v9' },
  { id: 6, name: 'Staking rewards', chain: 'Cardano', network: 'Mainnet', icon: 'pink', baseAddress: 'addr1qstakingrewards038fmv17x9ad3', stakeAddress: 'stake1urewardsonly7x03k9m5' },
  { id: 7, name: 'Testnet development', chain: 'Cardano', network: 'Preprod', icon: 'yellow', baseAddress: 'addr_test1qdevelopmentm4c7x03' },
  { id: 8, name: 'Partner payments', chain: 'Cardano', network: 'Mainnet', icon: 'blue', baseAddress: 'addr1qpartners0m2x7r99lfa84' },
];
