import { IConnection } from '../database/models/Connection';
import { db } from '../database/GeroWalletDatabase';

export class ConnectionRepository {
    async getAll(): Promise<IConnection[]> {
        return db.connection.toArray();
    }

    async get(conceptualWalletId: number): Promise<IConnection | undefined> {
        return db.connection.get({ conceptualWalletId });
    }

    async put(id: number, item: IConnection) {
        db.connection.put(item, id);
    }
}
