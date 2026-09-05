# Gero Wallet

<div align="center">

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.9-blue.svg)](https://www.typescriptlang.org/)
[![Vue](https://img.shields.io/badge/Vue.js-2.7-green.svg)](https://v2.vuejs.org/)

A multi-chain, non-custodial wallet browser extension (Chrome Manifest V3) for Cardano, Midnight, and Apex Fusion.

[Features](#key-features) • [Quick Start](#quick-start) • [Documentation](#documentation) • [Contributing](#contributing)

</div>

---

## Overview

**Gero Wallet** (v2.7.0) is a feature-rich, non-custodial multi-chain wallet browser extension. It supports Cardano, Midnight, and Apex Fusion (Prime and Vector), and ships two interfaces: a full dashboard and Mini-Gero, a compact side-panel wallet.

All blockchain data, price feeds, DeFi routing, and real-time updates are served through **Nexus**, Gero's own backend data layer. The extension holds no third-party data-provider keys — the client talks only to the Gero backend, which brokers everything server-side.

### Two interfaces

Gero ships two surfaces over the same wallet core:

- **Full dashboard** — the complete extension: portfolio, swaps, perpetuals, staking, governance, dApp connections, rewards, and settings.
- **Mini-Gero** — a compact wallet in the browser side panel, for working without leaving the page you're on. It covers the common flows: balances, send, receive, swap, buy and sell, staking and DRep delegation, market prices, perpetuals, vaults, activity, and dApp approvals.

Mini-Gero is a focused subset of the dashboard. Anything not in the side panel is available in the full interface.

### Key Features

**💼 Wallet Management**
- Create and import wallets with BIP39 mnemonic phrases
- Hardware wallet support (Ledger, Trezor, Keystone)
- PassKey (WebAuthn PRF) wallets with hardware-backed key encryption
- Multi-account and multi-wallet support
- Enterprise-grade encryption (AES-256 + ChaCha20-Poly1305)

**⛓️ Multi-Chain Support**
- **Cardano** — staking, CIP-1694 governance, native assets, NFTs, dApp connector
- **Midnight** — shielded transfers, NIGHT/DUST management, proof server, and a shielded proving consent flow
- **Apex Fusion** — Prime and Vector chains

**⛓️ Cardano Native Features**
- **Staking**: delegate to stake pools and earn rewards
- **Governance**: CIP-1694 DRep voting and delegation
- **NFTs**: view, manage, and trade Cardano NFTs
- **Native Tokens**: full support for Cardano native assets
- **CIP-113 programmable tokens**: shown in the portfolio and badged; Stage 1 is display only, transfers of these tokens are not supported yet

**🔄 DeFi and Trading**
- DEX aggregation for best swap rates (routed via Nexus)
- Token swaps across multiple Cardano DEXs
- Perpetuals trading via Strike Finance: order book, market and limit orders, TWAP orders, positions and order history
- Vaults via Strike Finance: deposit into yield vaults and track positions
- Portfolio tracking, analytics, and real-time price feeds
- Fiat on-ramp via MoonPay and Guardarian

**🎁 Rewards**
- Cashback via the Bring portal (on supported networks)

**🔐 Security First**
- Non-custodial (you control your keys)
- Configurable lock methods: password, PIN, or pattern
- Two-factor authentication
- Auto-lock with configurable timeout
- Transaction risk assessment
- DApp connection approval system
- Hardware wallet integration

**🌐 Web3 Connectivity**
- CIP-30 dApp connector API (`window.cardano`)
- WalletConnect session support
- Real-time blockchain updates via Gero Sync (WebSocket push)

## Tech Stack

- **Frontend**: Vue.js 2.7 + TypeScript + Vuetify 2.7 (Material Design)
- **Build System**: Vite 4.5.5 with 4 separate configurations
- **State Management**: Custom Vue Observable stores (lightweight, performant)
- **Database**: Dexie 4.0.7 (IndexedDB wrapper with versioned schemas)
- **Cardano SDK**: @cardano-sdk/core v0.46.9 (modern, preferred for new features)
- **Data Layer**: Nexus (Gero backend) for blockchain data, prices, and DeFi routing
- **Real-time**: Gero Sync — WebSocket push for instant blockchain updates
- **Cryptography**: WebAssembly for performance-critical operations (bip39, blake2b)
- **Hardware Wallets**: Native support for Ledger, Trezor, and Keystone

For complete technical details, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Quick Start

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js 18+** and npm ([Download](https://nodejs.org/))
- **Docker Desktop** or **Rancher Desktop** ([Docker](https://www.docker.com/products/docker-desktop) | [Rancher](https://rancherdesktop.io/))
- **Chrome** or any Chromium-based browser (Edge, Brave, etc.)
- **Git** for version control

### 1. Clone and Install

```bash
# Clone the repository
git clone https://github.com/Gero-Labs/gerowallet.git
cd gerowallet

# Install dependencies
npm install

# Create environment file (the three variables below are all you need —
# see "Configure Environment")
touch .env.development
```

### 2. Configure Environment

The client needs no third-party API keys — all blockchain data, prices, and DeFi
routing are served by the Gero backend (Nexus). For local development you only
need to point the extension at a backend instance:

```bash
# Gero backend base URL (localhost for development)
VITE_BACKEND_URL=http://localhost:8081

# Nexus is reached through the backend proxy (server injects the Nexus key).
# Point this at <gero-backend>/api/nexus, NOT at Nexus directly.
VITE_NEXUS_URL=http://localhost:8081/api/nexus

# Gero Sync WebSocket (real-time blockchain updates, served by the backend)
VITE_SYNC_WS_URL=ws://localhost:8081/sync
```

Those three are all you need. Other `VITE_*` variables (fiat on-ramp,
feature-flag service, blog, etc.) are optional — none are required to boot the
extension against a local backend. To list every variable the code reads:

```bash
grep -rhoE 'VITE_[A-Z0-9_]+' src/ scripts/ | sort -u
```

CIP-113 programmable-token display is behind two independent gates, both of which must
pass. The per-network deployment list lives in
[`src/utils/cip113Deployments.ts`](src/utils/cip113Deployments.ts) - the
`programmable_logic_base` script hashes are reviewed protocol constants, an empty list
disables the feature for that network, and mainnet ships empty. The `isCip113Enabled`
feature flag is the runtime half: it ships off and is the only kill-switch that does not
need a rebuild and a store review.

### 3. Start Gero Backend

```bash
# Pull Docker image
docker pull skyhawkofficial/gero:gerowallet-backend-v1.76

# Run container
docker run -d \
  --name gerowallet-backend \
  --env-file .env.backend \
  -p 8081:8081 \
  skyhawkofficial/gero:gerowallet-backend-v1.76

# Verify it's running
curl http://localhost:8081/health
```

### 4. Start Development

```bash
# Start development server (hot reload)
npm run dev
```

This starts development servers for all contexts:
- Background service worker
- Content scripts (DApp connector)
- Inject scripts (window.cardano API)
- Web UI (options, popup, sidepanel)

### 5. Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **"Developer mode"** (toggle in top-right corner)
3. Click **"Load unpacked"**
4. Select the `extension/` folder from the project directory
5. The extension should now appear - pin it to your toolbar

**That's it!** You now have Gero Wallet running locally. 🎉

For detailed setup instructions, troubleshooting, and development guides, see [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).

---

## Development

### Development Commands

```bash
# Development with hot reload
npm run dev              # All contexts (recommended)
npm run dev:web          # Web UI only (faster for UI work)
npm run dev:background   # Background script only
npm run dev:content      # Content scripts only
npm run dev:inject       # Inject scripts only
npm run dev-firefox      # Firefox development build
```

### Build and Package

```bash
# Production build
npm run build            # Optimized production build
npm run build:beta       # Beta build with beta environment

# Package extension
npm run pack             # Create .zip, .crx, and .xpi packages
npm run pack:zip         # Chrome Web Store .zip
npm run pack:zip:beta    # Beta .zip

# Utilities
npm run clear            # Clean build artifacts
npm run typecheck        # TypeScript type checking
npm run lint             # ESLint checks
npm run lint -- --fix    # Auto-fix linting issues
```

### Testing

Use the **Preprod testnet** for safe testing:
1. Load the extension and create a test wallet
2. Go to Settings → Network → **Preprod**
3. Get free test ADA from [Cardano Faucet](https://docs.cardano.org/cardano-testnet/tools/faucet/)

**Never test with real funds on mainnet during development!**

---

## Project Structure

```
gerowallet/
├── src/
│   ├── chrome/              # Extension-specific code
│   │   ├── background.ts    # Service worker (main background script)
│   │   ├── messaging.ts     # Chrome messaging system
│   │   └── walletBg.ts      # Wallet operations in background
│   ├── modules/             # Feature modules (Vue components)
│   │   ├── dashboard/       # Portfolio, assets, quick actions
│   │   ├── staking/         # Cardano staking and delegation
│   │   ├── governance/      # Governance and DRep voting
│   │   ├── swap/            # DeFi token swaps
│   │   ├── transactions/    # Transaction history
│   │   └── ...              # Other feature modules
│   ├── stores/              # Vue Observable state management
│   │   ├── geroStore.ts     # Global app state
│   │   ├── walletStore.ts   # Active wallet state
│   │   └── ...              # Feature-specific stores
│   ├── services/            # Business logic services
│   │   ├── walletManager.service.ts   # Wallet lifecycle
│   │   ├── sync.service.ts            # Blockchain sync
│   │   └── websocket.service.ts       # Gero Sync real-time updates
│   ├── db/                  # Database layer (Dexie/IndexedDB)
│   │   ├── gero-db.ts       # Application-level DB
│   │   └── wallet-db.ts     # Wallet-specific DBs
│   ├── api/                 # Backend/data integrations
│   │   ├── nexus-tx-api.ts     # Nexus transaction building
│   │   ├── market-api.ts       # Prices & market data (via backend)
│   │   └── ...                 # Other backend-routed clients
│   ├── shared/              # Reusable utilities and components
│   │   ├── utils/           # Helper functions
│   │   ├── composables/     # Vue composables
│   │   └── components/      # Shared Vue components
│   └── options/             # Extension UI entry points
├── docs/                    # Documentation
│   ├── GETTING_STARTED.md   # Detailed setup guide
│   └── ...
├── ARCHITECTURE.md          # System architecture overview
├── CONTRIBUTING.md          # Contribution guidelines
└── README.md                # This file
```

For detailed architecture overview, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Architecture Highlights

### Chrome Extension (Manifest V3)

Gero Wallet uses a multi-context architecture for security and performance:

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Popup     │  │   Options   │  │ Side Panel  │
│   (Web UI)  │  │   (Web UI)  │  │  (Web UI)   │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
              ┌─────────▼─────────┐
              │  Chrome Messaging │
              └─────────┬─────────┘
                        │
         ┌──────────────▼──────────────┐
         │  Background Service Worker  │
         │  - Wallet Operations        │
         │  - Transaction Signing      │
         │  - State Broadcasting       │
         └──────────┬──────────────────┘
                    │
         ┌──────────┼──────────┐
         │                     │
    ┌────▼────┐         ┌─────▼──────┐
    │IndexedDB│         │Chrome      │
    │(Dexie)  │         │Storage     │
    └─────────┘         └────────────┘
```

**Why this architecture?**
- **Security**: Private keys isolated in background context, never exposed to UI
- **Performance**: Non-blocking operations, efficient state synchronization
- **Reliability**: Database persistence with real-time state sync

### Key Architectural Patterns

1. **Two-Tier Database System**
   - Application-level DB: Global data (wallets list, config)
   - Wallet-specific DBs: Individual wallet data (transactions, addresses)

2. **Real-Time Communication**
   - Gero Sync WebSocket push for instant blockchain updates
   - Mutex-protected sync to prevent race conditions

3. **Modern Cardano SDK**
   - Uses `@cardano-sdk/core` v0.46.9 for all Cardano operations
   - Conway-era support (latest Cardano protocol features)

4. **Hardware Wallet Integration**
   - Hybrid approach: Background prepares, Frontend handles device communication
   - Supports WebUSB (Ledger), WebBLE, and QR codes (Keystone)

For complete architectural details, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Documentation

### For Contributors

- **[Getting Started Guide](docs/GETTING_STARTED.md)** - Detailed setup, development workflow, troubleshooting
- **[Architecture Overview](ARCHITECTURE.md)** - System design, patterns, data flow
- **[Contributing Guidelines](CONTRIBUTING.md)** - How to contribute, code standards, PR process

### For Developers

- **Tech Stack**: Vue.js 2.7, TypeScript, Vite, Dexie, Cardano SDK
- **Key Patterns**: Vue Observable stores, Chrome messaging, two-tier database
- **Data Layer**: Nexus (Gero backend) — the single source for blockchain data, prices, and DeFi routing; the client carries no third-party provider keys

### Development Resources

- [Cardano Developer Docs](https://docs.cardano.org/)
- [Cardano SDK Documentation](https://input-output-hk.github.io/cardano-js-sdk/)
- [Chrome Extension Developer Guide](https://developer.chrome.com/docs/extensions/)
- [Vue.js 2 Guide](https://v2.vuejs.org/v2/guide/)
- [Vuetify 2 Components](https://v2.vuetifyjs.com/)

---

## Contributing

We welcome contributions from the community! Gero Wallet is a financial application handling real cryptocurrency, so we prioritize security and quality.

### Before You Start

1. Read the [Contributing Guidelines](CONTRIBUTING.md)
2. Review the [Architecture Overview](ARCHITECTURE.md)
3. Set up your development environment using the [Getting Started Guide](docs/GETTING_STARTED.md)

### Contribution Workflow

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/YOUR_USERNAME/gerowallet.git`
3. **Create a branch**: `git checkout -b feature/your-feature-name`
4. **Make changes** following our coding standards
5. **Test thoroughly** (use Preprod network for transactions)
6. **Commit**: `git commit -m "feat: add your feature description"`
7. **Push**: `git push origin feature/your-feature-name`
8. **Open a Pull Request** with a clear description

### Development Principles

- **Security First**: Never log sensitive data (keys, mnemonics, passwords)
- **Test Thoroughly**: Use Preprod testnet, test edge cases
- **Follow Patterns**: Match existing code style and architecture
- **Performance Matters**: Profile critical operations, optimize for speed
- **Documentation**: Comment complex logic, update docs for API changes

### Good First Issues

Check our [GitHub Issues](https://github.com/Gero-Labs/gerowallet/issues) for issues labeled `good first issue` - these are great starting points for new contributors.

---

## Browser Support

- ✅ **Chrome/Chromium** (Manifest V3) - Primary platform
- ✅ **Edge** (Chromium-based)
- ✅ **Brave** (Chromium-based)
- ⚠️ **Firefox** (Manifest V2 compatibility mode - some limitations)
- ❌ Safari (not currently supported)

---

## Security

Gero Wallet takes security seriously. This is a non-custodial wallet handling real cryptocurrency.

### Security Features

**Key protection**
- **Private key encryption**: AES-256 + ChaCha20-Poly1305 AEAD, with PBKDF2 key derivation
- **Context isolation**: private keys never leave the background service worker
- **Hardware wallet support**: Ledger, Trezor, and Keystone
- **PassKey (WebAuthn PRF) wallets**: key encryption bound to platform authenticator hardware, with no spending password

**Access control**
- **Configurable lock methods**: password, PIN, or pattern
- **Two-factor authentication**
- **Auto-lock**: configurable inactivity timeout
- **Separate recovery password**: independent of the spending password

**Transaction and dApp safety**
- **Transaction risk assessment**: inline risk checks before signing
- **dApp security**: connection approval system and domain whitelisting
- **Shielded proving consent**: explicit approval before Midnight proving operations

### Reporting Security Issues

If you discover a security vulnerability, please **DO NOT** open a public issue. Instead:
1. Open a private report via GitHub: [Report a vulnerability](https://github.com/Gero-Labs/gerowallet/security/advisories/new)
2. Provide detailed information about the vulnerability (with keys/mnemonics/passwords redacted)
3. Allow time for the team to patch before public disclosure

See [SECURITY.md](SECURITY.md) for the full policy, scope, and safe-harbor terms.

---

## Community

- **GitHub Issues**: [Report bugs or request features](https://github.com/Gero-Labs/gerowallet/issues)
- **GitHub Discussions**: Ask questions, share ideas
- **Discord**: Join our community (coming soon)
- **Twitter**: [@GeroWallet](https://twitter.com/GeroWallet)

---

## License

Licensed under the **Apache License, Version 2.0** (Copyright A.D. Labs) - see the [LICENSE](LICENSE) and [NOTICE](NOTICE) files for the full terms.

### What this means:
- ✅ Use, modify, and distribute the source code, including for commercial purposes
- ✅ Includes an express patent grant from contributors
- ⚠️ You must retain the copyright, license, and attribution notices (see [NOTICE](NOTICE))
- ⚠️ You must state any changes you make to the files
- ❌ No trademark rights to the "Gero" name or logos are granted

For licensing questions, reach out via [gerowallet.io](https://gerowallet.io).

---

## Acknowledgments

Gero Wallet is built on the shoulders of giants. Special thanks to:

- **Cardano Foundation** - For the Cardano blockchain
- **Input Output (IOHK)** - For Cardano JS SDK and development tools
- **Emurgo** - For CardanoSerializationLib and ecosystem support
- **Open Source Community** - For the amazing libraries and tools we use

### Key Dependencies

- [@cardano-sdk/core](https://github.com/input-output-hk/cardano-js-sdk) - Modern Cardano SDK
- [Vue.js](https://v2.vuejs.org/) - Progressive JavaScript framework
- [Vuetify](https://v2.vuetifyjs.com/) - Material Design component library
- [Dexie.js](https://dexie.org/) - IndexedDB wrapper
- And [many more](package.json)...

---

## Roadmap

### Current (v2.7.x)
- ✅ Conway-era support
- ✅ PassKey authentication
- ✅ Governance (DRep voting)
- ✅ Multi-chain support (Cardano, Midnight, Apex Fusion)
- ✅ Mini-Gero side panel
- ✅ Perpetuals trading

### Upcoming
- 🔜 Bitcoin support (BTC, Lightning, Ordinals, Babylon staking, Thorchain swaps)
- 🔜 Stake pool operator dashboard
- 🔜 Gero Card
- 🔜 Google-backed (MPC) wallets
- 🔜 Remote signing across trusted devices
- 🔜 Copilot insights feed
- 🔜 Enhanced NFT management
- 🔜 Advanced portfolio analytics
- 🔜 Mobile companion app

### Future
- 💡 Cross-chain swaps
- 💡 Social recovery
- 💡 Decentralized identity (DID)

See our [Project Catalyst proposals](https://projectcatalyst.io/) for community-funded development.

---

<div align="center">

**Built with ❤️ by the Gero Labs team**

[Website](https://gerowallet.io) • [Documentation](ARCHITECTURE.md) • [GitHub](https://github.com/Gero-Labs/gerowallet)

**Last Updated**: 2026-08-09

</div>
