// Local notify API for hand-testing the Notifications tab (handover B-M3, CONTRACT §10.3).
//
// Runs the contract's own mock (`gerowallet-e2e-tests/tests/fixtures/mock-relay.mjs`,
// `createNotifyMock`) on 127.0.0.1:6300, the loopback port the extension's CSP allows,
// and gives it a small command line. The mock generates its OWN throwaway VAPID pair on
// every start; nothing here is a real key. Real Chrome subscribes through Google's push
// service with that key, so pushes sent from here arrive as real system notifications.
//
//   node spikes/notify-manual/dev-server.mjs            (terminal 1)
//   VITE_NOTIFY_API_URL=http://127.0.0.1:6300/api/notify/v1 npm run dev   (terminal 2)
//
// See README.md next to this file for the full walk-through.
import http from 'node:http';
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PORT = Number(process.env.NOTIFY_MOCK_PORT || 6300);
/** The e2e repo cloned next to this checkout, or next to the checkout a worktree belongs to. */
function findE2E() {
  if (process.env.GERO_E2E_DIR) return resolve(process.env.GERO_E2E_DIR);
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    const candidate = join(dirname(dir), 'gerowallet-e2e-tests');
    if (existsSync(join(candidate, 'tests/fixtures/mock-relay.mjs'))) return candidate;
    if (dirname(dir) === dir) return resolve('../gerowallet-e2e-tests');
  }
}
const E2E = findE2E();
const MOCK = join(E2E, 'tests/fixtures/mock-relay.mjs');
if (!existsSync(MOCK)) {
  console.error(`No contract mock at ${MOCK}. Clone Gero-Labs/gerowallet-e2e-tests next to this repo or set GERO_E2E_DIR.`);
  process.exit(1);
}
const { createNotifyMock } = await import(pathToFileURL(MOCK).href);

const base = `http://127.0.0.1:${PORT}`;
let mock;
const server = http.createServer((req, res) => mock.handle(req, res).catch((e) => { res.writeHead(500); res.end(String(e)); }));
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
mock = createNotifyMock({ publicBase: base, ...(process.env.NOTIFY_SERVED ? { servedCategories: JSON.parse(process.env.NOTIFY_SERVED) } : {}) });

const ctl = async (path, body) => {
  const r = await fetch(`${base}/__mock/${path}`, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const t = await r.text();
  return t ? JSON.parse(t) : null;
};
const show = (v) => console.log(JSON.stringify(v, null, 2));
const short = (s) => (typeof s === 'string' && s.length > 48 ? `${s.slice(0, 45)}…` : s);

/** `key=value` words → an object; numbers and booleans are parsed, `a.b=1` nests. */
function kv(words) {
  const out = {};
  for (const w of words) {
    const i = w.indexOf('=');
    if (i < 0) continue;
    const path = w.slice(0, i).split('.');
    let raw = w.slice(i + 1);
    const value = raw === 'true' ? true : raw === 'false' ? false : raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw;
    let o = out;
    for (const k of path.slice(0, -1)) o = o[k] ??= {};
    o[path[path.length - 1]] = value;
  }
  return out;
}

// Push defaults per event type (§6): what a real server would send.
const PUSH = {
  funds: { t: 'funds', c: 'funds', d: 'activity', x: { tx: 'a'.repeat(64) } },
  funds_summary: { t: 'funds_summary', c: 'funds', d: 'activity', n: 3 },
  staking: { t: 'staking_reward', c: 'staking', d: 'staking' },
  new_device: { t: 'new_device', c: 'remoteSigning', d: 'pairedDevices', x: { deviceId: 'b'.repeat(32) } },
  test: { t: 'test', c: 'system', d: 'home' },
};

const HELP = `
commands (the mock's control API, §10.3):
  state                          devices, links, wallet prefs
  log                            every /api/notify/v1 route the extension called
  push [type] [k=v ...]          type: ${Object.keys(PUSH).join(' | ')} (default funds)
                                 e.g.  push funds a.ada=12.5      push funds_summary n=1      push new_device
                                 any field of §6 can be set: t= c= d= n= exp= eventId= a.ada= x.tx=
  prefs [off=a,b] [amounts=true] [min=<ADA>]
                                 another device (iOS) writes the synced prefs of the first registered wallet
  invalidate                     the push service reported the device's endpoint gone (410): F2 recovery on the next re-assertion
  rotate | retire <kid>          VAPID rotation (§8.3)
  fail <route-prefix> <status> [times] [code]
                                 e.g.  fail "DELETE /api/notify/v1/device/wallets" 503 4
  reset                          wipe the mock (the extension keeps its local state)
  help | quit
`;

console.log(`notify mock on ${base}  (VAPID kid ${mock.vapid.kid}, a throwaway pair generated just now)`);
console.log(`build the extension with  VITE_NOTIFY_API_URL=${base}/api/notify/v1  and load ./extension unpacked.`);
console.log(HELP);

async function walletKey() {
  const s = await ctl('state');
  const w = s.wallets[0];
  if (!w) throw new Error('no wallet registered yet: turn the wallet on in Settings → Notifications first');
  const [network, stakeAddress] = w.walletKey.split('|');
  return { network, stakeAddress, prefs: w.prefs };
}

async function run(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/).filter(Boolean);
  if (!cmd) return;
  switch (cmd) {
    case 'help': return console.log(HELP);
    case 'quit': case 'exit': server.close(); process.exit(0);
    case 'state': {
      const s = await ctl('state');
      return show({ currentKid: s.currentKid, devices: s.devices.map((d) => ({ deviceId: d.deviceId, transport: d.transport, targetStatus: d.targetStatus, endpoint: short(d.webpush?.endpoint), links: d.links })), wallets: s.wallets });
    }
    case 'log': return console.log((await ctl('state')).log.map((l) => `${new Date(l.at).toISOString().slice(11, 19)}  ${l.route}`).join('\n') || '(empty)');
    case 'push': {
      const type = rest[0] && !rest[0].includes('=') ? rest.shift() : 'funds';
      const preset = PUSH[type];
      if (!preset) return console.log(`unknown push type ${type}; one of ${Object.keys(PUSH).join(', ')}`);
      const body = { ...structuredClone(preset), eventId: `${type}:manual:${Date.now()}`, ...kv(rest) };
      const r = await ctl('push', body);
      return console.log(`push service answered ${r.status ?? r.error ?? '?'}${r.skipped ? ` (${r.skipped})` : ''}  e=${r.payload?.e ?? ''}`);
    }
    case 'prefs': {
      const { network, stakeAddress, prefs } = await walletKey();
      const o = kv(rest);
      const synced = {
        categoriesOff: o.off === undefined ? prefs.categoriesOff : o.off === '-' ? [] : String(o.off).split(',').filter(Boolean),
        showAmounts: o.amounts === undefined ? prefs.showAmounts : !!o.amounts,
        minReceiveLovelace: o.min === undefined ? prefs.minReceiveLovelace : Math.round(Number(o.min) * 1_000_000),
      };
      return show(await ctl('prefs', { network, stakeAddress, synced }));
    }
    case 'invalidate': {
      const d = (await ctl('state')).devices.find((x) => x.transport === 'webpush');
      if (!d) return console.log('no webpush device');
      return show(await ctl('invalidate', { deviceId: d.deviceId, reason: 'Unregistered' }));
    }
    case 'rotate': return show(await ctl('rotate-vapid', {}));
    case 'retire': return show(await ctl('retire-vapid', { kid: rest[0] }));
    case 'fail': {
      const m = line.match(/^fail\s+"([^"]+)"\s+(\d+)(?:\s+(\d+))?(?:\s+(\S+))?/) || line.match(/^fail\s+(\S+)\s+(\d+)(?:\s+(\d+))?(?:\s+(\S+))?/);
      if (!m) return console.log('usage: fail "<route prefix>" <status> [times] [code]');
      await ctl('fail', { route: m[1], status: Number(m[2]), times: Number(m[3] || 1), code: m[4] || 'unavailable' });
      return console.log(`next ${m[3] || 1} × ${m[1]} → ${m[2]}`);
    }
    case 'reset': await ctl('reset', {}); return console.log('mock reset');
    default: return console.log(`unknown command ${cmd}; try help`);
  }
}

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'notify> ' });
rl.prompt();
rl.on('line', (line) => { run(line).catch((e) => console.log(`error: ${e.message}`)).finally(() => rl.prompt()); });
rl.on('close', () => { server.close(); process.exit(0); });
