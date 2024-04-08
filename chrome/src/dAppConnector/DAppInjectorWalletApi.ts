import { WalletApi } from './injectedWallet';
import { MessagingEvent, MessagingTarget, sendContentPageMessage } from './messaging';
import { Bytes, Paginate } from './types';
export class DAppInjectorWalletApi implements WalletApi {

    public events = [];

    public getBalance = (): Promise<string> => {
        return new Promise<string>(async (getBalance, reject) => {
            try {
                const message = { title: 'dapp-get-balance' };
                const response = await sendContentPageMessage<any>(message);
                getBalance(response.balance);
            } catch (e) {
                reject(e);
            }
        });
    }

    public getChangeAddress = (): Promise<string> => {
        return new Promise<string>(async (changeAddress, reject) => {
            try {
                const message = { title: 'dapp-get-change-address' };
                const response = await sendContentPageMessage<any>(message);
                changeAddress(response.changeAddress);
            } catch (e) {
                reject(e);
            }
        });
    }

    public getRewardAddresses = (): Promise<string[]> => {
        return new Promise<string[]>(async (reward, reject) => {
            try {
                const message = { title: 'dapp-get-info' };
                const response = await sendContentPageMessage<any>(message);
                reward([response.rewardAddress]);
            } catch (e) {
                reject(e);
            }
        });
    }

    public getUnusedAddresses = (): Promise<string[]> => {
        return new Promise<string[]>(async (resolve, reject) => {
            try {
                const message = { title: 'dapp-get-info' };
                const response = await sendContentPageMessage<any>(message);
                resolve(response.unusedAddresses);
            } catch (e) {
                reject(e);
            }
        });
    }

    public getUsedAddresses = (paginate: Paginate | undefined): Promise<string[]> => {
        return new Promise<string[]>(async (resolve, reject) => {
            try {
                const message = { title: 'dapp-get-info' };
                const response = await sendContentPageMessage<any>(message);
                resolve(response.usedAddresses);
            } catch (e) {
                reject(e);
            }
        });
    }

    public getUtxos = (amount: string | undefined, paginate: Paginate | undefined): Promise<string[] | undefined> => {

        return new Promise<string[] | undefined>(async (getUtxos, reject) => {
            try {
                const message = { title: 'dapp-get-utxos', amount, paginate };
                const response = await sendContentPageMessage<any>(message);

                delete response.target;
                delete response.sender;
                delete response.id;
                getUtxos(Object.values(response));
            } catch (e) {
                reject(e);
            }
        });
    }

    public experimental = {
        on: (eventName: string, callback) => {
            this.registerEvent(eventName, callback);
        },
        off: (eventName: string, callback) => {
            this.unregisterEvent(eventName, callback);
        },
        getCollateral: () => {
            return new Promise<string[]>(async (getCollateral, reject) => {
                try {
                    const message = { title: 'dApp-get-collateral'};
                    const response = await sendContentPageMessage<any>(message);
                    const result = response.result.toString() === '' ? [] : [response.result.toString()] ;
    
                    getCollateral(result);
                } catch (e) {}
            });
        }
    }

    public signData = (address: string, sigStructure: string): Promise<Bytes> => {
        return new Promise<Bytes>(async (resolve, reject) => {
            try {
                const message = { title: 'dapp-sign-data', address, sigStructure };
                const response = await sendContentPageMessage<any>(message);
                resolve(response);
            } catch (e) {
                reject(e);
            }
        });
    }

    public signTx = (tx: string, partialSign: boolean): Promise<string> => {
        return new Promise<string>(async (signTx, reject) => {
            try {
                const message = { title: 'dapp-sign-tx', tx };
                const response = await sendContentPageMessage<any>(message);
                signTx(response.witnesses);
            } catch (e) {
                reject(e);
            }
        });
    }

    public submitTx = (tx: string): Promise<string> => {
        return new Promise<string>(async (submitTx, reject) => {
            try {
                const message = { title: 'dapp-submit-tx', tx };
                const response = await sendContentPageMessage<any>(message);
                submitTx(response.result.toString());
            } catch (e) {
                reject(e);
            }
        });
    }

    public onAccountChange = (callback) => {
        this.registerEvent(MessagingEvent.accountChange, callback);
    };

    public onNetworkChange = () => {
        // network change not supported on gero
    };

    public getCollateral = () => {
        return new Promise<string[]>(async (getCollateral, reject) => {
            try {
                const message = { title: 'dApp-get-collateral'};
                const response = await sendContentPageMessage<any>(message);
                const result = response.result.toString() === '' ? [] : [response.result.toString()] ;

                getCollateral(result);
            } catch (e) {}
        });
    };

    public getNetworkId = () => {
        return new Promise<number>(async (getNetwork, reject) => {
            try {
                const message = { title: 'dapp-get-network'};
                const response = await sendContentPageMessage<any>(message);
                getNetwork(response.network);
            } catch (e) {
                reject(e)
            }
        });
    }

    public registerEvent = (eventName, callback) => {
        const handler = (event: CustomEvent) => callback(event.detail);
        const events = this.events[eventName] || [];
      
        this.events[eventName] = [...events, [callback, handler]];
        window.addEventListener(`${MessagingTarget.gero}${eventName}`, handler);
    };

    public unregisterEvent = (eventName, callback) => {
        const filterHandlersBy = (predicate) => (handlers) =>
          handlers.filter(([savedCallback]) => predicate(savedCallback));
      
        const filterByMatchingHandlers = filterHandlersBy((cb) => cb === callback || cb.toString() === callback.toString());
        const filterByNonMatchingHandlers = filterHandlersBy((cb) => cb !== callback && cb.toString() !== callback.toString());

        const eventHandlers = this.events[eventName];
      
        if (typeof eventHandlers !== 'undefined') {
          const matchingHandlers = filterByMatchingHandlers(eventHandlers);
          for (const [, handler] of matchingHandlers) {
            window.removeEventListener(`${MessagingTarget.gero}${eventName}`, handler);
          }
         this.events[eventName] =
            filterByNonMatchingHandlers(eventHandlers);
        }
    };

}
