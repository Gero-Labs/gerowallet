import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Owner = { approvalKey: __compactRuntime.JubjubPoint;
                      upgradeKey: Uint8Array
                    };

export enum Scope { QuorumOnly = 0, Any = 1 }

export type WlEntry = { active: boolean; recipient: Uint8Array; scope: Scope };

export type DelegatePolicy = { active: boolean;
                               key: __compactRuntime.JubjubPoint;
                               cap: bigint;
                               period: bigint
                             };

export type Policy = { whitelistEnabled: boolean;
                       whitelist: WlEntry[];
                       delegates: DelegatePolicy[]
                     };

export type RecoveryConfig = { guardians: bigint[];
                               threshold: bigint;
                               recoveryDelay: bigint;
                               cooldown: bigint;
                               expiryWindow: bigint
                             };

export type GuardianSecret = { key: __compactRuntime.JubjubPoint;
                               salt: Uint8Array
                             };

export type GuardianApproval = { key: __compactRuntime.JubjubPoint;
                                 salt: Uint8Array;
                                 sig: { announcement: __compactRuntime.JubjubPoint,
                                        response: bigint
                                      }
                               };

export type Approval = { signer: __compactRuntime.JubjubPoint;
                         sig: { announcement: __compactRuntime.JubjubPoint,
                                response: bigint
                              }
                       };

export type PendingOwners = { active: boolean;
                              owners: Owner[];
                              threshold: bigint;
                              executableAfter: bigint
                            };

export type PendingPolicy = { active: boolean;
                              policy: Policy;
                              executableAfter: bigint
                            };

export type Window = { start: bigint; spent: bigint };

export type PendingGuardians = { active: boolean;
                                 config: RecoveryConfig;
                                 executableAfter: bigint
                               };

export type PendingRecovery = { active: boolean;
                                owners: Owner[];
                                threshold: bigint;
                                executableAfter: bigint;
                                expiresAfter: bigint;
                                approvedBy: boolean[]
                              };

export type Witnesses<PS> = {
}

export type ImpureCircuits<PS> = {
  deposit(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  execute(context: __compactRuntime.CircuitContext<PS>,
          recipient_0: { bytes: Uint8Array },
          amount_0: bigint,
          expiry_0: bigint,
          approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  delegatePayout(context: __compactRuntime.CircuitContext<PS>,
                 slot_0: bigint,
                 recipient_0: { bytes: Uint8Array },
                 amount_0: bigint,
                 expiry_0: bigint,
                 timeClaim_0: { is_some: boolean, value: bigint },
                 sig_0: { announcement: __compactRuntime.JubjubPoint,
                          response: bigint
                        }): Promise<__compactRuntime.CircuitResults<PS, []>>;
  proposeOwners(context: __compactRuntime.CircuitContext<PS>,
                newOwners_0: Owner[],
                newThreshold_0: bigint,
                notBefore_0: bigint,
                expiry_0: bigint,
                approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  cancelOwners(context: __compactRuntime.CircuitContext<PS>,
               expiry_0: bigint,
               approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  applyOwners(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
  proposePolicy(context: __compactRuntime.CircuitContext<PS>,
                newPolicy_0: Policy,
                notBefore_0: bigint,
                expiry_0: bigint,
                approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  cancelPolicy(context: __compactRuntime.CircuitContext<PS>,
               expiry_0: bigint,
               approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  applyPolicy(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
  narrowPolicy(context: __compactRuntime.CircuitContext<PS>,
               newPolicy_0: Policy,
               expiry_0: bigint,
               approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  proposeRecovery(context: __compactRuntime.CircuitContext<PS>,
                  newOwners_0: Owner[],
                  newThreshold_0: bigint,
                  notBefore_0: bigint,
                  expiry_0: bigint,
                  approvals_0: { is_some: boolean, value: GuardianApproval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  cancelRecovery(context: __compactRuntime.CircuitContext<PS>,
                 at_0: bigint,
                 expiry_0: bigint,
                 approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  withdrawRecovery(context: __compactRuntime.CircuitContext<PS>,
                   at_0: bigint,
                   expiry_0: bigint,
                   approvals_0: { is_some: boolean, value: GuardianApproval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  clearExpiredRecovery(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
  applyRecovery(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
  proposeGuardians(context: __compactRuntime.CircuitContext<PS>,
                   newGuardians_0: GuardianSecret[],
                   newThreshold_0: bigint,
                   newRecoveryDelay_0: bigint,
                   newCooldown_0: bigint,
                   newExpiryWindow_0: bigint,
                   notBefore_0: bigint,
                   expiry_0: bigint,
                   approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  cancelGuardians(context: __compactRuntime.CircuitContext<PS>,
                  expiry_0: bigint,
                  approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  applyGuardians(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type ProvableCircuits<PS> = {
  deposit(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  execute(context: __compactRuntime.CircuitContext<PS>,
          recipient_0: { bytes: Uint8Array },
          amount_0: bigint,
          expiry_0: bigint,
          approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  delegatePayout(context: __compactRuntime.CircuitContext<PS>,
                 slot_0: bigint,
                 recipient_0: { bytes: Uint8Array },
                 amount_0: bigint,
                 expiry_0: bigint,
                 timeClaim_0: { is_some: boolean, value: bigint },
                 sig_0: { announcement: __compactRuntime.JubjubPoint,
                          response: bigint
                        }): Promise<__compactRuntime.CircuitResults<PS, []>>;
  proposeOwners(context: __compactRuntime.CircuitContext<PS>,
                newOwners_0: Owner[],
                newThreshold_0: bigint,
                notBefore_0: bigint,
                expiry_0: bigint,
                approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  cancelOwners(context: __compactRuntime.CircuitContext<PS>,
               expiry_0: bigint,
               approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  applyOwners(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
  proposePolicy(context: __compactRuntime.CircuitContext<PS>,
                newPolicy_0: Policy,
                notBefore_0: bigint,
                expiry_0: bigint,
                approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  cancelPolicy(context: __compactRuntime.CircuitContext<PS>,
               expiry_0: bigint,
               approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  applyPolicy(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
  narrowPolicy(context: __compactRuntime.CircuitContext<PS>,
               newPolicy_0: Policy,
               expiry_0: bigint,
               approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  proposeRecovery(context: __compactRuntime.CircuitContext<PS>,
                  newOwners_0: Owner[],
                  newThreshold_0: bigint,
                  notBefore_0: bigint,
                  expiry_0: bigint,
                  approvals_0: { is_some: boolean, value: GuardianApproval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  cancelRecovery(context: __compactRuntime.CircuitContext<PS>,
                 at_0: bigint,
                 expiry_0: bigint,
                 approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  withdrawRecovery(context: __compactRuntime.CircuitContext<PS>,
                   at_0: bigint,
                   expiry_0: bigint,
                   approvals_0: { is_some: boolean, value: GuardianApproval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  clearExpiredRecovery(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
  applyRecovery(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
  proposeGuardians(context: __compactRuntime.CircuitContext<PS>,
                   newGuardians_0: GuardianSecret[],
                   newThreshold_0: bigint,
                   newRecoveryDelay_0: bigint,
                   newCooldown_0: bigint,
                   newExpiryWindow_0: bigint,
                   notBefore_0: bigint,
                   expiry_0: bigint,
                   approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  cancelGuardians(context: __compactRuntime.CircuitContext<PS>,
                  expiry_0: bigint,
                  approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  applyGuardians(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type PureCircuits = {
  guardianCommitment(key_0: __compactRuntime.JubjubPoint, salt_0: Uint8Array): bigint;
  recoveryConfigCommitment(cfg_0: RecoveryConfig): bigint;
  ownerSetCommitment(owners_0: Owner[], threshold_0: bigint): bigint;
  policyCommitment(p_0: Policy): bigint;
  payoutDigest(vault_0: { bytes: Uint8Array },
               network_0: Uint8Array,
               nonce_0: bigint,
               expiry_0: bigint,
               recipient_0: { bytes: Uint8Array },
               amount_0: bigint): bigint;
  delegatePayoutDigest(vault_0: { bytes: Uint8Array },
                       network_0: Uint8Array,
                       slot_0: bigint,
                       delegateNonce_0: bigint,
                       expiry_0: bigint,
                       recipient_0: { bytes: Uint8Array },
                       amount_0: bigint): bigint;
  ownerStatementDigest(domain_0: Uint8Array,
                       vault_0: { bytes: Uint8Array },
                       network_0: Uint8Array,
                       nonce_0: bigint,
                       expiry_0: bigint,
                       subject_0: bigint): bigint;
  buildConstants(): bigint[];
}

export type Circuits<PS> = {
  guardianCommitment(context: __compactRuntime.CircuitContext<PS>,
                     key_0: __compactRuntime.JubjubPoint,
                     salt_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, bigint>>;
  recoveryConfigCommitment(context: __compactRuntime.CircuitContext<PS>,
                           cfg_0: RecoveryConfig): Promise<__compactRuntime.CircuitResults<PS, bigint>>;
  ownerSetCommitment(context: __compactRuntime.CircuitContext<PS>,
                     owners_0: Owner[],
                     threshold_0: bigint): Promise<__compactRuntime.CircuitResults<PS, bigint>>;
  policyCommitment(context: __compactRuntime.CircuitContext<PS>, p_0: Policy): Promise<__compactRuntime.CircuitResults<PS, bigint>>;
  payoutDigest(context: __compactRuntime.CircuitContext<PS>,
               vault_0: { bytes: Uint8Array },
               network_0: Uint8Array,
               nonce_0: bigint,
               expiry_0: bigint,
               recipient_0: { bytes: Uint8Array },
               amount_0: bigint): Promise<__compactRuntime.CircuitResults<PS, bigint>>;
  delegatePayoutDigest(context: __compactRuntime.CircuitContext<PS>,
                       vault_0: { bytes: Uint8Array },
                       network_0: Uint8Array,
                       slot_0: bigint,
                       delegateNonce_0: bigint,
                       expiry_0: bigint,
                       recipient_0: { bytes: Uint8Array },
                       amount_0: bigint): Promise<__compactRuntime.CircuitResults<PS, bigint>>;
  ownerStatementDigest(context: __compactRuntime.CircuitContext<PS>,
                       domain_0: Uint8Array,
                       vault_0: { bytes: Uint8Array },
                       network_0: Uint8Array,
                       nonce_0: bigint,
                       expiry_0: bigint,
                       subject_0: bigint): Promise<__compactRuntime.CircuitResults<PS, bigint>>;
  buildConstants(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, bigint[]>>;
  deposit(context: __compactRuntime.CircuitContext<PS>, amount_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  execute(context: __compactRuntime.CircuitContext<PS>,
          recipient_0: { bytes: Uint8Array },
          amount_0: bigint,
          expiry_0: bigint,
          approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  delegatePayout(context: __compactRuntime.CircuitContext<PS>,
                 slot_0: bigint,
                 recipient_0: { bytes: Uint8Array },
                 amount_0: bigint,
                 expiry_0: bigint,
                 timeClaim_0: { is_some: boolean, value: bigint },
                 sig_0: { announcement: __compactRuntime.JubjubPoint,
                          response: bigint
                        }): Promise<__compactRuntime.CircuitResults<PS, []>>;
  proposeOwners(context: __compactRuntime.CircuitContext<PS>,
                newOwners_0: Owner[],
                newThreshold_0: bigint,
                notBefore_0: bigint,
                expiry_0: bigint,
                approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  cancelOwners(context: __compactRuntime.CircuitContext<PS>,
               expiry_0: bigint,
               approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  applyOwners(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
  proposePolicy(context: __compactRuntime.CircuitContext<PS>,
                newPolicy_0: Policy,
                notBefore_0: bigint,
                expiry_0: bigint,
                approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  cancelPolicy(context: __compactRuntime.CircuitContext<PS>,
               expiry_0: bigint,
               approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  applyPolicy(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
  narrowPolicy(context: __compactRuntime.CircuitContext<PS>,
               newPolicy_0: Policy,
               expiry_0: bigint,
               approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  proposeRecovery(context: __compactRuntime.CircuitContext<PS>,
                  newOwners_0: Owner[],
                  newThreshold_0: bigint,
                  notBefore_0: bigint,
                  expiry_0: bigint,
                  approvals_0: { is_some: boolean, value: GuardianApproval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  cancelRecovery(context: __compactRuntime.CircuitContext<PS>,
                 at_0: bigint,
                 expiry_0: bigint,
                 approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  withdrawRecovery(context: __compactRuntime.CircuitContext<PS>,
                   at_0: bigint,
                   expiry_0: bigint,
                   approvals_0: { is_some: boolean, value: GuardianApproval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  clearExpiredRecovery(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
  applyRecovery(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
  proposeGuardians(context: __compactRuntime.CircuitContext<PS>,
                   newGuardians_0: GuardianSecret[],
                   newThreshold_0: bigint,
                   newRecoveryDelay_0: bigint,
                   newCooldown_0: bigint,
                   newExpiryWindow_0: bigint,
                   notBefore_0: bigint,
                   expiry_0: bigint,
                   approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  cancelGuardians(context: __compactRuntime.CircuitContext<PS>,
                  expiry_0: bigint,
                  approvals_0: { is_some: boolean, value: Approval }[]): Promise<__compactRuntime.CircuitResults<PS, []>>;
  applyGuardians(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type Ledger = {
  readonly owners: Owner[];
  readonly threshold: bigint;
  readonly nonce: bigint;
  readonly network: Uint8Array;
  readonly delay: bigint;
  readonly pendingOwners: PendingOwners;
  readonly policy: Policy;
  readonly pendingPolicy: PendingPolicy;
  delegateWindow: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): Window;
    [Symbol.iterator](): Iterator<[bigint, Window]>
  };
  delegateNonce: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): bigint;
    [Symbol.iterator](): Iterator<[bigint, bigint]>
  };
  readonly recovery: RecoveryConfig;
  readonly pendingGuardians: PendingGuardians;
  readonly pendingRecovery: PendingRecovery;
  readonly recoveryNonce: bigint;
  readonly cooldownUntil: bigint;
}

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               initialOwners_0: Owner[],
               initialThreshold_0: bigint,
               networkTag_0: Uint8Array,
               changeDelay_0: bigint,
               whitelistEnabled_0: boolean,
               whitelist_0: WlEntry[],
               guardians_0: GuardianSecret[],
               guardianThreshold_0: bigint,
               recoveryDelay_0: bigint,
               cooldown_0: bigint,
               expiryWindow_0: bigint): Promise<__compactRuntime.ConstructorResult<PS>>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
export declare const expectedVk: Record<string, string>;
export declare const circuitSignatures: __compactRuntime.CircuitSignatures;
export declare const declaredInterfaces: __compactRuntime.DeclaredInterfaces;
