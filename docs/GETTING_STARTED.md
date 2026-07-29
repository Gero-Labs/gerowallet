# Getting Started with Gero Wallet Development

This guide will help you set up your development environment and start contributing to Gero Wallet.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Initial Setup](#initial-setup)
- [Development Environment](#development-environment)
- [Building and Testing](#building-and-testing)
- [Common Development Tasks](#common-development-tasks)
- [Debugging](#debugging)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

1. **Node.js 18 or higher**
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify installation: `node --version` (should be 18.x or higher)
   - npm comes bundled with Node.js

2. **Git**
   - Download from [git-scm.com](https://git-scm.com/)
   - Verify installation: `git --version`

3. **Docker Desktop or Rancher Desktop**
   - For running the Gero Backend locally
   - Docker Desktop: [docker.com](https://www.docker.com/products/docker-desktop)
   - Rancher Desktop (alternative): [rancherdesktop.io](https://rancherdesktop.io/)

4. **Chrome or Chromium-based Browser**
   - Chrome, Edge, Brave, or any Chromium-based browser
   - Firefox is also supported for development

5. **Code Editor** (recommended)
   - [Visual Studio Code](https://code.visualstudio.com/) with extensions:
     - Volar (Vue.js language support)
     - ESLint
     - TypeScript Vue Plugin (Volar)

### Backend Access

The client needs **no** third-party data keys. All blockchain data, prices, DeFi routing, and real-time sync flow through **Nexus (the Gero backend)**, which holds every provider key server-side. For local development you only point the client at a Gero backend. See [Environment Configuration](#environment-configuration) below.

---

## Initial Setup

### 1. Fork and Clone the Repository

```bash
# Fork the repository on GitHub (click "Fork" button)
# Then clone your fork
git clone https://github.com/YOUR_USERNAME/gerowallet.git
cd gerowallet
```

### 2. Install Dependencies

```bash
npm install
```

This will install all required packages (~1,000+ dependencies). It may take a few minutes.

**Common Issues**:
- If you get `EACCES` errors, avoid using `sudo`. Instead, configure npm to use a different directory:
  ```bash
  mkdir ~/.npm-global
  npm config set prefix '~/.npm-global'
  export PATH=~/.npm-global/bin:$PATH
  ```
- If you get `node-gyp` errors, install build tools:
  - **Windows**: `npm install --global windows-build-tools`
  - **macOS**: Install Xcode Command Line Tools: `xcode-select --install`
  - **Linux**: Install build-essential: `sudo apt-get install build-essential`

### 3. Environment Configuration

Create environment files from the example template:

```bash
cp .env.example .env.development
```

Open `.env.development` and configure the following **required** variables. These are the only variables the client needs for local development — every one simply points at a Gero backend:

```bash
# Gero backend base URL
VITE_BACKEND_URL=http://localhost:8081

# Nexus (Gero backend) API base — always <backend>/api/nexus
VITE_NEXUS_URL=http://localhost:8081/api/nexus

# Real-time sync WebSocket (served by the Gero backend)
VITE_SYNC_WS_URL=ws://localhost:8081/sync

# Feature flags (optional for local development)
VITE_ENABLE_MULTISIG=true
VITE_ENABLE_GOVERNANCE=true
```

**No third-party data keys are required.** The client never talks to blockchain,
price, or DeFi providers directly — it only points at the Gero backend, and the
backend holds all provider keys server-side. There are no data-provider keys of
any kind to configure in the client.

### 4. Start the Gero Backend (Local Development)

The Gero Backend (Nexus) is the single API the client talks to. It holds all provider keys server-side and exposes blockchain data, prices, DeFi routing, and real-time sync to the client.

#### Pull the Docker Image

```bash
docker pull skyhawkofficial/gero:gerowallet-backend-v1.76
```

#### Create Backend Environment File

Create a `.env.backend` file with the following:

```bash
# Backend configuration
PORT=8081
NODE_ENV=development

# Provider keys (blockchain data, prices, DeFi routing, real-time sync)
# are configured server-side here, in the backend — never in the client.
# Populate the provider credentials your backend build expects.

# Database (if persistence is needed, optional for dev)
# MONGODB_URI=mongodb://localhost:27017/gerowallet
```

#### Run the Container

```bash
docker run -d \
  --name gerowallet-backend \
  --env-file .env.backend \
  -p 8081:8081 \
  skyhawkofficial/gero:gerowallet-backend-v1.76
```

**Verify it's running**:
```bash
docker ps | grep gerowallet-backend
curl http://localhost:8081/health
```

You should see a response like: `{"status":"ok"}`

**Managing the container**:
```bash
# Stop the backend
docker stop gerowallet-backend

# Start the backend
docker start gerowallet-backend

# View logs
docker logs -f gerowallet-backend

# Remove the container
docker rm -f gerowallet-backend
```

---

## Development Environment

### Start Development Server

```bash
npm run dev
```

This starts **hot-reload development servers** for all contexts:
- Background service worker
- Content scripts
- Inject scripts
- Web UI (options, popup, sidepanel)

You'll see output like:
```
VITE v4.5.5  ready in 2341 ms

➜  Options:   http://localhost:5173/
➜  Background: extension/background.js
➜  Content:    extension/content.js
➜  Inject:     extension/inject.js
```

The `extension/` folder is now populated with development builds.

### Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`

2. Enable **Developer mode** (toggle in top-right corner)

3. Click **"Load unpacked"**

4. Select the `extension/` folder in the project directory

5. The extension should now appear in your extensions list

6. **Pin the extension** (click the puzzle icon in Chrome toolbar, then pin Gero Wallet)

**Reload the extension after changes**:
- Click the refresh icon on the extension card in `chrome://extensions/`
- Or use the keyboard shortcut: `Ctrl+R` (Windows/Linux) or `Cmd+R` (macOS)

### Development Modes

#### Full Development (All Contexts)
```bash
npm run dev
```
Builds all components with hot reload.

#### Web UI Only (Faster)
```bash
npm run dev:web
```
Only rebuilds the options/popup UI. Use when working on UI components.

#### Background Only
```bash
npm run dev:background
```
Only rebuilds background service worker. Use when working on wallet logic, crypto, etc.

#### Content Scripts Only
```bash
npm run dev:content
```
Only rebuilds content scripts. Use when working on DApp connector.

#### Inject Scripts Only
```bash
npm run dev:inject
```
Only rebuilds inject scripts (window.cardano API).

### Firefox Development

```bash
npm run dev-firefox
```

Then load in Firefox:
1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `manifest.json` from the `extension/` folder

**Note**: Firefox uses Manifest V2 compatibility mode. Some features may behave differently.

---

## Building and Testing

### Type Checking

```bash
npm run typecheck
```

Runs TypeScript compiler in check mode (no output, just validation).

**Fix type errors**:
- Gero Wallet uses relaxed TypeScript settings (`noImplicitAny: false`)
- Focus on compilation errors, not strict typing
- Some `@ts-ignore` comments are acceptable for rapid development

### Linting

```bash
# Check for linting errors
npm run lint

# Auto-fix linting issues
npm run lint -- --fix
```

**Common linting issues**:
- Unused variables (prefix with `_` if intentional: `_unusedVar`)
- Missing return types (can be inferred in most cases)
- `any` types (acceptable in relaxed mode, but prefer specific types when possible)

### Production Build

```bash
npm run build
```

Creates optimized production builds in `extension/`:
- Minified JavaScript
- Tree-shaken bundles
- No source maps (for size)

**Verify build**:
```bash
ls -lh extension/
# Should see background.js, content.js, inject.js, options.html, popup.html, etc.
```

### Beta Build

```bash
npm run build:beta
```

Creates a beta build using `.env.beta` environment variables (beta backend, etc.).

### Package Extension

```bash
# Create all package formats (.zip, .crx, .xpi)
npm run pack

# Create .zip only (for Chrome Web Store)
npm run pack:zip

# Create beta .zip
npm run pack:zip:beta
```

Packages are created in the root directory:
- `gerowallet-v{version}.zip` - Chrome/Edge
- `gerowallet-v{version}.crx` - Chromium (self-hosted)
- `gerowallet-v{version}.xpi` - Firefox

### Clean Build Artifacts

```bash
npm run clear
```

Removes the `extension/` folder to force a fresh build.

---

## Common Development Tasks

### Creating a New Wallet (Test Wallet)

1. Load the extension in Chrome (see above)
2. Click the extension icon
3. Click "Create New Wallet"
4. Choose a name (e.g., "Test Wallet")
5. **Save the mnemonic phrase** (you'll need it for testing)
6. Set a password (use something simple for testing, e.g., "test123")
7. Confirm and create

**Test Networks**:
- Switch to **Preprod** network for testing (Settings → Network → Preprod)
- Get free test ADA from [Cardano Faucet](https://docs.cardano.org/cardano-testnet/tools/faucet/)

### Importing a Test Wallet

Use the following test mnemonic (DO NOT use for real funds):
```
test walk nut penalty hip pave soap entry language right filter choice
```

**Steps**:
1. Click "Import Wallet"
2. Enter the mnemonic
3. Set a password
4. Switch to Preprod network

### Adding a New Feature Module

Example: Adding a "Notifications" feature

1. **Create module directory**:
   ```bash
   mkdir -p src/modules/notifications/{components,dialogs,views}
   ```

2. **Create main view** (`src/modules/notifications/views/NotificationsView.vue`):
   ```vue
   <template>
     <v-container>
       <h1>{{ $t('notifications.title') }}</h1>
       <!-- Your component UI -->
     </v-container>
   </template>

   <script setup lang="ts">
   // Your component logic
   </script>
   ```

3. **Add route** (`src/modules/navigation/router.ts`):
   ```typescript
   {
     path: '/notifications',
     name: 'Notifications',
     component: () => import('@/modules/notifications/views/NotificationsView.vue')
   }
   ```

4. **Add navigation item** (e.g., in `src/modules/navigation/layouts/ContentLayout.vue`):
   ```vue
   <v-list-item to="/notifications">
     <v-list-item-title>{{ $t('notifications.title') }}</v-list-item-title>
   </v-list-item>
   ```

5. **Create store if needed** (`src/stores/notificationsStore.ts`):
   ```typescript
   import Vue from 'vue';

   const notificationsStore = Vue.observable({
     notifications: [],
     unreadCount: 0,

     addNotification(notification) {
       this.notifications.push(notification);
       this.unreadCount++;
     }
   });

   export default notificationsStore;
   ```

6. **Add translations** (`src/locales/en.json`):
   ```json
   {
     "notifications": {
       "title": "Notifications",
       "empty": "No notifications"
     }
   }
   ```

### Adding a Chrome Message Handler

Example: Adding a "getBalance" message handler

1. **Define message type** (`src/models/MessageTypes.ts`):
   ```typescript
   export enum MessageTypes {
     // ... existing types
     GET_BALANCE = 'GET_BALANCE'
   }
   ```

2. **Add handler in background** (`src/chrome/background.ts`):
   ```typescript
   app.addToOptions(MessageTypes.GET_BALANCE, async (request, sendResponse) => {
     try {
       const balance = await walletBg.getBalance();
       sendResponse({
         id: request.id,
         data: { success: true, balance },
         target: TARGET,
         sender: SENDER.extension
       });
     } catch (error) {
       sendResponse({
         id: request.id,
         data: { success: false, error: error.message },
         target: TARGET,
         sender: SENDER.extension
       });
     }
     return true; // Keep channel open for async
   });
   ```

3. **Call from UI** (e.g., in a Vue component):
   ```typescript
   import { Messaging } from '@/chrome/messaging';
   import { MessageTypes } from '@/models/MessageTypes';

   async function fetchBalance() {
     const response = await Messaging.sendToBackgroundFromOptions({
       method: MessageTypes.GET_BALANCE,
       data: {}
     });

     if (!response.data.success) {
       throw new Error(response.data.error);
     }

     return response.data.balance;
   }
   ```

### Working with the Database

#### Application-Level Database (Wallets List)

```typescript
import { getAllWallets, createNewWallet, getWallet } from '@/db/gero-db';

// Get all wallets
const wallets = await getAllWallets();

// Create new wallet
const walletId = await createNewWallet(
  'My Wallet',
  'icon-name',
  'blue-theme',
  mnemonic,
  password,
  'cardano',
  'mainnet'
);

// Get specific wallet
const wallet = await getWallet(walletId);
```

#### Wallet-Specific Database

```typescript
import { getDb } from '@/db/wallet-db';

// Open wallet database
const db = await getDb(walletId);

// Read transactions
const transactions = await db['transactions'].toArray();

// Add transaction
await db['transactions'].add({
  hash: 'abc123...',
  inputs: [...],
  outputs: [...],
  timestamp: Date.now()
});

// Update transaction
await db['transactions'].update('abc123...', {
  confirmations: 10
});

// Use transactions for atomic operations
await db.transaction('rw', db.transactions, db.addresses, async () => {
  await db.transactions.add(newTx);
  await db.addresses.update(address, { lastUsed: Date.now() });
});
```

### Adding Translation Strings

All user-facing text must use i18n translations.

1. **Add to language files**:

   `src/locales/en.json`:
   ```json
   {
     "myFeature": {
       "title": "My Feature",
       "description": "This is my awesome feature",
       "button": "Click Me"
     }
   }
   ```

   `src/locales/es.json` (Spanish):
   ```json
   {
     "myFeature": {
       "title": "Mi Función",
       "description": "Esta es mi función increíble",
       "button": "Haz clic"
     }
   }
   ```

2. **Use in templates**:
   ```vue
   <template>
     <div>
       <h1>{{ $t('myFeature.title') }}</h1>
       <p>{{ $t('myFeature.description') }}</p>
       <v-btn>{{ $t('myFeature.button') }}</v-btn>
     </div>
   </template>
   ```

3. **Use in script**:
   ```typescript
   import { useTranslation } from '@/shared/composables/useTranslation';

   const { t } = useTranslation();
   const message = computed(() => t('myFeature.description'));
   ```

---

## Debugging

### Background Service Worker

The background service worker is where all sensitive operations happen (wallet management, transaction signing, etc.).

**Open DevTools for Background**:
1. Navigate to `chrome://extensions/`
2. Find Gero Wallet
3. Click the **"service worker"** link (blue text)
4. DevTools will open

**Common debugging patterns**:
```typescript
// Use console prefixes for easy filtering
console.log('⏱️ PERF: Login took', performance.now() - start, 'ms');
console.log('🔐 Auth: User authenticated');
console.log('📡 API: Fetching UTXOs');
console.log('💾 DB: Transaction saved');
console.log('🔄 Sync: Syncing wallet');

// Debug complex objects
console.log('Wallet state:', JSON.stringify(walletStore, null, 2));

// Debug transactions
console.log('TX inputs:', tx.body.inputs);
console.log('TX outputs:', tx.body.outputs);
console.log('TX fee:', tx.body.fee);
```

**Filter logs**: In DevTools console, use the filter box:
- `⏱️ PERF:` - Show only performance logs
- `🔐 Auth:` - Show only auth logs
- etc.

### Options Page / Popup

**Open DevTools for Options/Popup**:
1. Right-click on the extension UI (options page or popup)
2. Select **"Inspect"**
3. DevTools will open

**Vue DevTools**:
- Install [Vue DevTools](https://devtools.vuejs.org/) extension
- Open DevTools → "Vue" tab
- Inspect component state, props, emitted events

### Network Requests

**View API calls**:
1. Open DevTools → Network tab
2. Filter by "Fetch/XHR"
3. Click on a request to see headers, payload, response

**Common API endpoints**:
- Gero Backend: `http://localhost:8081/api/...`
- Nexus (Gero backend): `http://localhost:8081/api/nexus/...`
- Real-time sync WebSocket: `ws://localhost:8081/sync`

### Vue Component Debugging

```vue
<script setup>
import { watch } from 'vue';

// Watch reactive state
watch(() => walletStore.balance, (newBalance, oldBalance) => {
  console.log('Balance changed:', oldBalance, '→', newBalance);
});

// Debug computed properties
const totalValue = computed(() => {
  const value = walletStore.balance * priceStore.adaPrice;
  console.log('Total value computed:', value);
  return value;
});
</script>
```

### Database Debugging

```typescript
// View database contents in DevTools
// Application tab → IndexedDB → GeroWalletDatabase or wallet-{id}

// Programmatic debugging
const db = await getDb(walletId);
console.log('All transactions:', await db.transactions.toArray());
console.log('All addresses:', await db.addresses.toArray());

// Clear database (caution!)
await db.delete();
```

---

## Troubleshooting

### Extension Not Loading

**Symptom**: Extension doesn't appear after "Load unpacked"

**Solutions**:
1. Check for errors in `chrome://extensions/` (click "Errors" button)
2. Ensure `manifest.json` exists in `extension/` folder
3. Run `npm run dev` to rebuild
4. Check console for Vite build errors

### Hot Reload Not Working

**Symptom**: Changes not reflected after saving files

**Solutions**:
1. Manually reload extension (click refresh icon in `chrome://extensions/`)
2. For background script changes, MUST reload extension manually
3. For UI changes, refresh the options/popup page
4. Check Vite dev server is running (`npm run dev`)

### "Service Worker Inactive" Error

**Symptom**: Background script shows as "Inactive (Service Worker)"

**Explanation**: Service workers automatically suspend after 30 seconds of inactivity (Manifest V3 behavior).

**Solutions**:
- This is normal! The service worker will wake up when needed (messages, alarms, etc.)
- To keep it active for debugging, keep DevTools open for the service worker
- Click the "service worker" link in `chrome://extensions/` to wake it up

### WASM Loading Errors

**Symptom**: `RuntimeError: WebAssembly.instantiate(): ...`

**Solutions**:
1. Ensure WASM files are in `public/` directory
2. Check Vite config has `vite-plugin-wasm` and `vite-plugin-top-level-await`
3. Clear build and rebuild: `npm run clear && npm run dev`
4. Check browser console for CORS errors (should not happen in extension context)

### Database Errors ("No [Table] Table")

**Symptom**: `Dexie.DatabaseClosedError: No Addresses Table`

**Cause**: Database schema not applied before opening

**Solution**: Always use centralized database functions:
```typescript
// ✅ CORRECT
import { getDb } from '@/db/wallet-db';
const db = await getDb(walletId);

// ❌ WRONG
import Dexie from 'dexie';
const db = new Dexie(`wallet-${walletId}`);
await db.open(); // Schema not applied!
```

### Chrome Messaging Timeouts

**Symptom**: `Error: Could not establish connection. Receiving end does not exist.`

**Causes**:
1. Background service worker is inactive
2. Wrong messaging method (popup vs options context)
3. Handler not registered

**Solutions**:
```typescript
// Use correct messaging method based on context

// OPTIONS/BROWSER CONTEXT
import { Messaging } from '@/chrome/messaging';
const response = await Messaging.sendToBackgroundFromOptions({
  method: MessageTypes.MY_METHOD,
  data: {}
});

// POPUP CONTEXT
const response = await Messaging.sendToBackground({
  method: MessageTypes.MY_METHOD,
  data: {}
});

// Ensure handler returns true for async operations
app.addToOptions(MessageTypes.MY_METHOD, async (request, sendResponse) => {
  const result = await someAsyncOperation();
  sendResponse({ data: { success: true, result } });
  return true; // IMPORTANT!
});
```

### TypeScript Errors

**Symptom**: Type errors during `npm run typecheck`

**Solutions**:
1. Gero Wallet uses relaxed TypeScript (`noImplicitAny: false`)
2. Focus on compilation errors, not strict typing
3. Use `@ts-ignore` for complex type issues (sparingly)
4. Add type annotations where helpful:
   ```typescript
   // Add explicit type for clarity
   const balance: string = walletStore.balance;

   // Or use @ts-ignore for complex cases
   // @ts-ignore - Complex type inference
   const result = someComplexOperation();
   ```

### Docker Backend Connection Issues

**Symptom**: `Failed to fetch http://localhost:8081/api/...`

**Solutions**:
1. Check Docker container is running: `docker ps | grep gerowallet-backend`
2. Check container logs: `docker logs gerowallet-backend`
3. Verify port mapping: Container should map `8081:8081`
4. Test endpoint: `curl http://localhost:8081/health`
5. Check firewall settings (allow port 8081)
6. Restart container: `docker restart gerowallet-backend`

### Real-Time Sync Connection Issues

**Symptom**: "Connecting..." status stuck, no real-time updates

**Solutions**:
1. Check `VITE_SYNC_WS_URL` in `.env.development` points at your backend's sync WebSocket
2. Verify the Gero backend is running and reachable (check network requests)
3. Check browser console for sync/WebSocket errors
4. Confirm the backend exposes the sync WebSocket endpoint (the client holds no
   provider keys — all real-time sync is served by the backend)

### Build Errors

**Symptom**: `npm run build` fails with errors

**Common issues**:

1. **"Cannot find module..."**
   - Clear node_modules: `rm -rf node_modules && npm install`
   - Clear build: `npm run clear`

2. **"Out of memory" errors**
   - Increase Node memory: `NODE_OPTIONS=--max-old-space-size=4096 npm run build`

3. **"Rollup failed to resolve import"**
   - Check import path is correct
   - Ensure module is installed: `npm install <module>`
   - Check `vite.config.ts` aliases

4. **"require is not defined"**
   - Likely using Node.js module in browser context
   - Check if `vite-plugin-node-polyfills` is configured
   - Use ESM imports instead: `import` not `require`

---

## Next Steps

Now that you have your development environment set up:

1. **Read the Architecture**: See [`ARCHITECTURE.md`](../ARCHITECTURE.md) for system design
2. **Explore the Codebase**: Start with `src/modules/dashboard/` for UI, `src/chrome/` for extension logic
3. **Pick an Issue**: Check [GitHub Issues](https://github.com/Gero-Labs/gerowallet/issues) for "good first issue" labels
4. **Join the Community**: Ask questions in GitHub Discussions or Issues
5. **Read Contributing Guide**: See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for contribution workflow

### Learning Resources

- **Cardano**: [Cardano Docs](https://docs.cardano.org/)
- **Cardano SDK**: `@cardano-sdk/core` (see the package on npm)
- **Vue.js 2**: [Vue.js Guide](https://v2.vuejs.org/v2/guide/)
- **Vuetify 2**: [Vuetify Components](https://v2.vuetifyjs.com/)
- **Chrome Extensions**: [Chrome Extension Docs](https://developer.chrome.com/docs/extensions/)
- **Dexie.js**: [Dexie Tutorial](https://dexie.org/docs/Tutorial/)

### Development Tips

- **Start small**: Make small, incremental changes
- **Test thoroughly**: Use Preprod network for testing transactions
- **Ask questions**: Don't hesitate to ask in GitHub Issues
- **Follow patterns**: Look at existing code for examples
- **Security first**: Never log sensitive data, always validate inputs
- **Performance matters**: Use `performance.now()` to measure timing
- **Document changes**: Add comments for complex logic

---

**Happy coding! Welcome to the Gero Wallet community!** 🚀

If you have questions or run into issues not covered here, please:
- Check existing [GitHub Issues](https://github.com/Gero-Labs/gerowallet/issues)
- Open a new issue with the "question" label
- Review the [ARCHITECTURE.md](../ARCHITECTURE.md) for technical details

---

**Last Updated**: 2025-12-23