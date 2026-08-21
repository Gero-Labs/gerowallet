/**
 * RealFi read client — the single boundary between this module and the partner SDK.
 *
 * WHY A BOUNDARY AT ALL
 * `@realfi-co/realfi-partner-sdk` is published privately to the GitHub Packages
 * registry and needs a classic PAT with `read:packages` to install. CI and most
 * developer machines will not have that token, and a build that hard-imports the
 * package fails outright without it. So the SDK is loaded lazily, by a specifier the
 * compiler and the bundler cannot resolve statically, and every consumer of this
 * module talks to OUR interface instead of the SDK's surface.
 *
 * The practical effect: the whole Earn surface — flag, routing, composable, UI, i18n —
 * compiles, lints and ships today, and starts serving real data the moment the package
 * is installed. Nothing here fabricates data when it is absent; the UI is told why it
 * is empty and says so.
 *
 * SCOPE
 * Read-only. Every call below comes from `RealfiSDK.api`, which the SDK changelog
 * states needs "No Blaze instance required" — so this phase needs no Cardano provider,
 * no WASM and no signing. Order building is deliberately absent; it belongs behind a
 * Nexus endpoint (see docs/realfi-earn-ios-plan.md for why).
 */

import {
  EMPTY_POINTS,
  type RealFiOrder,
  type RealFiOrderAction,
  type RealFiOrderStatus,
  type RealFiPoints,
  type RealFiPosition,
  type RealFiProtocol,
  type RealFiReferrals,
  type RealFiUnavailableReason,
  type SmallestUnit,
} from '../types';

/** The network names the SDK's `detectParams` / `api.forNetwork` accept. */
type SdkNetwork = 'mainnet' | 'preprod' | 'preview';

/**
 * Map a Gero `Network` value to the SDK's network preset.
 *
 * Returns null for anything RealFi has no deployment on. This is a *format* mapping
 * only — whether a wallet may reach RealFi at all is decided by
 * `networks.resolveRealFiSupport`, which today allows Cardano preprod alone.
 */
export function toSdkNetwork(network: string): SdkNetwork | null {
  switch (network) {
    case 'Mainnet':
      return 'mainnet';
    case 'Preprod':
      return 'preprod';
    case 'Preview':
      return 'preview';
    default:
      return null;
  }
}

export interface RealFiReadClient {
  getPosition(address: string): Promise<RealFiPosition | null>;
  getPoints(address: string): Promise<RealFiPoints>;
  getReferrals(address: string): Promise<RealFiReferrals>;
  getOrders(address: string): Promise<RealFiOrder[]>;
  getProtocol(): Promise<RealFiProtocol | null>;
}

/**
 * Discriminated on a STRING, not a boolean.
 *
 * This project compiles with `strictNullChecks: false`, under which TypeScript does
 * not narrow a `{ ok: true } | { ok: false }` union reliably — the accessor on the
 * narrowed branch fails to resolve. A string tag narrows correctly regardless, and
 * reads better at the call site.
 */
export type RealFiClientResult =
  | { status: 'ok'; client: RealFiReadClient }
  | { status: 'unavailable'; reason: RealFiUnavailableReason };

/* ── SDK loading ──────────────────────────────────────────────────────────── */

/**
 * Held in a variable, never inlined at the import site.
 *
 * A literal specifier would make TypeScript resolve the module at compile time
 * (TS2307 when it is absent) and make Vite try to bundle it. Through a variable, plus
 * `@vite-ignore`, both defer to runtime — exactly what an optional private dependency
 * needs.
 */
const SDK_SPECIFIER = '@realfi-co/realfi-partner-sdk';

type UnknownRecord = Record<string, unknown>;

/** Cached module namespace, or `null` once we know it is absent. */
let sdkModule: UnknownRecord | null | undefined;

async function loadPartnerSdk(): Promise<UnknownRecord | null> {
  if (sdkModule !== undefined) return sdkModule;
  try {
    sdkModule = (await import(/* @vite-ignore */ SDK_SPECIFIER)) as UnknownRecord;
  } catch {
    // Not installed in this build. Not worth logging per call — the caller turns this
    // into a user-visible "unavailable" state exactly once.
    sdkModule = null;
  }
  return sdkModule;
}

/** Test seam: lets specs inject a fake SDK namespace, and reset between cases. */
export function __setPartnerSdkForTests(module: UnknownRecord | null | undefined): void {
  sdkModule = module;
}

/* ── Defensive reading ────────────────────────────────────────────────────────
 * The SDK's docs name these fields but do not pin their runtime types, and the package
 * is not installed here to check against. Rather than guess one representation and
 * silently render NaN or "[object Object]" where a balance belongs, every value is read
 * through helpers that handle the plausible shapes and fall back to something neutral.
 *
 * VERIFY THESE against the real SDK on preprod before the flag is enabled for anyone
 * but us — that is the first task once npm access lands.
 * ────────────────────────────────────────────────────────────────────────────── */

/**
 * Read a key off an untyped record.
 *
 * `noPropertyAccessFromIndexSignature` is on, so index-signature values must be read
 * with brackets. Funnelling that through one helper keeps the mapping code readable
 * and makes the null-tolerance uniform.
 */
function get(record: UnknownRecord | null, key: string): unknown {
  return record ? record[key] : undefined;
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

function toSmallestUnit(value: unknown): SmallestUnit {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' && value.trim() !== '') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value).toString();
  return '0';
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = toNumberOrNull(value);
  return parsed === null ? fallback : parsed;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** First non-null of several candidate keys — the SDK's wrapper shapes vary. */
function firstNumber(record: UnknownRecord | null, keys: string[]): number {
  for (const key of keys) {
    const parsed = toNumberOrNull(get(record, key));
    if (parsed !== null) return parsed;
  }
  return 0;
}

const ORDER_STATUSES: readonly string[] = [
  'Open',
  'Validating',
  'Executed',
  'Canceled',
  'Invalidated',
  'InvalidMinReceived',
];

const ORDER_ACTIONS: readonly string[] = [
  'Mint',
  'Redeem',
  'Stake',
  'Unstake',
  'Deposit',
  'Withdraw',
];

/**
 * Narrow an unrecognised status to `Validating` rather than dropping the order.
 *
 * If RealFi adds a status we do not know, the safe render is "still working": it keeps
 * the order visible and makes no claim about the funds. Dropping it would tell the user
 * their order vanished, which is the one thing that must never happen here.
 */
function toOrderStatus(value: unknown): RealFiOrderStatus {
  return ORDER_STATUSES.includes(value as string)
    ? (value as RealFiOrderStatus)
    : 'Validating';
}

function toOrderAction(value: unknown): RealFiOrderAction {
  return ORDER_ACTIONS.includes(value as string) ? (value as RealFiOrderAction) : 'Stake';
}

/* ── The SDK-backed implementation ───────────────────────────────────────────── */

function createSdkReadClient(api: UnknownRecord): RealFiReadClient {
  /** Call an SDK API method by name, tolerating one this SDK version lacks. */
  async function call(method: string, ...args: unknown[]): Promise<unknown> {
    const fn = get(api, method);
    if (typeof fn !== 'function') return null;
    return await (fn as (...a: unknown[]) => Promise<unknown>).apply(api, args);
  }

  return {
    async getPosition(address) {
      const raw = asRecord(await call('getYieldBreakdown', address));
      if (!raw) return null;
      return {
        totalSUSDr: toSmallestUnit(get(raw, 'totalSUSDr')),
        totalUSDrValue: toSmallestUnit(get(raw, 'totalUSDrValue')),
        principal: toSmallestUnit(get(raw, 'principal')),
        // `yield` is the SDK's field name and a reserved word here, so it is read by
        // key and surfaced as `earned`.
        earned: toSmallestUnit(get(raw, 'yield')),
        yieldPercent: toNumber(get(raw, 'yieldPercent')),
      };
    },

    async getPoints(address) {
      const raw = asRecord(await call('getPointsBalance', address));
      if (!raw) return EMPTY_POINTS;
      // Nulls are meaningful: they mean "no points record yet", which is NOT zero.
      return {
        pointsBalance: toNumberOrNull(get(raw, 'pointsBalance')),
        potentialPoints: toNumberOrNull(get(raw, 'potentialPoints')),
        multiplier: toNumberOrNull(get(raw, 'multiplier')),
      };
    },

    async getReferrals(address) {
      const [codeRaw, rewardsRaw, invitedRaw] = await Promise.all([
        call('getReferrerCode', address),
        call('getReferralRewards', address),
        call('getInvitedCount', address),
      ]);

      const code = asRecord(codeRaw);
      // Counts may arrive bare or wrapped in an object; accept either.
      const rewardsRecord = asRecord(rewardsRaw);
      const invitedRecord = asRecord(invitedRaw);

      return {
        code: toStringOrNull(get(code, 'code')),
        createdAt: toStringOrNull(get(code, 'createdAt')),
        invitedCount: invitedRecord
          ? firstNumber(invitedRecord, ['count', 'invited'])
          : toNumber(invitedRaw),
        rewardPoints: rewardsRecord
          ? firstNumber(rewardsRecord, ['points', 'rewards', 'total'])
          : toNumber(rewardsRaw),
      };
    },

    async getOrders(address) {
      const raw = await call('getOrdersByOwner', address);
      if (!Array.isArray(raw)) return [];
      return raw.map((entry) => {
        const order = asRecord(entry);
        const utxo = asRecord(get(order, 'utxo'));
        const claimTxHash = toStringOrNull(get(order, 'claimTxHash'));
        const result: RealFiOrder = {
          // The order's own tx hash; fall back to its UTxO's when absent.
          txHash: toStringOrNull(get(order, 'txHash')) ?? toStringOrNull(get(utxo, 'txHash')) ?? '',
          action: toOrderAction(get(order, 'action')),
          status: toOrderStatus(get(order, 'status')),
        };
        if (claimTxHash) result.claimTxHash = claimTxHash;
        return result;
      });
    },

    async getProtocol() {
      const [feesRaw, configRaw] = await Promise.all([
        call('getOrderFees'),
        call('getPartnerConfig'),
      ]);
      const fees = asRecord(feesRaw);
      const config = asRecord(configRaw);
      if (!fees && !config) return null;

      const limits = asRecord(get(config, 'limits'));
      return {
        // Circulating supply needs the on-chain SDK (treasury + vault datums), which
        // needs Blaze and a provider. Out of scope for the read-only phase.
        circulatingUsdr: null,
        circulatingSusdr: null,
        usdrPerSusdr: await resolveExchangeRate(call),
        reserveAssetCount: 0,
        fees: {
          mintBps: toNumber(get(fees, 'mintBps')),
          redeemBps: toNumber(get(fees, 'redeemBps')),
        },
        limits: {
          mintMinUsd: toNumber(get(limits, 'mintMinUsd')),
          redeemMinUsd: toNumber(get(limits, 'redeemMinUsd')),
        },
      };
    },
  };
}

/**
 * Current sUSDr → USDr rate, diffusion-aware where the deployed protocol supports it.
 *
 * On the V1_1 line, deposited yield releases into the rate linearly across a window
 * rather than landing at once, so a naive vault-balance division overstates it while a
 * window is open. The SDK exposes both the inputs and the same maths its validators
 * apply; we use them, and fall back to 0 — rendered as "unavailable", never as a
 * plausible-looking wrong number — if either is missing.
 */
async function resolveExchangeRate(
  call: (method: string, ...args: unknown[]) => Promise<unknown>,
): Promise<number> {
  const inputs = await call('getSusdrExchangeRateInputs');
  if (!inputs) return 0;

  const sdk = await loadPartnerSdk();
  const calculate = get(sdk, 'calculateSusdrExchangeRate');
  const precision = get(sdk, 'SUSDR_EXCHANGE_RATE_PRECISION');
  if (typeof calculate !== 'function' || precision === undefined) return 0;

  try {
    const rate = (calculate as (i: unknown, at: bigint) => unknown)(inputs, BigInt(Date.now()));
    const scaled = toNumberOrNull(rate);
    const scale = toNumberOrNull(precision);
    if (scaled === null || !scale) return 0;
    return scaled / scale;
  } catch {
    return 0;
  }
}

/* ── Entry point ──────────────────────────────────────────────────────────── */

/**
 * Resolve a read client for a wallet's network, or the reason there isn't one.
 *
 * Callers should surface `reason` rather than collapsing it to "something went wrong":
 * a user with funds staked needs to know whether RealFi is unreachable or simply not
 * offered on their network.
 */
export async function resolveRealFiReadClient(network: string): Promise<RealFiClientResult> {
  const sdkNetwork = toSdkNetwork(network);
  if (!sdkNetwork) return { status: 'unavailable', reason: 'unsupported-network' };

  const sdk = await loadPartnerSdk();
  if (!sdk) return { status: 'unavailable', reason: 'sdk-missing' };

  const apiFactory = asRecord(get(asRecord(get(sdk, 'RealfiSDK')), 'api'));
  const forNetwork = get(apiFactory, 'forNetwork');
  if (typeof forNetwork !== 'function') {
    return { status: 'unavailable', reason: 'sdk-missing' };
  }

  try {
    const api = asRecord((forNetwork as (n: string) => unknown).call(apiFactory, sdkNetwork));
    if (!api) return { status: 'unavailable', reason: 'request-failed' };
    return { status: 'ok', client: createSdkReadClient(api) };
  } catch {
    return { status: 'unavailable', reason: 'request-failed' };
  }
}
