import Vue from 'vue';
import { wallets } from './fixtures';
export const geroStore = Vue.observable({ wallets: Object.fromEntries(wallets.map(wallet => [wallet.id, wallet])) });
