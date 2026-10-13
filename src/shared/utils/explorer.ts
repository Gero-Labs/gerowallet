import { bech32 } from 'bech32';
import { Blockchain, Network } from '@/models/types';
import { parseGovActionId } from '@/shared/utils/govActionId';
import { parseDRepId, toCip129 } from '@/shared/utils/drepId';

/**
 * Block-explorer deep links.
 *
 * Cardano wallets choose their explorer (per-wallet config row
 * EXPLORER_CONFIG_KEY, Settings → Profile). Every other chain has exactly one
 * explorer, so the choice only exists for Cardano.
 *
 * URL templates were checked against the live sites on 2026-10-09 with real
 * mainnet and testnet ids. When the chosen explorer has no page for an entity
 * (pool.pm has no transactions, AdaStat 404s on CIP-129 governance ids, ...)
 * the link falls back to DEFAULT_CARDANO_EXPLORER rather than disappearing.
 */

/**
 * What an explorer link points at. A UTxO has no page on any explorer: a 'tx' link
 * given `txHash#index` opens the transaction that created it.
 */
export type ExplorerEntity =
  | 'tx'
  | 'block'
  | 'epoch'
  | 'address'
  | 'stake'
  | 'pool'
  | 'asset'
  | 'policy'
  | 'drep'
  | 'govAction';

export type CardanoExplorerId = 'cexplorer' | 'cardanoscan' | 'adastat' | 'poolpm';

/** Per-wallet config row (wallet DB `config` table) holding the chosen explorer id. */
export const EXPLORER_CONFIG_KEY = 'explorer';

export const DEFAULT_CARDANO_EXPLORER: CardanoExplorerId = 'cexplorer';

export interface ExplorerOption {
  id: CardanoExplorerId;
  name: string;
  /** True when some entity types are missing and open in the default explorer instead. */
  partial: boolean;
}

type PathBuilder = (id: string) => string | null;

interface ExplorerDef {
  name: string;
  /** Origin per network; a missing network means the explorer does not cover it. */
  hosts: Partial<Record<string, string>>;
  paths: Partial<Record<ExplorerEntity, PathBuilder>>;
}

const seg = encodeURIComponent;

/** `pool1…` as is; a 56-hex pool key hash bech32-encoded. pool.pm and apexscan reject hex. */
function toPoolBech32(id: string): string | null {
  if (id.startsWith('pool1')) return id;
  if (!/^[0-9a-fA-F]{56}$/.test(id)) return null;
  const bytes = id.match(/../g)!.map(byte => parseInt(byte, 16));
  return bech32.encode('pool', bech32.toWords(bytes));
}

/** `{txHash}{index as one hex byte}`: the 66-hex form AdaStat and Cardanoscan accept. */
function govActionHex(id: string): string | null {
  const parsed = parseGovActionId(id);
  if (!parsed || parsed.index > 0xff) return null;
  return parsed.txHash + parsed.index.toString(16).padStart(2, '0');
}

/**
 * Any DRep id form (CIP-129, CIP-105, raw credential hex) as CIP-129 `drep1…`, the one
 * form every explorer accepts. Null for the two keyword DReps, which have no page.
 */
function drepCip129(id: string): string | null {
  const parsed = parseDRepId(id);
  if (!parsed || parsed.form === 'keyword') return null;
  return toCip129(parsed.credentialHex, parsed.credentialType);
}

function drepPath(prefix: string): PathBuilder {
  return (id) => {
    const drep = drepCip129(id);
    return drep ? `${prefix}${drep}` : null;
  };
}

function testnetHosts(domain: string): Partial<Record<string, string>> {
  return {
    [Network.MAINNET]: `https://${domain}`,
    [Network.PREPROD]: `https://preprod.${domain}`,
    [Network.PREVIEW]: `https://preview.${domain}`,
  };
}

const CARDANO_EXPLORERS: Record<CardanoExplorerId, ExplorerDef> = {
  cexplorer: {
    name: 'Cexplorer',
    hosts: testnetHosts('cexplorer.io'),
    paths: {
      tx: id => `/tx/${seg(id)}`,
      block: id => `/block/${seg(id)}`,
      epoch: id => `/epoch/${seg(id)}`,
      address: id => `/address/${seg(id)}`,
      stake: id => `/stake/${seg(id)}`,
      pool: id => `/pool/${seg(id)}`,
      asset: id => `/asset/${seg(id)}`,
      policy: id => `/policy/${seg(id)}`,
      drep: drepPath('/drep/'),
      govAction: (id) => {
        const parsed = parseGovActionId(id);
        return parsed ? `/gov/action/${parsed.txHash}%23${parsed.index}` : null;
      },
    },
  },
  cardanoscan: {
    name: 'Cardanoscan',
    hosts: testnetHosts('cardanoscan.io'),
    paths: {
      tx: id => `/transaction/${seg(id)}`,
      block: id => `/block/${seg(id)}`,
      epoch: id => `/epoch/${seg(id)}`,
      address: id => `/address/${seg(id)}`,
      stake: id => `/stakeKey/${seg(id)}`,
      pool: id => `/pool/${seg(id)}`,
      asset: id => `/token/${seg(id)}`,
      policy: id => `/tokenPolicy/${seg(id)}`,
      drep: drepPath('/drep/'),
      govAction: (id) => {
        const hex = govActionHex(id);
        return hex ? `/govAction/${hex}` : null;
      },
    },
  },
  adastat: {
    name: 'AdaStat',
    hosts: testnetHosts('adastat.net'),
    paths: {
      tx: id => `/transactions/${seg(id)}`,
      block: id => `/blocks/${seg(id)}`,
      epoch: id => `/epochs/${seg(id)}`,
      address: id => `/addresses/${seg(id)}`,
      stake: id => `/accounts/${seg(id)}`,
      pool: id => `/pools/${seg(id)}`,
      asset: id => `/tokens/${seg(id)}`,
      policy: id => `/policies/${seg(id)}`,
      drep: drepPath('/dreps/'),
      // CIP-129 gov_action1… 404s on AdaStat mainnet; the 66-hex form works everywhere.
      govAction: (id) => {
        const hex = govActionHex(id);
        return hex ? `/governances/${hex}` : null;
      },
    },
  },
  poolpm: {
    name: 'Pool.pm',
    hosts: testnetHosts('pool.pm'),
    // A wallet/token/pool viewer: no transaction, block, epoch or governance pages.
    paths: {
      address: id => `/${seg(id)}`,
      stake: id => `/${seg(id)}`,
      pool: (id) => {
        const pool = toPoolBech32(id);
        return pool ? `/${pool}` : null;
      },
      asset: id => (id.startsWith('asset1') ? `/${seg(id)}` : null),
      policy: id => `/policy/${seg(id)}`,
    },
  },
};

const ALL_ENTITIES: ExplorerEntity[] = [
  'tx', 'block', 'epoch', 'address', 'stake', 'pool', 'asset', 'policy', 'drep', 'govAction',
];

/** Apex Prime and Vector are separate apexscan hosts; both chains are mainnet-only. */
const APEX_PATHS: Partial<Record<ExplorerEntity, PathBuilder>> = {
  tx: id => `/en/transaction/${seg(id)}`,
  block: id => `/en/block/${seg(id)}`,
  epoch: id => `/en/epoch/${seg(id)}`,
  address: id => `/en/address/${seg(id)}`,
  stake: id => `/en/stake-address/${seg(id)}`,
  pool: (id) => {
    const pool = toPoolBech32(id);
    return pool ? `/en/pool/${pool}` : null;
  },
  asset: id => `/en/token/${seg(id)}`,
  policy: id => `/en/policy/${seg(id)}`,
};

const APEX_HOSTS: Record<string, string> = {
  [Blockchain.APEX_PRIME]: 'https://apexscan.org',
  [Blockchain.APEX_VECTOR]: 'https://vector.apexscan.org',
};

function isCardanoExplorerId(value: unknown): value is CardanoExplorerId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CARDANO_EXPLORERS, value);
}

/** Preprod and Preview keep their own hosts; anything else (incl. unknown) is mainnet, as before. */
function cardanoNetwork(network: string | null | undefined): string {
  return network === Network.PREPROD || network === Network.PREVIEW ? network : Network.MAINNET;
}

function cardanoUrl(
  explorerId: CardanoExplorerId,
  network: string,
  type: ExplorerEntity,
  id: string,
): string | null {
  const explorer = CARDANO_EXPLORERS[explorerId];
  const host = explorer.hosts[network];
  const path = explorer.paths[type]?.(id);
  return host && path ? host + path : null;
}

/** Explorers a wallet on this chain and network can choose from. Empty when there is no choice. */
export function explorersFor(chain: string, network: string | null | undefined): ExplorerOption[] {
  if (chain !== Blockchain.CARDANO) return [];
  const net = cardanoNetwork(network);
  return (Object.keys(CARDANO_EXPLORERS) as CardanoExplorerId[])
    .filter(id => !!CARDANO_EXPLORERS[id].hosts[net])
    .map(id => ({
      id,
      name: CARDANO_EXPLORERS[id].name,
      partial: ALL_ENTITIES.some(type => !CARDANO_EXPLORERS[id].paths[type]),
    }));
}

/** The saved choice when it is valid for this chain and network, else the default. */
export function resolveExplorerId(
  chain: string,
  network: string | null | undefined,
  saved: unknown,
): CardanoExplorerId {
  const valid = explorersFor(chain, network).some(option => option.id === saved);
  return valid && isCardanoExplorerId(saved) ? saved : DEFAULT_CARDANO_EXPLORER;
}

/**
 * Deep link to `id` on the chain's explorer, or '' when there is none.
 * `explorerId` only applies to Cardano; an unknown or unsupported one is ignored.
 */
export function getExplorerUrl(
  chain: string,
  id: string,
  type: ExplorerEntity,
  network: string = Network.MAINNET,
  explorerId?: string | null,
): string {
  if (!id) return '';
  // A UTxO reference opens its transaction (no explorer has a UTxO page).
  if (type === 'tx') id = id.split('#')[0];
  switch (chain) {
    case Blockchain.CARDANO: {
      const net = cardanoNetwork(network);
      const chosen = resolveExplorerId(chain, net, explorerId);
      return cardanoUrl(chosen, net, type, id)
        ?? cardanoUrl(DEFAULT_CARDANO_EXPLORER, net, type, id)
        ?? '';
    }
    case Blockchain.APEX_PRIME:
    case Blockchain.APEX_VECTOR: {
      const path = APEX_PATHS[type]?.(id);
      return path ? APEX_HOSTS[chain] + path : '';
    }
    case Blockchain.BITCOIN:
      if (type === 'tx') return `https://mempool.space/tx/${seg(id)}`;
      if (type === 'block') return `https://mempool.space/block/${seg(id)}`;
      return '';
    default:
      return '';
  }
}
