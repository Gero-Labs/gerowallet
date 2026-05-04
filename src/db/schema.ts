export const geroWalletDbName: string = 'GeroWalletDatabase';

export const geroDBVersion: number = 15;

export const geroDBSchema = {
  wallets:
    '++id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network, userId, encryptionMethod, webAuthnCredentialId, addressType',
  config: '++id, key, value',
  provider: '++id, [name+chain+network], baseUrl, apiKey',
};

export const walletDBVersion: number = 10;

export const walletDBSchema = {
  config: 'key, value',
  sync: '++id, hash, height, slot, time, epoch, epoch_slot',
  account: '++id, walletId',
  addresses: 'address',
  contacts: 'address, name',
  rewards: 'epoch, amount, pool_id, type',
  transactions: 'id',
  connected_dapps: '++id, domain, time',
  portfolio_charts: '++id, address, currency, [address+currency], data, timestamp, expiresAt',
  utxos: '++id', // Persisted UTxOs from server (survives logout)
};

export const blockChainDBVersion: number = 5;

export const blockChainDBSchema = {
  pools: 'pool_id_bech32',
  dreps: 'drep_id',
  sync: '++id, time',
  assets: 'asset, fingerprint, asset_name, policy_id',
  epoch_params: 'epoch',
  genesis_info: 'id',
};

export const portfolioDBVersion: number = 1;

export const portfolioDBSchema = {
  portfolio_charts: '++id, address, currency, [address+currency], data, timestamp, expiresAt', // data is JSON string
};
