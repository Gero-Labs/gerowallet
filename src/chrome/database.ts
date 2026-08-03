let db: IDBDatabase;

function openDatabase(dbName: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version);

    request.onupgradeneeded = function(event) {
      db = (event.target as IDBOpenDBRequest).result;
      // const objectStore = db.createObjectStore("myStore", { keyPath: "id", autoIncrement: true });
      // objectStore.createIndex("name", "name", { unique: false });
      // objectStore.createIndex("age", "age", { unique: false });
    };

    request.onsuccess = function(event) {
      db = (event.target as IDBOpenDBRequest).result;
      resolve(db);
    };

    request.onerror = function() {
      reject(new Error("Error opening database"));
    };
  });
}

// Add a record
function addRecord(storeName: string, record: any): Promise<IDBValidKey> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], "readwrite");
    const objectStore = transaction.objectStore(storeName);
    const request = objectStore.add(record);

    request.onsuccess = function(event) {
      resolve((event.target as IDBRequest).result);
    };

    request.onerror = function() {
      reject(new Error("Error adding record"));
    };
  });
}

// Get a record
function getRecord(storeName: string, id: IDBValidKey): Promise<any> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], "readonly");
    const objectStore = transaction.objectStore(storeName);
    const request = objectStore.get(id);

    request.onsuccess = function(event) {
      resolve((event.target as IDBRequest).result);
    };

    request.onerror = function() {
      reject(new Error("Error retrieving record"));
    };
  });
}

// Update a record
function updateRecord(storeName: string, id: IDBValidKey, updatedRecord: any): Promise<IDBValidKey> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], "readwrite");
    const objectStore = transaction.objectStore(storeName);
    const request = objectStore.get(id);

    request.onsuccess = function(event) {
      const data = (event.target as IDBRequest).result;
      Object.assign(data, updatedRecord);
      const updateRequest = objectStore.put(data);

      updateRequest.onsuccess = function(event) {
        resolve((event.target as IDBRequest).result);
      };

      updateRequest.onerror = function() {
        reject(new Error("Error updating record"));
      };
    };

    request.onerror = function() {
      reject(new Error("Error retrieving record for update"));
    };
  });
}

// Delete a record
function deleteRecord(storeName: string, id: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], "readwrite");
    const objectStore = transaction.objectStore(storeName);
    const request = objectStore.delete(id);

    request.onsuccess = function() {
      resolve();
    };

    request.onerror = function() {
      reject(new Error("Error deleting record"));
    };
  });
}

// Get all records
function getAllRecords(storeName: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], "readonly");
    const objectStore = transaction.objectStore(storeName);
    const request = objectStore.getAll();

    request.onsuccess = function(event) {
      resolve((event.target as IDBRequest).result);
    };

    request.onerror = function() {
      reject(new Error("Error retrieving all records"));
    };
  });
}

// Live query with basic polling (simplified)
function liveQuery(storeName: string, callback: (records: any[]) => void, interval = 1000) {
  let lastRecords: any[] = [];

  async function poll() {
    const records = await getAllRecords(storeName);
    if (JSON.stringify(records) !== JSON.stringify(lastRecords)) {
      lastRecords = records;
      callback(records);
    }
    setTimeout(poll, interval);
  }

  poll();
}

// Get provider
function getProvider(chain: string, network: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['provider'], 'readonly');
    const providerStore = transaction.objectStore("provider");
    const index = providerStore.index("chain");
    const request = index.openCursor();
    const results: any[] = [];

    request.onsuccess = function(event) {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        if (cursor.value.chain === chain && cursor.value.network === network) {
          results.push(cursor.value);
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };

    request.onerror = function() {
      reject(new Error("Error retrieving records"));
    };
  });
}

export {
  openDatabase,
  addRecord,
  getRecord,
  updateRecord,
  deleteRecord,
  getAllRecords,
  liveQuery,
  getProvider
};
