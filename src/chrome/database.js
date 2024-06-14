// Open the database and create an object store
let db;

function openDatabase(dbName, version) {
  return new Promise((resolve, reject) => {
    const request = self.indexedDB.open(dbName, version);

    request.onupgradeneeded = function(event) {
      db = event.target.result;
      // const objectStore = db.createObjectStore("myStore", { keyPath: "id", autoIncrement: true });
      // objectStore.createIndex("name", "name", { unique: false });
      // objectStore.createIndex("age", "age", { unique: false });
    };

    request.onsuccess = function(event) {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = function(event) {
      reject("Error opening database", event);
    };
  });
}

// Add a record
function addRecord(storeName, record) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], "readwrite");
    const objectStore = transaction.objectStore(storeName);
    const request = objectStore.add(record);

    request.onsuccess = function(event) {
      resolve(event.target.result);
    };

    request.onerror = function(event) {
      reject("Error adding record", event);
    };
  });
}

// Get a record
function getRecord(storeName, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], "readonly");
    const objectStore = transaction.objectStore(storeName);
    const request = objectStore.get(id);

    request.onsuccess = function(event) {
      resolve(event.target.result);
    };

    request.onerror = function(event) {
      reject("Error retrieving record", event);
    };
  });
}

// Update a record
function updateRecord(storeName, id, updatedRecord) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], "readwrite");
    const objectStore = transaction.objectStore(storeName);
    const request = objectStore.get(id);

    request.onsuccess = function(event) {
      const data = event.target.result;
      Object.assign(data, updatedRecord);
      const updateRequest = objectStore.put(data);

      updateRequest.onsuccess = function(event) {
        resolve(event.target.result);
      };

      updateRequest.onerror = function(event) {
        reject("Error updating record", event);
      };
    };

    request.onerror = function(event) {
      reject("Error retrieving record for update", event);
    };
  });
}

// Delete a record
function deleteRecord(storeName, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], "readwrite");
    const objectStore = transaction.objectStore(storeName);
    const request = objectStore.delete(id);

    request.onsuccess = function(event) {
      resolve(event.target.result);
    };

    request.onerror = function(event) {
      reject("Error deleting record", event);
    };
  });
}

// Get all records
function getAllRecords(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([storeName], "readonly");
    const objectStore = transaction.objectStore(storeName);
    const request = objectStore.getAll();

    request.onsuccess = function(event) {
      resolve(event.target.result);
    };

    request.onerror = function(event) {
      reject("Error retrieving all records", event);
    };
  });
}

// Live query with basic polling (simplified)
function liveQuery(callback, interval = 1000) {
  let lastRecords = [];

  async function poll() {
    const records = await getAllRecords();
    if (JSON.stringify(records) !== JSON.stringify(lastRecords)) {
      lastRecords = records;
      callback(records);
    }
    setTimeout(poll, interval);
  }

  poll();
}

function getProvider(chain, network) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['provider', 'readonly'])
    const providerStore = transaction.objectStore("provider");
    const index = providerStore.index("chain")
    const request = index.openCursor();
    const results = [];

    request.onsuccess = function(event) {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.chain === chain && cursor.value.network === network) {
          results.push(cursor.value);
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };

    request.onerror = function(event) {
      reject("Error retrieving records", event);
    };
  });

}

// // Usage example
// (async function() {
//   await openDatabase();
//
//   // Add a record
//   await addRecord({ name: "John Doe", age: 30 });
//
//   // Get a record
//   const record = await getRecord(1);
//   console.log("Record:", record);
//
//   // Update a record
//   await updateRecord(1, { name: "Jane Doe", age: 31 });
//
//   // Delete a record
//   await deleteRecord(1);
//
//   // Get all records
//   const allRecords = await getAllRecords();
//   console.log("All Records:", allRecords);
//
//   // Live query
//   liveQuery(records => {
//     console.log("Live query records:", records);
//   });
// })();
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
