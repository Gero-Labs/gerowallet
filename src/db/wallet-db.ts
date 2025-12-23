import Dexie, { DexieError } from 'dexie';
import {
  walletDBSchema,
  walletDBVersion
} from '@/db/schema';
import { debugLog } from '@/utils/debug';

const dbCache: Map<string, Dexie> = new Map();

export async function getDb(id: number): Promise<Dexie | null> {
    const dbName = 'wallet-' + id;

    if (dbCache.has(dbName)) {
        return dbCache.get(dbName)!;
    }

    try {
        const db: Dexie = new Dexie(dbName);

        // Migration path: Define all historical schema versions for proper upgrade
        // This ensures wallets from v2.5.3 (version 3) properly migrate to current version

        // Version 3: Original schema (v2.5.3)
        db.version(3).stores({
            config: 'key, value',
            sync: '++id, hash, height, slot, time, epoch, epoch_slot',
            account: '++id, walletId',
            addresses: 'address',
            contacts: 'address, name',
            rewards: 'epoch, amount, pool_id, type',
            transactions: 'id',
            connected_dapps: '++id, domain, time',
        });

        // Version 4-6: Intermediate versions
        db.version(4).stores({
            config: 'key, value',
            sync: '++id, hash, height, slot, time, epoch, epoch_slot',
            account: '++id, walletId',
            addresses: 'address',
            contacts: 'address, name',
            rewards: 'epoch, amount, pool_id, type',
            transactions: 'id',
            connected_dapps: '++id, domain, time',
        });

        db.version(5).stores({
            config: 'key, value',
            sync: '++id, hash, height, slot, time, epoch, epoch_slot',
            account: '++id, walletId',
            addresses: 'address',
            contacts: 'address, name',
            rewards: 'epoch, amount, pool_id, type',
            transactions: 'id',
            connected_dapps: '++id, domain, time',
        });

        db.version(6).stores({
            config: 'key, value',
            sync: '++id, hash, height, slot, time, epoch, epoch_slot',
            account: '++id, walletId',
            addresses: 'address',
            contacts: 'address, name',
            rewards: 'epoch, amount, pool_id, type',
            transactions: 'id',
            connected_dapps: '++id, domain, time',
            multisig: 'id, paymentAddress, stakeAddress, name, signers, cbor, requiredSigners, createdAt',
        });

        // Version 7: Added portfolio_charts table
        db.version(7).stores({
            config: 'key, value',
            sync: '++id, hash, height, slot, time, epoch, epoch_slot',
            account: '++id, walletId',
            addresses: 'address',
            contacts: 'address, name',
            rewards: 'epoch, amount, pool_id, type',
            transactions: 'id',
            connected_dapps: '++id, domain, time',
            multisig: 'id, paymentAddress, stakeAddress, name, signers, cbor, requiredSigners, createdAt',
            portfolio_charts: '++id, address, currency, [address+currency], data, timestamp, expiresAt',
        });

        // Version 8: Continued with portfolio_charts
        db.version(8).stores({
            config: 'key, value',
            sync: '++id, hash, height, slot, time, epoch, epoch_slot',
            account: '++id, walletId',
            addresses: 'address',
            contacts: 'address, name',
            rewards: 'epoch, amount, pool_id, type',
            transactions: 'id',
            connected_dapps: '++id, domain, time',
            multisig: 'id, paymentAddress, stakeAddress, name, signers, cbor, requiredSigners, createdAt',
            portfolio_charts: '++id, address, currency, [address+currency], data, timestamp, expiresAt',
        });

        // Version 9: Multisig removed from schema
        db.version(9).stores({
            config: 'key, value',
            sync: '++id, hash, height, slot, time, epoch, epoch_slot',
            account: '++id, walletId',
            addresses: 'address',
            contacts: 'address, name',
            rewards: 'epoch, amount, pool_id, type',
            transactions: 'id',
            connected_dapps: '++id, domain, time',
            portfolio_charts: '++id, address, currency, [address+currency], data, timestamp, expiresAt',
        });

        // Version 10: Current version (added delegation_requests)
        db.version(walletDBVersion).stores(walletDBSchema);

        await db.open();
        dbCache.set(dbName, db);
        return db;
    } catch (error: DexieError | any) {
      debugLog('Database error:', error)
        if (error.name === 'NoSuchDatabaseError') {
            const db: Dexie = new Dexie(dbName);
            db.version(walletDBVersion).stores(walletDBSchema);
            await db.open();
            dbCache.set(dbName, db);
            return db;
        } else {
            console.error('Error opening database:', error);
            return null
        }
    }
}

export async function setWalletConfiguration(id: number, key: string, value: any) {
  const db: Dexie = await getDb(id);
  const configTable = db.table('config');
  const configuration = await configTable.where({ key: key }).first();
  if (!configuration) {
    await configTable.put({
      key: key,
      value: value
    });
  } else {
    console.log('Updating configuration', configuration)
    configuration.value = value;
    await configTable.put(configuration);
  }
}

export async function addOrUpdateContact(id: number, contact, address?: string) {
  const db: Dexie = await getDb(id);
  if (address) {
    db.table('contacts').update(address, {address: contact.address, name: contact.name})
  } else {
    db.table('contacts').put({address: contact.address, name: contact.name})
  }
}

export async function removeContact(id: number, address: string) {
  const db: Dexie = await getDb(id);
  db.table('contacts').delete(address)
}

export async function addConnectedDapp(walletId: number, domain: string) {
  try {
    const db: Dexie = await getDb(walletId);
    const dappsTable = db.table('connected_dapps');

    if (!dappsTable) throw new Error('No Connected Dapps Table.');

    // Check if the domain already exists in the table
    const existingDapp = await dappsTable.get({ domain: domain });

    if (existingDapp) {
      console.log(`Domain ${domain} already exists, ignoring.`);
      return existingDapp;
    }

    // Insert new domain
    const domainObject = { domain, time: new Date().getTime() };
    domainObject['id'] = await dappsTable.put(domainObject);
    console.log(`Domain ${domain} added successfully.`);

    return domainObject;
  } catch (err) {
    console.error(`Failed to add connected dapp: ${err}`);
    throw err;
  }
}

export async function removeDapp(id: number, dappId: string) {
  const db: Dexie = await getDb(id);
  db.table('connected_dapps').delete(dappId)
}

export function clearDbCache(id: number) {
  const dbName = 'wallet-' + id;
  const db = dbCache.get(dbName);
  if (db) {
    db.close();
    dbCache.delete(dbName);
  }
}

export async function removePendingTransaction(walletId: number, txId: string) {
  try {
    const db: Dexie = await getDb(walletId);
    const txTable = db.table('transactions');

    if (!txTable) throw new Error('No Transactions Table.');

    // Get the transaction to verify it's pending
    const transaction = await txTable.get(txId);

    if (!transaction) {
      console.warn(`Transaction ${txId} not found`);
      return false;
    }

    if (!transaction.pending) {
      console.warn(`Transaction ${txId} is not pending, cannot remove`);
      return false;
    }

    // Remove the transaction
    await txTable.delete(txId);
    console.log(`Pending transaction ${txId} removed successfully`);

    return true;
  } catch (err) {
    console.error(`Failed to remove pending transaction: ${err}`);
    throw err;
  }
}

// Note: Portfolio data is now stored directly in wallet databases
// Old portfolio_* databases will be migrated during upgrade

// ===== DUST Delegation Request Functions =====

export async function addDelegationRequest(walletId: number, request: any) {
  try {
    const db: Dexie = await getDb(walletId);
    const requestsTable = db.table('delegation_requests');

    if (!requestsTable) throw new Error('No delegation_requests table.');

    // Check if request with same ID already exists
    const existingRequest = await requestsTable.get(request.id);
    if (existingRequest) {
      console.log(`Delegation request ${request.id} already exists, updating.`);
      await requestsTable.put(request);
      return existingRequest;
    }

    // Insert new request
    await requestsTable.put(request);
    console.log(`Delegation request ${request.id} added successfully.`);
    return request;
  } catch (err) {
    console.error(`Failed to add delegation request: ${err}`);
    throw err;
  }
}

export async function updateDelegationRequest(walletId: number, requestId: string, updates: any) {
  try {
    const db: Dexie = await getDb(walletId);
    const requestsTable = db.table('delegation_requests');

    if (!requestsTable) throw new Error('No delegation_requests table.');

    const request = await requestsTable.get(requestId);
    if (!request) {
      throw new Error(`Delegation request ${requestId} not found.`);
    }

    const updatedRequest = { ...request, ...updates };
    await requestsTable.put(updatedRequest);
    console.log(`Delegation request ${requestId} updated successfully.`);
    return updatedRequest;
  } catch (err) {
    console.error(`Failed to update delegation request: ${err}`);
    throw err;
  }
}

export async function getDelegationRequest(walletId: number, requestId: string) {
  try {
    const db: Dexie = await getDb(walletId);
    const requestsTable = db.table('delegation_requests');

    if (!requestsTable) throw new Error('No delegation_requests table.');

    return await requestsTable.get(requestId);
  } catch (err) {
    console.error(`Failed to get delegation request: ${err}`);
    throw err;
  }
}

export async function getAllDelegationRequests(walletId: number, type?: string, status?: string) {
  try {
    const db: Dexie = await getDb(walletId);
    const requestsTable = db.table('delegation_requests');

    if (!requestsTable) throw new Error('No delegation_requests table.');

    let query = requestsTable.toCollection();

    if (type) {
      query = query.filter(req => req.type === type);
    }

    if (status) {
      query = query.filter(req => req.status === status);
    }

    return await query.toArray();
  } catch (err) {
    console.error(`Failed to get delegation requests: ${err}`);
    throw err;
  }
}

export async function getActiveDelegationRequests(walletId: number, type?: string) {
  try {
    const db: Dexie = await getDb(walletId);
    const requestsTable = db.table('delegation_requests');

    if (!requestsTable) throw new Error('No delegation_requests table.');

    const now = Date.now();
    let query = requestsTable
      .toCollection()
      .filter(req => req.status === 'pending' && req.expiresAt > now);

    if (type) {
      query = query.filter(req => req.type === type);
    }

    return await query.toArray();
  } catch (err) {
    console.error(`Failed to get active delegation requests: ${err}`);
    throw err;
  }
}

export async function deleteDelegationRequest(walletId: number, requestId: string) {
  try {
    const db: Dexie = await getDb(walletId);
    const requestsTable = db.table('delegation_requests');

    if (!requestsTable) throw new Error('No delegation_requests table.');

    await requestsTable.delete(requestId);
    console.log(`Delegation request ${requestId} deleted successfully.`);
  } catch (err) {
    console.error(`Failed to delete delegation request: ${err}`);
    throw err;
  }
}

export async function expireOldDelegationRequests(walletId: number) {
  try {
    const db: Dexie = await getDb(walletId);
    const requestsTable = db.table('delegation_requests');

    if (!requestsTable) throw new Error('No delegation_requests table.');

    const now = Date.now();
    const expiredRequests = await requestsTable
      .toCollection()
      .filter(req => req.status === 'pending' && req.expiresAt <= now)
      .toArray();

    for (const request of expiredRequests) {
      await requestsTable.put({ ...request, status: 'expired' });
    }

    console.log(`Expired ${expiredRequests.length} delegation requests.`);
    return expiredRequests.length;
  } catch (err) {
    console.error(`Failed to expire delegation requests: ${err}`);
    throw err;
  }
}

