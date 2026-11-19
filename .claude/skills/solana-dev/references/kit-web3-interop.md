---
title: Kit ↔ web3.js Interop
description: How to handle legacy web3.js code — web3.js v3 (Kit internals, 3.0.0 since Oct 2026) is the migration target; defer migration mechanics to the official migration skill.
---

# Kit ↔ web3.js Interop

## The landscape (2026)

`@solana/web3.js` v3 is a rebuild of the classic class-based API (`Connection`, `Keypair`, `Transaction`) on top of `@solana/kit` internals, co-developed by Blueshift and the Solana Foundation.

**Status: stable.** `@solana/web3.js` 3.0.0 shipped on 2026-10-01 (3.1.1 as of Oct 19) together with a new `@solana/wallet-adapter` 3.0 package. 3.1.x depends on `@solana/kit ^8.5.0` (3.0.x on `^8.4.0`). 3.x is now the `latest` dist-tag, so `npm i @solana/web3.js` installs it; a codebase that has to stay on 1.x pins `@solana/web3.js@1`. The v3 work now lives on the repo's `main` branch (the `v3.x` branch is gone; 1.x continues on `maintenance/v1.x`). Treat v3 as the migration target for v1 codebases, not a default recommendation for new work.

The [3.0.0 release notes](https://github.com/solana-foundation/solana-web3.js/blob/main/packages/web3.js/RELEASE_NOTES.md) list the breaking changes from 1.x. The ones that bite most: `Keypair.generate()` / `fromSecretKey()` / `fromSeed()` and `Transaction.serialize()` are async, `Connection`'s implicit default commitment is now `confirmed` (was `finalized`), many `Connection` results are `bigint` and `Uint8Array` instead of `number` and `Buffer`, and `getRecentBlockhash` / `FeeCalculator` / the `Account` class are gone.

## Decision routing

1. **Greenfield code** → use `@solana/kit` + plugins directly. Don't add web3.js at all. See [kit/overview.md](kit/overview.md).
2. **Migrating a v1 codebase** → use the official migration skill. It is maintained alongside the source in the solana-web3.js repo and kept current with each release, so prefer it over hand-migrating from memory:
   ```bash
   npx skills add https://github.com/solana-foundation/solana-web3.js/tree/main/skills/web3js-v1-to-v3-migration
   ```
   (Or install from the repo and select it: `npx skills add solana-foundation/solana-web3.js -s web3js-v1-to-v3-migration`.) A companion guide in the same repo covers `@solana/spl-token` → `@solana-program/token`.
3. **Found `@solana/web3-compat` in a codebase** → it is superseded (an interim shim running the v1 API on Kit 5). Do not introduce it in new work; plan a migration to v3 or Kit.
4. **A dependency expects v1 objects** (`Connection`, sync `Keypair`) → upgrade the dependency or isolate it in an adapter module. Do not downgrade your app to v1, and do not let legacy class types leak across the app.

## Why the boundary is cheap in v3

Because v3 is built on Kit, the seams are shared types rather than conversion shims:

- `PublicKey` is a deprecated alias of v3's `Address` class.
- A v3 `Keypair` structurally satisfies Kit's `KeyPairSigner` — it can be passed directly to Kit APIs, Kit plugins, and Codama-generated clients.

The migration skill covers the rest (async signing, `bigint` RPC numerics, removed APIs, commitment defaults).

## References

- Repo (v3 on `main`): https://github.com/solana-foundation/solana-web3.js
- Migration guide: https://github.com/solana-foundation/solana-web3.js/blob/main/docs/web3js-v1-to-v3-migration.md
- Migration skill: https://github.com/solana-foundation/solana-web3.js/blob/main/skills/web3js-v1-to-v3-migration/SKILL.md
- API docs: https://solana-foundation.github.io/solana-web3.js/
