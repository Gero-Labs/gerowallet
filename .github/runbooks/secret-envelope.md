# Secret envelope (gpw2): release, rollout and rollback runbook

This runbook covers moving every secret a password wallet stores under its spending password to the `gpw2` envelope. The job is to do that without ever locking a user out of their wallet.

Code: `src/shared/utils/secretEnvelope.ts` (format), `crypto.ts` (readers), `secretWriters.ts` (writers), `src/chrome/secretMigration.ts` (on-unlock migration), `passwordRotation.ts` (spending-password change). Contributor rules are in `.claude/skills/gerowallet-dev/references/security.md`.

## 1. What changes for a wallet

| Field | Before | After (flag on) |
|---|---|---|
| Root key (`wallets.encryptedPrivateKey`) | raw hex PBKDF2-SHA512 c=19162 → ChaCha20-Poly1305, or legacy CryptoJS-wrapped | `gpw2` |
| Mnemonic (`wallets.encryptedMnemonic`) | `gpw1` Argon2id, or legacy CryptoJS (MD5, 1 iteration) | `gpw2` |
| 2FA TOTP secret, backup codes, legacy PIN hash (`wallet-{id}.config`) | `gpw1` or legacy CryptoJS | `gpw2` |
| SPO cold key, password-encrypted (`wallet-{id}.config`) | raw hex PBKDF2 | `gpw2` |
| Strike key (`chrome.storage.local`) | raw hex PBKDF2 | `gpw2` when written or when the password changes; not migrated on unlock |
| MPC device share | `gpw1` / legacy | `gpw2` when written; not migrated on unlock |

`gpw2` = Argon2id → XChaCha20-Poly1305. The header is authenticated and has a purpose byte, so a blob only opens for the field it was written for.

## 2. Compatibility matrix

| Build | Reads gpw2 | Writes gpw2 | Migrates on unlock |
|---|---|---|---|
| Before the reader release | **no** | no | no |
| First release with the readers (**N**), flag off | yes | no | no |
| N or later, flag `isKeyEnvelopeV2Enabled` on | yes | yes | yes |

**The one way to lock users out:** ship a build from before N to a user whose wallet has already been migrated. Their correct password then fails as "wrong password".

## 3. Release rules

1. **The flag is the gate.** The readers and the writer merged to `development` together, so release N carries both. The writer is inert until the flag is on, and that is the only thing separating "can read gpw2" from "writes gpw2".
2. **No flag before adoption.** Leave `isKeyEnvelopeV2Enabled` off until N (or later) is on the large majority of installs (Chrome Web Store dashboard, installs by version). An install still below N is fine while the flag is off, because nothing writes gpw2. Release N does change one thing with the flag off: a spending-password change now re-encrypts 2FA data, the SPO cold key and the Strike key, and works for Bitcoin and Midnight wallets (device-test T6 and T7 before release).
3. **Every build must pass the reader guard.** `ci-cd.yml` runs `node scripts/check-secret-envelope-readers.mjs` before building. Before cutting a hotfix or rollback from a tag, check that tag too:

   ```bash
   node scripts/check-secret-envelope-readers.mjs v2.7.3
   ```

   A tag that fails must **never** be published once the flag has been on for anyone. Workflows run from the ref being built, so an old tag does not carry this step: the manual check above is the control.
4. **Rolling back means a new build.** It is a new version number built from a ref that passes the guard. It never means republishing an old package.
5. **Record each release** in the table in section 8.

## 4. Turning the flag on

The flag is defined in the gero-sync flag service. The UI mirrors it to `chrome.storage.local.featureFlags` for the background. It must exist there with default `false` before release N ships.

1. **Synthetic canary.** Set up staff test profiles holding only synthetic wallets: Cardano, Bitcoin and Midnight, one legacy wallet created on v2.6.3, one with 2FA, one with an SPO cold key. Flip the flag for them, run the device test (section 7) and check the counters (section 5).
2. **Staff wallets.** Enable for staff. Watch support and counters for at least one release cycle.
3. **Everyone.** Enable globally.

**Stop criteria.** Flip the flag **off** straight away if any of these happen:
- any `equivalence_fail` or `readback_fail` in counters from a canary or staff profile;
- any report of a correct spending password being refused, a 2FA code refused after a password change, or changed addresses;
- unlock or sign latency the user can see (Argon2id runs on every password decrypt of a `gpw2` root key).

## 5. Monitoring

Nothing is sent off the device. Each extension keeps local, non-sensitive counts of migration outcomes in `chrome.storage.local.keyEnvelopeMigration`: `migrated`, `decrypt_fail`, `equivalence_fail`, `readback_fail`, `cas_conflict`, `write_error`. Successful no-ops (`already-current`, `disabled`, `not-applicable`) are not counted.

- `cas_conflict`: another write (usually a password change) landed first. Harmless; it retries on the next unlock.
- `write_error`: storage failed, e.g. quota. Harmless; every reader still opens every field, and it retries.
- `decrypt_fail`: should not happen, since migration runs only after a successful decrypt. Investigate.
- `equivalence_fail`: the stored root key does not match the stored mnemonic. Nothing was written. **Stop and investigate.**
- `readback_fail`: storage returned something other than what was written. **Stop and investigate.**

### Inspecting a profile

Run this in the extension's service-worker console (`chrome://extensions` → Gero → *Inspect views: service worker*). It prints **only the format of each field**, never a value:

```js
const cls = v => Array.isArray(v) ? v.map(cls).join(',')
  : typeof v !== 'string' ? String(v)
  : v.startsWith('gpw2.') ? 'gpw2' : v.startsWith('gpw1.') ? 'gpw1'
  : v.startsWith('U2FsdGVk') ? 'legacy-cryptojs' : /^[0-9a-f]+$/i.test(v) ? 'raw-pbkdf2' : 'other';
const names = new Set((await indexedDB.databases()).map(d => d.name));
const open = n => new Promise((ok, err) => { const r = indexedDB.open(n); r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error); });
const all = (db, t) => new Promise(ok => { const q = db.transaction(t).objectStore(t).getAll(); q.onsuccess = () => ok(q.result); });
const rows = [];
for (const w of await all(await open('GeroWalletDatabase'), 'wallets')) {
  const cfg = names.has(`wallet-${w.id}`) ? await all(await open(`wallet-${w.id}`), 'config') : [];
  const pick = k => cls(cfg.find(r => r.key === k)?.value);
  rows.push({ id: w.id, chain: w.chain, rootKey: cls(w.encryptedPrivateKey), mnemonic: cls(w.encryptedMnemonic),
    totp: pick('encryptedTotpSecret'), backupCodes: pick('encryptedBackupCodes'), pinHash: pick('encryptedPinHash'),
    coldKey: pick('spo_encryptedColdKey') });
}
console.table(rows);
console.log((await chrome.storage.local.get('keyEnvelopeMigration')).keyEnvelopeMigration ?? {});
```

## 6. If something goes wrong

1. **Flip `isKeyEnvelopeV2Enabled` off.** New gpw2 writes and migrations stop at the next write or unlock. Wallets that were already migrated keep working, because every build from N on reads gpw2. Migrated data is never written back to a weaker format.
2. **Do not publish an older build** (section 3).
3. **If a user reports a correct password being refused:**
   - Ask for their extension version first. A version below N on a migrated wallet is the lockout case: have them update to N or later, and the same password works again.
   - Otherwise collect the section 5 output (formats and counters only). **Never** ask for the password, mnemonic or any blob.
   - Recovery of last resort is restoring from the mnemonic, which the user holds.
4. **If a 2FA unlock fails after a password change made on an older build:** before the fix, a password change left the TOTP secret under the old password. Unlock decrypts that secret with the password being entered, so neither the old nor the new password gets through, and the disable-2FA dialog sits behind unlock. The fix does not repair wallets already in this state. Recovery: remove the wallet and restore it from its mnemonic with a new spending password, then set up 2FA again. The funds are unaffected.

## 7. Device test plan

Run this on each release candidate of release N (and of any later release that changes these files). Use a spare Chrome profile and **synthetic wallets only**.

**Setup for the upgrade path.** Uninstalling wipes IndexedDB, so a store build and an unpacked build cannot be swapped to test a migration. Instead:
1. Build the old version into a fixed folder, pinning the Web Store `key` into the built `extension/manifest.json` so the extension ID is stable.
2. Load that folder unpacked and create the wallets.
3. Build the candidate into the **same** folder (same `key`) and press *Reload* on `chrome://extensions`. This is an in-place update, so IndexedDB is kept.

**Forcing the flag on a test profile.** The options page rewrites the mirror from the flag service when it loads. Set it after the options page has loaded, or enable the flag for the test account in a non-production flag service.

```js
const { featureFlags = {} } = await chrome.storage.local.get('featureFlags');
await chrome.storage.local.set({ featureFlags: { ...featureFlags, isKeyEnvelopeV2Enabled: true } });
```

| # | Case | Expected |
|---|---|---|
| T1 | Flag off, candidate build: unlock, sign, reveal recovery phrase on a legacy wallet | Works; formats unchanged (inspector) |
| T2 | Flag on: Cardano legacy wallet (v2.6.3), unlock with password, sign a tx | Root key, mnemonic and 2FA fields become `gpw2`; counters show `migrated: 1`; receive/stake addresses unchanged; tx signs |
| T3 | Flag on: Bitcoin wallet, unlock, send on testnet | Fields become `gpw2`; address unchanged; PSBT signs |
| T4 | Flag on: Midnight wallet, unlock, shielded and unshielded op on the test network | Fields become `gpw2`; addresses unchanged |
| T5 | Flag on: wallet with 2FA; migrate, lock, unlock with password + TOTP | TOTP accepted |
| T6 | Change spending password (flag on and off), then lock/unlock with the new password + 2FA | New password works; old refused; 2FA accepted; SPO cold key and Strike key still usable |
| T7 | Change spending password on a Bitcoin and a Midnight wallet | Succeeds (used to fail as "wrong password") |
| T8 | SPO wallet with a password cold key: migrate, then KES rotation | Cold key `gpw2`; rotation signs |
| T9 | PassKey (PRF) wallet | Untouched; unlock and sign work |
| T10 | Wrong password with flag on | Refused; no field changes; no counter change |
| T11 | Flag off again after T2–T8 | Every migrated wallet still unlocks, signs and reveals its phrase |
| T12 | Kill the service worker mid-unlock (`chrome://serviceworker-internals` → Stop), unlock again | Wallet usable; migration completes on a later unlock |
| T13 | Time a sign on a `gpw2` wallet on the lowest supported device | Acceptable; record the number to pin Argon2id write params |

**Record:**

| Date | Candidate version / commit | Tester | Device | T1–T13 result | Notes |
|---|---|---|---|---|---|
| | | | | | |

## 8. Release record

| Version | Date | Commit | Contains | Reader guard | Flag state after release |
|---|---|---|---|---|---|
| | | | readers + writer + migration (N) | | off |
| | | | (flag rollout, no release needed) | | off → canary → staff → all |

## 9. Residual exposure

- **Wallets that never migrate.** A wallet is only upgraded after a password operation on release N or later with the flag on. Clients that stay on older versions, or never sign with the spending password (the only trigger), keep their existing formats, including legacy CryptoJS mnemonic blobs on old wallets.
- **Copies taken before migration.** A disk image, a copied Chrome profile or a backup keeps the old blobs forever; migration cannot reach them. If such a copy may have leaked:
  1. Change the spending password (all fields are re-encrypted under the new one).
  2. If exposure is likely, move funds to a wallet with a new mnemonic.
- **The lock-screen PIN hash** (`pinHash`) is stored as a hash, not under the spending password, so it is outside this scheme.
