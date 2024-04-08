import { InjectedWallet } from './injectedWallet';

export type WindowExtended = Window & { cardano?: { [k: string]: any} };

export const injectWindow = (window: WindowExtended, wallet: InjectedWallet): void => {
    if (!window.cardano) {
        window.cardano = {};
    }
    window.cardano[wallet.name.toLowerCase()] = window.cardano[wallet.name.toLowerCase()] || wallet.getPublicApi();
};
