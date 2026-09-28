# B0 spike: Web Push in the extension service worker

Handover `HANDOVER-extension.md` §B0, run on 2026-09-28 on Windows 11 with Google Chrome 153.0.8010.54, Microsoft Edge 154.0.4258.37 and Opera 151.0.7922.176. Brave is not installed on this machine, so Brave was not run. Everything here is throwaway code: `extension/` is a 60-line MV3 extension whose worker logs every event to `chrome.storage.local`, and `run.mjs` drives it with the e2e repo's Playwright. No wallet code is involved.

## Answers

| # | Question | Answer |
|---|---|---|
| 1 | Can `chrome.sidePanel.open()` run as the first statement of `notificationclick`? | **Not answered by an experiment yet.** It needs a human click on the OS toast; the harness is ready (`node run.mjs chrome click --hold=120`, then click both toasts, and the log prints whether `sidePanel.open` resolved or threw the gesture error, for the Web Notifications `notificationclick` path and for the `chrome.notifications.onClicked` path). From the Chromium source, `SidePanelOpenFunction::Run` only checks `user_gesture()` on the API request, and gestures do not survive messages or timers, so a positive result would come only from the event dispatch itself marking the request. Until the click is done, **build B4 on the dashboard-tab route** as the handover recommends. |
| 2 | Does CDP `ServiceWorker.deliverPushMessage` reach an extension service worker? | **Yes, in Chrome and Edge.** The `ServiceWorker` domain is not on the browser-level session: attach the CDP session to an extension page (`context.newCDPSession(page)`), call `ServiceWorker.enable`, take the `registrationId` for the `chrome-extension://<id>/` scope from `workerRegistrationUpdated`, then `deliverPushMessage({ origin: 'chrome-extension://<id>', registrationId, data })`. The worker's `push` handler ran with `event.data.json()` intact and `showNotification` worked. The `worker.evaluate(d => self.dispatchEvent(new PushEvent('push', { data: d })))` fallback also works (the handler must start its work before `waitUntil`, as the B3 snippet does). Both are usable for `notify-push-render.spec.ts`; the CDP one goes through Chrome's real push plumbing and is the one to prefer. |
| 3 | What does Chrome show when a push handler shows no notification? | **Nothing, in every state tested.** Real pushes (through FCM for Chrome, WNS for Edge) whose handler showed no notification, subscribed with `userVisibleOnly: true`: Chrome, no wallet UI open, 6 silent pushes in a row; Chrome, dashboard tab focused, 2; Edge, no UI, 3. In no case did Chrome's forced "This site has been updated in the background" notification appear. That notification is a persistent notification written on the service-worker registration (tag `user_visible_auto_notification`), so it would have been listed by `self.registration.getNotifications()`, which was read 4 s after each push and again 10–60 s later and stayed empty. The side-panel-only state was not run separately: it is strictly less exposed than "no UI open", which already produced nothing. So B8 does not need the "skip `showNotification` for a focused dashboard" special case (B8 step 4); keep steps 1–3 (silent notification plus in-app toast) as the design. Chromium source notes: extensions whose background is a service worker skip the requirement entirely when subscribed with `userVisibleOnly: false` (Chrome 121+); with `true`, the generic path applies (a visible tab of the origin waives it, otherwise a per-origin budget decides). Since the observed behaviour is already "no generic notification", keep `userVisibleOnly: true` as the brief asks. |
| 4 | Brave, Edge and Opera subscription behaviour | **Chrome:** FCM endpoint (`https://fcm.googleapis.com/fcm/send/…`), `expirationTime: null`. **Edge:** WNS endpoint (`https://wns2-par02p.notify.windows.com/w/?token=…`), `expirationTime: null`; a real Web Push (VAPID + aes128gcm) through WNS reached the worker and showed a notification. **Opera 151:** FCM endpoint like Chrome; a real push through FCM reached the worker. Opera has no `chrome.sidePanel` API (the worker's `chrome.sidePanel` is undefined), so B4's tab route is the only route there. **Brave:** not installed here, not run; the expectation stays "rejects `subscribe()` until Use Google services for push messaging is on", to be confirmed by whoever has Brave. The server allowlist (§11) must include `*.notify.windows.com` for Edge. |

## Things learned about the harness

- Branded Chrome 137+ ignores `--load-extension`. The way that works is `--enable-unsafe-extension-debugging` at launch and the CDP command `Extensions.loadUnpacked({ path })` on a browser-level session. Playwright's default arguments add `--disable-extensions` (which silently disables the just-loaded extension: `chrome://extensions` shows nothing and its pages give `ERR_BLOCKED_BY_CLIENT`) and `--disable-background-networking` (which would starve the push service), so both must go through `ignoreDefaultArgs`. Edge 154 and Opera 151 behave the same.
- `pushManager.subscribe` in an extension worker needs no permission prompt in any of the three browsers.
- A real push is easy to send from Node: `encryptWebPush` from the contract mock plus a VAPID JWT (the mock's `vapidHeader` is not exported; `run.mjs` has a 10-line copy). FCM and WNS both answer `201`.

## How to run

```bash
# from spikes/notify-b0, with ../../../gerowallet-e2e-tests installed (npm ci) for Playwright
node run.mjs chrome subscribe                  # Q4; saves the subscription under %TEMP%/gero-b0
node run.mjs chrome cdp                        # Q2
node run.mjs chrome push --show=0 --count=3 --hold=15   # Q3 (add --ui=dashboard or --ui=sidepanel)
node run.mjs chrome click --hold=120           # Q1: click the two toasts while it holds, read the log it prints
```

`edge` and `opera` work in place of `chrome`. A local VAPID pair is generated on first use and kept in `%TEMP%/gero-b0/vapid.json`; nothing is committed.
