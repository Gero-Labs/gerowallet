import { autoInjectable, singleton } from 'tsyringe';
import { config } from '../config';
import { GERO_CARDANO_SERVER } from '../constants';
import { APIError, ERROR, TxSendError } from '../dAppConnector/api-error';
import { BlockfrostAssetInfoResponse } from '../models';
import { AddressInfo, AssetsInfo, BalanceInfo } from '../shared/types';
declare const Buffer;

@singleton()
@autoInjectable()
export class BlockFrostService {
    private blockfrostApiKey: string;
    private readonly blockFrostUrl: string;
    private readonly baseUrl: string;
    private fetchApiPromise: Promise<Response>;

    private readonly ipfsKey = config.ipfsKey;

    constructor() {
        this.blockFrostUrl = config.blockFrostUrl;
        this.baseUrl = config.baseUrl;
    }

    public async getTxNumber(stakeAddress: string): Promise<number> {
        try {
            const response = await fetch(`${GERO_CARDANO_SERVER}/txNumber/${stakeAddress}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
            return response.json();
        } catch (error) {
            return 0;
        }
    }

    public async getUtxos(address: string, paginate: any | undefined = undefined) {
        if (!this.checkBlockfrostKey()) {
            await this.fetchBlockfrostApiKey();
        }
        const page = paginate ? paginate.page : 1;
        const limit = paginate ? `&${paginate.limit}` : '';
        const response = await fetch(`${this.blockFrostUrl}/addresses/${address}/utxos?page=${page}${limit}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                project_id: this.blockfrostApiKey,
            },
        })
            .then(res => res.json())
            .catch(error => {
                if (error.status_code === 400) throw new Error(APIError.InvalidRequest.info);
                else if (error.status_code === 500) throw new Error(APIError.InternalError.info);
                else {
                    return [];
                }
            });
        return response;
    }

    public async submitTx(transaction: any) {
        if (!this.checkBlockfrostKey()) {
            await this.fetchBlockfrostApiKey();
        }
        const response = await fetch(`${this.blockFrostUrl}/tx/submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/cbor',
                project_id: this.blockfrostApiKey,
            },
            body: Buffer.from(transaction, 'hex'),
        }).catch(error => {
            if (error.status_code === 400) throw new Error(TxSendError.Failure.info.concat('.', ' ', error.message));
            else if (error.status_code === 500) throw new Error(APIError.InternalError.info);
            else if (error.status_code === 429) throw new Error(TxSendError.Refused.info);
            else if (error.status_code === 425) throw new Error(ERROR.fullMempool);
            else throw new Error(APIError.InvalidRequest.info);
        });

        return response.json();
    }

    public async fetchSpecificAssetInfo(assetId: string): Promise<BlockfrostAssetInfoResponse> {
        if (!this.checkBlockfrostKey()) {
            await this.fetchBlockfrostApiKey();
        }
        const response = await fetch(`${this.blockFrostUrl}/assets/${assetId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                project_id: this.blockfrostApiKey,
            },
        })
            .then(res => res.json())
            .catch(error => {
                throw new Error(`some error for fetchSpecificAsset: ${error}`);
            });

        return response;
    }

    public async fetchSpecificPolicyIdAssets(policyId: string): Promise<number> {
        if (!this.checkBlockfrostKey()) {
            await this.fetchBlockfrostApiKey();
        }

        const response = await fetch(`${this.blockFrostUrl}/assets/policy/${policyId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                project_id: this.blockfrostApiKey,
            },
        })
            .then(res => res.json())
            .catch(error => []);

        return response.length;
    }

    public async fetchIPFSInfo(ipfsPath: string): Promise<Blob> {
        const response = await fetch(`https://ipfs.blockfrost.io/api/v0/ipfs/gateway/${ipfsPath}`, {
            method: 'GET',
            headers: {
                project_id: this.ipfsKey,
            },
        })
            .then(res => res.blob())
            .catch(error => {
                throw new Error(`some error for fetchIPFSInfo: ${error}`);
            });

        return response;
    }

    public async getAccountAddresses(stakeAddress: string) {
        if (!this.checkBlockfrostKey()) {
            await this.fetchBlockfrostApiKey();
        }
        const response = await fetch(`${this.blockFrostUrl}/accounts/${stakeAddress}/addresses`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                project_id: this.blockfrostApiKey,
            },
        })
            .then(res => res.json())
            .catch(error => {
                return [];
            });
        const addresses = response;
        if (addresses.error) {
            return [];
        }
        return addresses;
    }

    public async getAssetAddress(assetName: string) {
        if (!this.checkBlockfrostKey()) {
            await this.fetchBlockfrostApiKey();
        }

        const response = await fetch(`${this.blockFrostUrl}/assets/${assetName}/addresses`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                project_id: this.blockfrostApiKey,
            },
        })
            .then(res => res.json())
            .catch(error => {
                return { undefined };
            });

        if (response?.error) {
            return undefined;
        }

        return response;
    }

    public async fetchBlockfrostApiKey() {
        if (!this.fetchApiPromise) {
            this.fetchApiPromise = fetch(`${this.baseUrl}/blockfrost/key`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                },
            });
        }
        if (!this.blockfrostApiKey) {
            const response = await this.fetchApiPromise
                .then(res => res.clone().json())
                .catch(error => {
                    throw new Error(`some error for fetchBlockfrostApiKey: ${error}`);
                });
            this.blockfrostApiKey = response.blockfrostApiKey;
        }
    }

    private checkBlockfrostKey(): boolean {
        return !!this.blockfrostApiKey ?? false;
    }

    public async getTxHashes(rewardAddress: string) {
        const result = await fetch(`${GERO_CARDANO_SERVER}/hashes/${rewardAddress}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        }).catch(error => {
            const errorMessage = error?.response?.data?.error?.response;
            throw new Error(`getTxHashes: , ${error}`);
        });

        return result.json().then((hashes: string[]) => {
            return hashes;
        });
    }

    public async getTotalBalance(rewardAddress: string): Promise<BalanceInfo> {
        const result = await fetch(`${GERO_CARDANO_SERVER}/addressInfo/${rewardAddress}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        }).catch(error => {
            return undefined;
        });

        return result.json().then((balanceInfo: BalanceInfo) => {
            return balanceInfo;
        });
    }

    public async getAddressInfo(rewardAddress: string): Promise<AddressInfo> {
        const result = await fetch(`${GERO_CARDANO_SERVER}/addressInfo/${rewardAddress}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        }).catch(error => {
            return undefined;
        });

        return result.json().then((addressInfo: AddressInfo) => {
            return addressInfo;
        });
    }
    
    public async getTotalAssets(rewardAddress: string): Promise<AssetsInfo[]> {
        const result = await fetch(`${GERO_CARDANO_SERVER}/assets/${rewardAddress}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        }).catch(error => {
            return undefined;
        });

        return result.json().then((assetsInfo: AssetsInfo[]) => {
            return assetsInfo;
        });
    }
}
