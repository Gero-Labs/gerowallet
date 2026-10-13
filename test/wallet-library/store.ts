import { reactive } from 'vue';
import { wallets } from './fixtures';
export const geroStore = reactive({ wallets: Object.fromEntries(wallets.map(wallet => [wallet.id, wallet])) });
