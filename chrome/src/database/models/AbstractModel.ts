import { LogService } from '../../services/log.service';
import { db, IDataPayload, IDbResponse } from '../GeroWalletDatabase';

export class AbstractModel {
    private tableName;

    constructor(tableName: string) {
        this.tableName = tableName;
    }

    async getAll(limit?: number, offset?: number): Promise<IDbResponse> {
        return db
            .transaction('readonly', db[this.tableName], async () => {
                return limit && offset
                    ? await db[this.tableName].limit(limit).offset(offset).toArray()
                    : await db[this.tableName].toArray();
            })
            .then((res) => {
                const response: IDbResponse = {
                    result: 'OK',
                    payload: res,
                };
                return response;
            })
            .catch((e) => {
                const response: IDbResponse = {
                    result: 'ERROR',
                    payload: e,
                };
                new LogService().log('getAll error: ' + e);
                return response;
            });
    }

    async getBy(payload: Partial<IDataPayload>): Promise<IDbResponse> {
        return db
            .transaction('readonly', db[this.tableName], async () => {
                return await db[this.tableName].where(payload).toArray();
            })
            .then((res) => {
                const response: IDbResponse = {
                    result: 'OK',
                    payload: res,
                };
                return response;
            })
            .catch((e) => {
                const response: IDbResponse = {
                    result: 'ERROR',
                    payload: e,
                };
                new LogService().log('getBy error: ' + e);
                return response;
            });
    }

    async put(payload: IDataPayload, id?: number): Promise<IDbResponse> {
        return db
            .transaction('rw', db[this.tableName], async () => {
                return id ? await db[this.tableName].put(payload, id) : await db[this.tableName].put(payload);
            })
            .then(() => {
                const response: IDbResponse = {
                    result: 'OK',
                    payload: undefined,
                };
                return response;
            })
            .catch((e) => {
                const response: IDbResponse = {
                    result: 'ERROR',
                    payload: e,
                };
                new LogService().log('put error: ' + e);
                return response;
            });
    }

    async saveNew(payload: IDataPayload): Promise<IDbResponse> {
        return db
            .transaction('rw', db[this.tableName], async () => {
                return await db[this.tableName].add(payload);
            })
            .then(() => {
                const response: IDbResponse = {
                    result: 'OK',
                    payload: undefined,
                };
                return response;
            })
            .catch((e) => {
                const response: IDbResponse = {
                    result: 'ERROR',
                    payload: e,
                };
                new LogService().log('saveNew error: ' + e);
                return response;
            });
    }

    // TODO delete Cascade
    async delete(payload: IDataPayload): Promise<IDbResponse> {
        return db
            .transaction('rw', db[this.tableName], async () => {
                return await db[this.tableName].delete(payload);
            })
            .then(() => {
                const response: IDbResponse = {
                    result: 'OK',
                    payload: undefined,
                };
                return response;
            })
            .catch((e) => {
                const response: IDbResponse = {
                    result: 'ERROR',
                    payload: e,
                };
                new LogService().log('delete error: ' + e);
                return response;
            });
    }
}
