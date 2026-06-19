# Gero Wallet

<div align="center">

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-4.9-blue.svg)](https://www.typescriptlang.org/)
[![Vue](https://img.shields.io/badge/Vue.js-2.7-green.svg)](https://v2.vuejs.org/)

A comprehensive Cardano blockchain wallet browser extension (Chrome Manifest V3) merging Web2 and Web3 technologies.

[Features](#key-features) • [Quick Start](#quick-start) • [Documentation](#documentation) • [Contributing](#contributing)

</div>

---

## Overview

**Gero Dashboard** (v2.6.4) is a feature-rich, non-custodial Cardano wallet browser extension that provides comprehensive blockchain management with enterprise-grade security, DeFi integrations, and seamless Web3 connectivity.

### Key Features

**💼 Wallet Management**
- Create and import wallets with BIP39 mnemonic phrases
- Hardware wallet support (Ledger, Trezor, Keystone)
- Multi-account and multi-wallet support
- Enterprise-grade encryption (AES-256 + ChaCha20-Poly1305)

**⛓️ Cardano Native Features**
- **Staking**: Delegate to stake pools and earn rewards
- **Governance**: Participate in Cardano governance (CIP-1694 DRep voting)
- **NFTs**: View, manage, and trade Cardano NFTs
- **Native Tokens**: Full support for Cardano native assets

**🔄 DeFi Integrations**
- DEX aggregation for best swap rates (via DEX Hunter)
- Token swaps across multiple Cardano DEXs
- Portfolio tracking and analytics (TapTools)
- Real-time price feeds (Kraken WebSocket)

**🔐 Security First**
- Non-custodial (you control your keys)
- Transaction risk assessment (Cardano Shield)
- DApp connection approval system
- Hardware wallet integration for enhanced security

**🌐 Web3 Connectivity**
- CIP-30 DApp connector API (window.cardano)
- Multi-signature wallet support
- Real-time blockchain updates (Ably WebSocket)

## Tech Stack

- **Frontend**: Vue.js 2.7 + TypeScript + Vuetify 2.7 (Material Design)
- **Build System**: Vite 4.5.5 with 4 separate configurations
- **State Management**: Custom Vue Observable stores (lightweight, performant)
- **Database**: Dexie 4.0.7 (IndexedDB wrapper with versioned schemas)
- **Cardano SDK**: @cardano-sdk/core v0.46.9 (modern, preferred for new features)
- **Real-time**: Ably v2.11.0 (WebSocket-based blockchain updates)
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

# Create environment file
cp .env.example .env.development
```

### 2. Configure Environment

Edit `.env.development` and add your API keys:

```bash
# Required: Blockchain API (get free key at blockfrost.io)
VITE_BLOCKFROST_API_KEY=your_blockfrost_api_key_here

# Required: Real-time messaging (get free key at ably.com)
VITE_ABLY_API_KEY=your_ably_api_key_here

# Backend URL (localhost for development)
VITE_BACKEND_URL=http://localhost:8081
```

**Get free API keys**:
- [Blockfrost](https://blockfrost.io) - 50,000 requests/day free tier
- [Ably](https://ably.com) - 6M messages/month free tier

### 3. Start Gero Backend

```bash
# Pull Docker image
docker pull skyhawkofficial/gero:gerowallet-backend-v1.76

# Create backend env file (optional, uses defaults)
cp .env.example .env.backend

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
│   │   └── ably.service.ts            # Real-time updates
│   ├── db/                  # Database layer (Dexie/IndexedDB)
│   │   ├── gero-db.ts       # Application-level DB
│   │   └── wallet-db.ts     # Wallet-specific DBs
│   ├── api/                 # External API integrations
│   │   ├── blockchain-api.ts   # Blockfrost/Koios
│   │   ├── dexhunter-api.ts    # DEX aggregation
│   │   └── ...                 # Other integrations
│   ├── shared/              # Reusable utilities and components
│   │   ├── utils/           # Helper functions
│   │   ├── composables/     # Vue composables
│   │   └── components/      # Shared Vue components
│   └── options/             # Extension UI entry points
├── docs/                    # Documentation
│   ├── GETTING_STARTED.md   # Detailed setup guide
│   ├── SECURITY_AUDIT.md    # Security guidelines
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
   - Ably WebSocket for instant blockchain updates
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
- **[Security Audit](docs/SECURITY_AUDIT.md)** - Security practices and audit reports

### For Developers

- **Tech Stack**: Vue.js 2.7, TypeScript, Vite, Dexie, Cardano SDK
- **Key Patterns**: Vue Observable stores, Chrome messaging, two-tier database
- **External Integrations**: Blockfrost, Ably, Kraken, DEX Hunter, TapTools

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

- **Private Key Encryption**: AES-256 + ChaCha20-Poly1305 AEAD
- **Context Isolation**: Private keys never leave background service worker
- **Hardware Wallet Support**: Ledger, Trezor, Keystone integration
- **Transaction Risk Assessment**: Cardano Shield integration
- **DApp Security**: Connection approval system, domain whitelisting

### Reporting Security Issues

If you discover a security vulnerability, please **DO NOT** open a public issue. Instead:
1. Email security reports to: **security@gerowallet.io**
2. Provide detailed information about the vulnerability
3. Allow time for the team to patch before public disclosure

For security audit information and best practices, see [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md).

---

## Community

- **GitHub Issues**: [Report bugs or request features](https://github.com/Gero-Labs/gerowallet/issues)
- **GitHub Discussions**: Ask questions, share ideas
- **Discord**: Join our community (coming soon)
- **Twitter**: [@GeroWallet](https://twitter.com/GeroWallet) (placeholder)

---

## License

This project is licensed under the **Apache License 2.0** - see the [LICENSE](LICENSE) file for details.

### What this means:
- ✅ Commercial use allowed
- ✅ Modification allowed
- ✅ Distribution allowed
- ✅ Patent use allowed
- ⚠️ Must include license and copyright notice
- ⚠️ State changes made to the code

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
- [Ably](https://ably.com/) - Real-time messaging platform
- And [many more](package.json)...

---

## Roadmap

### Current (v2.6.x)
- ✅ Conway-era support
- ✅ PassKey authentication
- ✅ Multi-signature wallets
- ✅ Governance (DRep voting)

### Upcoming (v2.7.x)
- 🔜 Enhanced NFT management
- 🔜 Multi-chain support (Ethereum, Polygon)
- 🔜 Mobile app (React Native)
- 🔜 Advanced portfolio analytics

### Future
- 💡 Cross-chain swaps
- 💡 Social recovery
- 💡 Decentralized identity (DID)

See our [Project Catalyst proposals](https://projectcatalyst.io/) for community-funded development.

---

<div align="center">

**Built with ❤️ by the Gero Labs team**

[Website](https://gerowallet.io) • [Documentation](ARCHITECTURE.md) • [GitHub](https://github.com/Gero-Labs/gerowallet)

**Last Updated**: 2025-12-23

</div>
