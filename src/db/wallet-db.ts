import Dexie, { DexieError } from 'dexie';
import { walletDBSchema, walletDBVersion } from '@/db/schema';

const dbCache: Map<string, Dexie> = new Map();

export async function getDb(id: number): Promise<Dexie> {
    const dbName = 'wallet-' + id;
    
    if (dbCache.has(dbName)) {
        return dbCache.get(dbName)!;
    }
    
    try {
        const db: Dexie = new Dexie(dbName);
        db.version(walletDBVersion).stores(walletDBSchema);
        await db.open();
        dbCache.set(dbName, db);
        return db;
    } catch (error: DexieError | any) {
        console.debug('Database error:', error)
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

// Portfolio charts functions
export async function getPortfolioChart(walletId: number, address: string, currency: 'ADA' | 'USD' | 'EUR') {
  const db: Dexie = await getDb(walletId);
  
  // Try composite index first, fallback to individual queries if schema mismatch
  try {
    return await db
      .table('portfolio_charts')
      .where(['address', 'currency'])
      .equals([address, currency])
      .first();
  } catch (schemaError: any) {
    if (schemaError.name === 'SchemaError') {
      console.warn('Composite index not available, using fallback method for portfolio chart lookup');
      // Fallback: query by address and filter by currency
      const entries = await db.table('portfolio_charts').where('address').equals(address).toArray();
      return entries.find(e => e.currency === currency);
    } else {
      throw schemaError;
    }
  }
}

export async function savePortfolioChart(walletId: number, entry: any) {
  const db: Dexie = await getDb(walletId);
  await db.table('portfolio_charts').add(entry);
}

export async function removePortfolioChart(walletId: number, address: string, currency: 'ADA' | 'USD' | 'EUR') {
  const db: Dexie = await getDb(walletId);
  
  // Try composite index first, fallback to individual queries if schema mismatch
  try {
    await db.table('portfolio_charts').where(['address', 'currency']).equals([address, currency]).delete();
  } catch (schemaError: any) {
    if (schemaError.name === 'SchemaError') {
      console.warn('Composite index not available, using fallback method for portfolio chart removal');
      // Fallback: query by address and filter by currency
      const entries = await db.table('portfolio_charts').where('address').equals(address).toArray();
      const entriesToDelete = entries.filter(entry => entry.currency === currency);
      for (const entry of entriesToDelete) {
        await db.table('portfolio_charts').delete(entry.id);
      }
    } else {
      throw schemaError;
    }
  }
}

export async function clearPortfolioChartsByAddress(walletId: number, address: string) {
  const db: Dexie = await getDb(walletId);
  await db.table('portfolio_charts').where('address').equals(address).delete();
}

export async function clearAllPortfolioCharts(walletId: number) {
  const db: Dexie = await getDb(walletId);
  await db.table('portfolio_charts').clear();
}

export async function cleanupExpiredPortfolioCharts(walletId: number) {
  const db: Dexie = await getDb(walletId);
  const now = Date.now();
  const expiredEntries = await db.table('portfolio_charts').where('expiresAt').belowOrEqual(now).toArray();
  
  if (expiredEntries.length > 0) {
    await db.table('portfolio_charts').where('expiresAt').belowOrEqual(now).delete();
  }
  
  return expiredEntries.length;
}

export async function getPortfolioChartsStats(walletId: number) {
  const db: Dexie = await getDb(walletId);
  const allEntries = await db.table('portfolio_charts').toArray();
  const now = Date.now();

  const validEntries = allEntries.filter(entry => entry.expiresAt > now);
  const expiredEntries = allEntries.filter(entry => entry.expiresAt <= now);

  return {
    totalEntries: allEntries.length,
    validEntries: validEntries.length,
    expiredEntries: expiredEntries.length,
    oldestEntry: allEntries.length > 0 ? Math.min(...allEntries.map(e => e.timestamp)) : null,
    newestEntry: allEntries.length > 0 ? Math.max(...allEntries.map(e => e.timestamp)) : null,
  };
}

export async function getPortfolioChartsStatus(walletId: number, address: string) {
  const db: Dexie = await getDb(walletId);
  const now = Date.now();

  // Load sequentially to reduce memory usage
  const adaEntry = await db
    .table('portfolio_charts')
    .where('address')
    .equals(address)
    .and(entry => entry.currency === 'ADA')
    .first();

  const usdEntry = await db
    .table('portfolio_charts')
    .where('address')
    .equals(address)
    .and(entry => entry.currency === 'USD')
    .first();

  const eurEntry = await db
    .table('portfolio_charts')
    .where('address')
    .equals(address)
    .and(entry => entry.currency === 'EUR')
    .first();

  return {
    ada: {
      hasData: !!adaEntry && adaEntry.expiresAt > now,
      dataPoints: adaEntry ? (Array.isArray(adaEntry.data) ? adaEntry.data.length : 
                              typeof adaEntry.data === 'string' ? JSON.parse(adaEntry.data).length : 0) : 0,
      expiresAt: adaEntry?.expiresAt || null,
    },
    usd: {
      hasData: !!usdEntry && usdEntry.expiresAt > now,
      dataPoints: usdEntry ? (Array.isArray(usdEntry.data) ? usdEntry.data.length : 
                              typeof usdEntry.data === 'string' ? JSON.parse(usdEntry.data).length : 0) : 0,
      expiresAt: usdEntry?.expiresAt || null,
    },
    eur: {
      hasData: !!eurEntry && eurEntry.expiresAt > now,
      dataPoints: eurEntry ? (Array.isArray(eurEntry.data) ? eurEntry.data.length : 
                              typeof eurEntry.data === 'string' ? JSON.parse(eurEntry.data).length : 0) : 0,
      expiresAt: eurEntry?.expiresAt || null,
    },
  };
}


