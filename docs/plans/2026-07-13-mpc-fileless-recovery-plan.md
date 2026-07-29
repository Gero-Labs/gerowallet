# MPC Fileless Recovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Google MPC wallet's downloadable `.gmpc` recovery file with a password-encrypted recovery share stored on `gero-backend` (client Argon2id + server AES-GCM at rest), enabling fileless Google+password recovery on a new device, plus a revealable SRP escape hatch and a `SET_RECOVERY_PASSWORD` action that never asks the old password.

**Architecture:** Same self-hosted Shamir 2-of-3 (device + login + recovery). The recovery share moves from a user-held file to a backend blob encrypted under the user's recovery password. Changing the recovery password is a crash-safe re-split (stage `deviceShareNext` → backend `rotate` login → promote → store recovery → clear cache) with resume-on-unlock. Reveal-SRP reconstructs entropy → mnemonic behind a device-secret re-auth.

**Tech Stack:** Backend — Java 17 / Spring Boot, JPA (Hibernate `ddl-auto: update`, no migration file), reuse `GoogleIdTokenVerifier` + `LoginShareCipher`. Extension — Vue 2.7 + TypeScript + Vuetify 2.7, Dexie, `@cardano-sdk/core`, `shamir-secret-sharing`, Argon2id + XChaCha20 (`@noble`), vitest.

**Design spec:** `docs/plans/2026-07-13-mpc-fileless-recovery-design.md`.

**Worktrees:** extension `gerowallet-google-mpc` (branch `feat/google-mpc-wallet`); backend `gero-backend-google-mpc`. Backend and extension tasks land in their respective repos; commit in each.

## Global Constraints

- **Custody premise (D3, accepted):** the backend now holds 2 of 3 shares (login + encrypted-recovery). Device share NEVER leaves the device. The recovery password is the load-bearing secret; enforce a **12-char minimum + strength meter**, high Argon2id params, and a **second server-side AES-GCM at-rest wrap** on the recovery blob.
- **Never log or return secrets:** never log `idToken` / `prfOutput` / any share / recovery password / SRP. Backend responses **project explicit fields only** — never a raw entity/row, never `err.message`, never a token/share.
- **SSRF (OX context-analysis):** the client posts to **literal `/api/mpc/...` paths on a config baseURL** (hostname not user-controlled) → **do not add URL-validation code** (over-protecting is the anti-pattern).
- **Never commit** `src/stores/featureFlagsStore.ts` (local `isGoogleWalletEnabled` flip; ships dark).
- **i18n:** every new `us.ts` key gets a `de.ts` counterpart; reuse existing keys where present.
- **Reuse, don't reinvent crypto:** `encryptRecoveryShare`/`decryptRecoveryShare`, `createMpcShareSet`, `reconstructEntropy`, `reconstructAndValidateEntropy`, `entropyToMnemonic`. No hand-rolled GF(256).
- **Backend `enroll` stays insert-only (409);** rotation uses the new `/api/mpc/rotate` UPDATE path.
- **Non-custodial invariant** holds up to D3; testnet-first, feature-flagged; D3 is explicitly in scope for the pre-mainnet third-party audit.
- **TDD:** failing test → run (fail) → implement → run (pass) → commit. Frequent commits. DRY / YAGNI.
- **Verifying Vue full-page components:** there is no component test harness — verify SFC/compile with `npx vite build --config vite.config.mts`; unit-test extracted pure logic (e.g. the recovery-password strength validator) with vitest.

## Task graph

Backend (in `gero-backend-google-mpc`): **T1** entity/repo → **T2** service → **T3** recovery endpoints → **T4** rotate endpoint → **T5** rate-limit/config.
Client (in `gerowallet-google-mpc`): **T6** foundation (Wallet field, db helpers, api methods, message types) → **T7** store flow + onboarding wiring → **T8** recover-on-new-device rework → **T9** reveal-SRP → **T10** set-recovery-password (re-split) + resume-on-unlock → **T11** onboarding UI → **T12** settings UI.

T6 is the client foundation; T7–T12 consume it. Backend T1–T5 are independent of the client and can proceed in parallel with T6+.

---

### Task 1: Recovery-share entity + repository

**Files:**
- Create: `src/main/java/io/gerowallet/repositories/mpc/entity/MpcRecoveryShareEntity.java`
- Create: `src/main/java/io/gerowallet/repositories/mpc/MpcRecoveryShareRepository.java`
- Test (create): `src/test/java/io/gerowallet/repositories/mpc/MpcRecoveryShareRepositoryTest.java`

All paths are under repo `/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc`.

**Interfaces:**
- Consumes: nothing (first backend task). Mirrors the existing `MpcLoginShareEntity` / `MpcLoginShareRepository` style but is **replace-allowed** — it does NOT implement `Persistable` and has no `isNew` insert-only trick, so `repo.save()` issues an UPDATE when the composite PK row already exists (required by change-recovery-password re-store).
- Produces (consumed by Task 2 `MpcRecoveryShareService` and later slice-boot tests):
  - `io.gerowallet.repositories.mpc.entity.MpcRecoveryShareEntity` — `@Entity @Table(name="mpc_recovery_shares")`, composite `@IdClass(MpcRecoveryShareEntity.Key.class)` over `(subject, chain, network)`; columns `String encryptedShare` (`@Column(columnDefinition="text", nullable=false)`), `String publicKey` (`@Column(columnDefinition="text", nullable=false)`), `Instant createdAt` (`@Column(nullable=false)`, stamped in `@PrePersist`).
  - Convenience ctor `MpcRecoveryShareEntity(String subject, String chain, String network, String encryptedShare, String publicKey)`.
  - Nested `MpcRecoveryShareEntity.Key(String subject, String chain, String network) implements Serializable`.
  - `io.gerowallet.repositories.mpc.MpcRecoveryShareRepository extends JpaRepository<MpcRecoveryShareEntity, MpcRecoveryShareEntity.Key>` with `Optional<MpcRecoveryShareEntity> findBySubjectAndChainAndNetwork(String subject, String chain, String network)`.

---

- [ ] **Step 1: Write the failing test**

Create `src/test/java/io/gerowallet/repositories/mpc/MpcRecoveryShareRepositoryTest.java`. Mirrors `MpcLoginShareRepositoryTest` (`@DataJpaTest`, `@Autowired` repo), but the second-save case asserts an **UPDATE that overwrites** (replace-allowed) rather than a `DataIntegrityViolationException` — this is the exact behavioral difference from the login-share entity.

```java
package io.gerowallet.repositories.mpc;

import io.gerowallet.repositories.mpc.entity.MpcRecoveryShareEntity;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

@DataJpaTest
class MpcRecoveryShareRepositoryTest {
    @Autowired MpcRecoveryShareRepository repo;

    @Test void storesAndFindsOneSharePerUser() {
        repo.save(new MpcRecoveryShareEntity("sub-1", "cardano", "mainnet", "enc-blob", "xpub-1"));
        Optional<MpcRecoveryShareEntity> found =
            repo.findBySubjectAndChainAndNetwork("sub-1", "cardano", "mainnet");
        assertTrue(found.isPresent());
        assertEquals("enc-blob", found.get().getEncryptedShare());
        assertEquals("xpub-1", found.get().getPublicKey());
        assertNotNull(found.get().getCreatedAt());
        assertTrue(repo.findBySubjectAndChainAndNetwork("sub-1", "cardano", "testnet").isEmpty());
    }

    @Test void secondSaveForSamePkUpdatesInsteadOfFailing() {
        repo.saveAndFlush(new MpcRecoveryShareEntity("sub-1", "cardano", "mainnet", "first-blob", "xpub-1"));
        // Replace-allowed: unlike the login share (Persistable insert-only), a second save
        // for the same composite PK must UPDATE the existing row (change-recovery-password
        // re-stores a fresh blob). No DataIntegrityViolationException; the row is overwritten.
        repo.saveAndFlush(new MpcRecoveryShareEntity("sub-1", "cardano", "mainnet", "second-blob", "xpub-2"));
        Optional<MpcRecoveryShareEntity> found =
            repo.findBySubjectAndChainAndNetwork("sub-1", "cardano", "mainnet");
        assertTrue(found.isPresent());
        assertEquals("second-blob", found.get().getEncryptedShare());
        assertEquals("xpub-2", found.get().getPublicKey());
        assertEquals(1, repo.count());
    }
}
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && ./mvnw -q -Dtest=MpcRecoveryShareRepositoryTest test
```

Expected: **compilation failure** (BUILD FAILURE) — `cannot find symbol: class MpcRecoveryShareEntity` / `MpcRecoveryShareRepository` do not yet exist. The test cannot compile, which is the expected red state.

- [ ] **Step 3: Implement the entity**

Create `src/main/java/io/gerowallet/repositories/mpc/entity/MpcRecoveryShareEntity.java`. Same composite-key + Lombok shape as `MpcLoginShareEntity`, but **plain `@Entity`** — no `implements Persistable`, no `isNew` field, no `@PostLoad`. `repo.save()` therefore merges (UPDATE) when the PK row exists.

```java
package io.gerowallet.repositories.mpc.entity;

import jakarta.persistence.*;
import lombok.*;

import java.io.Serializable;
import java.time.Instant;

/**
 * Exactly ONE encrypted MPC recovery share per (Google {@code sub}, chain,
 * network). This is the password-encrypted recovery share (client
 * Argon2id + XChaCha20 blob), wrapped once more with AES-GCM at rest by the
 * service layer — never parse or log it. {@code publicKey} is the non-secret
 * xpub anchor used to validate a reconstruct on a fresh device.
 *
 * <p>Unlike {@link MpcLoginShareEntity}, this entity is <b>replace-allowed</b>:
 * it does NOT implement {@code Persistable} and has no insert-only guard, so
 * {@code save()} issues an {@code UPDATE} (merge) when the composite id row
 * already exists. Change-recovery-password re-stores a fresh blob for the same
 * PK, which must overwrite rather than 409.
 */
@Entity
@Table(name = "mpc_recovery_shares")
@IdClass(MpcRecoveryShareEntity.Key.class)
@Data
@NoArgsConstructor
@AllArgsConstructor
public class MpcRecoveryShareEntity {

    @Id
    private String subject;   // Google sub
    @Id
    private String chain;
    @Id
    private String network;

    @Column(columnDefinition = "text", nullable = false)
    private String encryptedShare;

    @Column(columnDefinition = "text", nullable = false)
    private String publicKey;   // non-secret xpub anchor

    @Column(nullable = false)
    private Instant createdAt;

    public MpcRecoveryShareEntity(String subject, String chain, String network,
                                  String encryptedShare, String publicKey) {
        this.subject = subject;
        this.chain = chain;
        this.network = network;
        this.encryptedShare = encryptedShare;
        this.publicKey = publicKey;
    }

    /** Stamp creation time on first INSERT; left unchanged on subsequent UPDATEs. */
    @PrePersist
    void onInsert() {
        if (createdAt == null) {
            createdAt = Instant.now();
        }
    }

    @Data
    @NoArgsConstructor
    @AllArgsConstructor
    public static class Key implements Serializable {
        private String subject;
        private String chain;
        private String network;
    }
}
```

- [ ] **Step 4: Implement the repository**

Create `src/main/java/io/gerowallet/repositories/mpc/MpcRecoveryShareRepository.java`. Mirrors `MpcLoginShareRepository` but only the finder the service needs (no `existsBy...`).

```java
package io.gerowallet.repositories.mpc;

import io.gerowallet.repositories.mpc.entity.MpcRecoveryShareEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface MpcRecoveryShareRepository
        extends JpaRepository<MpcRecoveryShareEntity, MpcRecoveryShareEntity.Key> {
    Optional<MpcRecoveryShareEntity> findBySubjectAndChainAndNetwork(String subject, String chain, String network);
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && ./mvnw -q -Dtest=MpcRecoveryShareRepositoryTest test
```

Expected: **BUILD SUCCESS**, `Tests run: 2, Failures: 0, Errors: 0, Skipped: 0`. `storesAndFindsOneSharePerUser` confirms insert + finder + `createdAt` stamped + network scoping; `secondSaveForSamePkUpdatesInsteadOfFailing` confirms replace-allowed UPDATE (row count stays 1, blob + publicKey overwritten).

- [ ] **Final Step: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && \
git add src/main/java/io/gerowallet/repositories/mpc/entity/MpcRecoveryShareEntity.java \
        src/main/java/io/gerowallet/repositories/mpc/MpcRecoveryShareRepository.java \
        src/test/java/io/gerowallet/repositories/mpc/MpcRecoveryShareRepositoryTest.java && \
git commit -m "feat(mpc): add MpcRecoveryShareEntity + repository (replace-allowed)

Password-encrypted recovery share store, mirroring the login-share stack but
plain @Entity (no Persistable insert-only guard) so change-recovery-password
UPDATEs the existing (subject,chain,network) row. Columns: encryptedShare,
publicKey (xpub anchor), createdAt. Repo finder findBySubjectAndChainAndNetwork.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```


---

### Task 2: MpcRecoveryShareService (store upsert + fetch, double-wrapped at rest)

**Files:**
- Create: `gero-backend-google-mpc/src/main/java/io/gerowallet/service/mpc/RecoveryFetchResult.java`
- Create: `gero-backend-google-mpc/src/main/java/io/gerowallet/service/mpc/MpcRecoveryShareService.java`
- Test (create): `gero-backend-google-mpc/src/test/java/io/gerowallet/service/mpc/MpcRecoveryShareServiceTest.java`

**Interfaces:**
- Consumes (from Task 1 + existing beans):
  - `MpcRecoveryShareEntity(String subject, String chain, String network, String encryptedShare, String publicKey)` — plain `@Entity` (NO `Persistable`/`isNew`), Lombok `@Data` (so `setEncryptedShare(String)`, `setPublicKey(String)`, `getEncryptedShare()`, `getPublicKey()` exist); `repo.save()` UPDATEs when the row is loaded, INSERTs when new.
  - `MpcRecoveryShareRepository.findBySubjectAndChainAndNetwork(String,String,String) → Optional<MpcRecoveryShareEntity>`
  - `GoogleIdTokenVerifier.verifyAndGetSubject(String idToken) → String sub` (throws `MpcAuthException` → 401)
  - `LoginShareCipher.encrypt(String) → String`, `LoginShareCipher.decrypt(String) → String`, `LoginShareCipher.isEnabled() → boolean`
  - `MpcNotEnrolledException()` (→ 404), `MpcNotConfiguredException(String)` (→ 503), `MpcAuthException` (→ 401)
- Produces (consumed by Task 3 controller + tests):
  - `MpcRecoveryShareService.store(String idToken, String chain, String network, String encryptedRecovery, String publicKey) → void`
  - `MpcRecoveryShareService.fetch(String idToken, String chain, String network) → RecoveryFetchResult`
  - `record RecoveryFetchResult(String encryptedRecovery, String publicKey)`

---

- [ ] **Step 1: Write the failing test**

Create `gero-backend-google-mpc/src/test/java/io/gerowallet/service/mpc/MpcRecoveryShareServiceTest.java` (mirrors `MpcLoginShareServiceTest` — Mockito unit test, `cipher.isEnabled()` lenient-stubbed true in `@BeforeEach`, disabled-path tests re-stub false):

```java
package io.gerowallet.service.mpc;

import io.gerowallet.repositories.mpc.MpcRecoveryShareRepository;
import io.gerowallet.repositories.mpc.entity.MpcRecoveryShareEntity;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class MpcRecoveryShareServiceTest {
    @Mock GoogleIdTokenVerifier verifier;
    @Mock LoginShareCipher cipher;
    @Mock MpcRecoveryShareRepository repo;
    @InjectMocks MpcRecoveryShareService service;

    @BeforeEach
    void cipherEnabledByDefault() {
        // Service gates on cipher.isEnabled(); enable it for normal-path tests.
        // (Mockito would default the boolean to false.) Disabled-path tests re-stub false.
        lenient().when(cipher.isEnabled()).thenReturn(true);
    }

    @Test void storeInsertsWhenNoneExists() {
        when(verifier.verifyAndGetSubject("tok")).thenReturn("sub-1");
        when(repo.findBySubjectAndChainAndNetwork("sub-1","cardano","testnet")).thenReturn(Optional.empty());
        when(cipher.encrypt("client-blob")).thenReturn("at-rest");
        service.store("tok","cardano","testnet","client-blob","xpub-anchor");
        ArgumentCaptor<MpcRecoveryShareEntity> cap = ArgumentCaptor.forClass(MpcRecoveryShareEntity.class);
        verify(repo).save(cap.capture());
        assertEquals("sub-1", cap.getValue().getSubject());
        assertEquals("at-rest", cap.getValue().getEncryptedShare()); // server-wrapped
        assertEquals("xpub-anchor", cap.getValue().getPublicKey());
    }

    @Test void storeReplacesExistingRow() {
        // Upsert: row already present -> load, overwrite fields, save (UPDATE). No 409.
        when(verifier.verifyAndGetSubject("tok")).thenReturn("sub-1");
        var existing = new MpcRecoveryShareEntity("sub-1","cardano","testnet","old-at-rest","old-xpub");
        when(repo.findBySubjectAndChainAndNetwork("sub-1","cardano","testnet")).thenReturn(Optional.of(existing));
        when(cipher.encrypt("new-blob")).thenReturn("new-at-rest");
        service.store("tok","cardano","testnet","new-blob","new-xpub");
        ArgumentCaptor<MpcRecoveryShareEntity> cap = ArgumentCaptor.forClass(MpcRecoveryShareEntity.class);
        verify(repo).save(cap.capture());
        assertSame(existing, cap.getValue());               // same loaded row -> UPDATE
        assertEquals("new-at-rest", cap.getValue().getEncryptedShare());
        assertEquals("new-xpub", cap.getValue().getPublicKey());
    }

    @Test void storeRejectsBadToken() {
        when(verifier.verifyAndGetSubject("bad")).thenThrow(new MpcAuthException("x"));
        assertThrows(MpcAuthException.class,
            () -> service.store("bad","cardano","testnet","blob","xpub"));
        verify(repo, never()).save(any());
    }

    @Test void storeShortCircuitsWhenCipherDisabled() {
        when(cipher.isEnabled()).thenReturn(false);
        assertThrows(MpcNotConfiguredException.class,
            () -> service.store("tok","cardano","testnet","blob","xpub"));
        verifyNoInteractions(verifier); // 503 before any token work
        verify(repo, never()).save(any());
    }

    @Test void fetchReturnsBlobAndPublicKey() {
        // Round-trips the double-wrap: cipher.decrypt undoes the at-rest wrap on read.
        when(verifier.verifyAndGetSubject("tok")).thenReturn("sub-1");
        var e = new MpcRecoveryShareEntity("sub-1","cardano","testnet","at-rest","xpub-anchor");
        when(repo.findBySubjectAndChainAndNetwork("sub-1","cardano","testnet")).thenReturn(Optional.of(e));
        when(cipher.decrypt("at-rest")).thenReturn("client-blob");
        RecoveryFetchResult r = service.fetch("tok","cardano","testnet");
        assertEquals("client-blob", r.encryptedRecovery()); // == the client-side blob put in on store
        assertEquals("xpub-anchor", r.publicKey());
    }

    @Test void fetchThrowsWhenNotEnrolled() {
        when(verifier.verifyAndGetSubject("tok")).thenReturn("sub-1");
        when(repo.findBySubjectAndChainAndNetwork("sub-1","cardano","testnet")).thenReturn(Optional.empty());
        assertThrows(MpcNotEnrolledException.class, () -> service.fetch("tok","cardano","testnet"));
    }

    @Test void fetchRejectsBadToken() {
        when(verifier.verifyAndGetSubject("bad")).thenThrow(new MpcAuthException("x"));
        assertThrows(MpcAuthException.class, () -> service.fetch("bad","cardano","testnet"));
        verifyNoInteractions(repo);
    }

    @Test void fetchShortCircuitsWhenCipherDisabled() {
        when(cipher.isEnabled()).thenReturn(false);
        assertThrows(MpcNotConfiguredException.class,
            () -> service.fetch("tok","cardano","testnet"));
        verifyNoInteractions(verifier); // 503 before any token work
    }

    @Test void atRestWrapRoundTripsThroughCipher() {
        // Explicitly assert the store wraps (encrypt) and fetch unwraps (decrypt)
        // so the raw client blob is never persisted and the same blob comes back.
        when(verifier.verifyAndGetSubject("tok")).thenReturn("sub-1");
        when(repo.findBySubjectAndChainAndNetwork("sub-1","cardano","testnet")).thenReturn(Optional.empty());
        when(cipher.encrypt("client-blob")).thenReturn("wrapped");
        service.store("tok","cardano","testnet","client-blob","xpub");
        verify(cipher).encrypt("client-blob"); // client blob wrapped before persist
        ArgumentCaptor<MpcRecoveryShareEntity> cap = ArgumentCaptor.forClass(MpcRecoveryShareEntity.class);
        verify(repo).save(cap.capture());
        assertNotEquals("client-blob", cap.getValue().getEncryptedShare()); // never stored raw
        assertEquals("wrapped", cap.getValue().getEncryptedShare());
    }
}
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && mvn -q -Dtest=MpcRecoveryShareServiceTest test
```

Expected: COMPILATION FAILURE — `cannot find symbol: class MpcRecoveryShareService` and `cannot find symbol: class RecoveryFetchResult` (the production classes do not exist yet). BUILD FAILURE.

- [ ] **Step 3: Implement `RecoveryFetchResult` DTO**

Create `gero-backend-google-mpc/src/main/java/io/gerowallet/service/mpc/RecoveryFetchResult.java`:

```java
package io.gerowallet.service.mpc;

/**
 * Result of {@link MpcRecoveryShareService#fetch}: the client-side
 * (Argon2id/XChaCha20) recovery blob after the server at-rest wrap has been
 * removed, plus the non-secret xpub anchor. Contains no plaintext share and no
 * token — safe to project into the {@code /recovery/fetch} response.
 */
public record RecoveryFetchResult(String encryptedRecovery, String publicKey) {
}
```

- [ ] **Step 4: Implement `MpcRecoveryShareService`**

Create `gero-backend-google-mpc/src/main/java/io/gerowallet/service/mpc/MpcRecoveryShareService.java` (mirrors `MpcLoginShareService`: `requireConfigured()` 503 first, then verify, then work; logs only the 8-char `sub` prefix; NEVER logs the blob):

```java
package io.gerowallet.service.mpc;

import io.gerowallet.repositories.mpc.MpcRecoveryShareRepository;
import io.gerowallet.repositories.mpc.entity.MpcRecoveryShareEntity;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Fileless recovery-share store. Holds the wallet's third Shamir share as
 * a client-encrypted blob (Argon2id/XChaCha20), wrapped again by {@link
 * LoginShareCipher} for a second server-side at-rest layer (KMS key). The
 * backend never sees a plaintext share or the recovery password.
 *
 * <p>Unlike enroll (insert-only 409), this store is REPLACE-ALLOWED: onboarding
 * and change-recovery-password both write a fresh blob, so {@code save()} must
 * UPDATE when the row already exists. Never logs the blob — only an 8-char
 * {@code sub} prefix.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MpcRecoveryShareService {
    private final GoogleIdTokenVerifier verifier;
    private final LoginShareCipher cipher;
    private final MpcRecoveryShareRepository repo;

    /** Verify token, then upsert the double-wrapped recovery blob for this user+chain+network. */
    @Transactional
    public void store(String idToken, String chain, String network,
                      String encryptedRecovery, String publicKey) {
        requireConfigured(); // 503 before any work if MPC at-rest key is unconfigured
        String sub = verifier.verifyAndGetSubject(idToken); // 401 on failure
        var existing = repo.findBySubjectAndChainAndNetwork(sub, chain, network);
        if (existing.isPresent()) {
            // Loaded row -> save() issues UPDATE (plain @Entity, no insert-only guard).
            var e = existing.get();
            e.setEncryptedShare(cipher.encrypt(encryptedRecovery));
            e.setPublicKey(publicKey);
            repo.save(e);
        } else {
            repo.save(new MpcRecoveryShareEntity(
                    sub, chain, network, cipher.encrypt(encryptedRecovery), publicKey));
        }
        log.info("mpc recovery store ok sub={}… chain={} network={}",
                sub.substring(0, Math.min(8, sub.length())), chain, network);
    }

    /** Verify token, unwrap the at-rest layer, return the client blob + xpub anchor. */
    public RecoveryFetchResult fetch(String idToken, String chain, String network) {
        requireConfigured(); // 503 before any work if MPC at-rest key is unconfigured
        String sub = verifier.verifyAndGetSubject(idToken); // 401 on failure
        var e = repo.findBySubjectAndChainAndNetwork(sub, chain, network)
                .orElseThrow(MpcNotEnrolledException::new); // 404 when none
        return new RecoveryFetchResult(cipher.decrypt(e.getEncryptedShare()), e.getPublicKey());
    }

    /** Short-circuit the whole feature to 503 when the at-rest key isn't configured. */
    private void requireConfigured() {
        if (!cipher.isEnabled()) {
            throw new MpcNotConfiguredException("MPC recovery-share is not configured");
        }
    }
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && mvn -q -Dtest=MpcRecoveryShareServiceTest test
```

Expected: `BUILD SUCCESS`, `Tests run: 9, Failures: 0, Errors: 0, Skipped: 0`.

- [ ] **Final Step: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && \
git add src/main/java/io/gerowallet/service/mpc/RecoveryFetchResult.java \
        src/main/java/io/gerowallet/service/mpc/MpcRecoveryShareService.java \
        src/test/java/io/gerowallet/service/mpc/MpcRecoveryShareServiceTest.java && \
git commit -m "feat(mpc): MpcRecoveryShareService store-upsert + fetch, double-wrapped at rest

Recovery share held as client Argon2id blob, re-wrapped by LoginShareCipher
(second server at-rest layer). store() upserts (replace-allowed, no 409);
fetch() unwraps and returns {encryptedRecovery, publicKey} or 404. 503 before
any token work when at-rest key unconfigured. Logs only 8-char sub prefix,
never the blob.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```


---

### Task 3: Recovery controller endpoints + models + integration test

**Files:**
- Create: `src/main/java/io/gerowallet/controller/mpc/model/RecoveryStoreRequest.java`
- Create: `src/main/java/io/gerowallet/controller/mpc/model/RecoveryFetchRequest.java`
- Create: `src/main/java/io/gerowallet/controller/mpc/model/RecoveryFetchResponse.java`
- Modify: `src/main/java/io/gerowallet/controller/mpc/MpcController.java` (add `MpcRecoveryShareService` dep at line 25; add 3 endpoints after line 53)
- Test (modify): `src/test/java/io/gerowallet/controller/mpc/MpcControllerTest.java` (add `@Mock MpcRecoveryShareService recoveryService` + recovery/rotate unit tests)
- Test (modify): `src/test/java/io/gerowallet/controller/mpc/MpcEndpointIntegrationTest.java` (update `MpcSliceBoot` imports at lines 71–73; add recovery MockMvc tests)

**Interfaces:**
Consumes (from earlier backend tasks / frozen contract):
- `MpcRecoveryShareService(GoogleIdTokenVerifier, LoginShareCipher, MpcRecoveryShareRepository)` with `void store(String idToken, String chain, String network, String encryptedRecovery, String publicKey)` and `RecoveryFetchResult fetch(String idToken, String chain, String network)`.
- `RecoveryFetchResult` — record `{ String encryptedRecovery; String publicKey; }` in `io.gerowallet.service.mpc` with accessors `encryptedRecovery()` / `publicKey()`.
- `MpcLoginShareService.rotate(String idToken, String chain, String network, String loginShare)` (void; throws `MpcNotEnrolledException`/`MpcAuthException`/`MpcNotConfiguredException`).
- Existing `EnrollRequest{idToken,chain,network,loginShare}`; exceptions `MpcAuthException`, `MpcNotEnrolledException`, `MpcNotConfiguredException`.
- Repo `MpcRecoveryShareRepository` (`basePackageClasses`) + entity `MpcRecoveryShareEntity` for the slice boot.

Produces (the client + Task-4/WebConfig tasks rely on these HTTP contracts):
- `POST /api/mpc/recovery/store` body `RecoveryStoreRequest{idToken,chain,network,encryptedRecovery,publicKey}` → `200 {"stored":true}` / 401 / 503.
- `POST /api/mpc/recovery/fetch` body `RecoveryFetchRequest{idToken,chain,network}` → `200 {"encryptedRecovery":..,"publicKey":..}` / 401 / 404 / 503.
- `POST /api/mpc/rotate` body `EnrollRequest` → `200 {"rotated":true}` / 401 / 404 / 503.

---

- [ ] **Step 1: Write the failing test (unit controller tests)**

Append these `@Mock` field and test methods to `src/test/java/io/gerowallet/controller/mpc/MpcControllerTest.java`. Add the mock field right after `@Mock MpcLoginShareService service;` (line 16), and the test methods before the closing brace (line 51):

```java
    @Mock MpcRecoveryShareService recoveryService;
```

```java
    // ---- /api/mpc/recovery/store ----
    @Test void storeRecoveryReturns200Stored() {
        var req = new RecoveryStoreRequest();
        req.setIdToken("tok"); req.setChain("cardano"); req.setNetwork("mainnet");
        req.setEncryptedRecovery("blob"); req.setPublicKey("xpub");
        ResponseEntity<?> res = controller.storeRecovery(req);
        assertEquals(HttpStatus.OK, res.getStatusCode());
        assertEquals(Boolean.TRUE, ((java.util.Map<?, ?>) res.getBody()).get("stored"));
        verify(recoveryService).store("tok", "cardano", "mainnet", "blob", "xpub");
    }
    @Test void storeRecoveryBadTokenMaps401() {
        doThrow(new MpcAuthException("x")).when(recoveryService).store(any(),any(),any(),any(),any());
        var req = new RecoveryStoreRequest();
        req.setIdToken("bad"); req.setChain("cardano"); req.setNetwork("mainnet");
        req.setEncryptedRecovery("blob"); req.setPublicKey("xpub");
        assertEquals(HttpStatus.UNAUTHORIZED, controller.storeRecovery(req).getStatusCode());
    }
    @Test void storeRecoveryNotConfiguredMaps503() {
        doThrow(new MpcNotConfiguredException("x")).when(recoveryService).store(any(),any(),any(),any(),any());
        var req = new RecoveryStoreRequest();
        req.setIdToken("tok"); req.setChain("cardano"); req.setNetwork("mainnet");
        req.setEncryptedRecovery("blob"); req.setPublicKey("xpub");
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, controller.storeRecovery(req).getStatusCode());
    }

    // ---- /api/mpc/recovery/fetch ----
    @Test void fetchRecoveryReturns200WithBlobAndPublicKey() {
        when(recoveryService.fetch("tok","cardano","mainnet"))
                .thenReturn(new RecoveryFetchResult("blob","xpub"));
        var req = new RecoveryFetchRequest();
        req.setIdToken("tok"); req.setChain("cardano"); req.setNetwork("mainnet");
        ResponseEntity<?> res = controller.fetchRecovery(req);
        assertEquals(HttpStatus.OK, res.getStatusCode());
        var body = (RecoveryFetchResponse) res.getBody();
        assertEquals("blob", body.getEncryptedRecovery());
        assertEquals("xpub", body.getPublicKey());
    }
    @Test void fetchRecoveryBadTokenMaps401() {
        when(recoveryService.fetch(any(),any(),any())).thenThrow(new MpcAuthException("x"));
        var req = new RecoveryFetchRequest();
        req.setIdToken("bad"); req.setChain("cardano"); req.setNetwork("mainnet");
        assertEquals(HttpStatus.UNAUTHORIZED, controller.fetchRecovery(req).getStatusCode());
    }
    @Test void fetchRecoveryNotEnrolledMaps404() {
        when(recoveryService.fetch(any(),any(),any())).thenThrow(new MpcNotEnrolledException());
        var req = new RecoveryFetchRequest();
        req.setIdToken("tok"); req.setChain("cardano"); req.setNetwork("mainnet");
        assertEquals(HttpStatus.NOT_FOUND, controller.fetchRecovery(req).getStatusCode());
    }
    @Test void fetchRecoveryNotConfiguredMaps503() {
        when(recoveryService.fetch(any(),any(),any())).thenThrow(new MpcNotConfiguredException("x"));
        var req = new RecoveryFetchRequest();
        req.setIdToken("tok"); req.setChain("cardano"); req.setNetwork("mainnet");
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, controller.fetchRecovery(req).getStatusCode());
    }

    // ---- /api/mpc/rotate ----
    @Test void rotateReturns200Rotated() {
        var req = new EnrollRequest();
        req.setIdToken("tok"); req.setChain("cardano"); req.setNetwork("mainnet"); req.setLoginShare("s2");
        ResponseEntity<?> res = controller.rotate(req);
        assertEquals(HttpStatus.OK, res.getStatusCode());
        assertEquals(Boolean.TRUE, ((java.util.Map<?, ?>) res.getBody()).get("rotated"));
        verify(service).rotate("tok", "cardano", "mainnet", "s2");
    }
    @Test void rotateBadTokenMaps401() {
        doThrow(new MpcAuthException("x")).when(service).rotate(any(),any(),any(),any());
        var req = new EnrollRequest();
        req.setIdToken("bad"); req.setChain("cardano"); req.setNetwork("mainnet"); req.setLoginShare("s2");
        assertEquals(HttpStatus.UNAUTHORIZED, controller.rotate(req).getStatusCode());
    }
    @Test void rotateNotEnrolledMaps404() {
        doThrow(new MpcNotEnrolledException()).when(service).rotate(any(),any(),any(),any());
        var req = new EnrollRequest();
        req.setIdToken("tok"); req.setChain("cardano"); req.setNetwork("mainnet"); req.setLoginShare("s2");
        assertEquals(HttpStatus.NOT_FOUND, controller.rotate(req).getStatusCode());
    }
    @Test void rotateNotConfiguredMaps503() {
        doThrow(new MpcNotConfiguredException("x")).when(service).rotate(any(),any(),any(),any());
        var req = new EnrollRequest();
        req.setIdToken("tok"); req.setChain("cardano"); req.setNetwork("mainnet"); req.setLoginShare("s2");
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, controller.rotate(req).getStatusCode());
    }
```

Also add the recovery MockMvc tests + slice-boot import update to `src/test/java/io/gerowallet/controller/mpc/MpcEndpointIntegrationTest.java`.

Replace the imports block for the repo/entity/service (lines 4–7) so both login and recovery types are imported. Change:

```java
import io.gerowallet.repositories.mpc.MpcLoginShareRepository;
import io.gerowallet.repositories.mpc.entity.MpcLoginShareEntity;
import io.gerowallet.service.mpc.MpcBeans;
import io.gerowallet.service.mpc.MpcLoginShareService;
```

to:

```java
import io.gerowallet.repositories.mpc.MpcLoginShareRepository;
import io.gerowallet.repositories.mpc.MpcRecoveryShareRepository;
import io.gerowallet.repositories.mpc.entity.MpcLoginShareEntity;
import io.gerowallet.repositories.mpc.entity.MpcRecoveryShareEntity;
import io.gerowallet.service.mpc.MpcBeans;
import io.gerowallet.service.mpc.MpcLoginShareService;
import io.gerowallet.service.mpc.MpcRecoveryShareService;
```

Replace the slice-boot annotations (lines 71–73):

```java
    @Import({MpcBeans.class, MpcLoginShareService.class, MpcController.class})
    @EnableJpaRepositories(basePackageClasses = MpcLoginShareRepository.class)
    @EntityScan(basePackageClasses = MpcLoginShareEntity.class)
```

with:

```java
    @Import({MpcBeans.class, MpcRecoveryShareService.class, MpcLoginShareService.class, MpcController.class})
    @EnableJpaRepositories(basePackageClasses = {MpcRecoveryShareRepository.class, MpcLoginShareRepository.class})
    @EntityScan(basePackageClasses = {MpcRecoveryShareEntity.class, MpcLoginShareEntity.class})
```

Add a recovery repository field after the existing `repository` field (after line 81):

```java
    @Autowired
    private MpcRecoveryShareRepository recoveryRepository;
```

Add these test methods before the final closing brace (line 118):

```java
    @Test
    void recoveryTableAutoCreates() {
        // Count issues a SELECT against mpc_recovery_shares; throws if JPA didn't
        // auto-create the table from the entity, proving the table exists.
        assertEquals(0, recoveryRepository.count());
    }

    @Test
    void recoveryStoreRejectsBadToken() throws Exception {
        mockMvc.perform(post("/api/mpc/recovery/store")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idToken\":\"not.a.jwt\",\"chain\":\"cardano\",\"network\":\"mainnet\",\"encryptedRecovery\":\"blob\",\"publicKey\":\"xpub\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void recoveryFetchRejectsBadToken() throws Exception {
        mockMvc.perform(post("/api/mpc/recovery/fetch")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idToken\":\"not.a.jwt\",\"chain\":\"cardano\",\"network\":\"mainnet\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void rotateRejectsBadToken() throws Exception {
        mockMvc.perform(post("/api/mpc/rotate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idToken\":\"not.a.jwt\",\"chain\":\"cardano\",\"network\":\"mainnet\",\"loginShare\":\"gmpc1.02.x.y\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void recoveryFetchValidationRejectsMissingField() throws Exception {
        mockMvc.perform(post("/api/mpc/recovery/fetch")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());
    }
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && mvn -q -Dtest=MpcControllerTest,MpcEndpointIntegrationTest test
```

Expected: **compilation failure** — `MpcControllerTest.java` and `MpcEndpointIntegrationTest.java` reference symbols that do not yet exist (`RecoveryStoreRequest`, `RecoveryFetchRequest`, `RecoveryFetchResponse`, `RecoveryFetchResult`, `MpcRecoveryShareService`, `controller.storeRecovery`, `controller.fetchRecovery`, `controller.rotate`, `service.rotate`). Maven prints `COMPILATION ERROR ... cannot find symbol` and `BUILD FAILURE`. (Note: `RecoveryFetchResult`, `MpcRecoveryShareService`, and `MpcLoginShareService.rotate` come from earlier backend tasks; if those are not yet on the branch the same compile error appears — this task's own additions are the models, controller endpoints, and tests.)

- [ ] **Step 3: Implement the request/response models**

Create `src/main/java/io/gerowallet/controller/mpc/model/RecoveryStoreRequest.java`:

```java
package io.gerowallet.controller.mpc.model;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class RecoveryStoreRequest {
    @NotBlank
    private String idToken;
    @NotBlank
    private String chain;
    @NotBlank
    private String network;
    @NotBlank
    private String encryptedRecovery;
    @NotBlank
    private String publicKey;
}
```

Create `src/main/java/io/gerowallet/controller/mpc/model/RecoveryFetchRequest.java`:

```java
package io.gerowallet.controller.mpc.model;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class RecoveryFetchRequest {
    @NotBlank
    private String idToken;
    @NotBlank
    private String chain;
    @NotBlank
    private String network;
}
```

Create `src/main/java/io/gerowallet/controller/mpc/model/RecoveryFetchResponse.java`:

```java
package io.gerowallet.controller.mpc.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class RecoveryFetchResponse {
    private String encryptedRecovery;
    private String publicKey;
}
```

- [ ] **Step 4: Implement the controller endpoints**

Add the recovery-service dependency to `src/main/java/io/gerowallet/controller/mpc/MpcController.java`. Replace line 25 (`    private final MpcLoginShareService service;`) with:

```java
    private final MpcLoginShareService service;
    private final MpcRecoveryShareService recoveryService;
```

Add the three endpoints just before the class-closing brace (after the `loginShare` method, line 53). Responses project explicit fields only — never the entity/row, never a token/share/`err.message`:

```java

    @PostMapping("/recovery/store")
    public ResponseEntity<?> storeRecovery(@Valid @RequestBody RecoveryStoreRequest req) {
        try {
            recoveryService.store(req.getIdToken(), req.getChain(), req.getNetwork(),
                    req.getEncryptedRecovery(), req.getPublicKey());
            return ResponseEntity.ok(Map.of("stored", true));
        } catch (MpcAuthException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "unauthorized"));
        } catch (MpcNotConfiguredException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", "mpc not configured"));
        }
    }

    @PostMapping("/recovery/fetch")
    public ResponseEntity<?> fetchRecovery(@Valid @RequestBody RecoveryFetchRequest req) {
        try {
            RecoveryFetchResult r = recoveryService.fetch(req.getIdToken(), req.getChain(), req.getNetwork());
            return ResponseEntity.ok(new RecoveryFetchResponse(r.encryptedRecovery(), r.publicKey()));
        } catch (MpcAuthException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "unauthorized"));
        } catch (MpcNotEnrolledException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not enrolled"));
        } catch (MpcNotConfiguredException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", "mpc not configured"));
        }
    }

    @PostMapping("/rotate")
    public ResponseEntity<?> rotate(@Valid @RequestBody EnrollRequest req) {
        try {
            service.rotate(req.getIdToken(), req.getChain(), req.getNetwork(), req.getLoginShare());
            return ResponseEntity.ok(Map.of("rotated", true));
        } catch (MpcAuthException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "unauthorized"));
        } catch (MpcNotEnrolledException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not enrolled"));
        } catch (MpcNotConfiguredException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", "mpc not configured"));
        }
    }
```

(`RecoveryStoreRequest`, `RecoveryFetchRequest`, `RecoveryFetchResponse`, `RecoveryFetchResult`, `MpcRecoveryShareService` are all resolved by the existing wildcard imports `io.gerowallet.controller.mpc.model.*` and `io.gerowallet.service.mpc.*` at lines 3–4 — no new import lines needed.)

- [ ] **Step 5: Run test — expect PASS**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && mvn -q -Dtest=MpcControllerTest,MpcEndpointIntegrationTest test
```

Expected: `BUILD SUCCESS`, `Tests run: <N>, Failures: 0, Errors: 0, Skipped: 0` — the 11 new unit tests (storeRecovery 200/401/503, fetchRecovery 200/401/404/503, rotate 200/401/404/503) and the 5 integration additions (recovery table auto-create, recovery store/fetch/rotate bad-token 401, recovery fetch validation 400) all green, alongside the pre-existing login-share tests.

- [ ] **Step 6: Full MPC regression — expect PASS**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && mvn -q -Dtest='io.gerowallet.controller.mpc.*,io.gerowallet.service.mpc.*' test
```

Expected: `BUILD SUCCESS`, all MPC controller + service + integration tests pass (login-share `enroll`/`login-share` mappings unchanged; recovery + rotate added).

- [ ] **Final Step: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && \
git add src/main/java/io/gerowallet/controller/mpc/model/RecoveryStoreRequest.java \
        src/main/java/io/gerowallet/controller/mpc/model/RecoveryFetchRequest.java \
        src/main/java/io/gerowallet/controller/mpc/model/RecoveryFetchResponse.java \
        src/main/java/io/gerowallet/controller/mpc/MpcController.java \
        src/test/java/io/gerowallet/controller/mpc/MpcControllerTest.java \
        src/test/java/io/gerowallet/controller/mpc/MpcEndpointIntegrationTest.java && \
git commit -m "feat(mpc): recovery store/fetch + rotate endpoints

Add POST /api/mpc/recovery/store, /api/mpc/recovery/fetch, and /api/mpc/rotate
to MpcController with RecoveryStoreRequest/RecoveryFetchRequest/RecoveryFetchResponse
models. Status mappings mirror enroll/login-share (401 auth, 404 not-enrolled,
503 not-configured). Responses project explicit fields only. Extends the MPC
slice-boot integration test to cover the recovery table + endpoints.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```


---

### Task 4: Login-share rotate endpoint (`MpcLoginShareService.rotate` + `POST /api/mpc/rotate`)

Add the reset/re-split path's backend half: a `rotate` service method that **UPDATEs** the one existing login-share row (never inserts) and a `POST /api/mpc/rotate` controller endpoint that reuses `EnrollRequest`. The `enroll` insert-only 409 guard is left completely untouched — `rotate` works because a row loaded via `findBySubjectAndChainAndNetwork` fires `@PostLoad` → `isNew=false`, so `repo.save(e)` issues a JPA `merge()`/UPDATE instead of the INSERT-only `saveAndFlush` path `enroll` uses.

**Files:**
- Modify: `src/main/java/io/gerowallet/service/mpc/MpcLoginShareService.java` (add `rotate(...)` after `getLoginShare`, currently ends line 53; insert before the `requireConfigured()` helper at line 55)
- Modify: `src/main/java/io/gerowallet/controller/mpc/MpcController.java` (add `@PostMapping("/rotate")` after `loginShare`, currently ends line 53)
- Test (modify): `src/test/java/io/gerowallet/service/mpc/MpcLoginShareServiceTest.java` (add rotate cases; file currently ends line 88)
- Test (modify): `src/test/java/io/gerowallet/controller/mpc/MpcControllerTest.java` (add rotate status-mapping cases; file currently ends line 51)
- Test (modify): `src/test/java/io/gerowallet/controller/mpc/MpcEndpointIntegrationTest.java` (add rotate bad-token 401 + import the recovery repo into the slice boot so the full recovery+rotate wiring co-boots; file currently ends line 118)

**Interfaces:**
- Consumes (from contract / earlier tasks):
  - `GoogleIdTokenVerifier.verifyAndGetSubject(String idToken) -> String` (throws `MpcAuthException`)
  - `LoginShareCipher.encrypt(String) -> String`, `LoginShareCipher.isEnabled() -> boolean`
  - `MpcLoginShareRepository.findBySubjectAndChainAndNetwork(String,String,String) -> Optional<MpcLoginShareEntity>`, `.save(...)`
  - `MpcLoginShareEntity(subject,chain,network,encryptedShare)` ctor; `@PostLoad` sets `isNew=false` (loaded row → UPDATE on save)
  - `EnrollRequest{idToken,chain,network,loginShare}` (reused verbatim as the rotate body)
  - `MpcAuthException` (401), `MpcNotEnrolledException` (404), `MpcNotConfiguredException` (503)
  - `MpcRecoveryShareRepository` (from earlier task) — imported into the integration-test slice boot so recovery + rotate co-boot
- Produces (later tasks / client rely on):
  - `MpcLoginShareService.rotate(String idToken, String chain, String network, String loginShare) -> void`
  - `POST /api/mpc/rotate` body `EnrollRequest` → `200 {"rotated":true}` / 401 / 404 / 503 (consumed by the client `api.ts` `rotate(idToken,chain,network,loginShare)` and by `setRecoveryPasswordFlow`'s re-split)

---

- [ ] **Step 1: Write the failing test — service**

Add these methods inside `MpcLoginShareServiceTest` (before the closing `}` at line 88). They reuse the existing `@Mock verifier/cipher/repo`, `@InjectMocks service`, and the `cipherEnabledByDefault()` `@BeforeEach`.

```java
    @Test void rotateVerifiesTokenAndUpdatesExistingRow() {
        when(verifier.verifyAndGetSubject("tok")).thenReturn("sub-1");
        var e = new MpcLoginShareEntity("sub-1","cardano","mainnet","old-enc");
        when(repo.findBySubjectAndChainAndNetwork("sub-1","cardano","mainnet")).thenReturn(Optional.of(e));
        when(cipher.encrypt("gmpc1.02.NEW.Y")).thenReturn("new-enc");
        service.rotate("tok","cardano","mainnet","gmpc1.02.NEW.Y");
        ArgumentCaptor<MpcLoginShareEntity> cap = ArgumentCaptor.forClass(MpcLoginShareEntity.class);
        verify(repo).save(cap.capture());
        // Same row instance is re-saved (loaded → isNew=false → UPDATE), with the new ciphertext.
        assertSame(e, cap.getValue());
        assertEquals("new-enc", cap.getValue().getEncryptedShare());
        assertEquals("sub-1", cap.getValue().getSubject());
        verify(repo, never()).saveAndFlush(any()); // rotate never uses the insert-only path
    }
    @Test void rotateThrowsWhenNotEnrolled() {
        when(verifier.verifyAndGetSubject("tok")).thenReturn("sub-1");
        when(repo.findBySubjectAndChainAndNetwork("sub-1","cardano","mainnet")).thenReturn(Optional.empty());
        assertThrows(MpcNotEnrolledException.class,
            () -> service.rotate("tok","cardano","mainnet","new"));
        verify(repo, never()).save(any());
    }
    @Test void rotateRejectsBadToken() {
        when(verifier.verifyAndGetSubject("bad")).thenThrow(new MpcAuthException("x"));
        assertThrows(MpcAuthException.class, () -> service.rotate("bad","cardano","mainnet","new"));
        verify(repo, never()).save(any());
    }
    @Test void rotateShortCircuitsWhenCipherDisabled() {
        when(cipher.isEnabled()).thenReturn(false);
        assertThrows(MpcNotConfiguredException.class,
            () -> service.rotate("tok","cardano","mainnet","new"));
        verifyNoInteractions(verifier); // 503 before any token work
        verify(repo, never()).save(any());
    }
```

- [ ] **Step 2: Run test — expect FAIL** (rotate not implemented → compile error)

```
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && mvn -q -Dtest=MpcLoginShareServiceTest test
```
Expected: **BUILD FAILURE** — compilation error `cannot find symbol: method rotate(java.lang.String,java.lang.String,java.lang.String,java.lang.String)` in `MpcLoginShareServiceTest`.

- [ ] **Step 3: Implement — service**

In `src/main/java/io/gerowallet/service/mpc/MpcLoginShareService.java`, insert this method between `getLoginShare` (ends line 53) and the `requireConfigured()` helper (`/** Short-circuit ... */` at line 55). No new imports needed (`@Transactional` is already imported at line 9).

```java
    /**
     * Reset/re-split path (never used by daily unlock). Verify token, load the
     * ONE existing row for this user, and REPLACE its encrypted login share with
     * a freshly-encrypted new value. The row was loaded (its {@code @PostLoad}
     * set {@code isNew=false}), so {@code save()} issues a JPA {@code merge()}
     * → UPDATE — enroll's INSERT-only 409 guard is left untouched. 404 if the
     * user was never enrolled. Never logs the share or the raw token.
     */
    @Transactional
    public void rotate(String idToken, String chain, String network, String loginShare) {
        requireConfigured(); // 503 before any work if MPC at-rest key is unconfigured
        String sub = verifier.verifyAndGetSubject(idToken); // 401 on failure
        var e = repo.findBySubjectAndChainAndNetwork(sub, chain, network)
                .orElseThrow(MpcNotEnrolledException::new); // 404 if not enrolled
        e.setEncryptedShare(cipher.encrypt(loginShare)); // loaded row → isNew=false → UPDATE
        repo.save(e);
        log.info("mpc rotate ok sub={}… chain={} network={}",
                sub.substring(0, Math.min(8, sub.length())), chain, network);
    }
```

- [ ] **Step 4: Run test — expect PASS (service)**

```
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && mvn -q -Dtest=MpcLoginShareServiceTest test
```
Expected: **BUILD SUCCESS**, all `MpcLoginShareServiceTest` tests green (the 8 existing enroll/get tests + the 4 new rotate tests).

- [ ] **Step 5: Write the failing test — controller**

Add these methods inside `MpcControllerTest` (before the closing `}` at line 51). Reuses the existing `@Mock service`, `@InjectMocks controller`, and `EnrollRequest`.

```java
    @Test void rotateReturns200Rotated() {
        var req = new EnrollRequest();
        req.setIdToken("tok"); req.setChain("cardano"); req.setNetwork("mainnet"); req.setLoginShare("gmpc1.02.NEW.Y");
        ResponseEntity<?> res = controller.rotate(req);
        assertEquals(HttpStatus.OK, res.getStatusCode());
        assertEquals(true, ((java.util.Map<?, ?>) res.getBody()).get("rotated"));
        verify(service).rotate("tok","cardano","mainnet","gmpc1.02.NEW.Y");
    }
    @Test void rotateBadTokenMaps401() {
        doThrow(new MpcAuthException("x")).when(service).rotate(any(),any(),any(),any());
        var req = new EnrollRequest(); req.setIdToken("bad"); req.setChain("cardano"); req.setNetwork("mainnet"); req.setLoginShare("s");
        assertEquals(HttpStatus.UNAUTHORIZED, controller.rotate(req).getStatusCode());
    }
    @Test void rotateNotEnrolledMaps404() {
        doThrow(new MpcNotEnrolledException()).when(service).rotate(any(),any(),any(),any());
        var req = new EnrollRequest(); req.setIdToken("tok"); req.setChain("cardano"); req.setNetwork("mainnet"); req.setLoginShare("s");
        assertEquals(HttpStatus.NOT_FOUND, controller.rotate(req).getStatusCode());
    }
    @Test void rotateNotConfiguredMaps503() {
        doThrow(new MpcNotConfiguredException("x")).when(service).rotate(any(),any(),any(),any());
        var req = new EnrollRequest(); req.setIdToken("tok"); req.setChain("cardano"); req.setNetwork("mainnet"); req.setLoginShare("s");
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE, controller.rotate(req).getStatusCode());
    }
```

- [ ] **Step 6: Run test — expect FAIL** (controller.rotate not implemented → compile error)

```
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && mvn -q -Dtest=MpcControllerTest test
```
Expected: **BUILD FAILURE** — compilation error `cannot find symbol: method rotate(io.gerowallet.controller.mpc.model.EnrollRequest)` in `MpcControllerTest`.

- [ ] **Step 7: Implement — controller endpoint**

In `src/main/java/io/gerowallet/controller/mpc/MpcController.java`, add this method after `loginShare` (ends line 53), before the closing `}` at line 54. Status mapping mirrors `enroll`/`loginShare` exactly (401/404/503); reuses `EnrollRequest` (has `idToken,chain,network,loginShare`). No new imports needed — `EnrollRequest`, `MpcAuthException`, `MpcNotEnrolledException`, `MpcNotConfiguredException`, `Map`, `HttpStatus` are already imported via the wildcard imports at lines 3-12. Response projects an explicit field only — never the entity, token, share, or `err.message`.

```java
    @PostMapping("/rotate")
    public ResponseEntity<?> rotate(@Valid @RequestBody EnrollRequest req) {
        try {
            service.rotate(req.getIdToken(), req.getChain(), req.getNetwork(), req.getLoginShare());
            return ResponseEntity.ok(Map.of("rotated", true));
        } catch (MpcAuthException e) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "unauthorized"));
        } catch (MpcNotEnrolledException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not enrolled"));
        } catch (MpcNotConfiguredException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of("error", "mpc not configured"));
        }
    }
```

- [ ] **Step 8: Run test — expect PASS (controller)**

```
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && mvn -q -Dtest=MpcControllerTest test
```
Expected: **BUILD SUCCESS**, all `MpcControllerTest` tests green (6 existing + 4 new rotate cases).

- [ ] **Step 9: Write the failing test — integration (rotate bad-token 401 + full recovery/rotate co-boot)**

Edit `src/test/java/io/gerowallet/controller/mpc/MpcEndpointIntegrationTest.java`.

(a) Add the import so the slice boot can register the recovery repo (from the earlier recovery task) alongside the login repo — this proves recovery + rotate wiring co-boot in one real context. Add after line 4 (`import io.gerowallet.repositories.mpc.MpcLoginShareRepository;`):

```java
import io.gerowallet.repositories.mpc.MpcRecoveryShareRepository;
import io.gerowallet.repositories.mpc.entity.MpcRecoveryShareEntity;
import io.gerowallet.service.mpc.MpcRecoveryShareService;
import io.gerowallet.controller.mpc.MpcController;
```

(b) Widen the slice-boot `@Import`, `@EnableJpaRepositories`, and `@EntityScan` (currently lines 71-73) so both share stacks boot. Replace:

```java
    @Import({MpcBeans.class, MpcLoginShareService.class, MpcController.class})
    @EnableJpaRepositories(basePackageClasses = MpcLoginShareRepository.class)
    @EntityScan(basePackageClasses = MpcLoginShareEntity.class)
```
with:
```java
    @Import({MpcBeans.class, MpcLoginShareService.class, MpcRecoveryShareService.class, MpcController.class})
    @EnableJpaRepositories(basePackageClasses = {MpcLoginShareRepository.class, MpcRecoveryShareRepository.class})
    @EntityScan(basePackageClasses = {MpcLoginShareEntity.class, MpcRecoveryShareEntity.class})
```

(c) Add this test method before the closing `}` at line 118. A garbage token fails JWT parsing before any JWKS network fetch (hermetic), so `rotate` returns 401 — proving the route maps and its bad-token path is wired:

```java
    @Test
    void rotateRejectsBadToken() throws Exception {
        mockMvc.perform(post("/api/mpc/rotate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idToken\":\"not.a.jwt\",\"chain\":\"cardano\",\"network\":\"mainnet\",\"loginShare\":\"gmpc1.02.x.y\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void rotateValidationRejectsMissingLoginShare() throws Exception {
        mockMvc.perform(post("/api/mpc/rotate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"idToken\":\"not.a.jwt\",\"chain\":\"cardano\",\"network\":\"mainnet\"}"))
                .andExpect(status().isBadRequest());
    }
```

- [ ] **Step 10: Run test — expect PASS (integration)**

```
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && mvn -q -Dtest=MpcEndpointIntegrationTest test
```
Expected: **BUILD SUCCESS** — context boots with both login + recovery repos/entities and the `MpcRecoveryShareService`, both `mpc_login_shares` and `mpc_recovery_shares` tables auto-create, and both new rotate cases (401 bad token, 400 missing field) pass alongside the existing 5.

> Note: if the earlier recovery task (`MpcRecoveryShareEntity`/`Repository`/`Service`) is not yet merged when this task runs, keep Step 9's slice-boot edit (b)+(a) as-is but the class must exist first — sequence Task 4 after the recovery entity/repo/service task. The rotate service+controller (Steps 1-8) have no recovery dependency and can land independently.

- [ ] **Step 11: Confirm `enroll` 409 is untouched (regression)**

`rotate` only touched the loaded-row UPDATE path; `enroll`'s insert-only 409 guard (`saveAndFlush` + `Persistable#isNew`) is unchanged. Re-run the full MPC suite to prove enroll-duplicate still 409s and nothing regressed:

```
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && mvn -q -Dtest='io.gerowallet.controller.mpc.*,io.gerowallet.service.mpc.*,io.gerowallet.repositories.mpc.*' test
```
Expected: **BUILD SUCCESS** — including `MpcLoginShareServiceTest#enrollRejectsDuplicate`, `enrollRejectsConcurrentDuplicateOnConstraintViolation`, and `MpcControllerTest#duplicateEnrollMaps409` all still green.

- [ ] **Final Step: Commit**

```
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && \
git add src/main/java/io/gerowallet/service/mpc/MpcLoginShareService.java \
        src/main/java/io/gerowallet/controller/mpc/MpcController.java \
        src/test/java/io/gerowallet/service/mpc/MpcLoginShareServiceTest.java \
        src/test/java/io/gerowallet/controller/mpc/MpcControllerTest.java \
        src/test/java/io/gerowallet/controller/mpc/MpcEndpointIntegrationTest.java && \
git commit -m "feat(mpc): add login-share rotate endpoint for recovery re-split

MpcLoginShareService.rotate loads the existing row (isNew=false after
@PostLoad) and re-saves it as an UPDATE, replacing the encrypted login
share. POST /api/mpc/rotate reuses EnrollRequest and mirrors enroll's
status mapping (200 {rotated:true} / 401 / 404 / 503). enroll's
insert-only 409 guard is left untouched. Backs the client re-split
(SET_RECOVERY_PASSWORD) reset path.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```


---

### Task 5: Rate-limit + config for /recovery/* and /rotate

**Files:**
- Modify `src/main/java/io/gerowallet/config/ConfigProperties.java` (Mpc static class, lines 178–180 → add 4 fields after `releasePerMinute`)
- Modify `src/main/java/io/gerowallet/security/filter/MpcRateLimitFilter.java` (add `bucket` field; ctor + `doFilter` — lines 25–49)
- Modify `src/main/java/io/gerowallet/config/WebConfig.java` (existing mpc filter bean lines 390–406 → pass `"mpc"` bucket; ADD two new filter beans for recovery + rotate)
- Modify (Test) `src/test/java/io/gerowallet/security/filter/MpcRateLimitFilterTest.java` (update 2 ctor call sites to the new arity; ADD `usesConfiguredBucket` test proving distinct buckets)

**Interfaces:**
- Consumes: `NexusRateLimiter.allow(String klass, String ip, int rps, int perMinute)` (existing, `io.gerowallet.service.nexus`); `ClientIpResolver.resolve(HttpServletRequest)` (existing); `ConfigProperties.getMpc()` → `ConfigProperties.Mpc` (existing).
- Produces (later tasks / wiring rely on these):
  - `new MpcRateLimitFilter(NexusRateLimiter limiter, ClientIpResolver clientIp, String bucket, int rps, int perMinute)` — bucket is now an explicit ctor arg (was hardcoded `"mpc"`).
  - `ConfigProperties.Mpc.getRecoveryRps()/getRecoveryPerMinute()/getRotateRps()/getRotatePerMinute()` (defaults 2 / 30, mirroring `release*`).
  - Filter registrations: `/api/mpc/*` bucket `"mpc"`, `/api/mpc/recovery/*` bucket `"recovery"`, `/api/mpc/rotate` bucket `"rotate"` — all `setOrder(2)`.

---

- [ ] **Step 1: Write the failing test**

Replace the two existing ctor call sites (they use the old 4-arg signature) and add a bucket-passthrough test. Full new file:

```java
package io.gerowallet.security.filter;

import io.gerowallet.security.ClientIpResolver;
import io.gerowallet.service.nexus.NexusRateLimiter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.http.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.*;
import org.mockito.junit.jupiter.MockitoExtension;

import java.io.PrintWriter;
import java.io.StringWriter;

import static org.mockito.Mockito.*;

/**
 * NexusRateLimiter's real signature is {@code allow(String klass, String ip,
 * int rps, int perMinute)} (not the 3-arg {@code allow(key, rps, perMinute)}
 * sketched in the plan) — matched here to the actual class in
 * {@code io.gerowallet.service.nexus}. IP resolution is delegated to the same
 * {@link ClientIpResolver} used by {@code NexusRateLimitFilter}, so a spoofed
 * X-Forwarded-For can't be used to evade the per-IP bucket.
 *
 * <p>The bucket name is an explicit ctor arg so that {@code /api/mpc/*},
 * {@code /api/mpc/recovery/*} and {@code /api/mpc/rotate} register as separate
 * {@code FilterRegistrationBean}s with DISTINCT limiter buckets — exhausting one
 * path's bucket does not consume another's.
 */
@ExtendWith(MockitoExtension.class)
class MpcRateLimitFilterTest {
    @Mock NexusRateLimiter limiter;
    @Mock ClientIpResolver clientIp;
    @Mock HttpServletRequest req;
    @Mock HttpServletResponse res;
    @Mock FilterChain chain;

    @Test void blocksWhenOverLimit() throws Exception {
        when(clientIp.resolve(req)).thenReturn("1.2.3.4");
        when(res.getWriter()).thenReturn(new PrintWriter(new StringWriter()));
        when(limiter.allow(anyString(), eq("1.2.3.4"), anyInt(), anyInt())).thenReturn(false);

        new MpcRateLimitFilter(limiter, clientIp, "mpc", 2, 30).doFilter(req, res, chain);

        verify(res).setStatus(429);
        verify(chain, never()).doFilter(any(), any());
    }

    @Test void passesWhenUnderLimit() throws Exception {
        when(clientIp.resolve(req)).thenReturn("1.2.3.4");
        when(limiter.allow(anyString(), eq("1.2.3.4"), anyInt(), anyInt())).thenReturn(true);

        new MpcRateLimitFilter(limiter, clientIp, "mpc", 2, 30).doFilter(req, res, chain);

        verify(chain).doFilter(req, res);
    }

    @Test void usesConfiguredBucketAndLimits() throws Exception {
        when(clientIp.resolve(req)).thenReturn("1.2.3.4");
        when(limiter.allow(anyString(), eq("1.2.3.4"), anyInt(), anyInt())).thenReturn(true);

        new MpcRateLimitFilter(limiter, clientIp, "recovery", 5, 60).doFilter(req, res, chain);

        // Distinct bucket + this filter's own rps/perMinute are forwarded verbatim,
        // so the "recovery" window is independent of the "mpc"/"rotate" windows.
        verify(limiter).allow("recovery", "1.2.3.4", 5, 60);
        verify(limiter, never()).allow(eq("mpc"), anyString(), anyInt(), anyInt());
        verify(chain).doFilter(req, res);
    }
}
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && \
  mvn -q -Dtest=MpcRateLimitFilterTest test
```

Expected: **compilation failure** — `MpcRateLimitFilter(NexusRateLimiter, ClientIpResolver, String, int, int)` does not exist (current ctor is 4-arg `(limiter, clientIp, int, int)`). Maven prints:
```
[ERROR] .../MpcRateLimitFilterTest.java:[..] constructor MpcRateLimitFilter in class MpcRateLimitFilter cannot be applied to given types;
[ERROR]   required: NexusRateLimiter,ClientIpResolver,int,int
[ERROR]   found:    NexusRateLimiter,ClientIpResolver,String,int,int
[ERROR] BUILD FAILURE
```

- [ ] **Step 3: Implement — add the `bucket` field to the filter**

In `src/main/java/io/gerowallet/security/filter/MpcRateLimitFilter.java`, replace the class body (lines 24–50). The Javadoc above the class (lines 16–23) stays. New body:

```java
@RequiredArgsConstructor
public class MpcRateLimitFilter implements Filter {

    private final NexusRateLimiter limiter;
    private final ClientIpResolver clientIp;
    private final String bucket;
    private final int rps;
    private final int perMinute;

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        String ip = clientIp.resolve(request);
        if (!limiter.allow(bucket, ip, rps, perMinute)) {
            response.setStatus(429);
            response.setHeader("Retry-After", "1");
            response.setContentType("application/json");
            response.getWriter().write(
                    "{\"error\":\"rate_limit_exceeded\",\"message\":\"Too many requests — slow down\"}");
            return;
        }

        chain.doFilter(req, res);
    }
}
```

(`@RequiredArgsConstructor` regenerates the ctor in field order → `(limiter, clientIp, bucket, rps, perMinute)`. No other imports change.)

- [ ] **Step 4: Implement — add config fields**

In `src/main/java/io/gerowallet/config/ConfigProperties.java`, inside `public static class Mpc`, replace lines 178–180:

```java
        /** Rate limits for the share-release path. */
        private int releaseRps = 2;
        private int releasePerMinute = 30;
```

with:

```java
        /** Rate limits for the share-release path (enroll / login-share). */
        private int releaseRps = 2;
        private int releasePerMinute = 30;
        /** Rate limits for the recovery-share path (recovery/store, recovery/fetch). */
        private int recoveryRps = 2;
        private int recoveryPerMinute = 30;
        /** Rate limits for the login-share rotation path (change recovery password). */
        private int rotateRps = 2;
        private int rotatePerMinute = 30;
```

(`@Getter @Setter` on the class generate `getRecoveryRps()`/`setRecoveryRps(int)` etc. automatically — no other edit.)

- [ ] **Step 5: Implement — wire the filters in WebConfig**

In `src/main/java/io/gerowallet/config/WebConfig.java`, replace the existing mpc filter bean + registration (lines 390–406):

```java
    @Bean
    public MpcRateLimitFilter mpcRateLimitFilter(NexusRateLimiter nexusRateLimiter,
                                                 ClientIpResolver clientIpResolver) {
        ConfigProperties.Mpc mpc = configProperties.getMpc();
        return new MpcRateLimitFilter(nexusRateLimiter, clientIpResolver,
                mpc.getReleaseRps(), mpc.getReleasePerMinute());
    }

    @Bean
    public FilterRegistrationBean<MpcRateLimitFilter> mpcRateLimitFilterRegistration(
            MpcRateLimitFilter mpcRateLimitFilter) {
        FilterRegistrationBean<MpcRateLimitFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(mpcRateLimitFilter);
        registration.addUrlPatterns("/api/mpc/*");
        registration.setOrder(2); // after SecurityFilter (order 1)
        return registration;
    }
}
```

with (note: the closing `}` of the class is the last line — keep exactly one):

```java
    @Bean
    public MpcRateLimitFilter mpcRateLimitFilter(NexusRateLimiter nexusRateLimiter,
                                                 ClientIpResolver clientIpResolver) {
        ConfigProperties.Mpc mpc = configProperties.getMpc();
        return new MpcRateLimitFilter(nexusRateLimiter, clientIpResolver,
                "mpc", mpc.getReleaseRps(), mpc.getReleasePerMinute());
    }

    @Bean
    public FilterRegistrationBean<MpcRateLimitFilter> mpcRateLimitFilterRegistration(
            MpcRateLimitFilter mpcRateLimitFilter) {
        FilterRegistrationBean<MpcRateLimitFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(mpcRateLimitFilter);
        registration.addUrlPatterns("/api/mpc/*");
        registration.setOrder(2); // after SecurityFilter (order 1)
        return registration;
    }

    @Bean
    public MpcRateLimitFilter mpcRecoveryRateLimitFilter(NexusRateLimiter nexusRateLimiter,
                                                         ClientIpResolver clientIpResolver) {
        ConfigProperties.Mpc mpc = configProperties.getMpc();
        return new MpcRateLimitFilter(nexusRateLimiter, clientIpResolver,
                "recovery", mpc.getRecoveryRps(), mpc.getRecoveryPerMinute());
    }

    @Bean
    public FilterRegistrationBean<MpcRateLimitFilter> mpcRecoveryRateLimitFilterRegistration(
            MpcRateLimitFilter mpcRecoveryRateLimitFilter) {
        FilterRegistrationBean<MpcRateLimitFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(mpcRecoveryRateLimitFilter);
        registration.addUrlPatterns("/api/mpc/recovery/*");
        registration.setOrder(2); // after SecurityFilter (order 1)
        return registration;
    }

    @Bean
    public MpcRateLimitFilter mpcRotateRateLimitFilter(NexusRateLimiter nexusRateLimiter,
                                                       ClientIpResolver clientIpResolver) {
        ConfigProperties.Mpc mpc = configProperties.getMpc();
        return new MpcRateLimitFilter(nexusRateLimiter, clientIpResolver,
                "rotate", mpc.getRotateRps(), mpc.getRotatePerMinute());
    }

    @Bean
    public FilterRegistrationBean<MpcRateLimitFilter> mpcRotateRateLimitFilterRegistration(
            MpcRateLimitFilter mpcRotateRateLimitFilter) {
        FilterRegistrationBean<MpcRateLimitFilter> registration = new FilterRegistrationBean<>();
        registration.setFilter(mpcRotateRateLimitFilter);
        registration.addUrlPatterns("/api/mpc/rotate");
        registration.setOrder(2); // after SecurityFilter (order 1)
        return registration;
    }
}
```

Notes for the implementer (do NOT add extra code beyond the above):
- Three beans of the same type `MpcRateLimitFilter` coexist because each `@Bean` method name is a distinct bean id; the registration beans consume them by parameter name (`mpcRateLimitFilter` / `mpcRecoveryRateLimitFilter` / `mpcRotateRateLimitFilter`), so no `@Qualifier` is needed.
- `/api/mpc/recovery/*` uses a trailing `/*` (servlet path-prefix mapping) to cover `/store` and `/fetch`; `/api/mpc/rotate` is an exact mapping (no wildcard) — a single endpoint.
- The pre-existing `/api/mpc/*` filter still matches recovery/rotate requests too (servlet chains all matching filters), so those requests additionally decrement the shared `"mpc"` bucket. The distinct `"recovery"`/`"rotate"` buckets guarantee the independence the test asserts: exhausting `"recovery"` returns 429 for recovery without touching enroll/login-share's ability to pass.

- [ ] **Step 6: Run test — expect PASS**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && \
  mvn -q -Dtest=MpcRateLimitFilterTest test
```

Expected: `BUILD SUCCESS`, 3 tests run, 0 failures:
```
[INFO] Tests run: 3, Failures: 0, Errors: 0, Skipped: 0
[INFO] BUILD SUCCESS
```

- [ ] **Step 7: Compile-check the whole main sources (WebConfig + ConfigProperties wiring)**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && \
  mvn -q compile
```

Expected: `BUILD SUCCESS` (confirms the four new `getRecovery*/getRotate*` getters exist and the three `@Bean` methods compile).

- [ ] **Final Step: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gero-backend-google-mpc" && \
  git add \
    src/main/java/io/gerowallet/security/filter/MpcRateLimitFilter.java \
    src/main/java/io/gerowallet/config/ConfigProperties.java \
    src/main/java/io/gerowallet/config/WebConfig.java \
    src/test/java/io/gerowallet/security/filter/MpcRateLimitFilterTest.java && \
  git commit -m "feat(mpc): independent rate-limit buckets for /recovery/* and /rotate

Add per-path FilterRegistrationBeans (buckets \"recovery\", \"rotate\") and
ConfigProperties.Mpc.recovery*/rotate* limits (mirror release*=2/30). Bucket
name is now an explicit MpcRateLimitFilter ctor arg so each MPC path has an
independent per-IP window.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```


---

### Task 6: Wallet field + db helpers + api methods + message types (client foundation)

**Files:**
- Modify: `src/models/types.ts` (add `mpcDeviceShareNext?` to `Wallet`, after line 34)
- Modify: `src/db/gero-db.ts` (add `setMpcDeviceShare` / `setMpcDeviceShareNext` / `promoteMpcDeviceShareNext`, after `setWalletName` at line 610)
- Modify: `src/api/api.ts` (add `storeRecovery` / `fetchRecovery` / `rotate` to `mpc` block, before the closing `};` at line 286)
- Modify: `src/models/MessageTypes.ts` (add `STORE_MPC_RECOVERY` / `REVEAL_MPC_SRP` / `SET_RECOVERY_PASSWORD`, after line 31)
- Test: `src/api/mpc.api.spec.ts` (extend the existing `describe('Api.mpc')` block)

**Interfaces:**
- Consumes (existing, verified in worktree): `this.axiosInstance.post(path, body)` + `parseHttpError(error)` (api.ts lines 263-286); `getDb()` → `db['wallets'].update(id, {...})` / `db['wallets'].get(id)` (gero-db.ts); `Wallet.mpcDeviceShare?: string` (types.ts line 34); backend contract `POST /api/mpc/recovery/store` → `{stored:boolean}`, `POST /api/mpc/recovery/fetch` → `{encryptedRecovery,publicKey}`, `POST /api/mpc/rotate` → `{rotated:boolean}`.
- Produces (later tasks rely on these EXACT signatures):
  - `Wallet.mpcDeviceShareNext?: string`
  - `setMpcDeviceShare(walletId:number, encryptedDeviceShare:string):Promise<void>`
  - `setMpcDeviceShareNext(walletId:number, encryptedDeviceShareNext:string|undefined):Promise<void>`
  - `promoteMpcDeviceShareNext(walletId:number):Promise<void>`
  - `api.mpc.storeRecovery(idToken,chain,network,encryptedRecovery,publicKey):Promise<{stored:boolean}>`
  - `api.mpc.fetchRecovery(idToken,chain,network):Promise<{encryptedRecovery:string,publicKey:string}>`
  - `api.mpc.rotate(idToken,chain,network,loginShare):Promise<{rotated:boolean}>`
  - `MessageTypes.STORE_MPC_RECOVERY` / `MessageTypes.REVEAL_MPC_SRP` / `MessageTypes.SET_RECOVERY_PASSWORD`

---

- [ ] **Step 1: Write the failing test**

Extend `src/api/mpc.api.spec.ts`. Replace the whole file with (keeps the two existing tests verbatim, adds three):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosInstance } from 'axios';
import { Api } from './api';

function makeApi() {
  // Object.create(Api.prototype) would skip the constructor and leave class
  // fields like `mpc`/`multiSig` undefined, so construct for real and then
  // swap in a mocked axiosInstance (mirrors how other Api members are tested).
  const api = new Api(undefined, undefined);
  const post = vi.fn();
  api.axiosInstance = { post } as unknown as AxiosInstance;
  return { api, post };
}

describe('Api.mpc', () => {
  let api: Api;
  let post: ReturnType<typeof vi.fn>;
  beforeEach(() => { ({ api, post } = makeApi()); });

  it('enroll posts the Plan B contract body and returns result', async () => {
    post.mockResolvedValue({ data: { stored: true }, status: 200 });
    const res = await api.mpc.enroll('idtok', 'cardano', 'mainnet', 'gmpc1.02.X.Y');
    expect(post).toHaveBeenCalledWith('/api/mpc/enroll', {
      idToken: 'idtok', chain: 'cardano', network: 'mainnet', loginShare: 'gmpc1.02.X.Y',
    });
    expect(res).toEqual({ stored: true });
  });

  it('getLoginShare posts idToken+chain+network and returns the share string', async () => {
    post.mockResolvedValue({ data: { loginShare: 'gmpc1.02.X.Y' }, status: 200 });
    const share = await api.mpc.getLoginShare('idtok', 'cardano', 'mainnet');
    expect(post).toHaveBeenCalledWith('/api/mpc/login-share', {
      idToken: 'idtok', chain: 'cardano', network: 'mainnet',
    });
    expect(share).toBe('gmpc1.02.X.Y');
  });

  it('storeRecovery posts the exact recovery-store body and returns result', async () => {
    post.mockResolvedValue({ data: { stored: true }, status: 200 });
    const res = await api.mpc.storeRecovery('idtok', 'cardano', 'mainnet', 'encblob', 'xpubanchor');
    expect(post).toHaveBeenCalledWith('/api/mpc/recovery/store', {
      idToken: 'idtok', chain: 'cardano', network: 'mainnet',
      encryptedRecovery: 'encblob', publicKey: 'xpubanchor',
    });
    expect(res).toEqual({ stored: true });
  });

  it('fetchRecovery posts idToken+chain+network and returns blob+publicKey', async () => {
    post.mockResolvedValue({ data: { encryptedRecovery: 'encblob', publicKey: 'xpubanchor' }, status: 200 });
    const res = await api.mpc.fetchRecovery('idtok', 'cardano', 'mainnet');
    expect(post).toHaveBeenCalledWith('/api/mpc/recovery/fetch', {
      idToken: 'idtok', chain: 'cardano', network: 'mainnet',
    });
    expect(res).toEqual({ encryptedRecovery: 'encblob', publicKey: 'xpubanchor' });
  });

  it('rotate posts idToken+chain+network+loginShare and returns result', async () => {
    post.mockResolvedValue({ data: { rotated: true }, status: 200 });
    const res = await api.mpc.rotate('idtok', 'cardano', 'mainnet', 'gmpc1.02.NEW');
    expect(post).toHaveBeenCalledWith('/api/mpc/rotate', {
      idToken: 'idtok', chain: 'cardano', network: 'mainnet', loginShare: 'gmpc1.02.NEW',
    });
    expect(res).toEqual({ rotated: true });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx vitest run src/api/mpc.api.spec.ts
```

Expected: the three new tests fail. Failure is a `TypeError: api.mpc.storeRecovery is not a function` (and `fetchRecovery` / `rotate` likewise) — the two pre-existing tests still pass. Overall run reports `3 failed | 2 passed`.

- [ ] **Step 3: Implement — `src/api/api.ts`**

Add the three methods inside the `mpc = { ... }` block, immediately after the `getLoginShare` method (after line 285, before the closing `};` on line 286). Literal paths, config-provided `baseURL`, no URL validation (hostname is not user-controlled — per OX SSRF context-analysis). Mirror `enroll` exactly:

```ts
    /** Store the client-encrypted recovery blob (+ xpub anchor) after backend verifies the idToken. */
    storeRecovery: async (
      idToken: string, chain: string, network: string, encryptedRecovery: string, publicKey: string,
    ): Promise<{ stored: boolean }> => {
      try {
        const { data, status } = await this.axiosInstance.post('/api/mpc/recovery/store',
          { idToken, chain, network, encryptedRecovery, publicKey });
        if (status === 200) return data as { stored: boolean };
        throw parseHttpError(data);
      } catch (error) {
        throw parseHttpError(error);
      }
    },
    /** Fetch the client-encrypted recovery blob + xpub anchor; backend verifies the idToken. */
    fetchRecovery: async (
      idToken: string, chain: string, network: string,
    ): Promise<{ encryptedRecovery: string; publicKey: string }> => {
      try {
        const { data, status } = await this.axiosInstance.post('/api/mpc/recovery/fetch',
          { idToken, chain, network });
        if (status === 200) return data as { encryptedRecovery: string; publicKey: string };
        throw parseHttpError(data);
      } catch (error) {
        throw parseHttpError(error);
      }
    },
    /** Replace the login share (reset/re-split path); backend verifies the idToken. */
    rotate: async (
      idToken: string, chain: string, network: string, loginShare: string,
    ): Promise<{ rotated: boolean }> => {
      try {
        const { data, status } = await this.axiosInstance.post('/api/mpc/rotate',
          { idToken, chain, network, loginShare });
        if (status === 200) return data as { rotated: boolean };
        throw parseHttpError(data);
      } catch (error) {
        throw parseHttpError(error);
      }
    },
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx vitest run src/api/mpc.api.spec.ts
```

Expected: `5 passed`.

- [ ] **Step 5: Implement — `src/models/types.ts`**

Add the crash-safety field to the `Wallet` interface, directly after `mpcDeviceShare` (line 34). Non-indexed → no Dexie schema/version bump needed:

```ts
  mpcDeviceShare?: string; // AES-encrypted encoded device share (non-indexed)
  mpcDeviceShareNext?: string; // Staged next device share during crash-safe re-split (non-indexed)
```

- [ ] **Step 6: Implement — `src/db/gero-db.ts`**

Add three exported helpers immediately after `setWalletName` (after line 610), following its exact `getDb()` + `db['wallets'].update(...)` pattern:

```ts
/**
 * Persist the (re-encrypted) device share for an MPC wallet.
 * @param walletId - The wallet ID
 * @param encryptedDeviceShare - AES-encrypted encoded device share
 */
export async function setMpcDeviceShare(walletId: number, encryptedDeviceShare: string): Promise<void> {
  const db: Dexie = await getDb();
  await db['wallets'].update(walletId, { mpcDeviceShare: encryptedDeviceShare });
}

/**
 * Stage the next device share during a crash-safe re-split.
 * Pass `undefined` to clear a stale staged share.
 * @param walletId - The wallet ID
 * @param encryptedDeviceShareNext - AES-encrypted next device share, or undefined to clear
 */
export async function setMpcDeviceShareNext(
  walletId: number,
  encryptedDeviceShareNext: string | undefined,
): Promise<void> {
  const db: Dexie = await getDb();
  await db['wallets'].update(walletId, { mpcDeviceShareNext: encryptedDeviceShareNext });
}

/**
 * Promote the staged next device share to the live device share and clear the staging slot.
 * Single atomic update (mpcDeviceShare := mpcDeviceShareNext, mpcDeviceShareNext := undefined).
 * @param walletId - The wallet ID
 */
export async function promoteMpcDeviceShareNext(walletId: number): Promise<void> {
  const db: Dexie = await getDb();
  const wallet = await db['wallets'].get(walletId);
  await db['wallets'].update(walletId, {
    mpcDeviceShare: wallet?.mpcDeviceShareNext,
    mpcDeviceShareNext: undefined,
  });
}
```

- [ ] **Step 7: Implement — `src/models/MessageTypes.ts`**

Add the three new message types inside the MPC block, after `HAS_MPC_SESSION` (line 31), following the existing enum-string style:

```ts
  HAS_MPC_SESSION = 'HAS_MPC_SESSION',
  STORE_MPC_RECOVERY = 'STORE_MPC_RECOVERY',
  REVEAL_MPC_SRP = 'REVEAL_MPC_SRP',
  SET_RECOVERY_PASSWORD = 'SET_RECOVERY_PASSWORD',
```

- [ ] **Step 8: Typecheck + lint touched files**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx tsc --noEmit && npx eslint src/api/api.ts src/api/mpc.api.spec.ts src/db/gero-db.ts src/models/types.ts src/models/MessageTypes.ts
```

Expected: `tsc` exits 0 (no errors); eslint reports no errors/warnings on the five files.

- [ ] **Step 9: Re-run the spec to confirm green after all edits**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx vitest run src/api/mpc.api.spec.ts
```

Expected: `5 passed`.

- [ ] **Final Step: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && \
git add src/api/api.ts src/api/mpc.api.spec.ts src/db/gero-db.ts src/models/types.ts src/models/MessageTypes.ts && \
git commit -m "feat(mpc): recovery api methods, device-share-next db helpers, message types

Add api.mpc.storeRecovery/fetchRecovery/rotate (literal /api/mpc paths,
config baseURL, no url-validation); gero-db setMpcDeviceShare/
setMpcDeviceShareNext/promoteMpcDeviceShareNext; Wallet.mpcDeviceShareNext
crash-safety field; STORE_MPC_RECOVERY/REVEAL_MPC_SRP/SET_RECOVERY_PASSWORD
message types. Client foundation for fileless MPC recovery.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Do NOT stage `src/stores/featureFlagsStore.ts` (global constraint — ships dark).


---

### Task 7: storeRecoveryShareFlow + onboarding store wiring

**Files:**
- Modify: `src/chrome/mpcWalletHandlers.ts` (append new section after line 358 / end of file)
- Modify: `src/models/MessageTypes.ts` (add `STORE_MPC_RECOVERY` after the `HAS_MPC_SESSION = 'HAS_MPC_SESSION',` line ~31)
- Modify: `src/chrome/background.ts` (add `storeRecoveryShareFlow` to the existing MPC import block lines 41-47; add new `app.addToOptions(MessageTypes.STORE_MPC_RECOVERY, ...)` handler after the `CREATE_MPC_GOOGLE_WALLET` handler ends, i.e. after line 1646)
- Test: `src/chrome/mpcWalletHandlers.spec.ts` (append a new `describe('storeRecoveryShareFlow', ...)` block after the `recoverMpcGoogleWalletFlow` describe, before the `resolveSignPrivateKeyBytes` describe ~line 277)

**Interfaces:**
Consumes:
- `encryptRecoveryShare(encodedShare: string, password: string): Promise<string>` — from `@/shared/utils/mpc` (re-exported in `src/shared/utils/mpc/index.ts` line 4; Argon2id v2, produces `gmpc-recovery1.<b64url>` blob).
- `api.mpc.storeRecovery(idToken, chain, network, encryptedRecovery, publicKey): Promise<{ stored: boolean }>` — from `src/api/api.ts` mpc block (added in the api.ts task, mirrors `enroll`).
- `MessageTypes` enum-string style from `src/models/MessageTypes.ts`.
- `createMpcGoogleWalletFlow` returns `{ walletId, recoveryShare, publicKey }` (mpcWalletHandlers.ts line 173) — onboarding feeds `recoveryShare` + `publicKey` into `STORE_MPC_RECOVERY`.

Produces (later tasks / UI consume):
- `storeRecoveryShareFlow(input: StoreRecoveryShareInput, deps: StoreRecoveryShareDeps): Promise<{ stored: boolean }>`
  - `StoreRecoveryShareInput = { idToken: string; chain: string; network: string; recoveryShare: string; recoveryPassword: string; publicKey: string }`
  - `StoreRecoveryShareDeps = { encryptRecoveryShare: (encodedShare: string, password: string) => Promise<string>; storeRecovery: (idToken: string, chain: string, network: string, encryptedRecovery: string, publicKey: string) => Promise<{ stored: boolean }> }`
- `MessageTypes.STORE_MPC_RECOVERY = 'STORE_MPC_RECOVERY'` — background handler that the onboarding backup step (StepGoogleBackup.vue, Task 9) posts to with `{ idToken, chain, network, recoveryShare, recoveryPassword, publicKey }` and receives `{ success, stored }` / `{ success: false, error }` (non-fatal).

---

- [ ] **Step 1: Write the failing test**

Append this `describe` block to `src/chrome/mpcWalletHandlers.spec.ts` immediately after the closing `});` of the `recoverMpcGoogleWalletFlow` describe (after line 276, before `describe('resolveSignPrivateKeyBytes', ...)`). Also add `storeRecoveryShareFlow` and `type StoreRecoveryShareDeps` to the import block at the top of the file (lines 3-13):

```ts
import {
  createMpcGoogleWalletFlow,
  unlockMpcWalletFlow,
  recoverMpcGoogleWalletFlow,
  storeRecoveryShareFlow,
  subFromIdToken,
  resolveSignPrivateKeyBytes,
  assertMpcActionSupported,
  type CreateMpcGoogleWalletDeps,
  type UnlockMpcWalletDeps,
  type RecoverMpcGoogleWalletDeps,
  type StoreRecoveryShareDeps,
} from './mpcWalletHandlers';
```

New describe block:

```ts
describe('storeRecoveryShareFlow', () => {
  const recoveryShare = 'gmpc1.03.recovery';
  const recoveryPassword = 'a-strong-recovery-passphrase';
  const blob = 'gmpc-recovery1.encrypted-blob';

  function makeDeps(overrides: Partial<StoreRecoveryShareDeps> = {}): StoreRecoveryShareDeps {
    return {
      encryptRecoveryShare: vi.fn(async (share: string, password: string) => `enc-recovery(${share},${password})`),
      storeRecovery: vi.fn(async () => ({ stored: true })),
      ...overrides,
    };
  }

  const baseInput = {
    idToken: fakeIdToken(),
    chain: 'cardano',
    network: 'mainnet',
    recoveryShare,
    recoveryPassword,
    publicKey: 'xpub-anchor',
  };

  it('encrypts the recovery share under the recovery password before uploading', async () => {
    const deps = makeDeps();
    await storeRecoveryShareFlow(baseInput, deps);
    expect(deps.encryptRecoveryShare).toHaveBeenCalledWith(recoveryShare, recoveryPassword);
  });

  it('uploads the encrypted blob with idToken/chain/network and the xpub anchor (never the plaintext share)', async () => {
    const deps = makeDeps({
      encryptRecoveryShare: vi.fn(async () => blob),
    });
    const result = await storeRecoveryShareFlow(baseInput, deps);

    expect(deps.storeRecovery).toHaveBeenCalledWith(
      baseInput.idToken,
      baseInput.chain,
      baseInput.network,
      blob,
      baseInput.publicKey,
    );
    // the plaintext recovery share is never handed to the backend
    const storeArgs = (deps.storeRecovery as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    expect(storeArgs).not.toContain(recoveryShare);
    expect(result).toEqual({ stored: true });
  });

  it('never logs the recovery share, password, or encrypted blob', async () => {
    const deps = makeDeps({ encryptRecoveryShare: vi.fn(async () => blob) });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await storeRecoveryShareFlow(baseInput, deps);

    for (const spy of [logSpy, errSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        const line = call.join(' ');
        expect(line).not.toContain(recoveryShare);
        expect(line).not.toContain(recoveryPassword);
        expect(line).not.toContain(blob);
      }
    }
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('surfaces an upload failure by rejecting, and touches no wallet state (encrypt succeeded, only the upload failed)', async () => {
    const deps = makeDeps({
      storeRecovery: vi.fn(async () => { throw new Error('recovery upload failed'); }),
    });
    // The flow has no DB/wallet dependency at all: a rejection here cannot corrupt the
    // already-created wallet. The background handler catches this and reports it non-fatally.
    await expect(storeRecoveryShareFlow(baseInput, deps)).rejects.toThrow('recovery upload failed');
    expect(deps.encryptRecoveryShare).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx vitest run src/chrome/mpcWalletHandlers.spec.ts
```

Expected failure — `storeRecoveryShareFlow` and `StoreRecoveryShareDeps` do not exist yet:
```
Error: [vitest] No "storeRecoveryShareFlow" export is defined on the "./mpcWalletHandlers" mock/module
```
(or a TypeScript/transform error: `"storeRecoveryShareFlow" is not exported by "src/chrome/mpcWalletHandlers.ts"`). The `storeRecoveryShareFlow` describe block fails; the pre-existing describes still pass.

- [ ] **Step 3: Implement the flow**

Append to the end of `src/chrome/mpcWalletHandlers.ts` (after line 358):

```ts

// ---------------------------------------------------------------------------
// Task 7: store the recovery share (fileless: Google account + recovery
// password, nothing to download)
// ---------------------------------------------------------------------------

export interface StoreRecoveryShareInput {
  idToken: string;
  chain: string;
  network: string;
  /** Encoded recovery share (one of the 3 MPC shares). Never logged/persisted locally. */
  recoveryShare: string;
  /** User-chosen recovery passphrase (floor 12 chars, enforced in the UI). Never logged. */
  recoveryPassword: string;
  /**
   * The wallet's CIP-1852 xpub. Uploaded alongside the encrypted recovery blob as the
   * restore-time anchor so a fresh-device restore can validate the reconstructed key
   * belongs to this wallet+Google account. Not secret.
   */
  publicKey: string;
}

export interface StoreRecoveryShareDeps {
  encryptRecoveryShare: (encodedShare: string, password: string) => Promise<string>;
  storeRecovery: (
    idToken: string,
    chain: string,
    network: string,
    encryptedRecovery: string,
    publicKey: string,
  ) => Promise<{ stored: boolean }>;
}

/**
 * Encrypt the recovery share under the user's recovery passphrase (Argon2id) and
 * upload the resulting blob to the backend, keyed by the verified Google subject.
 * This arms cross-device restore: recovery = Google account + this password, with
 * nothing for the user to download.
 *
 * The recovery passphrase never leaves the device — only the encrypted blob and the
 * (non-secret) xpub anchor are uploaded. Secret hygiene: neither the plaintext share
 * nor the passphrase nor the blob is ever logged here.
 *
 * This flow deliberately has NO wallet/DB dependency: the wallet is already created and
 * usable on this device (device + login = 2 of 3). If the upload fails, the caller
 * (background handler) reports it non-fatally and offers a retry — no local state is
 * touched, so the wallet cannot be corrupted by an upload error.
 */
export async function storeRecoveryShareFlow(
  input: StoreRecoveryShareInput,
  deps: StoreRecoveryShareDeps,
): Promise<{ stored: boolean }> {
  const { idToken, chain, network, recoveryShare, recoveryPassword, publicKey } = input;
  const { encryptRecoveryShare, storeRecovery } = deps;

  const encryptedRecovery = await encryptRecoveryShare(recoveryShare, recoveryPassword);
  return storeRecovery(idToken, chain, network, encryptedRecovery, publicKey);
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx vitest run src/chrome/mpcWalletHandlers.spec.ts
```

Expected: all describes pass, including the 4 new `storeRecoveryShareFlow` tests. Example tail:
```
 ✓ src/chrome/mpcWalletHandlers.spec.ts (NN tests) 
   ✓ storeRecoveryShareFlow > encrypts the recovery share under the recovery password before uploading
   ✓ storeRecoveryShareFlow > uploads the encrypted blob with idToken/chain/network and the xpub anchor (never the plaintext share)
   ✓ storeRecoveryShareFlow > never logs the recovery share, password, or encrypted blob
   ✓ storeRecoveryShareFlow > surfaces an upload failure by rejecting, and touches no wallet state (encrypt succeeded, only the upload failed)
 Test Files  1 passed (1)
```

- [ ] **Step 5: Add the `STORE_MPC_RECOVERY` message type**

In `src/models/MessageTypes.ts`, add the new member immediately after `HAS_MPC_SESSION = 'HAS_MPC_SESSION',` (line ~31), following the existing enum-string style:

```ts
  HAS_MPC_SESSION = 'HAS_MPC_SESSION',
  STORE_MPC_RECOVERY = 'STORE_MPC_RECOVERY',
```

- [ ] **Step 6: Wire the background handler (non-fatal)**

In `src/chrome/background.ts`, add `storeRecoveryShareFlow` to the existing MPC handlers import (lines 41-47):

```ts
import {
  createMpcGoogleWalletFlow,
  unlockMpcWalletFlow,
  recoverMpcGoogleWalletFlow,
  storeRecoveryShareFlow,
  subFromIdToken,
  resolveSignPrivateKeyBytes,
  assertMpcActionSupported,
} from '@/chrome/mpcWalletHandlers';
```

Then add this handler immediately after the `CREATE_MPC_GOOGLE_WALLET` handler closes (after line 1646, before the `UNLOCK_MPC_WALLET` handler):

```ts

app.addToOptions(MessageTypes.STORE_MPC_RECOVERY, async (request, sendResponse) => {
  try {
    // Note: Never log request.data — contains idToken/recoveryShare/recoveryPassword.
    const { idToken, chain, network, recoveryShare, recoveryPassword, publicKey } = request.data || {};
    if (!idToken) throw new Error('idToken is required');
    if (!recoveryShare) throw new Error('recoveryShare is required');
    if (!recoveryPassword) throw new Error('recoveryPassword is required');
    if (!publicKey) throw new Error('publicKey is required');

    const { encryptRecoveryShare } = await import('@/shared/utils/mpc');
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);

    const { stored } = await storeRecoveryShareFlow(
      { idToken, chain, network, recoveryShare, recoveryPassword, publicKey },
      {
        encryptRecoveryShare,
        storeRecovery: (idTok, ch, net, blob, pub) => api.mpc.storeRecovery(idTok, ch, net, blob, pub),
      },
    );

    sendResponse({
      id: request.id,
      data: { success: true, stored },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    // NON-FATAL: the wallet is already created and usable on THIS device (device + login
    // = 2 of 3). A failed recovery upload only means cross-device restore isn't armed yet;
    // the onboarding backup step surfaces a retry. Log only the message — never the
    // recovery blob/share/password.
    console.error('Error storing MPC recovery share:', getErrorMessage(error, 'store recovery failed'));
    sendResponse({
      id: request.id,
      data: { success: false, error: getErrorMessage(error, 'Failed to store recovery backup') },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  return true; // Required for async Chrome message handlers
});
```

- [ ] **Step 7: Typecheck + lint the touched files**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx eslint src/chrome/mpcWalletHandlers.ts src/chrome/background.ts src/models/MessageTypes.ts src/chrome/mpcWalletHandlers.spec.ts
```

Expected: no errors, no warnings (exit 0, no output). Resolve any ESLint issue in these files before moving on.

- [ ] **Step 8: Re-run the flow tests — expect PASS**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx vitest run src/chrome/mpcWalletHandlers.spec.ts
```

Expected: `Test Files  1 passed (1)`, all `storeRecoveryShareFlow` tests green.

- [ ] **Final Step: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && \
git add src/chrome/mpcWalletHandlers.ts src/chrome/mpcWalletHandlers.spec.ts src/models/MessageTypes.ts src/chrome/background.ts && \
git commit -m "feat(mpc): storeRecoveryShareFlow + STORE_MPC_RECOVERY handler

Encrypt the recovery share under the user's recovery passphrase (Argon2id)
and upload the blob + xpub anchor via api.mpc.storeRecovery. Non-fatal
background handler: a failed upload leaves the already-created wallet
untouched and offers a retry. No plaintext share/password/blob is ever
logged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> Note: do NOT `git add src/stores/featureFlagsStore.ts` (global constraint — never commit it). Only the four files above are staged.


---

### Task 8: Rework recover-on-new-device to backend+password (fileless)

**Files:**
- Modify: `src/chrome/mpcWalletHandlers.ts` (rework `RecoverMpcGoogleWalletInput` L249-269, `RecoverMpcGoogleWalletDeps` L271-294, and `recoverMpcGoogleWalletFlow` body L319-358)
- Test: `src/chrome/mpcWalletHandlers.spec.ts` (replace the `describe('recoverMpcGoogleWalletFlow', …)` block, L202-276)
- Modify: `src/chrome/background.ts` (rework the `RECOVER_MPC_GOOGLE_WALLET` handler, L1807-1861)

**Interfaces:**
- Consumes (from earlier api.ts task / FROZEN CONTRACT): `api.mpc.fetchRecovery(idToken:string, chain:string, network:string): Promise<{ encryptedRecovery: string; publicKey: string }>` (POST `/api/mpc/recovery/fetch`; 404 → not enrolled); `decryptRecoveryShare(blob:string, password:string): Promise<string>` (throws `RecoveryDecryptError`); `reconstructAndValidateEntropy(recoveryShare:string, loginShare:string, expectedXpub:string): Promise<Uint8Array>` (throws `MpcValidationError` on xpub mismatch); `encryptDeviceShare`, `createMpcGoogleWallet`, `subFromIdToken`, `getLoginShare`.
- Produces (later tasks / UI `StepGoogleRestore.vue` rely on): reworked `recoverMpcGoogleWalletFlow(input: RecoverMpcGoogleWalletInput, deps: RecoverMpcGoogleWalletDeps): Promise<{ walletId: number; publicKey: string }>` where `RecoverMpcGoogleWalletInput = { name; icon; theme; chain; network; idToken; recoveryPassword; newSecret: DeviceShareSecret; webAuthnCredentialId?: string; mpcPrfSaltId?: string }` (NO `recoveryBlob`, NO `expectedXpub`) and `RecoverMpcGoogleWalletDeps` adds `fetchRecovery: (idToken, chain, network) => Promise<{ encryptedRecovery: string; publicKey: string }>`. `MessageTypes.RECOVER_MPC_GOOGLE_WALLET` request body drops `recoveryBlob`/`publicKey`, adds nothing (idToken + recoveryPassword + name/icon/theme/chain/network + device-secret fields).

---

- [ ] **Step 1: Write the failing test**

Replace the whole `describe('recoverMpcGoogleWalletFlow', …)` block (current L202-276) in `src/chrome/mpcWalletHandlers.spec.ts` with:

```ts
describe('recoverMpcGoogleWalletFlow', () => {
  function makeDeps(overrides: Partial<RecoverMpcGoogleWalletDeps> = {}): RecoverMpcGoogleWalletDeps {
    return {
      // Fileless: the encrypted recovery blob + xpub anchor come from the backend, not a file.
      fetchRecovery: vi.fn(async () => ({ encryptedRecovery: 'gmpc-recovery1.blob', publicKey: 'xpub-anchor' })),
      decryptRecoveryShare: vi.fn(async () => 'gmpc1.03.recovery'),
      getLoginShare: vi.fn(async () => 'gmpc1.02.login'),
      // Validates internally; returns entropy on success, throws MpcValidationError on mismatch.
      reconstructAndValidateEntropy: vi.fn(async () => new Uint8Array(32)),
      encryptDeviceShare: vi.fn(async (share: string, s: DeviceShareSecret) => `enc(${share},${(s as { password: string }).password})`),
      createMpcGoogleWallet: vi.fn(async () => 99),
      subFromIdToken: vi.fn(() => 'google-sub-123'),
      ...overrides,
    };
  }

  const newSecret: DeviceShareSecret = { kind: 'password', password: 'new-pw' };

  const baseInput = {
    name: 'Restored Wallet',
    icon: 'icon.png',
    theme: 'dark',
    chain: 'cardano',
    network: 'mainnet',
    idToken: fakeIdToken(),
    recoveryPassword: 'recovery-pw',
    newSecret,
    webAuthnCredentialId: 'cred-2',
    mpcPrfSaltId: 'salt-2',
  };

  it('fetches the recovery blob+xpub from the backend, decrypts it, fetches the login share, and validates against the fetched xpub anchor', async () => {
    const deps = makeDeps();
    await recoverMpcGoogleWalletFlow(baseInput, deps);

    expect(deps.fetchRecovery).toHaveBeenCalledWith(baseInput.idToken, baseInput.chain, baseInput.network);
    expect(deps.decryptRecoveryShare).toHaveBeenCalledWith('gmpc-recovery1.blob', baseInput.recoveryPassword);
    expect(deps.getLoginShare).toHaveBeenCalledWith(baseInput.idToken, baseInput.chain, baseInput.network);
    expect(deps.reconstructAndValidateEntropy).toHaveBeenCalledWith('gmpc1.03.recovery', 'gmpc1.02.login', 'xpub-anchor');
  });

  it('persists the wallet using the backend anchor xpub, the recovery share re-encrypted as the device factor, and the credential/salt ids', async () => {
    const deps = makeDeps();
    const result = await recoverMpcGoogleWalletFlow(baseInput, deps);

    expect(deps.encryptDeviceShare).toHaveBeenCalledWith('gmpc1.03.recovery', baseInput.newSecret);
    expect(deps.createMpcGoogleWallet).toHaveBeenCalledWith({
      name: baseInput.name,
      icon: baseInput.icon,
      theme: baseInput.theme,
      chain: baseInput.chain,
      network: baseInput.network,
      userId: 'google-sub-123',
      publicKey: 'xpub-anchor',
      encryptedDeviceShare: `enc(gmpc1.03.recovery,${(newSecret as { password: string }).password})`,
      webAuthnCredentialId: 'cred-2',
      mpcPrfSaltId: 'salt-2',
    });
    expect(result).toEqual({ walletId: 99, publicKey: 'xpub-anchor' });
  });

  it('rejects and does NOT persist when the anchor validation fails (wrong Google account for this recovery)', async () => {
    const deps = makeDeps({
      reconstructAndValidateEntropy: vi.fn(async () => { throw new MpcValidationError('xpub mismatch'); }),
    });
    await expect(recoverMpcGoogleWalletFlow(baseInput, deps)).rejects.toBeInstanceOf(MpcValidationError);
    expect(deps.encryptDeviceShare).not.toHaveBeenCalled();
    expect(deps.createMpcGoogleWallet).not.toHaveBeenCalled();
  });

  it('does not persist a wallet if the recovery password is wrong (decrypt throws)', async () => {
    const deps = makeDeps({ decryptRecoveryShare: vi.fn(async () => { throw new Error('wrong password'); }) });
    await expect(recoverMpcGoogleWalletFlow(baseInput, deps)).rejects.toThrow('wrong password');
    expect(deps.getLoginShare).not.toHaveBeenCalled();
    expect(deps.createMpcGoogleWallet).not.toHaveBeenCalled();
  });

  it('propagates a 404 "no recovery on file" and writes NO state (never decrypts, never persists)', async () => {
    const deps = makeDeps({ fetchRecovery: vi.fn(async () => { throw new Error('not enrolled'); }) });
    await expect(recoverMpcGoogleWalletFlow(baseInput, deps)).rejects.toThrow('not enrolled');
    expect(deps.decryptRecoveryShare).not.toHaveBeenCalled();
    expect(deps.getLoginShare).not.toHaveBeenCalled();
    expect(deps.createMpcGoogleWallet).not.toHaveBeenCalled();
  });

  it('never logs the decrypted recovery share, the login share, or the recovery password', async () => {
    const deps = makeDeps();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await recoverMpcGoogleWalletFlow(baseInput, deps);

    for (const spy of [logSpy, errSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        const line = call.join(' ');
        expect(line).not.toContain('gmpc1.03.recovery');
        expect(line).not.toContain('gmpc1.02.login');
        expect(line).not.toContain(baseInput.recoveryPassword);
      }
    }
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx vitest run src/chrome/mpcWalletHandlers.spec.ts
```

Expected: TypeScript/type + runtime failures because the current `RecoverMpcGoogleWalletDeps` has no `fetchRecovery` and the current flow reads `input.recoveryBlob`/`input.expectedXpub` (now removed from `baseInput`). Sample output:

```
 FAIL  src/chrome/mpcWalletHandlers.spec.ts > recoverMpcGoogleWalletFlow > fetches the recovery blob+xpub from the backend ...
AssertionError: expected "decryptRecoveryShare" to be called with arguments: [ 'gmpc-recovery1.blob', 'recovery-pw' ]
Received: undefined, 'recovery-pw'   // old flow passed input.recoveryBlob (now undefined)
...
 FAIL  ... > propagates a 404 "no recovery on file" ...
   Test Files  1 failed (1)
```
(and `error TS2353: 'fetchRecovery' does not exist in type 'RecoverMpcGoogleWalletDeps'` under `npm run typecheck`).

- [ ] **Step 3: Implement — rework the flow in `src/chrome/mpcWalletHandlers.ts`**

Replace `RecoverMpcGoogleWalletInput` (L249-269):

```ts
export interface RecoverMpcGoogleWalletInput {
  name: string;
  icon: string;
  theme: string;
  chain: string;
  network: string;
  idToken: string;
  /** The memorized recovery password. Never logged, never persisted. */
  recoveryPassword: string;
  newSecret: DeviceShareSecret;
  /** Present when newSecret.kind === 'prf'; persisted so unlock can re-derive. */
  webAuthnCredentialId?: string;
  mpcPrfSaltId?: string;
}
```

Replace `RecoverMpcGoogleWalletDeps` (L271-294):

```ts
export interface RecoverMpcGoogleWalletDeps {
  /**
   * Fetch the password-encrypted recovery blob + the non-secret xpub anchor for
   * this Google account from the backend. Throws on 404 ("no recovery on file")
   * before any local state is written. Replaces the removed recovery-file upload.
   */
  fetchRecovery: (idToken: string, chain: string, network: string) => Promise<{ encryptedRecovery: string; publicKey: string }>;
  decryptRecoveryShare: (blob: string, password: string) => Promise<string>;
  getLoginShare: (idToken: string, chain: string, network: string) => Promise<string>;
  /** Reconstruct entropy from the two shares AND validate its xpub === expectedXpub (throws MpcValidationError on mismatch). */
  reconstructAndValidateEntropy: (
    recoveryShare: string,
    loginShare: string,
    expectedXpub: string,
  ) => Promise<Uint8Array>;
  encryptDeviceShare: (deviceShare: string, secret: DeviceShareSecret) => Promise<string>;
  createMpcGoogleWallet: (params: {
    name: string;
    icon: string;
    theme: string;
    chain: string;
    network: string;
    userId: string;
    publicKey: string;
    encryptedDeviceShare: string;
    webAuthnCredentialId?: string;
    mpcPrfSaltId?: string;
  }) => Promise<number>;
  subFromIdToken: (idToken: string) => string;
}
```

Replace the flow doc-comment + body (L301-358) with:

```ts
/**
 * Restore an MPC Google wallet on a fresh device — fileless.
 *
 * There is nothing to keep: the third factor is the memorized recovery
 * password. The backend serves the password-encrypted recovery blob plus the
 * non-secret xpub anchor (`fetchRecovery`); the user types the recovery
 * password to decrypt it locally. Recovery + login (2 of 3) then reconstruct
 * the entropy, validated against the fetched xpub anchor.
 *
 * A fresh device has no locally-stored xpub, so the reconstructed key can't be
 * trusted blindly: pairing account A's recovery with account B's login would
 * combine into garbage entropy whose per-share checksums still pass, silently
 * cementing a phantom wallet. To prevent that, `reconstructAndValidateEntropy`
 * checks the derived xpub against the anchor — a mismatch throws
 * MpcValidationError and NO wallet is persisted.
 *
 * Failure atomicity: `fetchRecovery` (404 → no recovery on file), decrypt
 * (wrong password), and anchor validation (wrong account) all throw BEFORE any
 * device share is encrypted or any wallet row is written — retry is clean.
 * Reuses the recovery share as the new device's local device factor; the login
 * share stays enrolled and unchanged on the backend.
 */
export async function recoverMpcGoogleWalletFlow(
  input: RecoverMpcGoogleWalletInput,
  deps: RecoverMpcGoogleWalletDeps,
): Promise<RecoverMpcGoogleWalletResult> {
  const { name, icon, theme, chain, network, idToken, recoveryPassword, newSecret, webAuthnCredentialId, mpcPrfSaltId } = input;
  const {
    fetchRecovery,
    decryptRecoveryShare,
    getLoginShare,
    reconstructAndValidateEntropy,
    encryptDeviceShare,
    createMpcGoogleWallet,
    subFromIdToken: getSub,
  } = deps;

  // Backend serves the encrypted recovery blob + the xpub anchor (404 → no recovery on file).
  const { encryptedRecovery, publicKey } = await fetchRecovery(idToken, chain, network);
  const recoveryShare = await decryptRecoveryShare(encryptedRecovery, recoveryPassword);
  const loginShare = await getLoginShare(idToken, chain, network);
  // Anchor check: reconstruct AND validate the derived xpub === publicKey.
  // Throws MpcValidationError on mismatch (before anything is persisted).
  await reconstructAndValidateEntropy(recoveryShare, loginShare, publicKey);

  // Reuse the recovery share as the new device's local device factor.
  const encryptedDeviceShare = await encryptDeviceShare(recoveryShare, newSecret);
  const userId = getSub(idToken);

  const walletId = await createMpcGoogleWallet({
    name,
    icon,
    theme,
    chain,
    network,
    userId,
    publicKey,
    encryptedDeviceShare,
    webAuthnCredentialId,
    mpcPrfSaltId,
  });

  return { walletId, publicKey };
}
```

(`RecoverMpcGoogleWalletResult` at L296-299 is unchanged: `{ walletId: number; publicKey: string }`.)

- [ ] **Step 4: Run test — expect PASS**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx vitest run src/chrome/mpcWalletHandlers.spec.ts
```

Expected: `Test Files  1 passed (1)` — all `recoverMpcGoogleWalletFlow` tests green plus the pre-existing `createMpcGoogleWalletFlow` / `unlockMpcWalletFlow` / `subFromIdToken` / `resolveSignPrivateKeyBytes` / `assertMpcActionSupported` suites still passing.

- [ ] **Step 5: Rewire the background handler in `src/chrome/background.ts`**

Replace the `RECOVER_MPC_GOOGLE_WALLET` handler body (current L1807-1861) with — drops `recoveryBlob`/`publicKey` from the request, calls the new `fetchRecovery` dep, keeps the `MpcValidationError` → clean-message discipline (no raw error, no secrets logged):

```ts
app.addToOptions(MessageTypes.RECOVER_MPC_GOOGLE_WALLET, async (request, sendResponse) => {
  try {
    // Note: Never log request.data — contains idToken/recoveryPassword/spendingPassword/prfOutputHex
    const { name, icon, theme, chain, network, idToken, recoveryPassword } = request.data || {};
    if (!idToken || !chain || !network || !recoveryPassword) {
      throw new Error('idToken, chain, network and recoveryPassword are required');
    }
    const { secret: newSecret, webAuthnCredentialId, mpcPrfSaltId } = buildDeviceShareSecret(request.data);

    const { decryptRecoveryShare, reconstructAndValidateEntropy, encryptDeviceShare } = await import('@/shared/utils/mpc');
    const { createMpcGoogleWallet } = await import('@/db/gero-db');
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);

    const { walletId, publicKey } = await recoverMpcGoogleWalletFlow(
      {
        name, icon, theme, chain, network, idToken, recoveryPassword, newSecret,
        webAuthnCredentialId, mpcPrfSaltId,
      },
      {
        fetchRecovery: (idTok, ch, net) => api.mpc.fetchRecovery(idTok, ch, net),
        decryptRecoveryShare,
        getLoginShare: (idTok, ch, net) => api.mpc.getLoginShare(idTok, ch, net),
        reconstructAndValidateEntropy,
        encryptDeviceShare,
        createMpcGoogleWallet,
        subFromIdToken,
      },
    );

    sendResponse({
      id: request.id,
      data: { success: true, walletId, publicKey },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    // Anchor mismatch (wrong Google account for this recovery) surfaces as a
    // clean message; the raw MpcValidationError is not leaked.
    const { MpcValidationError } = await import('@/shared/utils/mpc');
    const message = error instanceof MpcValidationError
      ? "This recovery doesn't match this Google account."
      : getErrorMessage(error, 'Failed to recover MPC wallet');
    console.error('Error recovering MPC Google wallet:', message);
    sendResponse({
      id: request.id,
      data: { success: false, error: message },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  return true; // Required for async Chrome message handlers
});
```

- [ ] **Step 6: Verify background wiring type-checks**

`api.mpc.fetchRecovery` is provided by the earlier api.ts task. Confirm the handler compiles against the reworked signatures:

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E "mpcWalletHandlers|background.ts" || echo "no mpc handler/background type errors"
```

Expected: `no mpc handler/background type errors` (the reworked `recoverMpcGoogleWalletFlow` call now supplies `fetchRecovery` and omits `recoveryBlob`/`expectedXpub`). If `vue-tsc` OOMs in this environment (documented in memory), fall back to the vitest run in Step 4 plus `npx vitest run src/chrome/mpcWalletHandlers.spec.ts` as the compile signal.

- [ ] **Final Step: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && \
git add src/chrome/mpcWalletHandlers.ts src/chrome/mpcWalletHandlers.spec.ts src/chrome/background.ts && \
git commit -m "$(cat <<'EOF'
feat(mpc): rework recover-on-new-device to fileless backend+password

Replace the recovery-file envelope path with a fileless flow: fetchRecovery
serves the password-encrypted blob + xpub anchor from the backend, the user's
recovery password decrypts it, and recovery+login reconstruct the entropy
validated against the fetched anchor. Fetch 404 / wrong password / xpub
mismatch all fail before any state is written. Never logs shares or password.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```


---

### Task 9: `revealMpcSrpFlow` + `REVEAL_MPC_SRP` handler

**Files:**
- Modify `src/chrome/mpcWalletHandlers.ts` (append new section after the Task-5 recover block, currently ending at line 359)
- Modify `src/chrome/mpcWalletHandlers.spec.ts` (add imports at lines 3-13; append a new `describe('revealMpcSrpFlow')` block after the existing `recoverMpcGoogleWalletFlow` describe, currently ending at line 276)
- Modify `src/models/MessageTypes.ts` (add `REVEAL_MPC_SRP` in the MPC block after `HAS_MPC_SESSION`, line 31)
- Modify `src/chrome/background.ts` (import `revealMpcSrpFlow` in the existing `@/chrome/mpcWalletHandlers` import block at lines 40-47; wire a new `app.addToOptions(MessageTypes.REVEAL_MPC_SRP, …)` handler after the `HAS_MPC_SESSION` handler, currently ending at line 1747)
- Test: `src/chrome/mpcWalletHandlers.spec.ts` (unit tests for the pure flow — the background wiring is thin and not unit-tested, mirroring `UNLOCK_MPC_WALLET` which has no background spec)

**Interfaces:**
- Consumes (from crypto reuse — exact signatures already in the repo):
  - `decryptDeviceShare(encryptedDeviceShare: string, secret: DeviceShareSecret): Promise<string>` (`src/shared/utils/mpc/deviceShareCipher.ts`, re-exported from `@/shared/utils/mpc`)
  - `reconstructAndValidateEntropy(deviceShare: string, loginShare: string, expectedXpub: string): Promise<Uint8Array>` (`src/shared/utils/mpc/mpcKeys.ts`; throws `MpcValidationError` on xpub mismatch)
  - `entropyToMnemonic(entropy: Uint8Array): string` (`src/shared/utils/mpc/mpcKeys.ts`)
  - `MpcValidationError` (`@/shared/utils/mpc`)
  - `buildDeviceShareSecret(request.data): { secret: DeviceShareSecret }` (existing helper in `background.ts`, used by `UNLOCK_MPC_WALLET` at line 1662)
  - `mpcLoginShareCache` (existing, `@/chrome/mpcLoginShareCache`) and `Api` (`@/api/api`) for the handler's login-share resolution, mirroring `UNLOCK_MPC_WALLET` (lines 1664-1685)
- Produces (later tasks / UI dialog `RevealRecoveryPhraseDialog.vue` consume via the `REVEAL_MPC_SRP` message):
  - `revealMpcSrpFlow(input: RevealMpcSrpInput, deps: RevealMpcSrpDeps): Promise<RevealMpcSrpResult>`
  - `interface RevealMpcSrpInput { walletId: number; idToken: string; secret: DeviceShareSecret }`
  - `interface RevealMpcSrpResult { mnemonic: string }`
  - `MessageTypes.REVEAL_MPC_SRP = 'REVEAL_MPC_SRP'` → response `{ success: true, mnemonic }` / `{ success: false, error }`

---

- [ ] **Step 1: Write the failing test**

Add the new symbols to the existing import block in `src/chrome/mpcWalletHandlers.spec.ts` (lines 3-13) so it reads:

```typescript
import {
  createMpcGoogleWalletFlow,
  unlockMpcWalletFlow,
  recoverMpcGoogleWalletFlow,
  revealMpcSrpFlow,
  subFromIdToken,
  resolveSignPrivateKeyBytes,
  assertMpcActionSupported,
  type CreateMpcGoogleWalletDeps,
  type UnlockMpcWalletDeps,
  type RecoverMpcGoogleWalletDeps,
  type RevealMpcSrpDeps,
} from './mpcWalletHandlers';
```

Append this `describe` block after the `recoverMpcGoogleWalletFlow` describe (after line 276):

```typescript
describe('revealMpcSrpFlow', () => {
  // A deterministic 32-byte entropy and its BIP39 mnemonic are irrelevant to the
  // unit under test — the flow delegates entropy→mnemonic to an injected dep — so
  // we use sentinel values and assert wiring, not bip39 correctness.
  const KNOWN_ENTROPY = new Uint8Array(32).fill(7);
  const KNOWN_MNEMONIC = 'abandon abandon ability';

  const wallet = {
    chain: 'cardano',
    network: 'mainnet',
    publicKey: 'xpub-test',
    mpcDeviceShare: 'enc-device-share',
    webAuthnCredentialId: 'cred-1',
    mpcPrfSaltId: 'salt-1',
  };

  function makeDeps(overrides: Partial<RevealMpcSrpDeps> = {}): RevealMpcSrpDeps {
    return {
      getWallet: vi.fn(async () => wallet),
      getLoginShare: vi.fn(async () => 'gmpc1.02.login'),
      decryptDeviceShare: vi.fn(async () => 'gmpc1.01.device'),
      // Returns entropy on success; throws MpcValidationError on xpub mismatch.
      reconstructAndValidateEntropy: vi.fn(async () => KNOWN_ENTROPY),
      entropyToMnemonic: vi.fn(() => KNOWN_MNEMONIC),
      ...overrides,
    };
  }

  const secret: DeviceShareSecret = { kind: 'password', password: 'device-secret' };
  const baseInput = { walletId: 7, idToken: fakeIdToken(), secret };

  it('reconstructs entropy from device+login and returns the mnemonic for known entropy', async () => {
    const deps = makeDeps();
    const result = await revealMpcSrpFlow(baseInput, deps);

    expect(deps.getLoginShare).toHaveBeenCalledWith(baseInput.idToken, wallet.chain, wallet.network);
    expect(deps.decryptDeviceShare).toHaveBeenCalledWith(wallet.mpcDeviceShare, baseInput.secret);
    expect(deps.reconstructAndValidateEntropy).toHaveBeenCalledWith('gmpc1.01.device', 'gmpc1.02.login', wallet.publicKey);
    expect(deps.entropyToMnemonic).toHaveBeenCalledWith(KNOWN_ENTROPY);
    expect(result).toEqual({ mnemonic: KNOWN_MNEMONIC });
  });

  it('requires the device secret: passes the exact secret through to decryptDeviceShare unchanged', async () => {
    let seenSecret: DeviceShareSecret | undefined;
    const deps = makeDeps({
      decryptDeviceShare: vi.fn(async (_enc: string, sec: DeviceShareSecret) => {
        seenSecret = sec;
        return 'gmpc1.01.device';
      }),
    });
    await revealMpcSrpFlow(baseInput, deps);
    expect(seenSecret).toEqual(secret);
  });

  it('response omits entropy and any share material — mnemonic is the only key', async () => {
    const deps = makeDeps();
    const result = await revealMpcSrpFlow(baseInput, deps);

    expect(Object.keys(result)).toEqual(['mnemonic']);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('gmpc1.01.device'); // device share
    expect(serialized).not.toContain('gmpc1.02.login');  // login share
    expect(serialized).not.toContain('7,7,7');            // entropy bytes
  });

  it('never logs the mnemonic or any share material', async () => {
    const deps = makeDeps();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await revealMpcSrpFlow(baseInput, deps);

    for (const spy of [logSpy, errSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        const joined = call.join(' ');
        expect(joined).not.toContain(KNOWN_MNEMONIC);
        expect(joined).not.toContain('gmpc1.01.device');
        expect(joined).not.toContain('gmpc1.02.login');
      }
    }
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('throws a clean error and returns no mnemonic on MpcValidationError (shares mismatch)', async () => {
    const deps = makeDeps({
      reconstructAndValidateEntropy: vi.fn(async () => { throw new MpcValidationError('mismatch'); }),
    });
    await expect(revealMpcSrpFlow(baseInput, deps)).rejects.toThrow();
    expect(deps.entropyToMnemonic).not.toHaveBeenCalled();
  });

  it('throws if the wallet is not found and never touches crypto', async () => {
    const deps = makeDeps({ getWallet: vi.fn(async () => undefined) });
    await expect(revealMpcSrpFlow(baseInput, deps)).rejects.toThrow('MPC wallet not found');
    expect(deps.decryptDeviceShare).not.toHaveBeenCalled();
    expect(deps.entropyToMnemonic).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx vitest run src/chrome/mpcWalletHandlers.spec.ts
```

Expected: transform/collect error — the module has no export `revealMpcSrpFlow` and no type `RevealMpcSrpDeps`, e.g.:

```
Error: [vitest] No "revealMpcSrpFlow" export is defined on the "./mpcWalletHandlers" module
```

(or a TS resolution failure on the missing `RevealMpcSrpDeps` import). The `revealMpcSrpFlow` describe block does not run to green.

- [ ] **Step 3: Implement the pure flow**

Append to `src/chrome/mpcWalletHandlers.ts` (after line 359, the end of `recoverMpcGoogleWalletFlow`). Note the file already imports `MpcValidationError` (line 14) and `DeviceShareSecret` (line 15), and already defines `MpcWalletRecord` (lines 180-187) which is reused here.

```typescript
// ---------------------------------------------------------------------------
// Task 9: reveal SRP (seed phrase) — escape hatch
// ---------------------------------------------------------------------------

export interface RevealMpcSrpInput {
  walletId: number;
  /** Fresh Google idToken (or '' when the handler resolves the login share from
   *  this session's cache). The backend verifies it before releasing the login share. */
  idToken: string;
  /** Device-secret re-auth: password or passkey-PRF output. Required even in an
   *  unlocked session — revealing the seed is gated on proving device possession. */
  secret: DeviceShareSecret;
}

export interface RevealMpcSrpDeps {
  getWallet: (walletId: number) => Promise<MpcWalletRecord | undefined>;
  getLoginShare: (idToken: string, chain: string, network: string) => Promise<string>;
  decryptDeviceShare: (encryptedDeviceShare: string, secret: DeviceShareSecret) => Promise<string>;
  /** Reconstruct entropy from device+login AND validate its xpub === expectedXpub
   *  (throws MpcValidationError on mismatch). */
  reconstructAndValidateEntropy: (
    deviceShare: string,
    loginShare: string,
    expectedXpub: string,
  ) => Promise<Uint8Array>;
  entropyToMnemonic: (entropy: Uint8Array) => string;
}

export interface RevealMpcSrpResult {
  /** The BIP39 seed phrase. Returned to the UI EXACTLY ONCE for display — never
   *  persisted, never logged, never echoed into any storage or response body but this. */
  mnemonic: string;
}

/**
 * Reveal the MPC wallet's BIP39 seed phrase (escape hatch). Reconstructs entropy
 * from the local device share (decrypted under the re-auth device secret) + the
 * backend login share — exactly the daily-unlock reconstruction — validates it
 * against the wallet's stored xpub, then derives the mnemonic. Returns it once.
 *
 * Secret hygiene: entropy, device/login shares and the mnemonic never leave this
 * function except as the returned `{ mnemonic }`; nothing here logs. On an
 * MpcValidationError (shares don't reconstruct to this wallet) a clean error is
 * thrown and no mnemonic is produced.
 */
export async function revealMpcSrpFlow(
  input: RevealMpcSrpInput,
  deps: RevealMpcSrpDeps,
): Promise<RevealMpcSrpResult> {
  const { walletId, idToken, secret } = input;
  const { getWallet, getLoginShare, decryptDeviceShare, reconstructAndValidateEntropy, entropyToMnemonic } = deps;

  const wallet = await getWallet(walletId);
  if (!wallet) {
    throw new Error('MPC wallet not found');
  }

  const loginShare = await getLoginShare(idToken, wallet.chain, wallet.network);
  const deviceShare = await decryptDeviceShare(wallet.mpcDeviceShare, secret);

  try {
    const entropy = await reconstructAndValidateEntropy(deviceShare, loginShare, wallet.publicKey);
    return { mnemonic: entropyToMnemonic(entropy) };
  } catch (err) {
    if (err instanceof MpcValidationError) {
      throw new Error('Recovery data mismatch — unable to reveal the seed phrase for this wallet');
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx vitest run src/chrome/mpcWalletHandlers.spec.ts
```

Expected: all `revealMpcSrpFlow` tests green and the pre-existing 22 tests still pass, e.g. `Tests  28 passed (28)`.

- [ ] **Step 5: Add the `REVEAL_MPC_SRP` message type**

In `src/models/MessageTypes.ts`, add the member inside the MPC block, immediately after `HAS_MPC_SESSION = 'HAS_MPC_SESSION',` (line 31):

```typescript
  HAS_MPC_SESSION = 'HAS_MPC_SESSION',
  REVEAL_MPC_SRP = 'REVEAL_MPC_SRP',
```

- [ ] **Step 6: Wire the background handler**

In `src/chrome/background.ts`, add `revealMpcSrpFlow` to the existing import from `@/chrome/mpcWalletHandlers` (lines 40-47):

```typescript
import {
  createMpcGoogleWalletFlow,
  unlockMpcWalletFlow,
  recoverMpcGoogleWalletFlow,
  revealMpcSrpFlow,
  resolveSignPrivateKeyBytes,
  assertMpcActionSupported,
} from '@/chrome/mpcWalletHandlers';
```

Then add the handler after the `HAS_MPC_SESSION` handler (after line 1747). It mirrors `UNLOCK_MPC_WALLET`'s device-secret + login-share resolution (idToken → backend fetch, else this session's cached share), but returns the mnemonic once instead of caching root-key bytes. `secret` provides the required device re-auth (the UI collects it via inline password prompt, or the side-panel `index.html?mode=mpcPrf#/passkey-auth` popup for passkey wallets).

```typescript
/**
 * Reveal the MPC wallet's BIP39 seed phrase (escape hatch) after a device-secret
 * re-auth, even in an unlocked session. Reconstructs entropy from device+login,
 * validates the xpub, and returns the mnemonic to the UI EXACTLY ONCE.
 *
 * Secret hygiene: never log request.data (idToken / spendingPassword / prfOutputHex)
 * and never log the mnemonic. The mnemonic is returned only in this response body
 * for one-time display; it is not persisted or cached anywhere.
 */
app.addToOptions(MessageTypes.REVEAL_MPC_SRP, async (request, sendResponse) => {
  try {
    const { walletId, idToken } = request.data || {};
    if (!walletId) throw new Error('walletId is required');
    // Unlocked-session reveal: a fresh Google idToken OR a login share cached
    // this session must be present (device secret alone is below threshold).
    const hasCachedLoginShare = await mpcLoginShareCache.has(walletId);
    if (!idToken && !hasCachedLoginShare) {
      throw new Error('MPC session expired — sign in with Google');
    }
    const { secret } = buildDeviceShareSecret(request.data);

    const { decryptDeviceShare, reconstructAndValidateEntropy, entropyToMnemonic } = await import('@/shared/utils/mpc');
    const { getAllWallets } = await import('@/db/gero-db');
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);

    const getLoginShare = idToken
      ? async (idTok: string, ch: string, net: string): Promise<string> => api.mpc.getLoginShare(idTok, ch, net)
      : async (): Promise<string> => {
          const cached = await mpcLoginShareCache.get(walletId);
          if (!cached) throw new Error('MPC session expired — sign in with Google');
          return cached;
        };

    const { mnemonic } = await revealMpcSrpFlow(
      { walletId, idToken: idToken || '', secret },
      {
        getWallet: async (id) => {
          const wallets = await getAllWallets();
          return wallets[id];
        },
        getLoginShare,
        decryptDeviceShare,
        reconstructAndValidateEntropy,
        entropyToMnemonic,
      },
    );

    sendResponse({
      id: request.id,
      data: { success: true, mnemonic },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    // getErrorMessage only — never let a share/mnemonic reach the log or response.
    console.error('Error revealing MPC seed phrase:', getErrorMessage(error, 'reveal failed'));
    sendResponse({
      id: request.id,
      data: { success: false, error: getErrorMessage(error, 'Failed to reveal seed phrase') },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  return true; // Required for async Chrome message handlers
});
```

- [ ] **Step 7: Re-run the unit tests and rebuild the background bundle**

The pure flow is covered by the vitest suite; the background wiring compiles as part of the dev bundle (per the repo rule that `src/chrome/` changes need a separate background rebuild, and that the CI bundle can still fail where tsc passes).

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx vitest run src/chrome/mpcWalletHandlers.spec.ts
```

Expected: `Tests  28 passed (28)`.

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npm run lint -- src/chrome/mpcWalletHandlers.ts src/chrome/background.ts src/models/MessageTypes.ts
```

Expected: no ESLint errors or warnings in the touched files (fix any that appear before committing).

- [ ] **Final Step: Commit**

Do NOT stage `src/stores/featureFlagsStore.ts` (global constraint). Stage only the files this task touched:

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && \
git add src/chrome/mpcWalletHandlers.ts src/chrome/mpcWalletHandlers.spec.ts src/models/MessageTypes.ts src/chrome/background.ts && \
git commit -m "feat(mpc): revealMpcSrpFlow + REVEAL_MPC_SRP handler (seed-phrase escape hatch)

Reconstruct entropy from device+login behind a device-secret re-auth,
derive the BIP39 mnemonic, return it once. Never persisted/logged.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```


---

### Task 10: `setRecoveryPasswordFlow` (crash-safe re-split) + resume-on-unlock

**Files:**
- Modify: `src/chrome/mpcWalletHandlers.ts` (add `SetRecoveryPasswordInput` / `SetRecoveryPasswordDeps` interfaces + `setRecoveryPasswordFlow`; extend `MpcWalletRecord` with `mpcDeviceShareNext?`; extend `UnlockMpcWalletDeps` + `unlockMpcWalletFlow` resume-on-unlock — insert after line 243, edit `MpcWalletRecord` at lines 180–187 and `UnlockMpcWalletDeps`/`unlockMpcWalletFlow` at lines 195–243)
- Modify: `src/chrome/background.ts` (extend the `UNLOCK_MPC_WALLET` handler deps at lines 1687–1698 with `promoteMpcDeviceShareNext`/`dropMpcDeviceShareNext`; add a new `SET_RECOVERY_PASSWORD` handler after the `RECOVER_MPC_GOOGLE_WALLET` handler ends at line 1861)
- Test: `src/chrome/mpcWalletHandlers.spec.ts` (append `describe('setRecoveryPasswordFlow')` + resume-on-unlock cases inside the existing `describe('unlockMpcWalletFlow')`)

**Interfaces:**
- Consumes (from earlier tasks / frozen contract):
  - `src/models/types.ts`: `Wallet.mpcDeviceShareNext?: string`
  - `src/db/gero-db.ts`: `setMpcDeviceShareNext(walletId:number, encryptedDeviceShareNext:string|undefined):Promise<void>`, `promoteMpcDeviceShareNext(walletId:number):Promise<void>`, `getAllWallets()`
  - `src/api/api.ts`: `api.mpc.rotate(idToken,chain,network,loginShare):Promise<{rotated:boolean}>`, `api.mpc.storeRecovery(idToken,chain,network,encryptedRecovery,publicKey):Promise<{stored:boolean}>`, `api.mpc.getLoginShare(idToken,chain,network):Promise<string>`
  - `src/models/MessageTypes.ts`: `MessageTypes.SET_RECOVERY_PASSWORD`
  - `src/shared/utils/mpc` (re-exported by `index.ts`): `createMpcShareSet(entropy:Uint8Array):Promise<MpcShareSet>`, `reconstructAndValidateEntropy(deviceShare:string, loginShare:string, expectedXpub:string):Promise<Uint8Array>`, `encryptDeviceShare(deviceShare:string, secret:DeviceShareSecret):Promise<string>`, `decryptDeviceShare(envelope:string, secret:DeviceShareSecret):Promise<string>`, `encryptRecoveryShare(encodedShare:string, password:string):Promise<string>`, `MpcValidationError`, type `MpcShareSet`, type `DeviceShareSecret`
  - `src/chrome/mpcLoginShareCache.ts`: `mpcLoginShareCache.clear(walletId:number):Promise<void>`
- Produces (later tasks / UI dialogs rely on these):
  - `setRecoveryPasswordFlow(input: SetRecoveryPasswordInput, deps: SetRecoveryPasswordDeps): Promise<void>`
  - `interface SetRecoveryPasswordInput { walletId:number; idToken:string; newRecoveryPassword:string; secret:DeviceShareSecret }`
  - `interface SetRecoveryPasswordDeps { getWallet; getLoginShare; decryptDeviceShare; reconstructAndValidateEntropy; createMpcShareSet; encryptDeviceShare; encryptRecoveryShare; setMpcDeviceShareNext; rotate; promoteMpcDeviceShareNext; storeRecovery; clearLoginShareCache }`
  - `MpcWalletRecord.mpcDeviceShareNext?: string`
  - `UnlockMpcWalletDeps.promoteMpcDeviceShareNext?` / `.dropMpcDeviceShareNext?` (resume-on-unlock)
  - `app.addToOptions(MessageTypes.SET_RECOVERY_PASSWORD, …)` background handler

---

- [ ] **Step 1: Write the failing test**

Append the following `describe` block to the END of `src/chrome/mpcWalletHandlers.spec.ts`. Also add `setRecoveryPasswordFlow` and the two new dep types to the import list at the top of the file (see the small edit after the block).

```typescript
describe('setRecoveryPasswordFlow', () => {
  // A DISTINCT fresh split S' — all three shares differ from any prior split,
  // proving the flow re-splits rather than re-wrapping the old recovery share.
  const freshSplit = {
    deviceShare: 'gmpc1.01.deviceNEW',
    loginShare: 'gmpc1.02.loginNEW',
    recoveryShare: 'gmpc1.03.recoveryNEW',
  };

  const wallet = {
    chain: 'cardano',
    network: 'mainnet',
    publicKey: 'xpub-test',
    mpcDeviceShare: 'enc-device-share-OLD',
  };

  const secret: DeviceShareSecret = { kind: 'password', password: 'device-pw' };

  function makeDeps(
    order: string[],
    overrides: Partial<SetRecoveryPasswordDeps> = {},
  ): SetRecoveryPasswordDeps {
    return {
      getWallet: vi.fn(async () => wallet),
      getLoginShare: vi.fn(async () => 'gmpc1.02.loginOLD'),
      decryptDeviceShare: vi.fn(async () => 'gmpc1.01.deviceOLD'),
      // Reconstructs + validates the CURRENT device+login → entropy of THIS wallet.
      reconstructAndValidateEntropy: vi.fn(async () => new Uint8Array(32)),
      createMpcShareSet: vi.fn(async () => freshSplit),
      encryptDeviceShare: vi.fn(async (share: string) => `encDev(${share})`),
      encryptRecoveryShare: vi.fn(async (share: string, pw: string) => `encRec(${share},${pw})`),
      setMpcDeviceShareNext: vi.fn(async (_id: number, v: string | undefined) => {
        order.push(v === undefined ? 'dropNext' : 'stageNext');
      }),
      rotate: vi.fn(async () => { order.push('rotate'); return { rotated: true }; }),
      promoteMpcDeviceShareNext: vi.fn(async () => { order.push('promote'); }),
      storeRecovery: vi.fn(async () => { order.push('storeRecovery'); return { stored: true }; }),
      clearLoginShareCache: vi.fn(async () => { order.push('clearCache'); }),
      ...overrides,
    };
  }

  const baseInput = {
    walletId: 7,
    idToken: fakeIdToken(),
    newRecoveryPassword: 'a-brand-new-strong-password',
    secret,
  };

  it('reconstructs from the CURRENT device+login and NEVER asks the old recovery password', async () => {
    const order: string[] = [];
    const deps = makeDeps(order);
    await setRecoveryPasswordFlow(baseInput, deps);

    // Old device share is decrypted with the re-auth device secret …
    expect(deps.decryptDeviceShare).toHaveBeenCalledWith(wallet.mpcDeviceShare, secret);
    // … and the login share for THIS wallet's chain/network is fetched.
    expect(deps.getLoginShare).toHaveBeenCalledWith(baseInput.idToken, wallet.chain, wallet.network);
    // Entropy comes from device+login only — no old recovery password anywhere.
    expect(deps.reconstructAndValidateEntropy).toHaveBeenCalledWith(
      'gmpc1.01.deviceOLD',
      'gmpc1.02.loginOLD',
      wallet.publicKey,
    );
    // The input carries NO old-password field.
    expect('oldRecoveryPassword' in baseInput).toBe(false);
  });

  it('re-splits the same entropy: all three NEW shares come from one fresh split', async () => {
    const order: string[] = [];
    const deps = makeDeps(order);
    await setRecoveryPasswordFlow(baseInput, deps);

    // Fresh split off the reconstructed entropy.
    expect(deps.createMpcShareSet).toHaveBeenCalledWith(new Uint8Array(32));
    // Device factor = S'.device (staged as next).
    expect(deps.encryptDeviceShare).toHaveBeenCalledWith(freshSplit.deviceShare, secret);
    expect(deps.setMpcDeviceShareNext).toHaveBeenCalledWith(baseInput.walletId, `encDev(${freshSplit.deviceShare})`);
    // Login factor = S'.login (rotated on the backend).
    expect(deps.rotate).toHaveBeenCalledWith(baseInput.idToken, wallet.chain, wallet.network, freshSplit.loginShare);
    // Recovery factor = S'.recovery, encrypted under the NEW password + xpub anchor.
    expect(deps.encryptRecoveryShare).toHaveBeenCalledWith(freshSplit.recoveryShare, baseInput.newRecoveryPassword);
    expect(deps.storeRecovery).toHaveBeenCalledWith(
      baseInput.idToken,
      wallet.chain,
      wallet.network,
      `encRec(${freshSplit.recoveryShare},${baseInput.newRecoveryPassword})`,
      wallet.publicKey,
    );
  });

  it('runs the crash-safe order exactly: stage-next → rotate → promote → store-recovery → clear-cache', async () => {
    const order: string[] = [];
    const deps = makeDeps(order);
    await setRecoveryPasswordFlow(baseInput, deps);
    expect(order).toEqual(['stageNext', 'rotate', 'promote', 'storeRecovery', 'clearCache']);
  });

  it('rolls back on backend-rotate failure: drops the staged next, never promotes/stores/clears, stays on old split', async () => {
    const order: string[] = [];
    const deps = makeDeps(order, {
      rotate: vi.fn(async () => { order.push('rotate'); throw new Error('backend 503'); }),
    });

    await expect(setRecoveryPasswordFlow(baseInput, deps)).rejects.toThrow('backend 503');

    // Staged then dropped; nothing past rotate ran.
    expect(order).toEqual(['stageNext', 'rotate', 'dropNext']);
    expect(deps.setMpcDeviceShareNext).toHaveBeenNthCalledWith(1, baseInput.walletId, `encDev(${freshSplit.deviceShare})`);
    expect(deps.setMpcDeviceShareNext).toHaveBeenNthCalledWith(2, baseInput.walletId, undefined);
    expect(deps.promoteMpcDeviceShareNext).not.toHaveBeenCalled();
    expect(deps.storeRecovery).not.toHaveBeenCalled();
    expect(deps.clearLoginShareCache).not.toHaveBeenCalled();
  });

  it('stores the recovery blob LAST (only once S\' is fully live)', async () => {
    const order: string[] = [];
    const deps = makeDeps(order);
    await setRecoveryPasswordFlow(baseInput, deps);
    expect(order.indexOf('storeRecovery')).toBeGreaterThan(order.indexOf('promote'));
    expect(order.indexOf('storeRecovery')).toBeGreaterThan(order.indexOf('rotate'));
  });

  it('throws (and writes nothing) if the wallet is not found', async () => {
    const order: string[] = [];
    const deps = makeDeps(order, { getWallet: vi.fn(async () => undefined) });
    await expect(setRecoveryPasswordFlow(baseInput, deps)).rejects.toThrow('MPC wallet not found');
    expect(deps.setMpcDeviceShareNext).not.toHaveBeenCalled();
    expect(deps.rotate).not.toHaveBeenCalled();
  });

  it('never logs the new password, the shares, or the entropy', async () => {
    const order: string[] = [];
    const deps = makeDeps(order);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await setRecoveryPasswordFlow(baseInput, deps);

    for (const spy of [logSpy, errSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        const line = call.join(' ');
        expect(line).not.toContain(baseInput.newRecoveryPassword);
        expect(line).not.toContain(freshSplit.deviceShare);
        expect(line).not.toContain(freshSplit.loginShare);
        expect(line).not.toContain(freshSplit.recoveryShare);
      }
    }
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

describe('unlockMpcWalletFlow — resume-on-unlock (staged deviceShareNext)', () => {
  const secret: DeviceShareSecret = { kind: 'password', password: 'pw' };
  const baseInput = { walletId: 7, idToken: fakeIdToken(), secret };

  const walletWithNext = {
    chain: 'cardano',
    network: 'mainnet',
    publicKey: 'xpub-test',
    mpcDeviceShare: 'enc-device-OLD',
    mpcDeviceShareNext: 'enc-device-NEXT',
  };

  it('resumes a crashed re-split: primary device+login fails but next+login succeeds → promotes next, caches bytes', async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const reconstruct = vi.fn(async (encDeviceShare: string) => {
      // Post-rotate crash state: OLD device + NEW login → xpub mismatch.
      if (encDeviceShare === walletWithNext.mpcDeviceShare) throw new MpcValidationError('mismatch');
      // Staged next + NEW login → correct entropy.
      return bytes;
    });
    const deps: UnlockMpcWalletDeps = {
      getWallet: vi.fn(async () => walletWithNext),
      getLoginShare: vi.fn(async () => 'gmpc1.02.loginNEW'),
      reconstructRootKeyBytes: reconstruct,
      sessionCache: { set: vi.fn() },
      promoteMpcDeviceShareNext: vi.fn(async () => {}),
      dropMpcDeviceShareNext: vi.fn(async () => {}),
    };

    await unlockMpcWalletFlow(baseInput, deps);

    expect(reconstruct).toHaveBeenNthCalledWith(1, walletWithNext.mpcDeviceShare, secret, 'gmpc1.02.loginNEW', walletWithNext.publicKey);
    expect(reconstruct).toHaveBeenNthCalledWith(2, walletWithNext.mpcDeviceShareNext, secret, 'gmpc1.02.loginNEW', walletWithNext.publicKey);
    expect(deps.promoteMpcDeviceShareNext).toHaveBeenCalledWith(baseInput.walletId);
    expect(deps.sessionCache.set).toHaveBeenCalledWith(baseInput.walletId, bytes);
    expect(deps.dropMpcDeviceShareNext).not.toHaveBeenCalled();
  });

  it('drops a stale next and rethrows a clean error when neither device nor next reconstructs', async () => {
    const deps: UnlockMpcWalletDeps = {
      getWallet: vi.fn(async () => walletWithNext),
      getLoginShare: vi.fn(async () => 'gmpc1.02.loginX'),
      reconstructRootKeyBytes: vi.fn(async () => { throw new MpcValidationError('mismatch'); }),
      sessionCache: { set: vi.fn() },
      promoteMpcDeviceShareNext: vi.fn(async () => {}),
      dropMpcDeviceShareNext: vi.fn(async () => {}),
    };

    await expect(unlockMpcWalletFlow(baseInput, deps)).rejects.toThrow();
    expect(deps.dropMpcDeviceShareNext).toHaveBeenCalledWith(baseInput.walletId);
    expect(deps.promoteMpcDeviceShareNext).not.toHaveBeenCalled();
    expect(deps.sessionCache.set).not.toHaveBeenCalled();
  });

  it('on a normal unlock with a stale next present, drops the stale next and caches on the primary reconstruct', async () => {
    const bytes = new Uint8Array([7, 7, 7]);
    const deps: UnlockMpcWalletDeps = {
      getWallet: vi.fn(async () => walletWithNext),
      getLoginShare: vi.fn(async () => 'gmpc1.02.login'),
      reconstructRootKeyBytes: vi.fn(async () => bytes),
      sessionCache: { set: vi.fn() },
      promoteMpcDeviceShareNext: vi.fn(async () => {}),
      dropMpcDeviceShareNext: vi.fn(async () => {}),
    };

    await unlockMpcWalletFlow(baseInput, deps);

    expect(deps.dropMpcDeviceShareNext).toHaveBeenCalledWith(baseInput.walletId);
    expect(deps.promoteMpcDeviceShareNext).not.toHaveBeenCalled();
    expect(deps.sessionCache.set).toHaveBeenCalledWith(baseInput.walletId, bytes);
  });
});
```

Then update the import at the top of the spec (lines 3–13) to pull in the new symbols and types:

```typescript
import {
  createMpcGoogleWalletFlow,
  unlockMpcWalletFlow,
  recoverMpcGoogleWalletFlow,
  setRecoveryPasswordFlow,
  subFromIdToken,
  resolveSignPrivateKeyBytes,
  assertMpcActionSupported,
  type CreateMpcGoogleWalletDeps,
  type UnlockMpcWalletDeps,
  type RecoverMpcGoogleWalletDeps,
  type SetRecoveryPasswordDeps,
} from './mpcWalletHandlers';
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx vitest run src/chrome/mpcWalletHandlers.spec.ts 2>&1 | tail -20
```

Expected: a transform/type error because `setRecoveryPasswordFlow` and `SetRecoveryPasswordDeps` are not exported yet, e.g.:

```
Error: No known export 'setRecoveryPasswordFlow' in module .../mpcWalletHandlers.ts
```

(or the file fails to collect and the `setRecoveryPasswordFlow` / resume-on-unlock suites report as failing). The pre-existing 22 tests must not be relied on to pass while the file cannot compile.

- [ ] **Step 3: Implement `setRecoveryPasswordFlow` + resume-on-unlock in `mpcWalletHandlers.ts`**

**3a.** Extend `MpcWalletRecord` (lines 180–187) to carry the staged next share:

```typescript
export interface MpcWalletRecord {
  chain: string;
  network: string;
  publicKey: string;
  mpcDeviceShare: string;
  /** Staged next-generation device share written by a crash-safe re-split (setRecoveryPasswordFlow). */
  mpcDeviceShareNext?: string;
  webAuthnCredentialId?: string;
  mpcPrfSaltId?: string;
}
```

**3b.** Extend `UnlockMpcWalletDeps` (lines 195–205) with the two optional resume hooks:

```typescript
export interface UnlockMpcWalletDeps {
  getWallet: (walletId: number) => Promise<MpcWalletRecord | undefined>;
  getLoginShare: (idToken: string, chain: string, network: string) => Promise<string>;
  reconstructRootKeyBytes: (
    encryptedDeviceShare: string,
    secret: DeviceShareSecret,
    loginShare: string,
    expectedXpub: string,
  ) => Promise<Uint8Array>;
  sessionCache: { set: (walletId: number, bytes: Uint8Array) => void };
  /** Finish a crashed re-split: make the staged `mpcDeviceShareNext` the primary device share. Optional. */
  promoteMpcDeviceShareNext?: (walletId: number) => Promise<void>;
  /** Discard a stale `mpcDeviceShareNext` that no longer reconstructs. Optional. */
  dropMpcDeviceShareNext?: (walletId: number) => Promise<void>;
}
```

**3c.** Replace the body of `unlockMpcWalletFlow` (lines 215–243) with the resume-aware version:

```typescript
export async function unlockMpcWalletFlow(
  input: UnlockMpcWalletInput,
  deps: UnlockMpcWalletDeps,
): Promise<void> {
  const { walletId, idToken, secret } = input;
  const { getWallet, getLoginShare, reconstructRootKeyBytes, sessionCache, promoteMpcDeviceShareNext, dropMpcDeviceShareNext } = deps;

  const wallet = await getWallet(walletId);
  if (!wallet) {
    throw new Error('MPC wallet not found');
  }

  const loginShare = await getLoginShare(idToken, wallet.chain, wallet.network);

  try {
    const bytes = await reconstructRootKeyBytes(
      wallet.mpcDeviceShare,
      secret,
      loginShare,
      wallet.publicKey,
    );
    // Primary device+login reconstructs → a complete split. Any `mpcDeviceShareNext`
    // still lying around is stale (a re-split that fully finished, or was never
    // promoted) — drop it so it can't be tried again.
    if (wallet.mpcDeviceShareNext && dropMpcDeviceShareNext) {
      await dropMpcDeviceShareNext(walletId);
    }
    sessionCache.set(walletId, bytes);
  } catch (primaryErr) {
    // Resume-on-unlock: a re-split (setRecoveryPasswordFlow) that crashed AFTER the
    // backend login-share rotate but BEFORE the local promote leaves the backend on
    // S'.login while the device share is still S.device → primary reconstruct fails
    // the xpub check. If a staged S'.device is present, try IT against the (new)
    // login share; on success finish the interrupted promote and continue unlocked.
    if (wallet.mpcDeviceShareNext && promoteMpcDeviceShareNext) {
      try {
        const bytes = await reconstructRootKeyBytes(
          wallet.mpcDeviceShareNext,
          secret,
          loginShare,
          wallet.publicKey,
        );
        await promoteMpcDeviceShareNext(walletId);
        sessionCache.set(walletId, bytes);
        return;
      } catch {
        // The staged next doesn't reconstruct either → dead garbage from a failed
        // attempt. Drop it and fall through to surface the original error.
        if (dropMpcDeviceShareNext) await dropMpcDeviceShareNext(walletId);
      }
    }
    if (primaryErr instanceof MpcValidationError) {
      throw new Error('Recovery data mismatch — unable to unlock this wallet with Google');
    }
    throw primaryErr;
  }
}
```

**3d.** Append the new flow at the END of `mpcWalletHandlers.ts` (after line 358):

```typescript
// ---------------------------------------------------------------------------
// Task 10: set / change recovery password (crash-safe re-split)
// ---------------------------------------------------------------------------

export interface SetRecoveryPasswordInput {
  walletId: number;
  idToken: string;
  /** The NEW recovery password. Load-bearing secret — never logged, never persisted plaintext. */
  newRecoveryPassword: string;
  /** Device-secret re-auth (spending password or passkey PRF output) for the unlocked session. */
  secret: DeviceShareSecret;
}

export interface SetRecoveryPasswordDeps {
  getWallet: (walletId: number) => Promise<MpcWalletRecord | undefined>;
  getLoginShare: (idToken: string, chain: string, network: string) => Promise<string>;
  /** Decrypt the current at-rest device share under the re-auth secret. */
  decryptDeviceShare: (envelope: string, secret: DeviceShareSecret) => Promise<string>;
  /** Reconstruct entropy from device+login AND validate xpub === wallet.publicKey (throws MpcValidationError on mismatch). */
  reconstructAndValidateEntropy: (deviceShare: string, loginShare: string, expectedXpub: string) => Promise<Uint8Array>;
  /** Fresh 2-of-3 re-split of the SAME entropy → new device/login/recovery shares. */
  createMpcShareSet: (entropy: Uint8Array) => Promise<MpcShareSet>;
  encryptDeviceShare: (deviceShare: string, secret: DeviceShareSecret) => Promise<string>;
  encryptRecoveryShare: (recoveryShare: string, password: string) => Promise<string>;
  /** Stage (value=blob) or drop (value=undefined) the next-generation device share. */
  setMpcDeviceShareNext: (walletId: number, encryptedDeviceShareNext: string | undefined) => Promise<void>;
  /** Replace the backend login share with the fresh S'.login. */
  rotate: (idToken: string, chain: string, network: string, loginShare: string) => Promise<{ rotated: boolean }>;
  /** Promote the staged next device share to primary (device = S'.device, next cleared). */
  promoteMpcDeviceShareNext: (walletId: number) => Promise<void>;
  storeRecovery: (idToken: string, chain: string, network: string, encryptedRecovery: string, publicKey: string) => Promise<{ stored: boolean }>;
  /** Drop the now-stale cached login share so the next unlock fetches S'.login fresh. */
  clearLoginShareCache: (walletId: number) => Promise<void>;
}

/**
 * Set / change the recovery password from an UNLOCKED wallet (industry-standard parity:
 * NEVER asks for the old recovery password). Because a 2-of-3 recovery share
 * cannot be cheaply re-wrapped without hand-rolled GF(256) math (D4), this does
 * a full crash-safe RE-SPLIT of the same entropy and stores a fresh recovery
 * blob under the new password. Rotating the underlying shares also voids any
 * previously-leaked recovery blob (doubles as compromise-rotation).
 *
 * Crash-safe order — never bricks, never asks the old password:
 *   1. stage next device share (old still live)
 *   2. rotate the backend login share to S'.login  (rollback: drop next, stay old split)
 *   3. promote the staged device share to primary
 *   4. store the fresh recovery blob (new password) — LAST, only once S' is live
 *   5. clear the stale cached login share
 *
 * Secret hygiene: entropy, shares, and the new password are never logged or
 * persisted in plaintext.
 */
export async function setRecoveryPasswordFlow(
  input: SetRecoveryPasswordInput,
  deps: SetRecoveryPasswordDeps,
): Promise<void> {
  const { walletId, idToken, newRecoveryPassword, secret } = input;
  const {
    getWallet,
    getLoginShare,
    decryptDeviceShare,
    reconstructAndValidateEntropy,
    createMpcShareSet,
    encryptDeviceShare,
    encryptRecoveryShare,
    setMpcDeviceShareNext,
    rotate,
    promoteMpcDeviceShareNext,
    storeRecovery,
    clearLoginShareCache,
  } = deps;

  const wallet = await getWallet(walletId);
  if (!wallet) {
    throw new Error('MPC wallet not found');
  }

  // Reconstruct entropy from the CURRENT device+login under the re-auth secret,
  // validating the derived key still belongs to this wallet. No old recovery
  // password is ever involved (industry-standard parity).
  const loginShare = await getLoginShare(idToken, wallet.chain, wallet.network);
  const currentDeviceShare = await decryptDeviceShare(wallet.mpcDeviceShare, secret);
  const entropy = await reconstructAndValidateEntropy(currentDeviceShare, loginShare, wallet.publicKey);

  // Fresh 2-of-3 re-split of the SAME entropy → all three shares rotate.
  // xpub is unchanged (entropy unchanged), so createMpcGoogleWallet's anchor holds.
  const next = await createMpcShareSet(entropy);
  const encryptedNextDeviceShare = await encryptDeviceShare(next.deviceShare, secret);

  // 1. Stage next (old device share still primary).
  await setMpcDeviceShareNext(walletId, encryptedNextDeviceShare);

  // 2. Rotate the backend login share. On failure roll back: drop the staged
  //    next and keep the old split intact (never bricks).
  try {
    await rotate(idToken, wallet.chain, wallet.network, next.loginShare);
  } catch (err) {
    await setMpcDeviceShareNext(walletId, undefined);
    throw err;
  }

  // 3. Backend now holds S'.login → promote the staged device share to primary.
  await promoteMpcDeviceShareNext(walletId);

  // 4. Only now that S' is fully live, store the fresh recovery blob under the
  //    new password (+ the non-secret xpub anchor). Stored LAST.
  const recoveryBlob = await encryptRecoveryShare(next.recoveryShare, newRecoveryPassword);
  await storeRecovery(idToken, wallet.chain, wallet.network, recoveryBlob, wallet.publicKey);

  // 5. The cached login share is now stale (rotated) → clear it.
  await clearLoginShareCache(walletId);
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx vitest run src/chrome/mpcWalletHandlers.spec.ts 2>&1 | tail -12
```

Expected: all suites pass, e.g. `Test Files  1 passed (1)` and `Tests  33 passed (33)` (22 pre-existing + 7 `setRecoveryPasswordFlow` + 3 resume-on-unlock, plus the 1 existing unlock success/validation cases still green).

- [ ] **Step 5: Wire the `SET_RECOVERY_PASSWORD` handler + resume deps into `background.ts`**

**5a.** Extend the existing `UNLOCK_MPC_WALLET` handler so unlock can resume a crashed re-split. In `src/chrome/background.ts`, update the dynamic import at line 1665 and the `unlockMpcWalletFlow` deps object at lines 1687–1698:

```typescript
    const { reconstructRootKeyBytes } = await import('@/shared/utils/mpc');
    const { getAllWallets, promoteMpcDeviceShareNext, setMpcDeviceShareNext } = await import('@/db/gero-db');
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);
```

and the deps passed to `unlockMpcWalletFlow`:

```typescript
    await unlockMpcWalletFlow(
      { walletId, idToken: idToken || '', secret },
      {
        getWallet: async (id) => {
          const wallets = await getAllWallets();
          return wallets[id];
        },
        getLoginShare,
        reconstructRootKeyBytes,
        sessionCache: mpcSessionCache,
        promoteMpcDeviceShareNext,
        dropMpcDeviceShareNext: (id) => setMpcDeviceShareNext(id, undefined),
      },
    );
```

**5b.** Add the new handler immediately after the `RECOVER_MPC_GOOGLE_WALLET` handler ends (after line 1861), before the `CHECK_MPC_ENROLLMENT` handler:

```typescript
/**
 * Set / change the recovery password from an unlocked wallet. NEVER asks for the
 * old password (industry-standard parity): device + login reconstruct the entropy, then a
 * crash-safe re-split rotates all three shares and stores a fresh recovery blob
 * under the new password. Requires device-secret re-auth (secret in request.data).
 * Never log request.data — it carries idToken / newRecoveryPassword / device secret.
 */
app.addToOptions(MessageTypes.SET_RECOVERY_PASSWORD, async (request, sendResponse) => {
  try {
    const { walletId, idToken, newRecoveryPassword } = request.data || {};
    if (!walletId || !idToken || !newRecoveryPassword) {
      throw new Error('walletId, idToken and newRecoveryPassword are required');
    }
    const { secret } = buildDeviceShareSecret(request.data);

    const {
      decryptDeviceShare,
      encryptDeviceShare,
      encryptRecoveryShare,
      createMpcShareSet,
      reconstructAndValidateEntropy,
    } = await import('@/shared/utils/mpc');
    const { getAllWallets, setMpcDeviceShareNext, promoteMpcDeviceShareNext } = await import('@/db/gero-db');
    const { Api } = await import('@/api/api');
    const api = new Api(undefined, undefined);

    await setRecoveryPasswordFlow(
      { walletId, idToken, newRecoveryPassword, secret },
      {
        getWallet: async (id) => (await getAllWallets())[id],
        getLoginShare: (idTok, ch, net) => api.mpc.getLoginShare(idTok, ch, net),
        decryptDeviceShare,
        reconstructAndValidateEntropy,
        createMpcShareSet,
        encryptDeviceShare,
        encryptRecoveryShare,
        setMpcDeviceShareNext,
        rotate: (idTok, ch, net, loginShare) => api.mpc.rotate(idTok, ch, net, loginShare),
        promoteMpcDeviceShareNext,
        storeRecovery: (idTok, ch, net, blob, pub) => api.mpc.storeRecovery(idTok, ch, net, blob, pub),
        clearLoginShareCache: (id) => mpcLoginShareCache.clear(id),
      },
    );

    sendResponse({
      id: request.id,
      data: { success: true },
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    console.error('Error setting MPC recovery password:', getErrorMessage(error, 'set recovery password failed'));
    sendResponse({
      id: request.id,
      data: { success: false, error: getErrorMessage(error, 'Failed to set recovery password') },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
  return true; // Required for async Chrome message handlers
});
```

**5c.** Add `setRecoveryPasswordFlow` to the existing `mpcWalletHandlers` import block in `background.ts` (lines 41–47):

```typescript
import {
  createMpcGoogleWalletFlow,
  unlockMpcWalletFlow,
  recoverMpcGoogleWalletFlow,
  setRecoveryPasswordFlow,
  subFromIdToken,
  resolveSignPrivateKeyBytes,
  assertMpcActionSupported,
} from '@/chrome/mpcWalletHandlers';
```

- [ ] **Step 6: Rebuild the background bundle and re-run the unit suite**

The background script is a separate Vite build (per project rules); a change under `src/chrome/` requires the background rebuild, but the unit test is the authoritative gate here:

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && npx vitest run src/chrome/mpcWalletHandlers.spec.ts 2>&1 | tail -6 && npx eslint src/chrome/mpcWalletHandlers.ts src/chrome/background.ts 2>&1 | tail -20
```

Expected: vitest reports all tests passing and eslint reports no errors/warnings for the two touched files. (A full `npm run build` OOMs the CI runner per project notes — do not gate on it here; rely on the unit suite + eslint.)

- [ ] **Final Step: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet-google-mpc" && git add src/chrome/mpcWalletHandlers.ts src/chrome/mpcWalletHandlers.spec.ts src/chrome/background.ts && git commit -m "$(cat <<'EOF'
feat(mpc): crash-safe re-split for set/change recovery password + resume-on-unlock

- setRecoveryPasswordFlow: device+login reconstruct → fresh 2-of-3 re-split;
  order stage-next → rotate-login → promote → store-recovery → clear-cache.
  Never asks the old recovery password (industry-standard parity). Rotate failure rolls
  back (drop staged next, stay on old split).
- unlockMpcWalletFlow: resume-on-unlock — if device+login fails but the staged
  mpcDeviceShareNext + login reconstructs, promote next and continue; else drop
  the stale next and surface the original error.
- Wire SET_RECOVERY_PASSWORD handler and resume deps in background.ts.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```


---

### Task 11: Onboarding UI — password recovery, no file

Replace the downloadable `.gmpc` recovery-file UX with fileless password recovery across the three Google onboarding steps. `StepGoogleSecure` keeps capturing the recovery password but gains a strength meter + min-12 gate via a shared validator; `StepGoogleBackup` swaps the file download for a backend upload (`STORE_MPC_RECOVERY`) with retry; `StepGoogleRestore` swaps the file-picker for a recovery-password field feeding `RECOVER_MPC_GOOGLE_WALLET`. Consumes the background handlers already specified by earlier tasks — does NOT redefine them.

**Files**
- Create: `src/shared/utils/mpc/recoveryPasswordStrength.ts`
- Create (test): `src/shared/utils/mpc/recoveryPasswordStrength.spec.ts`
- Modify: `src/modules/welcome/components/WalletOnboarding/steps/StepGoogleSecure.vue`
- Modify: `src/modules/welcome/components/WalletOnboarding/steps/StepGoogleBackup.vue`
- Modify: `src/modules/welcome/components/WalletOnboarding/steps/StepGoogleRestore.vue`
- Modify: `src/modules/welcome/components/WalletOnboarding/WalletOnboarding.vue`
- Modify: `src/plugins/i18n/us.ts`
- Modify: `src/plugins/i18n/de.ts`

**Interfaces**
- Consumes: `MessageTypes.STORE_MPC_RECOVERY` (data `{ idToken, chain, network, recoveryShare, recoveryPassword, publicKey }` → `{ data: { success, error? } }`); `MessageTypes.RECOVER_MPC_GOOGLE_WALLET` (data `{ name, icon, theme, chain, network, idToken, recoveryPassword, ...newSecret }` → `{ data: { success, walletId, error? } }`); existing `MessageTypes.SIGN_WITH_GOOGLE`, `MessageTypes.UNLOCK_MPC_WALLET`, `MessageTypes.LOGIN`, `MessageTypes.CREATE_MPC_GOOGLE_WALLET`. Reuses `authPayloadToWireFields()` from `./googleWalletMessages`.
- Produces: `isAcceptableRecoveryPassword(pw: string): boolean` and `scoreRecoveryPassword(pw: string): { score: 0|1|2|3|4; labelKey: string; acceptable: boolean }` from `recoveryPasswordStrength.ts`; unchanged `StepGoogleSecure` `@created` payload (still carries `recoveryPassword`).

---

- [ ] **Step 1: Add the shared strength validator.** Pure, dependency-free, unit-testable. Floor = **min 12 chars** AND score above the weakest tier (`score >= 2`). Create `src/shared/utils/mpc/recoveryPasswordStrength.ts`:

```ts
// Recovery password is the load-bearing secret (design D3): enforce a concrete
// floor client-side on every set/change. Pure + framework-free so it unit-tests
// and is reusable by onboarding and the Settings change-password dialog.
export const MIN_RECOVERY_PASSWORD_LENGTH = 12;

export interface RecoveryPasswordScore {
  /** 0 (weakest) … 4 (strongest). */
  score: 0 | 1 | 2 | 3 | 4;
  /** i18n key for the tier label (see welcome.recoveryStrength*). */
  labelKey: string;
  /** True once the password clears the enforced floor. */
  acceptable: boolean;
}

const STRENGTH_LABEL_KEYS = [
  'welcome.recoveryStrengthWeak',   // 0
  'welcome.recoveryStrengthWeak',   // 1
  'welcome.recoveryStrengthFair',   // 2
  'welcome.recoveryStrengthGood',   // 3
  'welcome.recoveryStrengthStrong', // 4
];

/** Heuristic 0–4 score from length + character-class variety. No external deps. */
export function scoreRecoveryPassword(pw: string): RecoveryPasswordScore {
  const password = pw ?? '';
  if (password.length === 0) {
    return { score: 0, labelKey: STRENGTH_LABEL_KEYS[0], acceptable: false };
  }

  let variety = 0;
  if (/[a-z]/.test(password)) variety += 1;
  if (/[A-Z]/.test(password)) variety += 1;
  if (/\d/.test(password)) variety += 1;
  if (/[^A-Za-z0-9]/.test(password)) variety += 1;

  let raw = 0;
  if (password.length >= 8) raw += 1;
  if (password.length >= MIN_RECOVERY_PASSWORD_LENGTH) raw += 1;
  if (password.length >= 16) raw += 1;
  if (variety >= 2) raw += 1;
  if (variety >= 3) raw += 1;

  const score = Math.min(4, raw) as 0 | 1 | 2 | 3 | 4;
  const acceptable = password.length >= MIN_RECOVERY_PASSWORD_LENGTH && score >= 2;
  return { score, labelKey: STRENGTH_LABEL_KEYS[score], acceptable };
}

/** Single gate used by every set/change site. */
export function isAcceptableRecoveryPassword(pw: string): boolean {
  return scoreRecoveryPassword(pw).acceptable;
}
```

- [ ] **Step 2: Unit-test the validator (real vitest, matches the sibling-spec style in `recoveryShare.spec.ts`).** Create `src/shared/utils/mpc/recoveryPasswordStrength.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  scoreRecoveryPassword,
  isAcceptableRecoveryPassword,
  MIN_RECOVERY_PASSWORD_LENGTH,
} from './recoveryPasswordStrength';

describe('recoveryPasswordStrength', () => {
  it('rejects an empty password', () => {
    expect(isAcceptableRecoveryPassword('')).toBe(false);
    expect(scoreRecoveryPassword('').score).toBe(0);
  });

  it('rejects anything shorter than the minimum, however varied', () => {
    // 11 chars, all four classes present, still under the floor.
    const almost = 'Ab1!Ab1!Ab' + '2'; // length 11
    expect(almost.length).toBe(MIN_RECOVERY_PASSWORD_LENGTH - 1);
    expect(isAcceptableRecoveryPassword(almost)).toBe(false);
  });

  it('rejects the weakest tier at/above the length floor (single character class)', () => {
    const longButFlat = 'aaaaaaaaaaaaaa'; // 14 lowercase-only
    expect(longButFlat.length).toBeGreaterThanOrEqual(MIN_RECOVERY_PASSWORD_LENGTH);
    const res = scoreRecoveryPassword(longButFlat);
    expect(res.score).toBeLessThan(2);
    expect(res.acceptable).toBe(false);
    expect(isAcceptableRecoveryPassword(longButFlat)).toBe(false);
  });

  it('accepts a 12+ char password with mixed character classes', () => {
    const good = 'Recover-Me-42';
    expect(good.length).toBeGreaterThanOrEqual(MIN_RECOVERY_PASSWORD_LENGTH);
    expect(isAcceptableRecoveryPassword(good)).toBe(true);
    expect(scoreRecoveryPassword(good).score).toBeGreaterThanOrEqual(2);
  });

  it('scores a long, all-classes password at the top tier', () => {
    expect(scoreRecoveryPassword('Sup3r-Secret-Recovery-Phrase!').score).toBe(4);
  });

  it('always returns a label key for its score', () => {
    for (const pw of ['', 'a', 'Recover-Me-42', 'Sup3r-Secret-Recovery-Phrase!']) {
      expect(scoreRecoveryPassword(pw).labelKey).toMatch(/^welcome\.recoveryStrength/);
    }
  });
});
```

Run: `npx vitest run src/shared/utils/mpc/recoveryPasswordStrength.spec.ts`.

- [ ] **Step 3: `StepGoogleSecure.vue` — swap the recovery-password rules for the shared validator + add a strength meter.** The recovery field currently uses the spending-password rule stack (min 10, class rules). Replace the recovery `:rules` array so the min becomes 12 and the floor is the shared gate; keep the "must differ from spending password" rule. Anchor: the `<v-text-field v-model="recoveryPassword" …>` block (around the `rules.minCharacters(10)` list). Replace its `:rules` with:

```html
        :rules="[
          rules.required(),
          rules.minCharacters(12),
          (v) => isAcceptableRecoveryPassword(v) || $t('welcome.recoveryPasswordTooWeak'),
          (v) => passkeyCapable || v !== spendingPassword || $t('welcome.recoveryPasswordMustDiffer')
        ]"
```

Immediately AFTER that `<v-text-field>` (before the confirm field), insert the meter:

```html
      <!-- Strength meter: recovery password is the only recovery factor now -->
      <div v-if="recoveryPassword" class="recovery-strength mb-2">
        <v-progress-linear
          :value="(recoveryScore.score / 4) * 100"
          :color="recoveryStrengthColor"
          height="4"
          rounded
        />
        <span class="recovery-strength__label" :class="`recovery-strength__label--${recoveryScore.score}`">
          {{ $t(recoveryScore.labelKey) }}
        </span>
      </div>
```

In `<script setup>`, add the import next to the other mpc imports (anchor: `import { mpcPasskeyAvailable, enrollMpcPasskey } from '@/shared/utils/mpc/mpcPasskey';`):

```ts
import { scoreRecoveryPassword, isAcceptableRecoveryPassword } from '@/shared/utils/mpc/recoveryPasswordStrength';
```

Add computeds (anchor: after `const showRecovery = ref(false);`):

```ts
const recoveryScore = computed(() => scoreRecoveryPassword(recoveryPassword.value));
const recoveryStrengthColor = computed(() => (
  ['error', 'error', 'warning', 'info', 'success'][recoveryScore.value.score]
));
```

Add a scoped style (anchor: after the `.field-hint { … }` block):

```scss
.recovery-strength {
  display: flex;
  align-items: center;
  gap: 8px;
}
.recovery-strength__label {
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}
.recovery-strength__label--0,
.recovery-strength__label--1 { color: #ff6b6b; }
.recovery-strength__label--2 { color: #ffb020; }
.recovery-strength__label--3 { color: #4dabf7; }
.recovery-strength__label--4 { color: #51cf66; }
```

(No `canContinue` change needed — `formValid` already blocks continue while the new rule fails, since the field is inside `secureForm`.)

- [ ] **Step 4: `WalletOnboarding.vue` — pass the store inputs down to `StepGoogleBackup`.** The upload needs `idToken`/`chain`/`network` which the current props don't provide. Anchor: the `<StepGoogleBackup … />` block (keys `wallet-id`/`recovery-share`/`public-key`/`recovery-password`). Add three props:

```html
        <StepGoogleBackup class="onboarding-step"
          v-else-if="currentStep.key === 'googleBackup'"
          :network="network"
          :id-token="googleIdToken"
          :wallet-id="googleWalletId"
          :recovery-share="googleRecoveryShare"
          :public-key="googlePublicKey"
          :recovery-password="googleRecoveryPassword"
          @next="step++"
        />
```

(`googleIdToken` / `network` already exist in this component's state — no new refs. `network.blockchain` / `network.network` are read inside the step.)

- [ ] **Step 5: `StepGoogleBackup.vue` — replace file download with backend upload + confirm + retry.** Rewrite the `<template>` body (keep the outer `.step-google-backup` / `.step-scroll` / `.onboarding-actions` scaffold and the nav footer) so the card explains fileless recovery and the button uploads. Replace the info card + download button + checkbox region with:

```html
    <v-card class="mb-3" outlined style="background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.12);">
      <v-card-text class="pa-3">
        <div class="d-flex align-center mb-2">
          <v-icon color="primary" size="22" class="mr-2">mdi-shield-key-outline</v-icon>
          <div class="text-body-2 white--text font-weight-medium">{{ $t('welcome.recoveryNoFileTitle') }}</div>
        </div>
        <div class="text-body-2 grey--text text--lighten-1">
          {{ $t('welcome.recoveryNoFileBody') }}
        </div>
      </v-card-text>
    </v-card>

    <v-btn
      class="onb-btn"
      block
      depressed
      :color="stored ? 'success' : 'primary'"
      :loading="storing"
      :disabled="stored"
      @click="storeRecovery()"
    >
      <v-icon left small>{{ stored ? 'mdi-check' : 'mdi-cloud-upload-outline' }}</v-icon>
      {{ stored ? $t('welcome.recoverySaved') : (errorMessage ? $t('common.retry') : $t('welcome.saveRecovery')) }}
    </v-btn>

    <v-alert
      v-if="errorMessage"
      color="error"
      icon="mdi-alert-outline"
      outlined
      dense
      border="left"
      class="mt-3 mb-0"
    >
      <span class="text-body-2">{{ errorMessage }}</span>
    </v-alert>
```

Change the footer continue button's `:disabled` from `!canContinue` to require a successful store:

```html
      <v-btn class="onb-btn" depressed color="primary" :disabled="!stored" @click="$emit('next')">
        {{ $t('common.continue') }}
      </v-btn>
```

Rewrite `<script setup>`. Replace the props/refs/`triggerDownload`/`download` with a `STORE_MPC_RECOVERY` call (encryption happens in the background handler — the UI hands over `recoveryShare` + `recoveryPassword` per the consumed contract). Anchor: replace the entire existing `<script setup>` body:

```ts
import { ref, getCurrentInstance } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import type { NetworkInfo } from '@/utils/networks';
import type { GoogleWalletBgResponse } from './googleWalletMessages';

const props = defineProps<{
  network: NetworkInfo;
  idToken: string;
  walletId: number;
  /** Plaintext recovery share — sent once to the background, which encrypts + uploads. Never rendered/logged/persisted here. */
  recoveryShare: string;
  /** Wallet xpub (not secret) — the restore-time anchor stored alongside the blob. */
  publicKey: string;
  recoveryPassword: string;
}>();
defineEmits<{ (e: 'next'): void }>();

const vmProxy = getCurrentInstance()!.proxy;

const storing = ref(false);
const stored = ref(false);
const errorMessage = ref('');

const storeRecovery = async (): Promise<void> => {
  storing.value = true;
  errorMessage.value = '';
  try {
    // Never log request payload — carries idToken/recoveryShare/recoveryPassword.
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.STORE_MPC_RECOVERY,
      data: {
        idToken: props.idToken,
        chain: props.network?.blockchain,
        network: props.network?.network,
        recoveryShare: props.recoveryShare,
        recoveryPassword: props.recoveryPassword,
        publicKey: props.publicKey,
      },
    }) as GoogleWalletBgResponse;
    if (!response?.data?.success) {
      throw new Error(response?.data?.error || (vmProxy.$t('welcome.recoverySaveFailed') as string));
    }
    stored.value = true;
  } catch (error: unknown) {
    errorMessage.value = error instanceof Error ? error.message : (vmProxy.$t('welcome.recoverySaveFailed') as string);
  } finally {
    storing.value = false;
  }
};
```

Remove the now-unused `recoveryFileName` import and the `.mnemonic-note` style if unreferenced. (Onboarding store is non-fatal at the wallet level per design §4, but here it gates only the *recovery* step's Continue; a failed upload stays retryable and the wallet already exists.)

- [ ] **Step 6: `StepGoogleRestore.vue` — replace the file-picker with a recovery-password-only restore.** Remove the `<v-file-input>` and its recovery-file label; keep the recovery-password field but attach the min-12 rule (a restore password must clear the same floor to match what was stored — but do NOT run the strength gate here, only length, since the user is typing a previously-chosen password). Anchor: replace the "Recovery file upload" block + the recovery-password field:

```html
      <!-- Recovery password (no file — fileless restore) -->
      <div class="step-section-label mb-2">{{ $t('welcome.recoveryPassword') }}</div>
      <div class="field-hint mb-2">{{ $t('welcome.restoreRecoveryPasswordHint') }}</div>
      <v-text-field
        v-model="recoveryPassword"
        dense
        filled
        :label="$t('welcome.recoveryPassword')"
        :type="showRecovery ? 'text' : 'password'"
        :append-icon="showRecovery ? 'mdi-eye' : 'mdi-eye-off'"
        @click:append="showRecovery = !showRecovery"
        :rules="[rules.required(), rules.minCharacters(12)]"
        class="mb-2"
      ></v-text-field>
```

In `<script setup>`, drop the file-model + reader: remove `const recoveryFile = ref<File | null>(null);` and the `readFileAsText` helper. Update `canRestore` (anchor: `const canRestore = computed(...)`) to drop `!!recoveryFile.value`:

```ts
const canRestore = computed(() => (
  formValid.value && !!email.value && recoveryPassword.value.length >= 12 && secretReady.value && !restoring.value
));
```

Rewrite `restore()` to stop parsing an envelope and call `RECOVER_MPC_GOOGLE_WALLET` with the fileless contract — the background fetches the recovery blob + xpub from the backend itself. Anchor: replace the body of `const restore = async …` down to the `RECOVER_MPC_GOOGLE_WALLET` messaging call (keep the subsequent unlock/login/navigation block unchanged):

```ts
const restore = async (): Promise<void> => {
  if (!canRestore.value) return;
  restoring.value = true;
  errorMessage.value = '';
  try {
    const walletIcon = picture.value || networks.resolveIconColor(props.network?.blockchain || '', props.network?.network || '');
    const payload = authPayload.value;

    // Note: never log request payload — carries idToken/recoveryPassword and the new device secret.
    const recoverResponse = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.RECOVER_MPC_GOOGLE_WALLET,
      data: {
        name: name.value,
        icon: walletIcon,
        theme: Theme.GERO,
        chain: props.network?.blockchain,
        network: props.network?.network,
        idToken: idToken.value,
        recoveryPassword: recoveryPassword.value,
        ...authPayloadToWireFields(payload),
      },
    }) as GoogleWalletBgResponse;

    if (!recoverResponse?.data?.success || recoverResponse.data.walletId == null) {
      throw new Error(recoverResponse?.data?.error || (vmProxy.$t('errors.unknownError') as string));
    }

    const walletId = recoverResponse.data.walletId;
    // …unchanged: UNLOCK_MPC_WALLET → getAllWallets → LOGIN → router.push('/') …
```

(The `newSecret` the contract refers to = `...authPayloadToWireFields(payload)`, the freshly-enrolled passkey PRF material or the new spending password — same wire fields already used by the create flow.)

- [ ] **Step 7: Add i18n keys to `us.ts`.** Anchor: the existing Google-backup/recovery block (near `'welcome.invalidRecoveryFile'`, line ~2820). Add:

```ts
  'welcome.recoveryNoFileTitle': 'No file to download',
  'welcome.recoveryNoFileBody': 'Your recovery is your Google account plus this password. There is nothing to download — sign in with Google on any device and enter this password to restore.',
  'welcome.saveRecovery': 'Save recovery',
  'welcome.recoverySaved': 'Recovery saved',
  'welcome.recoverySaveFailed': 'Could not save your recovery. Please try again.',
  'welcome.recoveryPasswordTooWeak': 'Choose a stronger recovery password (at least 12 characters).',
  'welcome.restoreRecoveryPasswordHint': 'The recovery password you chose when you created this wallet.',
  'welcome.recoveryStrengthWeak': 'Weak',
  'welcome.recoveryStrengthFair': 'Fair',
  'welcome.recoveryStrengthGood': 'Good',
  'welcome.recoveryStrengthStrong': 'Strong',
```

Also update the two now-stale descriptions in `us.ts` to the fileless copy:

```ts
  'welcome.onboardingSubGoogleBackup': 'Confirm your recovery',
  'welcome.onboardingDescGoogleBackup': 'Recovery = your Google account + this password. Nothing to download.',
  'welcome.onboardingDescGoogleRestore': 'Sign in with Google and enter your recovery password to restore your wallet.',
  'welcome.recoveryPasswordHint': 'The only thing that can recover your wallet on a new device. Choose something strong you will remember.',
```

If `'common.retry'` does not already exist, add `'common.retry': 'Retry',` under the `common.*` block (grep first — it very likely exists; reuse it).

- [ ] **Step 8: Add the German counterparts to `de.ts`.** Anchor: the matching Google-backup block (near `'welcome.invalidRecoveryFile'`, line ~3298). Add:

```ts
  'welcome.recoveryNoFileTitle': 'Keine Datei zum Herunterladen',
  'welcome.recoveryNoFileBody': 'Ihre Wiederherstellung besteht aus Ihrem Google-Konto und diesem Passwort. Es gibt nichts herunterzuladen — melden Sie sich auf einem beliebigen Gerät mit Google an und geben Sie dieses Passwort ein, um wiederherzustellen.',
  'welcome.saveRecovery': 'Wiederherstellung speichern',
  'welcome.recoverySaved': 'Wiederherstellung gespeichert',
  'welcome.recoverySaveFailed': 'Wiederherstellung konnte nicht gespeichert werden. Bitte erneut versuchen.',
  'welcome.recoveryPasswordTooWeak': 'Wählen Sie ein stärkeres Wiederherstellungspasswort (mindestens 12 Zeichen).',
  'welcome.restoreRecoveryPasswordHint': 'Das Wiederherstellungspasswort, das Sie beim Erstellen dieser Wallet gewählt haben.',
  'welcome.recoveryStrengthWeak': 'Schwach',
  'welcome.recoveryStrengthFair': 'Ausreichend',
  'welcome.recoveryStrengthGood': 'Gut',
  'welcome.recoveryStrengthStrong': 'Stark',
```

And update the stale German descriptions:

```ts
  'welcome.onboardingSubGoogleBackup': 'Bestätigen Sie Ihre Wiederherstellung',
  'welcome.onboardingDescGoogleBackup': 'Wiederherstellung = Ihr Google-Konto + dieses Passwort. Nichts herunterzuladen.',
  'welcome.onboardingDescGoogleRestore': 'Melden Sie sich mit Google an und geben Sie Ihr Wiederherstellungspasswort ein, um Ihre Wallet wiederherzustellen.',
  'welcome.recoveryPasswordHint': 'Das Einzige, was Ihre Wallet auf einem neuen Gerät wiederherstellen kann. Wählen Sie ein starkes Passwort, das Sie sich merken.',
```

Add `'common.retry': 'Wiederholen',` under `common.*` in `de.ts` only if it does not already exist.

- [ ] **Step 9: Verify.** There is no component-test harness, so verify the SFCs compile and typecheck via the production bundle path:
  - Validator unit test: `npx vitest run src/shared/utils/mpc/recoveryPasswordStrength.spec.ts`
  - SFC / compile check (all three steps + WalletOnboarding): `npx vite build --config vite.config.mts` — must complete with no template/TS errors in the four changed components.
  - Lint the touched files: `npx eslint src/modules/welcome/components/WalletOnboarding/steps/StepGoogleSecure.vue src/modules/welcome/components/WalletOnboarding/steps/StepGoogleBackup.vue src/modules/welcome/components/WalletOnboarding/steps/StepGoogleRestore.vue src/modules/welcome/components/WalletOnboarding/WalletOnboarding.vue src/shared/utils/mpc/recoveryPasswordStrength.ts`

- [ ] **Step 10: Commit.** `git add` the created + modified files and commit:

```
feat(mpc): fileless password recovery in Google onboarding UI

Replace the .gmpc download/upload with backend-stored, password-protected
recovery: StepGoogleSecure gains a strength meter + min-12 gate via a shared
validator; StepGoogleBackup uploads via STORE_MPC_RECOVERY (retryable);
StepGoogleRestore drops the file-picker for a recovery-password field feeding
RECOVER_MPC_GOOGLE_WALLET. Adds recoveryPasswordStrength.ts + unit test and the
us/de i18n keys.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
```


---

### Task 12: Settings UI — change recovery password + reveal SRP

Adds two MPC-only rows to `SecurityTab` and two new dialogs. Both dialogs collect a
**device-secret re-auth** (inline spending password for password-MPC wallets, or the
`mode=mpcPrf` popup for passkey-MPC wallets — same delegation `LockScreen.vue` uses) plus a
**fresh Google idToken** (via `MessageTypes.SIGN_WITH_GOOGLE`) and consume the background
handlers specified by earlier tasks. No new crypto here — the strength validator comes from
Task 11.

**Files**
- Modify: `src/modules/dashboard/components/SecurityTab.vue` (two MPC rows + dialog mounts)
- Create: `src/modules/dashboard/dialogs/ChangeRecoveryPasswordDialog.vue`
- Create: `src/modules/dashboard/dialogs/RevealRecoveryPhraseDialog.vue`
- Modify: `src/plugins/i18n/us.ts` (new `security.mpcRecovery*` keys)
- Modify: `src/plugins/i18n/de.ts` (German counterparts)
- Test: `src/shared/utils/mpc/recoveryPasswordStrength.spec.ts` (UI-contract guard on the Task 11 validator; see Step note)

**Interfaces**
- **Consumes** (do NOT redefine — from Tasks 8–11):
  - `MessageTypes.SET_RECOVERY_PASSWORD` → `sendToBackgroundFromOptions({ method, data: { walletId, idToken, newRecoveryPassword, secret } })` → `{ data: { success, error? } }`. `secret` is `{ password }` (password wallets) or `{ prfOutputHex, webAuthnCredentialId, mpcPrfSaltId }` (passkey wallets).
  - `MessageTypes.REVEAL_MPC_SRP` → `data: { walletId, idToken, secret }` → `{ data: { success, mnemonic?, error? } }`.
  - `MessageTypes.SIGN_WITH_GOOGLE` → `data: {}` → `{ data: { success, tokens: { idToken, accessToken } } }`.
  - `isAcceptableRecoveryPassword(pw): boolean` + `scoreRecoveryPassword(pw): { score: 0|1|2|3|4; labelKey: string }` from `@/shared/utils/mpc/recoveryPasswordStrength` (Task 11).
  - `evaluateMpcPasskey` popup contract: `index.html?mode=mpcPrf&walletId=<id>#/passkey-auth` → `postMessage` `{ type: 'PASSKEY_AUTH_RESULT', payload: { success, prfOutputHex, webAuthnCredentialId, mpcPrfSaltId, cancelled?, error? } }`.
- **Produces**: two dialog components + rows; SRP shown once, never persisted/logged.

---

- [ ] **Step 1: (Prereq) Confirm Task 11 validator shape.** This task imports `isAcceptableRecoveryPassword` and `scoreRecoveryPassword` from `src/shared/utils/mpc/recoveryPasswordStrength.ts`. If Task 11 has not yet landed, it must expose exactly:
  ```typescript
  // src/shared/utils/mpc/recoveryPasswordStrength.ts  (OWNED BY TASK 11 — do not create here)
  export interface RecoveryPasswordScore { score: 0 | 1 | 2 | 3 | 4; labelKey: string; }
  export function scoreRecoveryPassword(pw: string): RecoveryPasswordScore;
  export function isAcceptableRecoveryPassword(pw: string): boolean; // min 12 chars AND score >= 2 (rejects weakest tier)
  ```

- [ ] **Step 2: Shared popup re-auth helper — add `mpcPrfSaltId` mode reuse note.** Both dialogs need the passkey path. Rather than duplicate the ~30-line popup promise in each dialog, factor it into a tiny composable so the two dialogs and `LockScreen.vue` stay consistent.
  Create `src/shared/composables/useMpcPasskeyPopup.ts`:
  ```typescript
  import { useTranslation } from '@/shared/composables/useTranslation';

  export interface MpcPasskeySecret {
    prfOutputHex: string;
    webAuthnCredentialId: string;
    mpcPrfSaltId: string;
  }

  // WebAuthn cannot run in a side panel / dialog context reliably, so the MPC passkey
  // PRF ceremony is delegated to a popup (index.html?mode=mpcPrf#/passkey-auth), the same
  // pattern LockScreen.vue uses. Resolves the raw prfOutputHex (never logged). Rejects on
  // cancel/timeout so callers can abort silently.
  export function evaluateMpcPasskeyViaPopup(walletId: number): Promise<MpcPasskeySecret> {
    const { t } = useTranslation();
    return new Promise((resolve, reject) => {
      const popupUrl = chrome.runtime.getURL(`index.html?mode=mpcPrf&walletId=${walletId}#/passkey-auth`);
      const popup = window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');
      if (!popup) {
        reject(new Error(t('errors.popupBlocked')));
        return;
      }
      const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
      const cleanup = () => { window.removeEventListener('message', handler); try { popup.close(); } catch { /* closed */ } };
      const handler = (event: MessageEvent) => {
        if (event.origin !== extensionOrigin) return;
        if (event.data?.type !== 'PASSKEY_AUTH_RESULT') return;
        const { success, prfOutputHex, webAuthnCredentialId, mpcPrfSaltId, cancelled, error: err } = event.data.payload || {};
        window.removeEventListener('message', handler);
        if (success && prfOutputHex) {
          resolve({ prfOutputHex, webAuthnCredentialId, mpcPrfSaltId });
        } else {
          reject(new Error(cancelled ? 'cancelled' : (err || t('security.passKeyAuthFailed'))));
        }
        try { popup.close(); } catch { /* closed */ }
      };
      window.addEventListener('message', handler);
      setTimeout(() => { cleanup(); reject(new Error(t('errors.authenticationTimeout'))); }, 120000);
    });
  }
  ```
  (Optional follow-up: `LockScreen.vue`'s local `evaluateMpcPasskeyViaPopup` can later be swapped to this helper — not required for this task.)

- [ ] **Step 3: `ChangeRecoveryPasswordDialog.vue` — create.** New-password + confirm, NO old-password field. Strength meter driven by the Task 11 validator; submit disabled until acceptable. Collects Google idToken then device secret, sends `SET_RECOVERY_PASSWORD`.
  Create `src/modules/dashboard/dialogs/ChangeRecoveryPasswordDialog.vue`:
  ```vue
  <template>
    <BaseDialog
      :is-open="isOpen"
      :title="t('security.mpcRecoveryChangeTitle')"
      :subtitle="t('security.mpcRecoveryChangeSubtitle')"
      :width="480"
      icon="mdi-form-textbox-password"
      :loading="submitting"
      @close="handleClose"
    >
      <v-card-text class="px-3 pb-4">
        <v-alert type="info" text dense class="mb-4">
          {{ t('security.mpcRecoveryChangeInfo') }}
        </v-alert>

        <v-text-field
          v-model="newPassword"
          :label="t('security.mpcRecoveryNewPassword')"
          :type="showPw ? 'text' : 'password'"
          :append-icon="showPw ? 'mdi-eye-off' : 'mdi-eye'"
          @click:append="showPw = !showPw"
          outlined dense
          :disabled="submitting"
          :error-messages="lengthError"
        />
        <!-- Strength meter (Task 11 validator) -->
        <v-progress-linear
          :value="(strength.score + 1) * 20"
          :color="strengthColor"
          height="6"
          rounded
          class="mb-1"
        />
        <div class="caption mb-3" :class="`${strengthColor}--text`">
          {{ t(strength.labelKey) }}
        </div>

        <v-text-field
          v-model="confirmPassword"
          :label="t('security.mpcRecoveryConfirmPassword')"
          :type="showPw ? 'text' : 'password'"
          outlined dense
          :disabled="submitting"
          :error-messages="mismatchError"
          @keydown.enter.stop="submit"
        />

        <v-alert v-if="errorMessage" type="error" text dense class="mt-2">
          {{ errorMessage }}
        </v-alert>

        <v-btn
          block color="primary" class="mt-2"
          :loading="submitting"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ t('security.mpcRecoveryChangeConfirm') }}
        </v-btn>
      </v-card-text>
    </BaseDialog>
  </template>

  <script setup lang="ts">
  import { ref, computed } from 'vue';
  import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
  import { useTranslation } from '@/shared/composables/useTranslation';
  import { walletStore } from '@/stores/walletStore';
  import { Messaging, BackgroundResponse } from '@/chrome/messaging';
  import { MessageTypes } from '@/models/MessageTypes';
  import { isAcceptableRecoveryPassword, scoreRecoveryPassword } from '@/shared/utils/mpc/recoveryPasswordStrength';
  import { evaluateMpcPasskeyViaPopup } from '@/shared/composables/useMpcPasskeyPopup';
  import snackbar from '@/plugins/snackbar';

  const { t } = useTranslation();
  const props = defineProps<{ isOpen: boolean }>();
  const emit = defineEmits<{ (e: 'close'): void }>();

  const newPassword = ref('');
  const confirmPassword = ref('');
  const showPw = ref(false);
  const submitting = ref(false);
  const errorMessage = ref('');

  // MPC passkey wallets carry both a credential id and a PRF salt id on the record.
  const isMpcPasskeyWallet = computed(() =>
    !!walletStore.loggedWallet?.webAuthnCredentialId && !!walletStore.loggedWallet?.mpcPrfSaltId,
  );

  const strength = computed(() => scoreRecoveryPassword(newPassword.value));
  const strengthColor = computed(() => (['error', 'error', 'warning', 'success', 'success'][strength.value.score]));
  const lengthError = computed(() =>
    newPassword.value && newPassword.value.length < 12 ? t('security.mpcRecoveryMinLength') : '',
  );
  const mismatchError = computed(() =>
    confirmPassword.value && confirmPassword.value !== newPassword.value ? t('security.mpcRecoveryMismatch') : '',
  );
  const canSubmit = computed(() =>
    !submitting.value
    && isAcceptableRecoveryPassword(newPassword.value)
    && newPassword.value === confirmPassword.value,
  );

  async function resolveSecret(): Promise<Record<string, unknown> | null> {
    const wallet = walletStore.loggedWallet;
    if (!wallet) return null;
    if (isMpcPasskeyWallet.value) {
      try {
        const { prfOutputHex, webAuthnCredentialId, mpcPrfSaltId } = await evaluateMpcPasskeyViaPopup(wallet.id);
        return { prfOutputHex, webAuthnCredentialId, mpcPrfSaltId };
      } catch (e: any) {
        if (e?.message === 'cancelled') return null; // silent abort
        throw e;
      }
    }
    // Password-MPC wallet: prompt inline via the browser's own field is already the
    // newPassword field; the DEVICE secret is the spending password chosen at creation.
    // Reuse a lightweight prompt: the confirm field is the recovery password, so we need
    // a separate spending-password entry. Collect it inline just-in-time.
    const pw = window.prompt(t('security.mpcRecoveryDeviceSecretPrompt'));
    return pw ? { password: pw } : null;
  }

  async function submit() {
    if (!canSubmit.value) return;
    const wallet = walletStore.loggedWallet;
    if (!wallet) return;
    submitting.value = true;
    errorMessage.value = '';
    try {
      // 1) fresh Google idToken
      const gResp = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SIGN_WITH_GOOGLE, data: {},
      }) as BackgroundResponse<{ tokens?: { idToken: string } }>;
      const idToken = gResp?.data?.success ? gResp.data['tokens']?.idToken : undefined;
      if (!idToken) throw new Error(t('welcome.googleSignInFailed'));

      // 2) device secret (passkey popup or inline spending password)
      const secret = await resolveSecret();
      if (!secret) { submitting.value = false; return; } // user cancelled

      // 3) re-split under the new recovery password (background never asks the old one)
      const resp = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SET_RECOVERY_PASSWORD,
        data: { walletId: wallet.id, idToken, newRecoveryPassword: newPassword.value, secret },
      }) as BackgroundResponse<{ success: boolean; error?: string }>;

      if (!resp?.data?.success) throw new Error(resp?.data?.error || t('security.mpcRecoveryChangeFailed'));
      snackbar.fireSuccess(t('security.mpcRecoveryChangeSuccess'));
      handleClose();
    } catch (e: any) {
      errorMessage.value = e?.message || t('security.mpcRecoveryChangeFailed');
    } finally {
      submitting.value = false;
    }
  }

  function handleClose() {
    newPassword.value = '';
    confirmPassword.value = '';
    errorMessage.value = '';
    showPw.value = false;
    emit('close');
  }
  </script>
  ```
  Note: `window.prompt` for the inline device secret is a deliberate minimal placeholder to keep this task tight; if the plan prefers a themed field, swap `resolveSecret()`'s password branch for the `promptForSpendingPassword()` `v-dialog` pattern from `LockSettingsDialog.vue` (lines 377–416 / 1086–1096). Keep the `secret` shape identical.

- [ ] **Step 4: `RevealRecoveryPhraseDialog.vue` — create.** Device-secret re-auth + fresh idToken, `REVEAL_MPC_SRP`, mnemonic shown ONCE behind a reveal toggle with a blunt warning; cleared on close; never persisted.
  Create `src/modules/dashboard/dialogs/RevealRecoveryPhraseDialog.vue`:
  ```vue
  <template>
    <BaseDialog
      :is-open="isOpen"
      :title="t('security.mpcRevealTitle')"
      :subtitle="t('security.mpcRevealSubtitle')"
      :width="480"
      icon="mdi-key-alert-outline"
      :loading="loading"
      @close="handleClose"
    >
      <v-card-text class="px-3 pb-4">
        <v-alert type="warning" text dense class="mb-4">
          {{ t('security.mpcRevealWarning') }}
        </v-alert>

        <!-- Pre-reveal: require re-auth -->
        <template v-if="!mnemonic">
          <v-alert v-if="errorMessage" type="error" text dense class="mb-2">
            {{ errorMessage }}
          </v-alert>
          <v-btn block color="primary" :loading="loading" @click="reveal">
            {{ t('security.mpcRevealAction') }}
          </v-btn>
        </template>

        <!-- Post-reveal: shown once -->
        <template v-else>
          <div class="phrase-box pa-3 rounded" :class="{ blurred: !revealed }">
            <span v-for="(word, i) in words" :key="i" class="mr-2 mb-1 d-inline-block">
              <span class="text--secondary caption mr-1">{{ i + 1 }}.</span>{{ word }}
            </span>
          </div>
          <div class="d-flex justify-space-between align-center mt-2">
            <v-btn small text color="primary" @click="revealed = !revealed">
              <v-icon left small>{{ revealed ? 'mdi-eye-off' : 'mdi-eye' }}</v-icon>
              {{ revealed ? t('security.mpcRevealHide') : t('security.mpcRevealShow') }}
            </v-btn>
            <CopyButton :value="mnemonic" x-small :title="t('common.copy')" />
          </div>
          <v-btn block outlined color="primary" class="mt-4" @click="handleClose">
            {{ t('security.mpcRevealDone') }}
          </v-btn>
        </template>
      </v-card-text>
    </BaseDialog>
  </template>

  <script setup lang="ts">
  import { ref, computed } from 'vue';
  import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
  import CopyButton from '@/shared/components/CopyButton.vue';
  import { useTranslation } from '@/shared/composables/useTranslation';
  import { walletStore } from '@/stores/walletStore';
  import { Messaging, BackgroundResponse } from '@/chrome/messaging';
  import { MessageTypes } from '@/models/MessageTypes';
  import { evaluateMpcPasskeyViaPopup } from '@/shared/composables/useMpcPasskeyPopup';

  const { t } = useTranslation();
  const props = defineProps<{ isOpen: boolean }>();
  const emit = defineEmits<{ (e: 'close'): void }>();

  const loading = ref(false);
  const errorMessage = ref('');
  const mnemonic = ref('');   // held in-memory only; cleared on close
  const revealed = ref(false);

  const words = computed(() => (mnemonic.value ? mnemonic.value.split(' ') : []));
  const isMpcPasskeyWallet = computed(() =>
    !!walletStore.loggedWallet?.webAuthnCredentialId && !!walletStore.loggedWallet?.mpcPrfSaltId,
  );

  async function resolveSecret(): Promise<Record<string, unknown> | null> {
    const wallet = walletStore.loggedWallet;
    if (!wallet) return null;
    if (isMpcPasskeyWallet.value) {
      try {
        const { prfOutputHex, webAuthnCredentialId, mpcPrfSaltId } = await evaluateMpcPasskeyViaPopup(wallet.id);
        return { prfOutputHex, webAuthnCredentialId, mpcPrfSaltId };
      } catch (e: any) {
        if (e?.message === 'cancelled') return null;
        throw e;
      }
    }
    const pw = window.prompt(t('security.mpcRecoveryDeviceSecretPrompt'));
    return pw ? { password: pw } : null;
  }

  async function reveal() {
    const wallet = walletStore.loggedWallet;
    if (!wallet) return;
    loading.value = true;
    errorMessage.value = '';
    try {
      const gResp = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SIGN_WITH_GOOGLE, data: {},
      }) as BackgroundResponse<{ tokens?: { idToken: string } }>;
      const idToken = gResp?.data?.success ? gResp.data['tokens']?.idToken : undefined;
      if (!idToken) throw new Error(t('welcome.googleSignInFailed'));

      const secret = await resolveSecret();
      if (!secret) { loading.value = false; return; } // cancelled → nothing shown

      const resp = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.REVEAL_MPC_SRP,
        data: { walletId: wallet.id, idToken, secret },
      }) as BackgroundResponse<{ success: boolean; mnemonic?: string; error?: string }>;

      if (!resp?.data?.success || !resp.data['mnemonic']) {
        throw new Error(resp?.data?.error || t('security.mpcRevealFailed'));
      }
      mnemonic.value = resp.data['mnemonic'];
      revealed.value = false; // start hidden behind the toggle
    } catch (e: any) {
      errorMessage.value = e?.message || t('security.mpcRevealFailed');
    } finally {
      loading.value = false;
    }
  }

  function handleClose() {
    mnemonic.value = '';   // never persisted; drop from memory on close
    revealed.value = false;
    errorMessage.value = '';
    emit('close');
  }
  </script>

  <style scoped>
  .phrase-box {
    background: rgba(255, 255, 255, 0.04);
    line-height: 1.9;
    font-family: 'Roboto Mono', monospace;
    transition: filter 0.2s ease;
  }
  .phrase-box.blurred {
    filter: blur(6px);
    user-select: none;
  }
  </style>
  ```

- [ ] **Step 5: `SecurityTab.vue` — add the two MPC rows.** Insert after the existing "Recovery Phrase" backup row (`</v-list-item>` at line 81), guarded by `isMpcWallet` (already defined, line 491). Anchor: the block immediately after line 81 (`</v-list-item>`) and before the spending-security row (line 82).
  ```vue
        <!-- MPC "Sign in with Google": change recovery password -->
        <v-list-item v-if="isMpcWallet" class="px-2 py-1" @click="changeRecoveryPasswordDialog = true">
          <v-list-item-avatar class="my-0">
            <v-icon>mdi-form-textbox-password</v-icon>
          </v-list-item-avatar>
          <v-list-item-content class="py-0">
            <v-list-item-title class="text-left">
              <h3 style="color: white; font-size: 16px;">{{ $t('security.mpcRecoveryChangeTitle') }}</h3>
            </v-list-item-title>
            <v-list-item-subtitle class="text-left">
              {{ $t('security.mpcRecoveryChangeRowSubtitle') }}
            </v-list-item-subtitle>
          </v-list-item-content>
          <v-list-item-icon class="my-0" style="align-self: center">
            <v-icon large>mdi-chevron-right</v-icon>
          </v-list-item-icon>
        </v-list-item>

        <!-- MPC "Sign in with Google": reveal secret recovery phrase -->
        <v-list-item v-if="isMpcWallet" class="px-2 py-1" @click="revealRecoveryPhraseDialog = true">
          <v-list-item-avatar class="my-0">
            <v-icon>mdi-key-alert-outline</v-icon>
          </v-list-item-avatar>
          <v-list-item-content class="py-0">
            <v-list-item-title class="text-left">
              <h3 style="color: white; font-size: 16px;">{{ $t('security.mpcRevealTitle') }}</h3>
            </v-list-item-title>
            <v-list-item-subtitle class="text-left">
              {{ $t('security.mpcRevealRowSubtitle') }}
            </v-list-item-subtitle>
          </v-list-item-content>
          <v-list-item-icon class="my-0" style="align-self: center">
            <v-icon large>mdi-chevron-right</v-icon>
          </v-list-item-icon>
        </v-list-item>
  ```

- [ ] **Step 6: `SecurityTab.vue` — mount the dialogs.** Anchor: after the existing `<RemoteSigningDialog .../>` mount (line 378).
  ```vue
      <ChangeRecoveryPasswordDialog :is-open="changeRecoveryPasswordDialog" @close="changeRecoveryPasswordDialog = false" />
      <RevealRecoveryPhraseDialog :is-open="revealRecoveryPhraseDialog" @close="revealRecoveryPhraseDialog = false" />
  ```

- [ ] **Step 7: `SecurityTab.vue` — imports + refs.** Anchor: after the `RemoteSigningDialog` import (line 400):
  ```typescript
  import ChangeRecoveryPasswordDialog from '@/modules/dashboard/dialogs/ChangeRecoveryPasswordDialog.vue';
  import RevealRecoveryPhraseDialog from '@/modules/dashboard/dialogs/RevealRecoveryPhraseDialog.vue';
  ```
  Anchor: after `const remoteSigningDialog = ref<boolean>(false);` (line 426):
  ```typescript
  const changeRecoveryPasswordDialog = ref<boolean>(false);
  const revealRecoveryPhraseDialog = ref<boolean>(false);
  ```

- [ ] **Step 8: i18n — add `us.ts` keys.** Anchor: near the other `security.*` keys (e.g. after `'security.spendingPassword'` at line 2845). Add:
  ```typescript
  'security.mpcRecoveryChangeTitle': 'Change recovery password',
  'security.mpcRecoveryChangeRowSubtitle': 'Update the password that protects your recovery share',
  'security.mpcRecoveryChangeSubtitle': 'Set a new recovery password — you will not be asked for the old one.',
  'security.mpcRecoveryChangeInfo': 'This re-encrypts your recovery share and rotates all three key shares. Any previously leaked recovery backup stops working.',
  'security.mpcRecoveryNewPassword': 'New recovery password',
  'security.mpcRecoveryConfirmPassword': 'Confirm recovery password',
  'security.mpcRecoveryMinLength': 'Use at least 12 characters',
  'security.mpcRecoveryMismatch': 'Passwords do not match',
  'security.mpcRecoveryChangeConfirm': 'Change recovery password',
  'security.mpcRecoveryChangeSuccess': 'Recovery password updated',
  'security.mpcRecoveryChangeFailed': 'Could not change recovery password',
  'security.mpcRecoveryDeviceSecretPrompt': 'Enter your wallet password to confirm',
  'security.mpcRevealTitle': 'Reveal secret recovery phrase',
  'security.mpcRevealRowSubtitle': 'Show your 24-word seed phrase to back up or export your wallet',
  'security.mpcRevealSubtitle': 'Confirm it is you, then view your seed phrase once.',
  'security.mpcRevealWarning': 'Anyone with this phrase controls your wallet. Never share it. Gero will never ask for it.',
  'security.mpcRevealAction': 'Reveal seed phrase',
  'security.mpcRevealShow': 'Show',
  'security.mpcRevealHide': 'Hide',
  'security.mpcRevealDone': 'Done',
  'security.mpcRevealFailed': 'Could not reveal the recovery phrase',
  ```
  Reuse existing `welcome.googleSignInFailed`, `common.copy`, `security.passKeyAuthFailed`, `errors.popupBlocked`, `errors.authenticationTimeout` (verify each exists via grep; add only if missing).

- [ ] **Step 9: i18n — add `de.ts` counterparts.** Anchor: near `'security.spendingPassword'` (line 2397). Add the same keys with German values:
  ```typescript
  'security.mpcRecoveryChangeTitle': 'Wiederherstellungspasswort ändern',
  'security.mpcRecoveryChangeRowSubtitle': 'Aktualisiere das Passwort, das deinen Wiederherstellungsanteil schützt',
  'security.mpcRecoveryChangeSubtitle': 'Lege ein neues Wiederherstellungspasswort fest — das alte wird nicht abgefragt.',
  'security.mpcRecoveryChangeInfo': 'Dies verschlüsselt deinen Wiederherstellungsanteil neu und rotiert alle drei Schlüsselanteile. Ein zuvor geleaktes Backup wird dadurch unbrauchbar.',
  'security.mpcRecoveryNewPassword': 'Neues Wiederherstellungspasswort',
  'security.mpcRecoveryConfirmPassword': 'Wiederherstellungspasswort bestätigen',
  'security.mpcRecoveryMinLength': 'Verwende mindestens 12 Zeichen',
  'security.mpcRecoveryMismatch': 'Passwörter stimmen nicht überein',
  'security.mpcRecoveryChangeConfirm': 'Wiederherstellungspasswort ändern',
  'security.mpcRecoveryChangeSuccess': 'Wiederherstellungspasswort aktualisiert',
  'security.mpcRecoveryChangeFailed': 'Wiederherstellungspasswort konnte nicht geändert werden',
  'security.mpcRecoveryDeviceSecretPrompt': 'Gib dein Wallet-Passwort zur Bestätigung ein',
  'security.mpcRevealTitle': 'Geheime Wiederherstellungsphrase anzeigen',
  'security.mpcRevealRowSubtitle': 'Zeige deine 24-Wort-Seed-Phrase, um dein Wallet zu sichern oder zu exportieren',
  'security.mpcRevealSubtitle': 'Bestätige deine Identität und sieh deine Seed-Phrase einmalig ein.',
  'security.mpcRevealWarning': 'Wer diese Phrase besitzt, kontrolliert dein Wallet. Teile sie niemals. Gero fragt niemals danach.',
  'security.mpcRevealAction': 'Seed-Phrase anzeigen',
  'security.mpcRevealShow': 'Anzeigen',
  'security.mpcRevealHide': 'Verbergen',
  'security.mpcRevealDone': 'Fertig',
  'security.mpcRevealFailed': 'Wiederherstellungsphrase konnte nicht angezeigt werden',
  ```

- [ ] **Step 10: Strength-validator UI-contract unit test (vitest).** The exhaustive validator spec is owned by Task 11; this is a small guard asserting the exact tiers the dialog relies on (min-12 + weakest-tier reject). If Task 11 already ships `recoveryPasswordStrength.spec.ts`, MERGE these cases into it instead of creating a duplicate file.
  Create `src/shared/utils/mpc/recoveryPasswordStrength.spec.ts`:
  ```typescript
  import { describe, it, expect } from 'vitest';
  import { isAcceptableRecoveryPassword, scoreRecoveryPassword } from './recoveryPasswordStrength';

  describe('recoveryPasswordStrength (UI floor)', () => {
    it('rejects anything under 12 characters regardless of complexity', () => {
      expect(isAcceptableRecoveryPassword('aB3$xY7!')).toBe(false); // 8 chars, strong charset
      expect(isAcceptableRecoveryPassword('')).toBe(false);
      expect(isAcceptableRecoveryPassword('short')).toBe(false);
    });

    it('rejects the weakest tier even at length >= 12', () => {
      expect(isAcceptableRecoveryPassword('aaaaaaaaaaaa')).toBe(false); // 12 chars, no entropy
      expect(scoreRecoveryPassword('aaaaaaaaaaaa').score).toBeLessThanOrEqual(1);
    });

    it('accepts a 12+ char password above the weakest tier', () => {
      expect(isAcceptableRecoveryPassword('correct horse battery staple')).toBe(true);
      expect(scoreRecoveryPassword('correct horse battery staple').score).toBeGreaterThanOrEqual(2);
    });

    it('score is monotonically usable for the meter (0..4 + labelKey)', () => {
      const s = scoreRecoveryPassword('Tr0ub4dour&3xtra-long');
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(4);
      expect(typeof s.labelKey).toBe('string');
    });
  });
  ```
  Run: `npx vitest run src/shared/utils/mpc/recoveryPasswordStrength.spec.ts`.

- [ ] **Step 11: Verify components compile.** There is no Vue component test harness, so verify the two full-page dialogs + the edited `SecurityTab` compile via the SFC/compile check:
  ```bash
  npx vite build --config vite.config.mts
  ```
  Also run `npm run lint` on the touched files and fix any ESLint issues (project rule). Confirm the vitest guard passes: `npx vitest run src/shared/utils/mpc/recoveryPasswordStrength.spec.ts`.

- [ ] **Step 12: Commit.**
  ```bash
  git add src/modules/dashboard/components/SecurityTab.vue \
          src/modules/dashboard/dialogs/ChangeRecoveryPasswordDialog.vue \
          src/modules/dashboard/dialogs/RevealRecoveryPhraseDialog.vue \
          src/shared/composables/useMpcPasskeyPopup.ts \
          src/shared/utils/mpc/recoveryPasswordStrength.spec.ts \
          src/plugins/i18n/us.ts src/plugins/i18n/de.ts
  git commit -m "feat(mpc): settings UI to change recovery password and reveal SRP

Add two MPC-only SecurityTab rows plus ChangeRecoveryPasswordDialog and
RevealRecoveryPhraseDialog. Both re-auth via inline password or the mpcPrf
passkey popup and a fresh Google idToken, then consume SET_RECOVERY_PASSWORD /
REVEAL_MPC_SRP. New password enforces the shared 12-char strength floor; the
SRP is shown once and never persisted. i18n us/de added.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
  ```
  Do NOT stage `src/stores/featureFlagsStore.ts` (local `isGoogleWalletEnabled` flip ships dark).


---
