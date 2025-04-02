export const walletDBVersion: number = 3;

export const walletDBSchema = {
  config: 'key, value',
  sync: '++id, hash, height, slot, time, epoch, epoch_slot',
  account: '++id, walletId',
  addresses: 'address',
  contacts: 'address, name',
  rewards: 'epoch, amount, pool_id, type',
  transactions: 'id',
  connected_dapps: '++id, domain, time',
}
