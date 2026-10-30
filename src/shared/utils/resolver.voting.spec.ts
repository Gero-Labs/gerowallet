import { describe, it, expect } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { analyzeTransactionForSignatures } from '@/shared/utils/resolver';
import { ChainDerivations } from '@/models/types';

const CRED = '463796d2a39623a5441e9eab1594c2d21f96d2a544f49f82bc023bff';

function txWithVote(voterType: Cardano.VoterType) {
  return {
    body: {
      inputs: [],
      outputs: [],
      votingProcedures: [
        {
          voter: { __typename: voterType, credential: { type: Cardano.CredentialType.KeyHash, hash: CRED } },
          votes: [
            {
              actionId: { id: 'a'.repeat(64), actionIndex: 0 },
              votingProcedure: { vote: Cardano.Vote.yes, anchor: null },
            },
          ],
        },
      ],
    },
  } as never;
}

// analyzeTransactionForSignatures(transaction, utxos, addresses)
// returns the signer array directly. The key set carries the voter's credential as the
// wallet's own DRep and committee hot key; the voting branch consults nothing else.
function analyze(tx: never) {
  return analyzeTransactionForSignatures(tx, [], { drep129: [{ cred: CRED, path: '' }], ccHot: [{ cred: CRED, path: '' }] } as never);
}

describe('analyzeTransactionForSignatures — voting procedures', () => {
  it('requires a DRep-key witness for a dRepKeyHash voter', () => {
    const result = analyze(txWithVote(Cardano.VoterType.dRepKeyHash));
    // Role 3 is the CIP-105 DRep key role.
    expect(result.some(s => s.derivationPath[0] === ChainDerivations.DREP)).toBe(true);
  });

  it('does not add a DRep signer for a stake-pool voter', () => {
    const result = analyze(txWithVote(Cardano.VoterType.stakePoolKeyHash));
    expect(result.some(s => s.derivationPath[0] === ChainDerivations.DREP)).toBe(false);
  });

  it('flags the cold key out-of-band for a stake-pool voter, like pool certificates do', () => {
    const result = analyze(txWithVote(Cardano.VoterType.stakePoolKeyHash));
    expect((result as unknown as { requiresColdKeySignature?: boolean }).requiresColdKeySignature).toBe(true);
  });

  it('requires a CC hot-key witness for a ccHotKeyHash voter', () => {
    const result = analyze(txWithVote(Cardano.VoterType.ccHotKeyHash));
    expect(result.some(s => s.derivationPath[0] === ChainDerivations.CONSTITUTIONAL_COMMITTEE_HOT)).toBe(true);
  });

  it('adds no key signer for script-credential voters', () => {
    for (const voterType of [Cardano.VoterType.dRepScriptHash, Cardano.VoterType.ccHotScriptHash]) {
      const result = analyze(txWithVote(voterType));
      expect(result).toHaveLength(0);
    }
  });

  it('adds exactly one signer for a batch of votes from one voter', () => {
    const tx = txWithVote(Cardano.VoterType.dRepKeyHash) as never as {
      body: { votingProcedures: { votes: unknown[] }[] };
    };
    tx.body.votingProcedures[0].votes = new Array(5).fill(tx.body.votingProcedures[0].votes[0]);

    const result = analyze(tx as never);
    const drepSigners = result.filter(s => s.derivationPath[0] === ChainDerivations.DREP);
    expect(drepSigners).toHaveLength(1);
  });

  it('is a no-op for a transaction with no voting procedures', () => {
    const plain = { body: { inputs: [], outputs: [] } } as never;
    expect(() => analyze(plain)).not.toThrow();
    expect(analyze(plain)).toHaveLength(0);
  });
});

describe('analyzeTransactionForSignatures — only signs for the wallet’s own credentials', () => {
  const FOREIGN = 'f'.repeat(56);
  const keys = (over: Record<string, unknown>) => ({ payment: [], change: [], stake: [], drep105: [], drep129: [], ccHot: [], ccCold: [], script: [], ...over }) as never;
  const voteBy = (voterType: Cardano.VoterType, hash: string) => ({
    body: { inputs: [], outputs: [], votingProcedures: [{
      voter: { __typename: voterType, credential: { type: Cardano.CredentialType.KeyHash, hash } },
      votes: [{ actionId: { id: 'a'.repeat(64), actionIndex: 0 }, votingProcedure: { vote: Cardano.Vote.yes, anchor: null } }],
    }] },
  }) as never;

  it('adds the DRep witness for our own DRep voter, not for someone else’s', () => {
    const own = keys({ drep129: [{ cred: CRED, path: '' }] });
    expect(analyzeTransactionForSignatures(voteBy(Cardano.VoterType.dRepKeyHash, CRED), [], own)
      .some(s => s.derivationPath[0] === ChainDerivations.DREP)).toBe(true);
    expect(analyzeTransactionForSignatures(voteBy(Cardano.VoterType.dRepKeyHash, FOREIGN), [], own)
      .some(s => s.derivationPath[0] === ChainDerivations.DREP)).toBe(false);
  });

  it('adds the CC-hot witness only for our own CC-hot voter', () => {
    const own = keys({ ccHot: [{ cred: CRED, path: '' }] });
    expect(analyzeTransactionForSignatures(voteBy(Cardano.VoterType.ccHotKeyHash, FOREIGN), [], own)).toHaveLength(0);
  });

  it('signs no certificate or vote when the key set carries no cred of that kind, as the Keystone signer', () => {
    const stakeCert = { body: { inputs: [], outputs: [], certificates: [{
      __typename: Cardano.CertificateType.VoteDelegation,
      stakeCredential: { type: Cardano.CredentialType.KeyHash, hash: CRED },
      dRep: { __typename: 'AlwaysAbstain' },
    }] } } as never;
    expect(analyzeTransactionForSignatures(stakeCert, [], keys({}))).toHaveLength(0);
    expect(analyzeTransactionForSignatures(voteBy(Cardano.VoterType.dRepKeyHash, CRED), [], keys({}))).toHaveLength(0);
    expect(analyzeTransactionForSignatures(voteBy(Cardano.VoterType.ccHotKeyHash, CRED), [], keys({}))).toHaveLength(0);
  });

  it('signs a certificate, a vote and a required signer for one key at that key\'s own path, once', () => {
    const own = keys({ drep129: [{ cred: CRED, path: "m/1852'/1815'/1'/3/2" }] });
    const tx = { body: {
      inputs: [], outputs: [], requiredExtraSignatures: [CRED],
      certificates: [{ __typename: Cardano.CertificateType.RegisterDelegateRepresentative, dRepCredential: { type: Cardano.CredentialType.KeyHash, hash: CRED }, deposit: 500_000_000n, anchor: null }],
      votingProcedures: [{
        voter: { __typename: Cardano.VoterType.dRepKeyHash, credential: { type: Cardano.CredentialType.KeyHash, hash: CRED } },
        votes: [{ actionId: { id: 'a'.repeat(64), actionIndex: 0 }, votingProcedure: { vote: Cardano.Vote.yes, anchor: null } }],
      }],
    } } as never;
    expect(analyzeTransactionForSignatures(tx, [], own)).toEqual([{ derivationPath: [ChainDerivations.DREP, 2], type: 'drep' }]);
  });

  it('adds the stake witness only for a certificate on our own stake credential', () => {
    const own = keys({ stake: [{ cred: CRED, path: '', address: 'stake_test1' }] });
    const cert = (hash: string) => ({ body: { inputs: [], outputs: [], certificates: [{
      __typename: Cardano.CertificateType.VoteDelegation,
      stakeCredential: { type: Cardano.CredentialType.KeyHash, hash },
      dRep: { __typename: 'AlwaysAbstain' },
    }] } }) as never;
    expect(analyzeTransactionForSignatures(cert(CRED), [], own).some(s => s.type === 'stake')).toBe(true);
    expect(analyzeTransactionForSignatures(cert(FOREIGN), [], own).some(s => s.type === 'stake')).toBe(false);
  });

  describe('required signers', () => {
    const COLD = 'c'.repeat(56);
    const HOT = 'e'.repeat(56);
    const requiring = (...hashes: string[]) => ({ body: { inputs: [], outputs: [], requiredExtraSignatures: hashes } }) as never;
    const own = keys({ drep129: [{ cred: CRED, path: '' }], ccCold: [{ cred: COLD, path: '' }], ccHot: [{ cred: HOT, path: '' }] });

    it('signs a governance required signer at the key\'s own path when the key set carries one', () => {
      const withPaths = keys({ drep129: [{ cred: CRED, path: "m/1852'/1815'/1'/3/2" }], ccCold: [{ cred: COLD, path: "m/1852'/1815'/1'/4/1" }] });
      expect(analyzeTransactionForSignatures(requiring(CRED, COLD), [], withPaths)).toEqual([
        { derivationPath: [ChainDerivations.DREP, 2], type: 'drep' },
        { derivationPath: [ChainDerivations.CONSTITUTIONAL_COMMITTEE_COLD, 1], type: 'ccCold' },
      ]);
    });

    it('signs a required signer naming our DRep key or a committee key, at that key\'s role', () => {
      expect(analyzeTransactionForSignatures(requiring(CRED, COLD, HOT), [], own)).toEqual([
        { derivationPath: [ChainDerivations.DREP, 0], type: 'drep' },
        { derivationPath: [ChainDerivations.CONSTITUTIONAL_COMMITTEE_COLD, 0], type: 'ccCold' },
        { derivationPath: [ChainDerivations.CONSTITUTIONAL_COMMITTEE_HOT, 0], type: 'ccHot' },
      ]);
    });

    it('matches the hash whatever its case', () => {
      expect(analyzeTransactionForSignatures(requiring(CRED.toUpperCase()), [], own))
        .toEqual([{ derivationPath: [ChainDerivations.DREP, 0], type: 'drep' }]);
    });

    it('matches a payment, change or stake key whatever case either side spells its hash in', () => {
      const PAYMENT = 'ab'.repeat(28);
      const CHANGE = 'cd'.repeat(28);
      const STAKE = 'ef'.repeat(28);
      const wallet = keys({
        payment: [{ cred: PAYMENT, path: "m/1852'/1815'/1'/0/3" }],
        change: [{ cred: CHANGE.toUpperCase(), path: "m/1852'/1815'/1'/1/2" }],
        stake: [{ cred: STAKE, path: "m/1852'/1815'/1'/2/0" }],
      });
      expect(analyzeTransactionForSignatures(requiring(PAYMENT.toUpperCase(), CHANGE, STAKE.toUpperCase()), [], wallet)).toEqual([
        { derivationPath: [ChainDerivations.EXTERNAL, 3], type: 'payment' },
        { derivationPath: [ChainDerivations.INTERNAL, 2], type: 'payment' },
        { derivationPath: [ChainDerivations.CHIMERIC_ACCOUNT, 0], type: 'stake' },
      ]);
    });

    it('signs once when a required signer and our own vote both name the DRep key', () => {
      const tx = { body: { inputs: [], outputs: [], requiredExtraSignatures: [CRED], votingProcedures: [{
        voter: { __typename: Cardano.VoterType.dRepKeyHash, credential: { type: Cardano.CredentialType.KeyHash, hash: CRED } },
        votes: [{ actionId: { id: 'a'.repeat(64), actionIndex: 0 }, votingProcedure: { vote: Cardano.Vote.yes, anchor: null } }],
      }] } } as never;
      expect(analyzeTransactionForSignatures(tx, [], own)).toEqual([{ derivationPath: [ChainDerivations.DREP, 0], type: 'drep' }]);
    });

    it('signs nothing for a hash that is not one of our keys, even with no key of that kind to compare against', () => {
      expect(analyzeTransactionForSignatures(requiring(FOREIGN), [], own)).toHaveLength(0);
      expect(analyzeTransactionForSignatures(requiring(CRED, COLD, HOT), [], keys({}))).toHaveLength(0);
    });
  });

  describe('collateral', () => {
    const INPUT_ADDR = 'addr_test_input_key';
    const COLLATERAL_ADDR = 'addr_test_collateral_key';
    const wallet = keys({
      payment: [
        { address: INPUT_ADDR, cred: 'a1'.repeat(28), path: "m/1852'/1815'/1'/0/5" },
        { address: COLLATERAL_ADDR, cred: 'b2'.repeat(28), path: "m/1852'/1815'/1'/0/0" },
      ],
    });
    const utxo = (txId: string, index: number, address: string) =>
      [{ txId, index, address }, { address, value: { coins: 5_000_000n } }] as unknown as Cardano.Utxo;
    const utxos = [utxo('11'.repeat(32), 0, INPUT_ADDR), utxo('22'.repeat(32), 1, COLLATERAL_ADDR)];
    const spending = (collaterals: Array<{ txId: string; index: number }>) => ({ body: {
      inputs: [{ txId: '11'.repeat(32), index: 0 }], outputs: [], collaterals,
    } }) as never;

    it('signs for a collateral UTxO at a key no input uses', () => {
      expect(analyzeTransactionForSignatures(spending([{ txId: '22'.repeat(32), index: 1 }]), utxos, wallet)).toEqual([
        { derivationPath: [ChainDerivations.EXTERNAL, 5], type: 'payment' },
        { derivationPath: [ChainDerivations.EXTERNAL, 0], type: 'payment' },
      ]);
    });

    it('signs once when the collateral sits at an input\'s key, and not at all for a collateral UTxO it does not know', () => {
      expect(analyzeTransactionForSignatures(spending([{ txId: '11'.repeat(32), index: 0 }, { txId: '33'.repeat(32), index: 0 }]), utxos, wallet))
        .toEqual([{ derivationPath: [ChainDerivations.EXTERNAL, 5], type: 'payment' }]);
    });
  });

  describe('reward accounts', () => {
    const STAKE = 'a3'.repeat(28);
    const rewardAccount = (hash: string) => Cardano.RewardAddress.fromCredentials(
      Cardano.NetworkId.Testnet, { type: Cardano.CredentialType.KeyHash, hash: hash as Cardano.Credential['hash'] },
    ).toAddress().toBech32();
    const wallet = keys({ stake: [{ cred: STAKE, path: "m/1852'/1815'/1'/2/0" }] });
    const stakeSigner = { derivationPath: [ChainDerivations.CHIMERIC_ACCOUNT, 0], type: 'stake' };
    const withdrawing = (account: string) => ({ body: { inputs: [], outputs: [], withdrawals: [{ stakeAddress: account, quantity: 1n }] } }) as never;
    const owning = (owner: string) => ({ body: { inputs: [], outputs: [], certificates: [{
      __typename: Cardano.CertificateType.PoolRegistration, poolParameters: { owners: [owner] },
    }] } }) as never;

    it('signs a withdrawal and a pool ownership by stake key hash when no stake address is given', () => {
      expect(analyzeTransactionForSignatures(withdrawing(rewardAccount(STAKE)), [], wallet)).toEqual([stakeSigner]);
      // Spread: a pool registration also flags the cold key on the array itself.
      expect([...analyzeTransactionForSignatures(owning(rewardAccount(STAKE)), [], wallet)]).toEqual([stakeSigner]);
    });

    it('signs nothing for another reward account', () => {
      expect(analyzeTransactionForSignatures(withdrawing(rewardAccount(FOREIGN)), [], wallet)).toHaveLength(0);
      expect(analyzeTransactionForSignatures(owning(rewardAccount(FOREIGN)), [], wallet)).toHaveLength(0);
    });

    it('signs with the stake key at the reward address when that key carries no cred', () => {
      const atAddress = keys({ stake: [{ address: rewardAccount(STAKE), cred: '', path: "m/1852'/1815'/1'/2/3" }] });
      expect(analyzeTransactionForSignatures(withdrawing(rewardAccount(STAKE)), [], atAddress))
        .toEqual([{ derivationPath: [ChainDerivations.CHIMERIC_ACCOUNT, 3], type: 'stake' }]);
    });

    it('signs nothing for a script\'s reward account, even one carrying the stake key\'s hash', () => {
      const script = Cardano.RewardAddress.fromCredentials(
        Cardano.NetworkId.Testnet, { type: Cardano.CredentialType.ScriptHash, hash: STAKE as Cardano.Credential['hash'] },
      ).toAddress().toBech32();
      expect(analyzeTransactionForSignatures(withdrawing(script), [], wallet)).toHaveLength(0);
    });
  });

  describe('DRep certificates', () => {
    const credential = (hash: string, type = Cardano.CredentialType.KeyHash) => ({ type, hash });
    const registration = (dRepCredential: { type: Cardano.CredentialType; hash: string }) => ({
      __typename: Cardano.CertificateType.RegisterDelegateRepresentative, dRepCredential, deposit: 500_000_000n, anchor: null,
    });
    const update = (dRepCredential: { type: Cardano.CredentialType; hash: string }) => ({
      __typename: Cardano.CertificateType.UpdateDelegateRepresentative, dRepCredential, anchor: null,
    });
    const retirement = (dRepCredential: { type: Cardano.CredentialType; hash: string }) => ({
      __typename: Cardano.CertificateType.UnregisterDelegateRepresentative, dRepCredential, deposit: 500_000_000n,
    });
    const withCertificates = (...certificates: unknown[]) => ({ body: { inputs: [], outputs: [], certificates } }) as never;
    const own = keys({ drep105: [{ cred: CRED, path: '' }], drep129: [{ cred: CRED, path: '' }] });
    const drepSigner = { derivationPath: [ChainDerivations.DREP, 0], type: 'drep' };

    it('adds the DRep-key witness for our own registration, update and retirement', () => {
      for (const certificate of [registration, update, retirement]) {
        expect(analyzeTransactionForSignatures(withCertificates(certificate(credential(CRED))), [], own)).toEqual([drepSigner]);
      }
    });

    it('adds it once for a registration and a vote by our own DRep', () => {
      const tx = { body: { inputs: [], outputs: [], certificates: [registration(credential(CRED))], votingProcedures: [{
        voter: { __typename: Cardano.VoterType.dRepKeyHash, credential: credential(CRED) },
        votes: [{ actionId: { id: 'a'.repeat(64), actionIndex: 0 }, votingProcedure: { vote: Cardano.Vote.yes, anchor: null } }],
      }] } } as never;
      expect(analyzeTransactionForSignatures(tx, [], own)).toEqual([drepSigner]);
    });

    it('adds nothing for another DRep', () => {
      expect(analyzeTransactionForSignatures(withCertificates(registration(credential(FOREIGN)), retirement(credential(FOREIGN))), [], own))
        .toHaveLength(0);
    });

    it('adds nothing for a script DRep, even with no DRep cred to compare against', () => {
      const script = credential(CRED, Cardano.CredentialType.ScriptHash);
      expect(analyzeTransactionForSignatures(withCertificates(registration(script), update(script)), [], own)).toHaveLength(0);
      expect(analyzeTransactionForSignatures(withCertificates(retirement(script)), [], keys({}))).toHaveLength(0);
    });
  });

  describe('committee certificates', () => {
    const HOT = 'e'.repeat(56);
    const credential = (hash: string, type = Cardano.CredentialType.KeyHash) => ({ type, hash });
    const authorization = (cold: { type: Cardano.CredentialType; hash: string }, hot = credential(HOT)) => ({
      __typename: Cardano.CertificateType.AuthorizeCommitteeHot, coldCredential: cold, hotCredential: hot,
    });
    const resignation = (cold: { type: Cardano.CredentialType; hash: string }) => ({
      __typename: Cardano.CertificateType.ResignCommitteeCold, coldCredential: cold, anchor: null,
    });
    const withCertificates = (...certificates: unknown[]) => ({ body: { inputs: [], outputs: [], certificates } }) as never;
    const own = keys({ ccCold: [{ cred: CRED, path: '' }], ccHot: [{ cred: HOT, path: '' }] });
    const coldSigner = { derivationPath: [ChainDerivations.CONSTITUTIONAL_COMMITTEE_COLD, 0], type: 'ccCold' };

    it('adds the cold-key witness for our own hot-key authorization and resignation', () => {
      expect(analyzeTransactionForSignatures(withCertificates(authorization(credential(CRED))), [], own)).toEqual([coldSigner]);
      expect(analyzeTransactionForSignatures(withCertificates(resignation(credential(CRED))), [], own)).toEqual([coldSigner]);
    });

    it('adds it once for several certificates of our cold key', () => {
      expect(analyzeTransactionForSignatures(withCertificates(authorization(credential(CRED)), resignation(credential(CRED))), [], own))
        .toEqual([coldSigner]);
    });

    it('adds nothing for another cold credential, even when the authorized hot key is ours', () => {
      expect(analyzeTransactionForSignatures(withCertificates(authorization(credential(FOREIGN)), resignation(credential(FOREIGN))), [], own))
        .toHaveLength(0);
    });

    it('adds nothing for a script cold credential, even with no cold cred to compare against', () => {
      const script = credential(CRED, Cardano.CredentialType.ScriptHash);
      expect(analyzeTransactionForSignatures(withCertificates(authorization(script), resignation(script)), [], own)).toHaveLength(0);
      expect(analyzeTransactionForSignatures(withCertificates(resignation(script)), [], keys({}))).toHaveLength(0);
    });
  });

  describe('key sets', () => {
    it('throws without a key set, so the fee estimate falls back to its heuristic', () => {
      expect(() => analyzeTransactionForSignatures(voteBy(Cardano.VoterType.dRepKeyHash, CRED), [], null as never)).toThrow();
    });

    it('signs a credential only with a key of its own kind', () => {
      // A stake certificate naming the wallet's DRep key hash as its stake credential.
      const stakeCert = { body: { inputs: [], outputs: [], certificates: [{
        __typename: Cardano.CertificateType.StakeDelegation,
        stakeCredential: { type: Cardano.CredentialType.KeyHash, hash: CRED },
        poolId: 'pool1pu5jlj4q9w9jlxeu370a3c9myx47md5j5m2str0naunn2q3lkdy',
      }] } } as never;
      expect(analyzeTransactionForSignatures(stakeCert, [], keys({ drep129: [{ cred: CRED, path: "m/1852'/1815'/1'/3/0" }] }))).toHaveLength(0);
    });

    it('signs nothing for a required signer naming a payment key with no path', () => {
      expect(analyzeTransactionForSignatures({ body: { inputs: [], outputs: [], requiredExtraSignatures: [CRED] } } as never, [], keys({ payment: [{ address: 'addr_watch', cred: CRED, path: '' }] })))
        .toHaveLength(0);
    });
  });
});
