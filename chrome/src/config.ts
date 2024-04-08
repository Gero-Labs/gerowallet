declare let __ENVIRONMENT__: string;
import 'reflect-metadata';

interface Network {
    name: 'preview' | 'preprod' | 'mainnet';
    id: number;
    displayName?: string;
    magic: number;
}

export interface Config {
    logzioEnabled: boolean;
    enableConsoleLogs: boolean;
    baseUrl: string;
    blockFrostUrl: string;
    scanUrl: string;
    candanoShieldAPIKey: string;
    ipfsKey: string;
    addressUrl: string;
    network: Network;
    poolsUrl: string;
}

const configurations: { [key: string]: Config } = {
    dev: {
        logzioEnabled: false,
        enableConsoleLogs: true,
        baseUrl: 'https://backend.gerowallet.net',
        blockFrostUrl: 'https://cardano-mainnet.blockfrost.io/api/v0',
        candanoShieldAPIKey: 'eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJHZXJvV2FsbGV0IiwiaWF0IjoxNzA1MDc5MTY0fQ.vbknEUthW9BGC7OeP3IZrwEFj_VB842dhKEg46YQ3EwcKwryzdjZPLMsTZ7-eTyY0mTBMtcumdu5TgqcfYOXzg',
        scanUrl: 'https://api.cardanoshield.com',
        ipfsKey: 'ipfsKb795XUSn4kgjRxvuGTd4rjv8kRrxzM6',
        addressUrl: 'https://cardanoscan.io/address/',
        network: {
            name: 'mainnet',
            magic: 764824073,
            id: 1
        },
        poolsUrl: 'https://js.cexplorer.io/api-static/pool',
    },
    production: {
        logzioEnabled: true,
        enableConsoleLogs: false,
        baseUrl: 'https://backend.gerowallet.io',
        blockFrostUrl: 'https://cardano-mainnet.blockfrost.io/api/v0',
        candanoShieldAPIKey: 'eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJHZXJvV2FsbGV0IiwiaWF0IjoxNzA1MDc5MTY0fQ.vbknEUthW9BGC7OeP3IZrwEFj_VB842dhKEg46YQ3EwcKwryzdjZPLMsTZ7-eTyY0mTBMtcumdu5TgqcfYOXzg',
        scanUrl: 'https://api.cardanoshield.com',
        ipfsKey: 'ipfsKb795XUSn4kgjRxvuGTd4rjv8kRrxzM6',
        addressUrl: 'https://cardanoscan.io/address/',
        network: {
            name: 'mainnet',
            magic: 764824073,
            id: 1
        },
        poolsUrl: 'https://js.cexplorer.io/api-static/pool'
    },
    'preprod-dev': {
        logzioEnabled: false,
        enableConsoleLogs: true,
        baseUrl: 'https://preprod.gerowallet.net',
        blockFrostUrl: 'https://cardano-preprod.blockfrost.io/api/v0',
        candanoShieldAPIKey: 'eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJHZXJvV2FsbGV0IiwiaWF0IjoxNzA1MDc5MTY0fQ.vbknEUthW9BGC7OeP3IZrwEFj_VB842dhKEg46YQ3EwcKwryzdjZPLMsTZ7-eTyY0mTBMtcumdu5TgqcfYOXzg',
        scanUrl: 'https://api.cardanoshield.com',
        ipfsKey: 'ipfsKb795XUSn4kgjRxvuGTd4rjv8kRrxzM6',
        addressUrl: 'https://preprod.cexplorer.io/tx/',
        network: {
            name: 'preprod',
            id: 0,
            displayName: 'PreProd',
            magic: 1
        },
        poolsUrl: 'https://preprod-js.cexplorer.io/api-static/pool'
    },
    'preprod-prod': {
        logzioEnabled: false,
        enableConsoleLogs: true,
        baseUrl: 'https://preprod.gerowallet.net',
        blockFrostUrl: 'https://cardano-preprod.blockfrost.io/api/v0',
        candanoShieldAPIKey: 'eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJHZXJvV2FsbGV0IiwiaWF0IjoxNzA1MDc5MTY0fQ.vbknEUthW9BGC7OeP3IZrwEFj_VB842dhKEg46YQ3EwcKwryzdjZPLMsTZ7-eTyY0mTBMtcumdu5TgqcfYOXzg',
        scanUrl: 'https://api.cardanoshield.com',
        ipfsKey: 'ipfsKb795XUSn4kgjRxvuGTd4rjv8kRrxzM6',
        addressUrl: 'https://preprod.cexplorer.io/tx/',
        network: {
            name: 'preprod',
            id: 0,
            displayName: 'PreProd',
            magic: 1
        },
        poolsUrl: 'https://preprod-js.cexplorer.io/api-static/pool'
    },
    'preview-dev': {
        logzioEnabled: false,
        enableConsoleLogs: true,
        baseUrl: 'https://preview.gerowallet.net',
        blockFrostUrl: 'https://cardano-preview.blockfrost.io/api/v0',
        candanoShieldAPIKey: 'eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJHZXJvV2FsbGV0IiwiaWF0IjoxNzA1MDc5MTY0fQ.vbknEUthW9BGC7OeP3IZrwEFj_VB842dhKEg46YQ3EwcKwryzdjZPLMsTZ7-eTyY0mTBMtcumdu5TgqcfYOXzg',
        scanUrl: 'https://api.cardanoshield.com',
        ipfsKey: 'ipfsKb795XUSn4kgjRxvuGTd4rjv8kRrxzM6',
        addressUrl: 'https://preview.cexplorer.io/tx/',
        network: {
            name: 'preview',
            id: 0,
            displayName: 'Preview',
            magic: 2
        },
        poolsUrl: 'https://preview-js.cexplorer.io/api-static/pool'
    },
    'preview-prod': {
        logzioEnabled: false,
        enableConsoleLogs: true,
        baseUrl: 'https://preview.gerowallet.net',
        blockFrostUrl: 'https://cardano-preview.blockfrost.io/api/v0',
        candanoShieldAPIKey: 'eyJhbGciOiJIUzUxMiJ9.eyJzdWIiOiJHZXJvV2FsbGV0IiwiaWF0IjoxNzA1MDc5MTY0fQ.vbknEUthW9BGC7OeP3IZrwEFj_VB842dhKEg46YQ3EwcKwryzdjZPLMsTZ7-eTyY0mTBMtcumdu5TgqcfYOXzg',
        scanUrl: 'https://api.cardanoshield.com',
        ipfsKey: 'ipfsKb795XUSn4kgjRxvuGTd4rjv8kRrxzM6',
        addressUrl: 'https://preview.cexplorer.io/tx/',
        network: {
            name: 'preview',
            id: 0,
            displayName: 'Preview',
            magic: 2
        },
        poolsUrl: 'https://preview-js.cexplorer.io/api-static/pool'
    },
};

function getConfiguration(environment: string): Config {
    if (environment && configurations[environment]) {
        return configurations[environment];
    }
    return configurations.dev;
}

export let config: Config;
try {
    config = getConfiguration(__ENVIRONMENT__);
} catch {
    config = getConfiguration('dev');
}
