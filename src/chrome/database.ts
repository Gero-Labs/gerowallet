import Dexie from "dexie";

class Database {
  private db: Dexie;

  constructor(databaseName: string) {
    this.db = new Dexie(databaseName);
  }
}

export const db = new Database('GeroWalletDatabase')
