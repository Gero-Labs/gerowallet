import fs from 'fs-extra'
import { isDev, isFirefox, log, r } from './utils';
import type PkgType from '../package.json';
import type { Manifest } from 'webextension-polyfill';
import dotenv from 'dotenv';
import path from 'node:path'

dotenv.config({
  path: path.resolve(process.cwd(), `.env.${process.env['NODE_ENV']}`)
})

interface ManifestWithOAuth2 extends Manifest.WebExtensionManifest {
  oauth2?: {
    client_id: string;
    scopes: string[];
  };
  key?: string;
  side_panel?: {
    default_path: string;
  };
  declarative_net_request?: {
    rule_resources: { id: string; enabled: boolean; path: string }[];
  };
}

//@ts-ignore
const key = process.env.MANIFEST_KEY;
//@ts-ignore
const client_id = process.env.GOOGLE_CLIENT_ID;
//@ts-ignore
const isBeta: boolean = process.env.VITE_IS_BETA === 'true';

// ── Content Security Policy (organized by category) ──────────────────────────

function buildCSP(dev: boolean): string {
  const connectSrc = [
    // Gero backend
    ...(dev
      ? ['https://dev.gerowallet.io']
      : ['https://*.gerowallet.io', 'wss://api.gerowallet.io']),
    'wss://market.gerowallet.io',
    // Bitcoin APIs
    'https://blockstream.info',
    'https://mempool.space',
    'https://api.hiro.so',
    // Babylon staking
    'https://*.babylonchain.io',
    'https://*.babylonlabs.io',
    // Ably (real-time blockchain updates)
    'wss://*.ably.net',
    'wss://*.ably-realtime.com',
    'https://*.ably-realtime.com',
    'https://*.ably.io',
    'wss://*.ably.io',
    // Kraken (price feed)
    'wss://ws.kraken.com',
    'https://api.kraken.com',
    // Koios (SPO pool data)
    'https://api.koios.rest',
    'https://preprod.koios.rest',
    'https://preview.koios.rest',
    // Third-party APIs
    'https://api.coingecko.com',
    'https://analytics-snekfun.splash.trade',
    'https://www.googleapis.com',
    'https://api.handle.me/',
    'https://media.bringweb3.io/',
    'https://api.bringweb3.io/',
    'https://api.cardanoshield.com/api/',
    'https://connect.trezor.io',
    // Strike Finance (perpetuals)
    'https://api.strikefinance.org',
    'https://api-v2.strikefinance.org',
    'wss://*.strikefinance.org',
    'https://*.gerowallet.io',
    // Dev-only
    ...(dev
      ? [
          'https://*.zkfold.io',
          'https://guardarian.com/',
          'http://localhost:*',
          'ws://localhost:*',
          'ws://127.0.0.1:*',
          'https://fastly.jsdelivr.net/npm/@sec-ant/zxing-wasm@2.1.5/dist/reader/zxing_reader.wasm',
        ]
      : ['ws://127.0.0.1:*']),
    // SPO Node Monitor (Cloudflare Tunnel)
    'https://*.trycloudflare.com',
    'data:',
  ];

  const scriptSrc = dev
    ? ["'self'", "'wasm-unsafe-eval'", 'http://localhost:*']
    : ["'self'", "'wasm-unsafe-eval'"];

  const fontSrc = dev
    ? ["'self'", 'https://fonts.gstatic.com/', 'http://localhost:*']
    : ["'self'", 'https://fonts.gstatic.com/'];

  const styleSrc = ['*', "'unsafe-inline'", "'self'", 'blob:'];

  const imgSrc = dev
    ? ["'self'", 'http:', 'data:']
    : ["'self'", 'https:', 'data:'];

  const frameSrc = [
    ...(dev ? ['http://localhost:*'] : ['https://api.gerowallet.io/', 'https://guardarian.com/']),
    'https://*.moonpay.com/',
    'https://connect.trezor.io/',
    'https://www.kaiserex.com/',
    'https://kaiserex.com/',
    'https://forms.zohopublic.eu/',
  ];

  const mediaSrc = [
    ...(dev ? ['https://*.gerowallet.io', 'http://localhost:*'] : ['https://*.gerowallet.io']),
    'data:',
  ];

  return [
    `default-src 'self'`,
    `script-src ${scriptSrc.join(' ')}`,
    `font-src ${fontSrc.join(' ')}`,
    `connect-src ${connectSrc.join(' ')}`,
    `style-src ${styleSrc.join(' ')}`,
    `img-src ${imgSrc.join(' ')}`,
    `frame-src ${frameSrc.join(' ')}`,
    `media-src ${mediaSrc.join(' ')}`,
    `object-src 'self'`,
  ].join('; ');
}

async function getManifest() {
  const pkg = await fs.readJSON(r('package.json')) as typeof PkgType

  // update this file to update this manifest.json
  // can also be conditional based on your need
  const manifest: ManifestWithOAuth2 = {
    manifest_version: 3,
    name: (pkg.displayName || pkg.name) + (isBeta ? ' (Beta)' : '') ,
    version: pkg.version,
    description: pkg.description,
    key,
    // options_ui: {
    //   page: './dist/options/index.html',
    //   open_in_tab: true,
    // },
    icons: {
      16: 'public/logo16.png',
      48: 'public/logo48.png',
      128: 'public/logo128.png',
    },
    action: {
      default_icon: {
        16: "public/logo16.png",
        48: "public/logo48.png",
        128: "public/logo128.png"
      },
      default_title: "Gero Dashboard | A Multi-chain Light Wallet Merging Web2 and Web3"
    },
    oauth2: {
      client_id,
      scopes:[
        "openid",
        "profile",
        "email"
      ]
    },
    background: isFirefox
      ? {
        scripts: ['background/_virtual_index.js'],
        persistent: true,
      }
      : {
        service_worker: './background/index.js',
        // Note: We build with format: 'iife', not ES modules, so don't use type: 'module'
        // This was causing "Failed to resolve module specifier" errors
      },
    permissions: [
      'tabs',
      'activeTab',
      'clipboardRead',
      'storage',
      'favicon',
      'alarms',
      'cookies',
      'unlimitedStorage',
      'webNavigation',
      'notifications',
      'identity',
      'sidePanel',
      'scripting',
      'declarativeNetRequest',
    ],
    declarative_net_request: {
      rule_resources: [
        { id: 'moonpay_iframe', enabled: true, path: 'public/dnr_rules.json' },
      ],
    },
    host_permissions: ['*://*/*'],
    web_accessible_resources: [
      {
        resources: ["public/logo.png", "public/logo128.png", "content/inject.js", "public/2.6.0.png"],
        matches: ["<all_urls>"]
      }
    ],
    content_scripts: [
      {
        matches: [
          '<all_urls>',
        ],
        js: [ 'content/content.js' ],
        run_at: "document_start",
        all_frames: true
      },
    ],
    side_panel: {
      default_path: 'sidepanel/index.html',
    },
    content_security_policy: {
      extension_pages: buildCSP(isDev),
    },
  }

  if (!isDev) {
    manifest['key'] = process.env['MANIFEST_KEY']
  }

  if (isBeta) {
    manifest.permissions = manifest.permissions!.filter((p) => p !== 'notifications')
  }

  // FIXME: not work in MV3
  if (isDev && false) {
    // for content script, as browsers will cache them for each reload,
    // we use a background script to always inject the latest version
    // see src/background/contentScriptHMR.ts
    delete manifest.content_scripts
    manifest.permissions?.push('webNavigation')
  }

  return manifest
}

export async function writeManifest() {
  await fs.writeJSON(r('extension/manifest.json'), await getManifest(), { spaces: 2 })
  log('PRE', 'write manifest.json')
}

writeManifest()
