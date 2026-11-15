/**
 * Midnight DApp Connector test dApp (dapp-connector-api 4.1, ledger 9).
 *
 * Exercises every method of a wallet's ConnectedAPI the way a dApp would,
 * and logs each call with its duration, its result, and, for a rejection,
 * whether the error has the spec's shape (`Error` with `type`
 * `DAppConnectorAPIError`, a known `code` and a `reason`). Run it with
 * `npm run midnight:connector-dapp` and open it in a Chrome that has the
 * wallet installed; content scripts do not run on `file://`.
 */
import type {
  ConnectedAPI,
  DesiredInput,
  DesiredOutput,
  InitialAPI,
  KeyMaterialProvider,
  ProvingProvider,
  WalletConnectedAPI,
} from '@midnightntwrk/dapp-connector-api';
import {
  NIGHT,
  USDM_MAINNET,
  asLedgerProvider,
  buildDappTransfer,
  decodeTransaction,
  fromHex,
  tokenLabel,
  verifySignedData,
} from './ledger';

const SPEC_ERROR_CODES = ['InternalError', 'Rejected', 'InvalidRequest', 'PermissionRejected', 'Disconnected', 'InsufficientFunds'];
/** Some dApps give up on a wallet call after this long (1AM's Dominion does). */
const SLOW_CALL_MS = 60_000;
const ALL_METHODS: Array<keyof WalletConnectedAPI> = [
  'getShieldedBalances', 'getUnshieldedBalances', 'getDustBalance', 'getShieldedAddresses', 'getUnshieldedAddress',
  'getDustAddress', 'getTxHistory', 'balanceUnsealedTransaction', 'balanceSealedTransaction', 'makeTransfer',
  'makeIntent', 'signData', 'submitTransaction', 'getProvingProvider', 'getConfiguration', 'getConnectionStatus',
];

const state: {
  wallets: Array<[string, InitialAPI]>;
  selected: string | null;
  api: ConnectedAPI | null;
  network: string;
  ownAddress: string;
  provider: ProvingProvider | null;
} = { wallets: [], selected: null, api: null, network: 'preprod', ownAddress: '', provider: null };

const logEntries: Array<Record<string, unknown>> = [];

/** A problem with this page's own inputs or order of steps, never the wallet's answer. */
class PageError extends Error {}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`#${id} missing`);
  return found as T;
}

function value(id: string): string {
  return el<HTMLInputElement>(id).value.trim();
}

function checked(id: string): boolean {
  return el<HTMLInputElement>(id).checked;
}

/** JSON with bigints as strings and byte arrays as hex, for display. */
function show(data: unknown): string {
  return JSON.stringify(data, (_key, v: unknown) => {
    if (typeof v === 'bigint') return v.toString();
    if (v instanceof Uint8Array) return `0x${[...v].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    return v;
  }, 2);
}

function out(id: string, data: unknown): void {
  el(id).textContent = typeof data === 'string' ? data : show(data);
}

/** What a rejection looks like, checked against the spec's APIError. */
function errorShape(error: unknown): Record<string, unknown> {
  const fields = (typeof error === 'object' && error !== null ? error : {}) as Record<string, unknown>;
  const isError = error instanceof Error;
  const specShape = isError && fields['type'] === 'DAppConnectorAPIError'
    && typeof fields['code'] === 'string' && SPEC_ERROR_CODES.includes(fields['code'])
    && typeof fields['reason'] === 'string';
  return {
    specShape,
    instanceofError: isError,
    type: fields['type'],
    code: fields['code'],
    reason: fields['reason'],
    message: isError ? error.message : fields['message'],
    asString: String(error),
  };
}

/** Run one wallet call: time it, log it, and keep a live timer while it is pending. */
async function call<T>(method: string, args: unknown, run: () => Promise<T>): Promise<T> {
  const li = document.createElement('li');
  li.className = 'pending';
  const head = document.createElement('div');
  head.className = 'head';
  const name = document.createElement('span');
  name.textContent = method;
  const time = document.createElement('span');
  time.className = 'time';
  head.append(name, time);
  const body = document.createElement('pre');
  if (args !== undefined) body.textContent = `args ${show(args)}`;
  li.append(head, body);
  el('log').prepend(li);

  const started = performance.now();
  const tick = setInterval(() => {
    const ms = performance.now() - started;
    time.textContent = `${(ms / 1000).toFixed(0)} s…`;
    if (ms > SLOW_CALL_MS) li.classList.add('slow');
  }, 1000);
  const entry: Record<string, unknown> = { method, args, at: new Date().toISOString() };
  logEntries.push(entry);
  try {
    const result = await run();
    const ms = Math.round(performance.now() - started);
    Object.assign(entry, { ms, ok: true, result });
    li.className = ms > SLOW_CALL_MS ? 'ok slow' : 'ok';
    time.textContent = `${ms} ms`;
    body.textContent = [body.textContent, `result ${show(result)}`].filter(Boolean).join('\n');
    return result;
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    const shape = errorShape(error);
    Object.assign(entry, { ms, ok: false, error: shape });
    li.className = ms > SLOW_CALL_MS ? 'err slow' : 'err';
    time.textContent = `${ms} ms`;
    const badge = document.createElement('span');
    badge.className = shape['specShape'] ? 'badge ok' : 'badge err';
    badge.textContent = shape['specShape'] ? 'spec error' : 'not a spec error';
    name.append(badge);
    body.textContent = [body.textContent, `error ${show(shape)}`].filter(Boolean).join('\n');
    throw error;
  } finally {
    clearInterval(tick);
  }
}

/** Buttons run this so a thrown error lands in the step's output, not the console. */
function action(buttonId: string, outId: string, run: () => Promise<unknown>): void {
  el<HTMLButtonElement>(buttonId).addEventListener('click', () => {
    void (async () => {
      try {
        const result = await run();
        if (result !== undefined) out(outId, result);
      } catch (error) {
        out(outId, describeFailure(error));
      }
    })();
  });
}

/** A page problem as plain text; anything else as the wallet's error, checked against the spec. */
function describeFailure(error: unknown): unknown {
  return error instanceof PageError ? `Page: ${error.message}` : { error: errorShape(error) };
}

function requireApi(): ConnectedAPI {
  if (!state.api) throw new PageError('Connect a wallet first (step 2)');
  return state.api;
}

// ── tokens and amounts ───────────────────────────────────────────────────────

function fillTokenSelects(): void {
  for (const select of document.querySelectorAll<HTMLSelectElement>('select[data-token]')) {
    select.replaceChildren();
    for (const [label, raw] of [['NIGHT', NIGHT], ['USDM (mainnet colour)', USDM_MAINNET], ['Custom', 'custom']]) {
      const option = document.createElement('option');
      option.value = raw;
      option.textContent = label;
      select.append(option);
    }
    const custom = document.getElementById(`${select.id}-custom`)?.closest('label');
    const sync = (): void => { if (custom) custom.hidden = select.value !== 'custom'; };
    select.addEventListener('change', sync);
    sync();
  }
}

function tokenOf(selectId: string): string {
  const selected = value(selectId);
  if (selected !== 'custom') return selected;
  const raw = value(`${selectId}-custom`).replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(raw)) throw new PageError('A custom token colour is 64 hex characters');
  return raw;
}

/** NIGHT and USDM have 6 decimals; a custom token's amount is in raw units. */
function amountOf(amountId: string, token: string): bigint {
  const text = value(amountId);
  const decimals = token === NIGHT || token === USDM_MAINNET ? 6 : 0;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[2] ?? '').length > decimals) throw new PageError(`Amount "${text}" is not a number with at most ${decimals} decimals`);
  return BigInt(match[1] + (match[2] ?? '').padEnd(decimals, '0'));
}

async function recipientOf(inputId: string): Promise<string> {
  const typed = value(inputId);
  if (typed) return typed;
  if (!state.ownAddress) {
    const api = requireApi();
    const { unshieldedAddress } = await call('getUnshieldedAddress', undefined, () => api.getUnshieldedAddress());
    state.ownAddress = unshieldedAddress;
  }
  return state.ownAddress;
}

function decodeOrNote(hex: string): unknown {
  try {
    return decodeTransaction(state.network, hex);
  } catch (error) {
    return `Could not decode: ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ── 1. discovery ─────────────────────────────────────────────────────────────

function safeIcon(icon: string): string | null {
  return /^data:image\//.test(icon) || /^https:\/\//.test(icon) ? icon : null;
}

function scanWallets(): void {
  state.wallets = Object.entries(globalThis.midnight ?? {}).filter(([, w]) => typeof w?.connect === 'function');
  const list = el('wallets');
  list.replaceChildren();
  if (state.wallets.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No wallet on window.midnight. Is the extension installed, unlocked, and allowed on this site?';
    list.append(p);
    return;
  }
  if (!state.selected || !state.wallets.some(([key]) => key === state.selected)) state.selected = state.wallets[0][0];
  for (const [key, wallet] of state.wallets) {
    const row = document.createElement('label');
    row.className = 'wallet';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'wallet';
    radio.checked = key === state.selected;
    radio.addEventListener('change', () => { state.selected = key; });
    row.append(radio);
    const icon = safeIcon(String(wallet.icon ?? ''));
    if (icon) {
      const img = document.createElement('img');
      img.src = icon;
      img.alt = '';
      row.append(img);
    }
    const text = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = String(wallet.name ?? '(no name)');
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `rdns ${String(wallet.rdns)} · apiVersion ${String(wallet.apiVersion)} · key ${key}`;
    text.append(title, meta);
    row.append(text);
    list.append(row);
  }
}

// ── 2. connect ───────────────────────────────────────────────────────────────

async function connect(): Promise<unknown> {
  const wallet = state.wallets.find(([key]) => key === state.selected)?.[1];
  if (!wallet) throw new PageError('No wallet selected (step 1)');
  const network = value('network');
  // Keep connect() inside the click: some wallets need the user gesture to open their prompt.
  const api = await call('connect', network, () => wallet.connect(network));
  state.api = api;
  state.network = network;
  state.ownAddress = '';
  state.provider = null;
  el<HTMLButtonElement>('pp-check').disabled = true;
  const status = await call('getConnectionStatus', undefined, () => api.getConnectionStatus());
  const configuration = await call('getConfiguration', undefined, () => api.getConfiguration());
  await call('hintUsage', ALL_METHODS, () => api.hintUsage(ALL_METHODS)).catch(() => undefined);
  const chip = el('status');
  chip.textContent = `${String(wallet.name)} · ${network}`;
  chip.className = 'chip ok';
  const mismatch = status.status === 'connected' && status.networkId !== network
    ? `Asked for ${network}, the wallet reports ${status.networkId}` : undefined;
  return { status, configuration, ...(mismatch ? { warning: mismatch } : {}) };
}

// ── 3. reads ─────────────────────────────────────────────────────────────────

type ReadMethod = 'getUnshieldedAddress' | 'getShieldedAddresses' | 'getDustAddress' | 'getUnshieldedBalances'
  | 'getShieldedBalances' | 'getDustBalance' | 'getConfiguration' | 'getConnectionStatus';

/** Balances keyed by colour, with the colour named where the page knows it. */
function labelBalances(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  return Object.fromEntries(Object.entries(result as Record<string, unknown>).map(([k, v]) => [`${tokenLabel(k)} (${k})`, v]));
}

async function read(method: ReadMethod): Promise<unknown> {
  const api = requireApi();
  // `.call(api)`: a wallet may implement the API as a class, whose methods need `this`.
  const result: unknown = await call(method, undefined, () => (api[method] as () => Promise<unknown>).call(api));
  if (method === 'getUnshieldedAddress') state.ownAddress = (result as { unshieldedAddress: string }).unshieldedAddress;
  return method === 'getUnshieldedBalances' || method === 'getShieldedBalances' ? labelBalances(result) : result;
}

async function readHistory(): Promise<unknown> {
  const api = requireApi();
  const page = Number(value('history-page'));
  const size = Number(value('history-size'));
  return call('getTxHistory', { page, size }, () => api.getTxHistory(page, size));
}

async function readAll(): Promise<unknown> {
  const methods: ReadMethod[] = ['getUnshieldedAddress', 'getShieldedAddresses', 'getDustAddress', 'getUnshieldedBalances',
    'getShieldedBalances', 'getDustBalance', 'getConfiguration', 'getConnectionStatus'];
  const results: Record<string, unknown> = {};
  for (const method of methods) {
    try {
      results[method] = await read(method);
    } catch (error) {
      results[method] = describeFailure(error);
    }
  }
  try {
    results['getTxHistory'] = await readHistory();
  } catch (error) {
    results['getTxHistory'] = describeFailure(error);
  }
  return results;
}

// ── 4. sign data ─────────────────────────────────────────────────────────────

async function signData(): Promise<unknown> {
  const api = requireApi();
  const data = el<HTMLTextAreaElement>('sign-data').value;
  const encoding = value('sign-encoding') as 'text' | 'hex' | 'base64';
  const payload = encoding === 'text' ? new TextEncoder().encode(data)
    : encoding === 'hex' ? fromHex(data)
      : Uint8Array.from(atob(data.trim()), (c) => c.charCodeAt(0));
  const signature = await call('signData', { data, encoding, keyType: 'unshielded' },
    () => api.signData(data, { encoding, keyType: 'unshielded' }));
  return { signature, checkedHere: verifySignedData(payload, signature) };
}

// ── 5. makeTransfer ──────────────────────────────────────────────────────────

let transferTx = '';

async function makeTransfer(): Promise<unknown> {
  const api = requireApi();
  const token = tokenOf('tr-token');
  const outputs: DesiredOutput[] = [{
    kind: 'unshielded', type: token, value: amountOf('tr-amount', token), recipient: await recipientOf('tr-recipient'),
  }];
  const options = { payFees: checked('tr-fees') };
  const { tx } = await call('makeTransfer', { outputs, options }, () => api.makeTransfer(outputs, options));
  transferTx = tx;
  el<HTMLButtonElement>('tr-submit').disabled = false;
  return { decoded: decodeOrNote(tx), hex: tx };
}

async function submit(hex: string, outId: string): Promise<unknown> {
  const api = requireApi();
  await call('submitTransaction', `${hex.length / 2} bytes`, () => api.submitTransaction(hex));
  out(outId, 'Submitted. Watch getTxHistory (step 3) or an explorer for the transaction.');
  return undefined;
}

// ── 6. makeIntent ────────────────────────────────────────────────────────────

async function makeIntent(): Promise<unknown> {
  const api = requireApi();
  const give = tokenOf('in-give-token');
  const want = tokenOf('in-want-token');
  const inputs: DesiredInput[] = [{ kind: 'unshielded', type: give, value: amountOf('in-give-amount', give) }];
  const outputs: DesiredOutput[] = [{
    kind: 'unshielded', type: want, value: amountOf('in-want-amount', want), recipient: await recipientOf(''),
  }];
  const idText = value('in-id');
  const intentId: number | 'random' = idText === 'random' ? 'random' : Number(idText);
  const options = { intentId, payFees: checked('in-fees') };
  const { tx } = await call('makeIntent', { inputs, outputs, options }, () => api.makeIntent(inputs, outputs, options));
  return { decoded: decodeOrNote(tx), hex: tx };
}

// ── 7. dApp-built transaction ───────────────────────────────────────────────

let builtTx = '';
let balancedTx = '';

/** Key material for contract circuits only; the built-in ones need none. */
const noKeyMaterial: KeyMaterialProvider = {
  getZKIR: (location) => Promise.reject(new Error(`This page has no circuit ${location}`)),
  getProverKey: (location) => Promise.reject(new Error(`This page has no circuit ${location}`)),
  getVerifierKey: (location) => Promise.reject(new Error(`This page has no circuit ${location}`)),
};

async function provingProvider(): Promise<ProvingProvider> {
  if (state.provider) return state.provider;
  const api = requireApi();
  state.provider = await call('getProvingProvider', 'key material: none (built-in circuits only)',
    () => api.getProvingProvider(noKeyMaterial));
  el<HTMLButtonElement>('pp-check').disabled = false;
  return state.provider;
}

async function buildDappTx(): Promise<unknown> {
  requireApi();
  const token = tokenOf('bu-token');
  const amount = amountOf('bu-amount', token);
  const recipient = await recipientOf('bu-recipient');
  const provider = await provingProvider();
  builtTx = await buildDappTransfer(state.network, [{ token, value: amount, recipient }], Number(value('bu-ttl')) || 10,
    asLedgerProvider(provider));
  el<HTMLButtonElement>('bu-balance').disabled = false;
  el<HTMLButtonElement>('bu-submit').disabled = true;
  return { built: decodeOrNote(builtTx), hex: builtTx };
}

async function balanceDappTx(): Promise<unknown> {
  const api = requireApi();
  if (!builtTx) throw new PageError('Build the transaction first');
  const options = { payFees: checked('bu-fees') };
  const { tx } = await call('balanceUnsealedTransaction', { bytes: builtTx.length / 2, options },
    () => api.balanceUnsealedTransaction(builtTx, options));
  balancedTx = tx;
  el<HTMLButtonElement>('bu-submit').disabled = false;
  return { balanced: decodeOrNote(tx), hex: tx };
}

// ── 8. balanceSealedTransaction ──────────────────────────────────────────────

let sealedBalancedTx = '';

async function balanceSealed(): Promise<unknown> {
  const api = requireApi();
  const input = el<HTMLTextAreaElement>('bs-tx').value.trim();
  if (!input) throw new PageError('Paste a sealed transaction first');
  const options = { payFees: checked('bs-fees') };
  const { tx } = await call('balanceSealedTransaction', { bytes: input.length / 2, options },
    () => api.balanceSealedTransaction(input, options));
  sealedBalancedTx = tx;
  el<HTMLButtonElement>('bs-submit').disabled = false;
  return { input: decodeOrNote(input), balanced: decodeOrNote(tx), hex: tx };
}

// ── 9. proving provider ─────────────────────────────────────────────────────

async function probeProvider(): Promise<unknown> {
  const provider = await provingProvider();
  const result = await call('provider.check', { preimage: '0 bytes', keyLocation: 'midnight/zswap/spend' },
    () => provider.check(new Uint8Array(), 'midnight/zswap/spend'));
  return { result, note: 'An empty preimage is not a real proof; a clean, quick error is the expected outcome.' };
}

// ── wiring ───────────────────────────────────────────────────────────────────

function wire(): void {
  fillTokenSelects();
  el('scan').addEventListener('click', scanWallets);
  action('connect', 'connect-out', connect);
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-read]')) {
    const method = button.dataset['read'] as ReadMethod;
    button.addEventListener('click', () => {
      void read(method).then((r) => out('read-out', { [method]: r }), (e: unknown) => out('read-out', { [method]: describeFailure(e) }));
    });
  }
  action('history', 'read-out', readHistory);
  action('read-all', 'read-out', readAll);
  action('sign', 'sign-out', signData);
  action('tr-make', 'tr-out', makeTransfer);
  action('tr-submit', 'tr-out', () => submit(transferTx, 'tr-out'));
  action('in-make', 'in-out', makeIntent);
  action('bu-build', 'bu-out', buildDappTx);
  action('bu-balance', 'bu-out', balanceDappTx);
  action('bu-submit', 'bu-out', () => submit(balancedTx, 'bu-out'));
  action('bs-balance', 'bs-out', balanceSealed);
  action('bs-submit', 'bs-out', () => submit(sealedBalancedTx, 'bs-out'));
  action('pp-get', 'pp-out', async () => { state.provider = null; await provingProvider(); return { provider: 'received', methods: ['check', 'prove'] }; });
  action('pp-check', 'pp-out', probeProvider);
  action('dec-decode', 'dec-out', () => Promise.resolve(decodeOrNote(el<HTMLTextAreaElement>('dec-tx').value)));
  action('dec-submit', 'dec-out', () => submit(el<HTMLTextAreaElement>('dec-tx').value.trim(), 'dec-out'));
  el('log-clear').addEventListener('click', () => { el('log').replaceChildren(); logEntries.length = 0; });
  el('log-copy').addEventListener('click', () => { void navigator.clipboard.writeText(show(logEntries)); });

  scanWallets();
  // Wallets inject at document_start, but some announce later.
  setTimeout(scanWallets, 500);
  setTimeout(scanWallets, 2000);
}

wire();
