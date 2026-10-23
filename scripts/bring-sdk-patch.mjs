/**
 * Build-time patch for the Bring cashback SDK (@bringweb3/chrome-extension-kit).
 *
 * The SDK runs inside our content script on every page and inside our service
 * worker, so its trust decisions are ours. Version 1.8.0 makes three that a web
 * page can abuse:
 *
 *   1. The wallet address goes to whatever element has the id
 *      `bringweb3-iframe-<extension id>` (a page can create one), posted with
 *      targetOrigin "*".
 *   2. The content script acts on any window message tagged `from: 'bringweb3'`
 *      without checking who sent it, so a page can drive the bridge: prompt a
 *      login, flip the user's popup opt-out, open tabs.
 *   3. The worker opens any URL a message names (OPEN_CASHBACK_PAGE) and
 *      navigates the tab to any redirect URL (ACTIVATE).
 *
 * The patch posts the address only to Bring's own iframe, and only with that
 * iframe's https *.bringweb3.io origin as targetOrigin. It acts only on window
 * messages from an https *.bringweb3.io origin (Bring's iframe, or another
 * wallet's Bring popup announcing an activation). OPEN_CASHBACK_PAGE opens only
 * the configured cashback page, and a redirect must be http(s).
 *
 * The SDK attaches its stored wallet address to every request it makes to
 * Bring's API. While the user has cashback turned off ("Shop & Earn popups"),
 * the stored address reads as absent, so it no longer leaves the device. The
 * worker also stops handing the address over then (src/chrome/bringAddressSharing.ts).
 *
 * The SDK is minified, so every edit is a pattern over its 1.8.0 output. A
 * pattern that does not match exactly once FAILS THE BUILD: an upgrade cannot
 * silently drop a patch. The invariants pin the opt-out storage format that
 * src/chrome/bringAddressSharing.ts reads, for the same reason. The `vite` dev server
 * pre-bundles dependencies with esbuild, which skips this hook; the extension
 * bundles (content, background) are always Rollup builds.
 */

export const BRING_SDK_MODULE = /[\\/]@bringweb3[\\/]chrome-extension-kit[\\/]dist[\\/]index\.m?js$/;

// Injected verbatim (via toString) at the top of the SDK module. Keep them
// self-contained: they may only reference each other and globals.
export function __geroIsBringOrigin(origin) {
  if (typeof origin !== 'string') return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) return false;
    return url.hostname === 'bringweb3.io' || url.hostname.endsWith('.bringweb3.io');
  } catch {
    return false;
  }
}

export function __geroBringFrameOrigin(frame) {
  if (!frame || typeof frame.src !== 'string') return null;
  try {
    const origin = new URL(frame.src).origin;
    return __geroIsBringOrigin(origin) ? origin : null;
  } catch {
    return null;
  }
}

export function __geroFromBringFrame(event, frame) {
  if (!event || !__geroIsBringOrigin(event.origin)) return false;
  if (frame && event.source === frame.contentWindow) return true;
  // Another wallet's Bring popup announcing an activation, so ours goes quiet
  // on that site (the SDK's own cross-extension rule). Bring origin only.
  return !!event.data && event.data.action === 'ACTIVATE';
}

export function __geroIsWebUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

const HELPERS = [__geroIsBringOrigin, __geroBringFrameOrigin, __geroFromBringFrame, __geroIsWebUrl];

const ID = '([\\w$]+)';

// getTurnOff's read: `let e=await d.get("optOut"),t=_(e);`. Its fourth group is
// the SDK's own "opted out now" predicate (`_` in 1.8.0), reused by a patch below.
const OPT_OUT_READ = new RegExp(`let ${ID}=await ${ID}\\.get\\("optOut"\\),${ID}=${ID}\\(\\1\\);`);

/** Pins the opt-out format src/chrome/bringAddressSharing.ts mirrors. Matched, never changed. */
export const BRING_SDK_INVARIANTS = [
  { name: 'storage key prefix is "bring_"', pattern: new RegExp(`${ID}="bring_"`) },
  { name: 'opt-out is stored as [start, start + duration]', pattern: new RegExp(`\\.set\\("optOut",\\[${ID},\\1\\+${ID}\\]\\)`) },
  { name: 'setTurnOff(true) opts out for MAX_SAFE_INTEGER ms', pattern: /\?Number\.MAX_SAFE_INTEGER:-1/ },
  {
    name: 'a window is a [number, number] pair with start <= end',
    pattern: new RegExp(`${ID}=e=>\\{if\\(!e\\|\\|!Array\\.isArray\\(e\\)\\|\\|e\\.length!==2\\)return!1;let\\[t,n\\]=e;return typeof t=="number"&&typeof n=="number"&&t<=n\\}`),
  },
  {
    name: 'opted out while now is inside the window',
    pattern: new RegExp(`${ID}=\\(e,t\\)=>\\{if\\(!${ID}\\(e\\)\\)return!0;let\\[n,r\\]=e;return t=t\\?\\?Date\\.now\\(\\),t<n\\|\\|t>r\\}`),
  },
  { name: 'getTurnOff reads the "optOut" window', pattern: OPT_OUT_READ },
  {
    name: 'an empty WALLET_ADDRESS_UPDATE removes the stored address',
    pattern: new RegExp(`case"WALLET_ADDRESS_UPDATE":\\{let\\{walletAddress:${ID}\\}=${ID};return [^;]{0,200}?\\1\\?${ID}\\.set\\("walletAddress",\\1\\)[^;]{0,120}?:\\3\\.remove\\("walletAddress"\\)`),
  },
];

// The content-script window listener. Its third argument is the module-level
// variable holding the iframe the SDK injected (`V` in 1.8.0).
const MESSAGE_LISTENER = new RegExp(`window\\.addEventListener\\("message",${ID}=>${ID}\\(\\{event:\\1,iframeEl:${ID},promptLogin:${ID},onClose:${ID}\\}\\)\\)`);

// The SDK's storage getter (`ve` in 1.8.0): cache first, then chrome.storage.local.
export const STORAGE_GETTER = new RegExp(`${ID}=async\\(e,t=!0\\)=>\\{if\\(t\\)\\{let n=${ID}\\.get\\(e\\);if\\(n!==null\\)return n\\}return new Promise`);

/**
 * @typedef {{ frameVar: string, optedOut: string }} PatchContext
 * @type {Array<{ name: string, pattern: RegExp, replace: (ctx: PatchContext) => (...m: string[]) => string }>}
 */
export const BRING_SDK_PATCHES = [
  {
    name: 'wallet address goes only to Bring\'s own iframe, at its Bring origin',
    pattern: new RegExp(
      `${ID}\\|\\|\\(\\1=document\\.querySelector\\(\`#\\$\\{${ID}\\}-\\$\\{chrome\\.runtime\\.id\\}\`\\)\\);let ${ID}=await ${ID}\\(\\);\\1\\?\\.contentWindow\\?\\.postMessage\\(\\{action:"WALLET_ADDRESS_UPDATE",walletAddress:\\3\\},"\\*"\\)`,
    ),
    replace: ({ frameVar }) => (_m, el, _idPrefix, address, getAddress) =>
      `${el}=${frameVar};let ${address}=await ${getAddress}();let __geroTo=__geroBringFrameOrigin(${el});__geroTo&&${el}.contentWindow?.postMessage({action:"WALLET_ADDRESS_UPDATE",walletAddress:${address}},__geroTo)`,
  },
  {
    name: 'stored wallet address reads as absent while cashback is turned off',
    pattern: STORAGE_GETTER,
    replace: ({ optedOut }) => (_m, get, cache) =>
      `${get}=async(e,t=!0)=>{if(e==="walletAddress"&&${optedOut}(await ${get}("optOut",t)))return;if(t){let n=${cache}.get(e);if(n!==null)return n}return new Promise`,
  },
  {
    name: 'content-script bridge acts only on messages from Bring\'s iframe',
    pattern: MESSAGE_LISTENER,
    replace: () => (_m, ev, handler, frameVar, promptLogin, onClose) =>
      `window.addEventListener("message",${ev}=>{__geroFromBringFrame(${ev},${frameVar})&&${handler}({event:${ev},iframeEl:${frameVar},promptLogin:${promptLogin},onClose:${onClose}})})`,
  },
  {
    name: 'portal listener acts only on Bring-origin messages',
    pattern: new RegExp(`window\\.addEventListener\\("message",${ID}=>\\{if\\(!\\1\\.data\\|\\|\\1\\.data\\.from!=="bringweb3"\\|\\|\\1\\.data\\.action!=="PORTAL_ACTIVATE"\\)return;`),
    replace: () => (_m, ev) =>
      `window.addEventListener("message",${ev}=>{if(!__geroIsBringOrigin(${ev}.origin)||!${ev}.data||${ev}.data.from!=="bringweb3"||${ev}.data.action!=="PORTAL_ACTIVATE")return;`,
  },
  {
    name: 'OPEN_CASHBACK_PAGE opens only the configured cashback page',
    pattern: new RegExp(`case"OPEN_CASHBACK_PAGE":let\\{url:${ID}\\}=${ID};return ${ID}\\(\\1\\|\\|${ID}\\)`),
    replace: () => (_m, _url, _msg, open, configured) => `case"OPEN_CASHBACK_PAGE":return ${open}(${configured})`,
  },
  {
    name: 'activation redirects only to http(s) URLs',
    pattern: new RegExp(`${ID}&&${ID}&&await ${ID}\\(\\2\\)&&chrome\\.tabs\\.update\\(\\1,\\{url:\\2\\}\\)`),
    replace: () => (_m, tab, url, allowed) =>
      `${tab}&&${url}&&__geroIsWebUrl(${url})&&await ${allowed}(${url})&&chrome.tabs.update(${tab},{url:${url}})`,
  },
];

function countMatches(code, pattern) {
  return [...code.matchAll(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`))].length;
}

/**
 * Patch one Bring SDK dist file. Throws, naming every failed pattern, unless
 * every invariant and every patch matches exactly once.
 */
export function patchBringSdk(code, id = '@bringweb3/chrome-extension-kit') {
  const problems = [];
  for (const { name, pattern } of [...BRING_SDK_INVARIANTS, ...BRING_SDK_PATCHES]) {
    const n = countMatches(code, pattern);
    if (n !== 1) problems.push(`${name}: expected 1 match, found ${n}`);
  }
  const frameVar = MESSAGE_LISTENER.exec(code)?.[3];
  const optedOut = OPT_OUT_READ.exec(code)?.[4];
  if (frameVar && !new RegExp(`var ${frameVar.replace(/\$/g, '\\$')}=null`).test(code)) {
    problems.push(`iframe variable ${frameVar} is not a module-level "var ${frameVar}=null"`);
  }
  if (problems.length || !frameVar || !optedOut) {
    throw new Error(
      `[bring-sdk-patch] ${id} does not match the reviewed Bring SDK 1.8.0 build. `
      + 'Re-review the SDK and update scripts/bring-sdk-patch.mjs (and src/chrome/bringAddressSharing.ts) before upgrading.\n  '
      + problems.join('\n  '),
    );
  }
  let out = code;
  for (const { pattern, replace } of BRING_SDK_PATCHES) out = out.replace(pattern, replace({ frameVar, optedOut }));
  return `${HELPERS.map(fn => fn.toString()).join('\n')}\n${out}`;
}

/** Vite/Rollup plugin: applies {@link patchBringSdk} to the SDK in every build that bundles it. */
export const bringSdkPatch = {
  name: 'bring-sdk-patch',
  enforce: 'pre',
  transform(code, id) {
    if (id.startsWith('\0') || id.includes('?')) return null;
    if (!BRING_SDK_MODULE.test(id)) return null;
    return { code: patchBringSdk(code, id), map: null };
  },
};
