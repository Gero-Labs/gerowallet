import { config } from './config';

export const GERO_CARDANO_SERVER = config.baseUrl;

/**
 * based off what the cardano-wallet.js team found worked empirically
 * note: slots are 1 second in Shelley mainnet, so this is 4hrs
 */
export const DEFAULT_TTL = 14400;

export const COLLATERAL_AMOUNT = '5000000';
