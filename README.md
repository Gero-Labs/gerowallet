# Gero Wallet

A comprehensive Cardano blockchain wallet browser extension (Chrome Manifest V3) merging Web2 and Web3 technologies.

## Overview

**Gero Wallet** (v2.6.1) is a multi-chain light wallet providing:
- Portfolio management and real-time price tracking
- Cardano staking and delegation
- Governance participation (CIP-1694 DRep)
- DeFi integrations (DEX aggregation, token swaps, perpetuals)
- Multi-signature wallet functionality
- Hardware wallet support (Ledger, Trezor, Keystone)
- Fiat on/off ramps

## Tech Stack

- **Frontend**: Vue.js 2.7 + TypeScript + Vuetify 2.7
- **Build**: Vite 4.5.5 (4 separate configs for different contexts)
- **State**: Custom Vue Observable stores
- **Database**: Dexie 4.0.7 (IndexedDB)
- **Cardano SDK**: @cardano-sdk/core v0.46.9 (modern)
- **Real-time**: Ably v2.11.0 (WebSocket blockchain updates)

## Prerequisites

1. **Node.js 18+** and npm
2. **Environment file**: Contact [@edridudi](https://github.com/edridudi) for the latest `.env` variables
3. **Gero Backend**: Docker container running on port 8081 (for development)

### Running Gero Backend Container

1. Install Docker Desktop or Rancher Desktop
2. Pull the latest image:
```bash
docker pull skyhawkofficial/gero:gerowallet-backend-v1.76
```
3. Run the container:
```bash
docker run -d --name gerowallet-backend --env-file <path-to-env> -p 8081:8081 skyhawkofficial/gero:gerowallet-backend-v1.76
```

## Development Setup

### Install Dependencies
```bash
npm install
```

### Development (Hot Reload)
```bash
npm run dev              # All contexts (background, content, inject, web)
npm run dev-firefox      # Firefox build
npm run dev:web          # Options page only
npm run dev:background   # Background script only
npm run dev:content      # Content scripts only
npm run dev:inject       # Inject scripts only
```

### Load Extension in Chrome
1. Open `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension/` folder from the project root

### Production Build
```bash
npm run build            # Production build (all contexts)
npm run build:beta       # Beta build with beta environment
```

### Package Extension
```bash
npm run pack             # Create .zip, .crx, and .xpi packages
npm run pack:zip         # Create .zip only
npm run pack:zip:beta    # Create beta .zip
```

### Utilities
```bash
npm run clear            # Clean build artifacts
npm run typecheck        # TypeScript compilation check
npm run lint             # ESLint check
```

## Project Structure

```
src/
├── chrome/              # Extension-specific code (background, messaging, serialization)
├── modules/             # Feature modules (dashboard, staking, governance, swap, etc.)
├── stores/              # Vue Observable state management
├── services/            # Business logic (walletManager, ably, sync)
├── db/                  # Dexie database layer (gero-db, wallet-db)
├── api/                 # External API integrations (blockfrost, koios, dexhunter, etc.)
├── shared/              # Reusable utilities and components
├── options/             # Extension options page entry point
├── popup/               # Extension popup entry point
└── sidepanel/           # Extension side panel entry point
```

## Key Features

### Wallet Management
- Create/import wallets with mnemonic phrases
- Hardware wallet integration (Ledger, Trezor, Keystone)
- Multi-account support
- Password-protected private keys (AES-256 encryption)

### Cardano Features
- **Staking**: Delegate to stake pools, view rewards
- **Governance**: Register as DRep, vote on proposals (CIP-1694)
- **Transactions**: Send/receive ADA and native tokens
- **DeFi**: Token swaps (DEX Hunter), perpetuals trading (Strike Finance)

### Security
- All private keys encrypted
- Transaction risk assessment (Cardano Shield)
- DApp connection approval system
- Hardware wallet support for enhanced security

### Real-time Updates
- Ably WebSocket for blockchain notifications
- Live price data (Kraken WebSocket)
- Portfolio tracking and analytics

## Development Notes

### Important Patterns
- **Conway-Era Certificates**: Use modern certificate types (`Unregistration`, `StakeRegistrationDelegation`)
- **Fee Calculation**: Include witness overhead (~110 bytes per signature)
- **Change Outputs**: Always resolve for certificate/withdrawal transactions
- **Cross-Context Communication**: Use `broadcastFromBackground()` for store sync

### Recent Fixes (2025-01-14)
- **Transaction Fee Calculation**: Fixed Conway-era certificate transaction fees
  - Added witness overhead to CBOR size calculation
  - Ensured change outputs included in fee estimation
  - Updated signature detection for new certificate types

See `CLAUDE.md` for comprehensive development guide.

## Browser Support

- Chrome/Chromium (Manifest V3)
- Firefox (Manifest V2 compatibility mode)

## Contributing

This is a financial application handling real cryptocurrency. Always:
- Prioritize security and test thoroughly
- Follow existing patterns and conventions
- Never log sensitive data (keys, mnemonics, passwords)
- Use modern Cardano JS SDK for new features

## Documentation

- **Developer Guide**: See `CLAUDE.md` for detailed technical documentation
- **Issue Tracking**: [GitHub Issues](https://github.com/Gero-Labs/gerowallet/issues)

## License

Proprietary - Gero Labs

---

**Last Updated**: 2025-01-14
