import fs from 'fs-extra'
import { isDev, isFirefox, log, r } from './utils';
import type PkgType from '../package.json';
import type { Manifest } from 'webextension-polyfill';

async function getManifest() {
  const pkg = await fs.readJSON(r('package.json')) as typeof PkgType

  // update this file to update this manifest.json
  // can also be conditional based on your need
  const manifest: Manifest.WebExtensionManifest = {
    manifest_version: 3,
    name: pkg.displayName || pkg.name,
    version: pkg.version,
    description: pkg.description,
    // options_ui: {
    //   page: './dist/options/index.html',
    //   open_in_tab: true,
    // },
    icons: {
      16: './public/logo16.png',
      48: './public/logo48.png',
      128: './public/logo128.png',
    },
    action: {
      default_icon: {
        16: "./public/logo16.png",
        48: "./public/logo48.png",
        128: "./public/logo128.png"
      },
      default_title: "Gero Dashboard | A Multi-chain Light Wallet Merging Web2 and Web3"
    },
    background: isFirefox
      ? {
        scripts: ['background/_virtual_index.js'],
        persistent: true,
      }
      : {
        service_worker: './background/_virtual_index.js',
      },
    permissions: [
      'tabs',
      'activeTab',
      'clipboardRead',
      'storage',
      'favicon',
      'alarms',
      'unlimitedStorage',
      'webNavigation',
      'notifications'
    ],
    host_permissions: ['*://*/*'],
    web_accessible_resources: [
      {
        resources: ["public/logo.png", "public/logo128.png", "content/_virtual_inject.js", "public/2.5.0.png"],
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
    content_security_policy: {
      extension_pages: isDev ?
        `default-src 'self'; script-src 'self' 'wasm-unsafe-eval' http://localhost:*; font-src 'self' https://fonts.gstatic.com/ http://localhost:*; connect-src https://api.handle.me/ https://media.bringweb3.io/ https://sandbox-api.bringweb3.io http://localhost:* ws://localhost:* https://fastly.jsdelivr.net/npm/@sec-ant/zxing-wasm@2.1.5/dist/reader/zxing_reader.wasm https://api.cardanoshield.com/api/ data:; style-src * 'unsafe-inline' 'self'  blob: ; img-src 'self'  http: data: ; frame-src http://localhost:* https://*.moonpay.com https://connect.trezor.io/; media-src http://localhost:* data:; object-src 'self'`
        : `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; font-src 'self' https://fonts.gstatic.com/; connect-src https://api.handle.me/ https://media.bringweb3.io/ https://api.bringweb3.io https://api.gerowallet.io/ wss://api.gerowallet.io/ https://api.cardanoshield.com/api/ data:; style-src * 'unsafe-inline' 'self'  blob: ; img-src 'self'  https: data: ; frame-src https://api.gerowallet.io/ https://guardarian.com/ https://*.moonpay.com/ https://connect.trezor.io/; media-src https://api.gerowallet.io/ data:; object-src 'self'`
    },
  }

  // // add sidepanel
  // if (isFirefox) {
  //   manifest.sidebar_action = {
  //     default_panel: 'dist/sidepanel/index.html',
  //   }
  // }
  // else {
  //   // the sidebar_action does not work for chromium based
  //   (manifest as any).side_panel = {
  //     default_path: 'dist/sidepanel/index.html',
  //   }
  // }

  if (!isDev) {
    manifest['key'] = process.env['MANIFEST_KEY']
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
