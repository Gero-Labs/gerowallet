// src/chrome/cip113Partition.spec.ts
//
// Covers the CIP-113 three-way partition predicate. The invariant under test is
// that nothing spendable before CIP-113 can be demoted by the new branch, and
// that a real programmable-token address is actually recognised.
import { describe, it, expect } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { classifyUtxoAddress } from './serialization';

const NETWORK_ID = Cardano.NetworkId.Testnet;

// A well-formed programmable_logic_base hash from the preprod reference deployment, used
// only as test fixture data. cip113Deployments.ts ships CIP113_BASE_PREPROD empty: that
// deployment predates the current contracts and is not confirmed on-chain.
const PLB = 'a48744c1584c58c2995cba1fa26b37f3999ee8cedac0ef241662f53d';
const OWN_PAYMENT = '00000000000000000000000000000000000000000000000000000001';
const OWN_STAKE = '00000000000000000000000000000000000000000000000000000002';
const STRANGER = '000000000000000000000000000000000000000000000000000000ff';

const ownPaymentCreds = new Set([OWN_PAYMENT]);
const ownerCreds = new Set([OWN_PAYMENT, OWN_STAKE]);
const plbSet = new Set([PLB]);

function baseAddress(
  paymentHash: string,
  paymentType: Cardano.CredentialType,
  stakeHash: string,
  stakeType: Cardano.CredentialType,
): string {
  return Cardano.BaseAddress.fromCredentials(
    NETWORK_ID,
    { hash: Hash28ByteBase16(paymentHash), type: paymentType },
    { hash: Hash28ByteBase16(stakeHash), type: stakeType },
  ).toAddress().toBech32();
}

/** The wallet's own ordinary address. */
const ownAddress = baseAddress(
  OWN_PAYMENT, Cardano.CredentialType.KeyHash,
  OWN_STAKE, Cardano.CredentialType.KeyHash,
);

/** The CIP-113 franken-address: PLB script in the payment slot, owner in the stake slot. */
const programmableAddress = baseAddress(
  PLB, Cardano.CredentialType.ScriptHash,
  OWN_STAKE, Cardano.CredentialType.KeyHash,
);

describe('classifyUtxoAddress — CIP-113 partition', () => {
  it('recognises the programmable-token address (stake-credential convention)', () => {
    expect(classifyUtxoAddress(programmableAddress, ownPaymentCreds, plbSet, ownerCreds)).toBe('programmable');
  });

  // Classifier-level only: gero-sync's stake-anchored SUBSCRIBE cannot currently surface
  // such a UTxO (see subscriptionCredentials()). This proves the branch is correct if a
  // future deployment uses that convention, not that the wallet finds one today.
  it('recognises the payment-credential ownership convention too (classifier-only)', () => {
    const addr = baseAddress(
      PLB, Cardano.CredentialType.ScriptHash,
      OWN_PAYMENT, Cardano.CredentialType.KeyHash,
    );
    expect(classifyUtxoAddress(addr, ownPaymentCreds, plbSet, ownerCreds)).toBe('programmable');
  });

  // ── The invariant: nothing spendable gets demoted ──────────────────────────
  it('keeps the wallet\'s own address spendable', () => {
    expect(classifyUtxoAddress(ownAddress, ownPaymentCreds, plbSet, ownerCreds)).toBe('spendable');
  });

  it('keeps the wallet\'s own address spendable even when CIP-113 is unconfigured', () => {
    expect(classifyUtxoAddress(ownAddress, ownPaymentCreds, new Set<string>(), new Set())).toBe('spendable');
  });

  it('keeps enterprise addresses spendable (no base part)', () => {
    const enterprise = Cardano.EnterpriseAddress.fromCredentials(NETWORK_ID, {
      hash: Hash28ByteBase16(OWN_PAYMENT),
      type: Cardano.CredentialType.KeyHash,
    }).toAddress().toBech32();
    expect(classifyUtxoAddress(enterprise, ownPaymentCreds, plbSet, ownerCreds)).toBe('spendable');
  });

  // Sending an empty `credentials` list turns off gero-sync's payment-credential filter,
  // so on a CIP-113-configured network these fallbacks are the only gate left. They fail
  // closed there and stay permissive everywhere else, so mainnet behaviour is unchanged.
  it('drops unparseable addresses once the server-side filter is off', () => {
    expect(classifyUtxoAddress('not-an-address', ownPaymentCreds, plbSet, ownerCreds)).toBe('foreign');
    expect(classifyUtxoAddress('', ownPaymentCreds, plbSet, ownerCreds)).toBe('foreign');
  });

  it('keeps unparseable addresses spendable where the filter is still on', () => {
    const noPlb = new Set<string>();
    expect(classifyUtxoAddress('not-an-address', ownPaymentCreds, noPlb, ownerCreds)).toBe('spendable');
    expect(classifyUtxoAddress('', ownPaymentCreds, noPlb, ownerCreds)).toBe('spendable');
  });

  it('drops a stranger\'s enterprise address once the server-side filter is off', () => {
    const strangerEnterprise = Cardano.EnterpriseAddress.fromCredentials(NETWORK_ID, {
      hash: Hash28ByteBase16(STRANGER),
      type: Cardano.CredentialType.KeyHash,
    }).toAddress().toBech32();
    expect(classifyUtxoAddress(strangerEnterprise, ownPaymentCreds, plbSet, ownerCreds)).toBe('foreign');
    // …but keeps it on a network where gero-sync still pre-filters.
    expect(classifyUtxoAddress(strangerEnterprise, ownPaymentCreds, new Set<string>(), ownerCreds)).toBe('spendable');
  });

  // ── Nothing else gets pulled into the programmable bucket ──────────────────
  it('does not claim a programmable address owned by somebody else', () => {
    const someoneElse = baseAddress(
      PLB, Cardano.CredentialType.ScriptHash,
      STRANGER, Cardano.CredentialType.KeyHash,
    );
    // Named distinctly from 'foreign' so the count is measurable: it tells us the
    // data source is sending holdings that are not ours.
    expect(classifyUtxoAddress(someoneElse, ownPaymentCreds, plbSet, ownerCreds)).toBe('programmable-other');
  });

  it('does not claim a different script address that shares our stake credential', () => {
    const otherScript = baseAddress(
      STRANGER, Cardano.CredentialType.ScriptHash,
      OWN_STAKE, Cardano.CredentialType.KeyHash,
    );
    expect(classifyUtxoAddress(otherScript, ownPaymentCreds, plbSet, ownerCreds)).toBe('foreign');
  });

  it('requires a script credential in the payment slot, not just a matching hash', () => {
    const keyHashLookalike = baseAddress(
      PLB, Cardano.CredentialType.KeyHash,
      OWN_STAKE, Cardano.CredentialType.KeyHash,
    );
    expect(classifyUtxoAddress(keyHashLookalike, ownPaymentCreds, plbSet, ownerCreds)).toBe('foreign');
  });

  it('ignores a script stake credential — that owner is a contract, not this wallet', () => {
    const scriptOwned = baseAddress(
      PLB, Cardano.CredentialType.ScriptHash,
      OWN_STAKE, Cardano.CredentialType.ScriptHash,
    );
    expect(classifyUtxoAddress(scriptOwned, ownPaymentCreds, plbSet, ownerCreds)).toBe('programmable-other');
  });

  it('drops the programmable branch entirely when no hash is configured', () => {
    expect(classifyUtxoAddress(programmableAddress, ownPaymentCreds, new Set<string>(), new Set())).toBe('foreign');
  });
});

describe('classifyUtxoAddress — multiple deployments per network', () => {
  // Preview was re-bootstrapped on 2026-08-13; tokens minted before that stay at
  // the older base address. Recognising only the newest hides them completely.
  const OLD_PLB = '8adfe689f4049706f893745f9e8af24cc2cade650de9bac05e3d403f';
  const NEW_PLB = '33ceea92481cd6cc5b9ad1750302642042bb8ea5d028b830ad86fc31';
  const bothDeployments = new Set([NEW_PLB, OLD_PLB]);

  const atOldDeployment = baseAddress(
    OLD_PLB, Cardano.CredentialType.ScriptHash,
    OWN_STAKE, Cardano.CredentialType.KeyHash,
  );
  const atNewDeployment = baseAddress(
    NEW_PLB, Cardano.CredentialType.ScriptHash,
    OWN_STAKE, Cardano.CredentialType.KeyHash,
  );

  it('recognises holdings under either deployment', () => {
    expect(classifyUtxoAddress(atOldDeployment, ownPaymentCreds, bothDeployments, ownerCreds)).toBe('programmable');
    expect(classifyUtxoAddress(atNewDeployment, ownPaymentCreds, bothDeployments, ownerCreds)).toBe('programmable');
  });

  // Exercises the list mechanism a future rotation needs, not today's shipped config:
  // preview deliberately ships only the newest hash, because the older deployments
  // predate the current contracts (see cip113Deployments.ts). This proves what that
  // rotation would rely on — a still-held but unconfigured hash reads as somebody
  // else's and its UTxOs silently disappear from the portfolio.
  it('loses the superseded deployment if only the newest is configured', () => {
    const newOnly = new Set([NEW_PLB]);
    expect(classifyUtxoAddress(atNewDeployment, ownPaymentCreds, newOnly, ownerCreds)).toBe('programmable');
    expect(classifyUtxoAddress(atOldDeployment, ownPaymentCreds, newOnly, ownerCreds)).toBe('foreign');
  });
});

describe('credential expansion — script addresses must never trigger it', () => {
  // Regression: with the credential filter disabled, gero-sync reports every address
  // under the stake credential, including script addresses. BIP44 derivation can only
  // ever produce KEY hashes, so treating a script address as "not yet derived" spun
  // the range to its 500 cap and re-triggered a full resync on every sync message —
  // an infinite loop that starved applyUtxos and made the tokens never appear.
  //
  // This mirrors the predicate in WalletBg.expandCredentialsIfNeeded.
  function needsExpansion(addresses: string[], ownPaymentCreds: Set<string>): boolean {
    for (const addr of addresses) {
      let baseAddr: Cardano.BaseAddress | undefined;
      try {
        baseAddr = Cardano.Address.fromString(addr)?.asBase();
      } catch { continue; }
      if (!baseAddr) continue;
      const paymentCred = baseAddr.getPaymentCredential();
      if (paymentCred.type === Cardano.CredentialType.ScriptHash) continue;
      if (!ownPaymentCreds.has(paymentCred.hash)) return true;
    }
    return false;
  }

  const scriptAddresses = [
    baseAddress(PLB, Cardano.CredentialType.ScriptHash, OWN_STAKE, Cardano.CredentialType.KeyHash),
    // A different script sharing the same stake credential — the exemption keys off
    // credential type, not the specific PLB hash, so this must be skipped too.
    baseAddress(STRANGER, Cardano.CredentialType.ScriptHash, OWN_STAKE, Cardano.CredentialType.KeyHash),
  ];

  it('does not expand for any script-payment address', () => {
    expect(needsExpansion(scriptAddresses, ownPaymentCreds)).toBe(false);
  });

  it('still expands for an undiscovered KEY address', () => {
    const undiscovered = baseAddress(
      STRANGER, Cardano.CredentialType.KeyHash,
      OWN_STAKE, Cardano.CredentialType.KeyHash,
    );
    expect(needsExpansion([undiscovered], ownPaymentCreds)).toBe(true);
  });

  it('does not expand when every key address is already derived', () => {
    expect(needsExpansion([ownAddress], ownPaymentCreds)).toBe(false);
  });
});
