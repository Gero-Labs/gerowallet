# Notifications: hand-testing against a local notify API

Two throwaway drivers for the Web Push work (handover §4.3, CONTRACT §10.3). Both run the
contract's own mock server (`gerowallet-e2e-tests/tests/fixtures/mock-relay.mjs`), which
generates a fresh throwaway VAPID pair on every start. No real key is involved anywhere,
and nothing here is used by a production build (`VITE_NOTIFY_API_URL` defaults to
`https://sync.gerowallet.io/api/notify/v1`, where `/config` keeps the feature dark).

| Script | What it does |
|---|---|
| `dev-server.mjs` | The mock on `127.0.0.1:6300` with a command line (`push`, `prefs`, `invalidate`, `fail`, …). You load the extension yourself and click through Settings → Notifications. |
| `real-push.mjs` | Fully scripted §4.3 check: launches branded Chrome, seeds the template wallet, opts in through worker messages and pushes through Google's push service. |

## Test the Notifications tab in your own Chrome

Prerequisites: `Gero-Labs/gerowallet-e2e-tests` cloned next to this repo (or `GERO_E2E_DIR`
pointing at it) and the usual `.env.development` in this checkout (a worktree needs its own
copy: `copy ..\..\..\.env.development .` from the worktree root).

1. Start the mock (terminal 1). It prints the VAPID kid and the command list, then waits for commands:

   ```bash
   node spikes/notify-manual/dev-server.mjs
   ```

2. Build the extension against it (terminal 2). `.env.development.local` in this checkout
   already carries `VITE_NOTIFY_API_URL=http://127.0.0.1:6300/api/notify/v1` (gitignored,
   `.env.*`); Vite picks it up on top of `.env.development`. The extension's CSP allows that
   loopback port.

   ```bash
   npm run dev
   ```

   Or a one-off production-mode build, without the dev server:

   ```bash
   cross-env VITE_NOTIFY_API_URL=http://127.0.0.1:6300/api/notify/v1 npm run build
   ```

3. `chrome://extensions` → Developer mode → Load unpacked → the `extension/` folder. Branded
   Chrome subscribes through Google's push service with the mock's key, so pushes arrive as
   real system notifications; Chromium/Brave without Google services show the B9 hint instead.

4. Open the dashboard with a **Cardano software wallet on preprod, preview or mainnet**
   (the mock accepts all three). Settings → Notifications:
   - "Notifications on this browser" → status **Active**; `state` in terminal 1 shows a `webpush` device.
   - "Notify me about this wallet" → the spending-password step signs the wallet proof; `state` shows the link, verified against your stake key.
   - The category, amount and mute rows write `PUT …/prefs` (`log` shows every call).

5. Push from terminal 1 and watch the system notification (and the in-app toast when a
   dashboard is focused, B8):

   ```text
   push funds a.ada=12.5 x.tx=<64 hex>     ADA received, amounts only when "Show amounts" is on
   push funds_summary n=3                 "3 more transactions"
   push new_device                        sticky, opens Settings → Security
   push test
   push funds exp=1                       an expired push: generic text, no deep link
   ```

6. Other scenarios:
   - `prefs off=funds amounts=true min=2` simulates iOS writing the synced prefs; close and reopen the tab to see them.
   - `invalidate` marks your endpoint gone on the server (what a provider 410 does); the next re-assertion (reload the extension, or wait for the daily alarm) re-subscribes and the status returns to Active (F2).
   - `fail "DELETE /api/notify/v1/device/wallets" 503 4` then turn the wallet off: the unlink stays queued and flushes on the next re-assertion (F7 keeps the browser dark meanwhile).
   - `rotate` then `retire dev1`: VAPID rotation (§8.3).
   - Turn the browser switch off: `state` shows `transport: none`; the link is kept, so turning it back on needs no password.

Restarting `dev-server.mjs` wipes the mock (new VAPID pair, no devices). The extension then
sees `device_unknown` on its next call and registers again on its own; a stale subscription
is renewed because the VAPID key changed.

## The scripted real-push check

```bash
cross-env VITE_NOTIFY_API_URL=http://localhost:6300/api/notify/v1 npm run build:background -- --mode production
node spikes/notify-manual/real-push.mjs --suspend=90
```

It needs the e2e repo's Playwright and the template wallet its global setup restores
(`.tmp/post-v27-wallet-template.json`, password in the script: a public test-vector wallet).
