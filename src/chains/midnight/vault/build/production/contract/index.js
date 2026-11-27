import * as __compactRuntime from '@midnight-ntwrk/compact-runtime';
__compactRuntime.checkRuntimeVersion('0.21.0');

export var Scope;
(function (Scope) {
  Scope[Scope['QuorumOnly'] = 0] = 'QuorumOnly';
  Scope[Scope['Any'] = 1] = 'Any';
})(Scope || (Scope = {}));

const _descriptor_0 = __compactRuntime.CompactTypeBoolean;

const _descriptor_1 = __compactRuntime.CompactTypeField;

const _descriptor_2 = new __compactRuntime.CompactTypeVector(5, _descriptor_1);

const _descriptor_3 = new __compactRuntime.CompactTypeUnsignedInteger(255n, 1);

const _descriptor_4 = new __compactRuntime.CompactTypeUnsignedInteger(18446744073709551615n, 8);

class _RecoveryConfig_0 {
  alignment() {
    return _descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_4.alignment().concat(_descriptor_4.alignment()))));
  }
  fromValue(value_0) {
    return {
      guardians: _descriptor_2.fromValue(value_0),
      threshold: _descriptor_3.fromValue(value_0),
      recoveryDelay: _descriptor_4.fromValue(value_0),
      cooldown: _descriptor_4.fromValue(value_0),
      expiryWindow: _descriptor_4.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_2.toValue(value_0.guardians).concat(_descriptor_3.toValue(value_0.threshold).concat(_descriptor_4.toValue(value_0.recoveryDelay).concat(_descriptor_4.toValue(value_0.cooldown).concat(_descriptor_4.toValue(value_0.expiryWindow)))));
  }
}

const _descriptor_5 = new _RecoveryConfig_0();

class _PendingGuardians_0 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_5.alignment().concat(_descriptor_4.alignment()));
  }
  fromValue(value_0) {
    return {
      active: _descriptor_0.fromValue(value_0),
      config: _descriptor_5.fromValue(value_0),
      executableAfter: _descriptor_4.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.active).concat(_descriptor_5.toValue(value_0.config).concat(_descriptor_4.toValue(value_0.executableAfter)));
  }
}

const _descriptor_6 = new _PendingGuardians_0();

const _descriptor_7 = new __compactRuntime.CompactTypeBytes(32);

class _ContractAddress_0 {
  alignment() {
    return _descriptor_7.alignment();
  }
  fromValue(value_0) {
    return {
      bytes: _descriptor_7.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_7.toValue(value_0.bytes);
  }
}

const _descriptor_8 = new _ContractAddress_0();

const _descriptor_9 = new __compactRuntime.CompactTypeUnsignedInteger(65535n, 2);

const _descriptor_10 = __compactRuntime.CompactTypeJubjubPoint;

class _JubjubSchnorrSignature_0 {
  alignment() {
    return _descriptor_10.alignment().concat(_descriptor_1.alignment());
  }
  fromValue(value_0) {
    return {
      announcement: _descriptor_10.fromValue(value_0),
      response: _descriptor_1.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_10.toValue(value_0.announcement).concat(_descriptor_1.toValue(value_0.response));
  }
}

const _descriptor_11 = new _JubjubSchnorrSignature_0();

class _Approval_0 {
  alignment() {
    return _descriptor_10.alignment().concat(_descriptor_11.alignment());
  }
  fromValue(value_0) {
    return {
      signer: _descriptor_10.fromValue(value_0),
      sig: _descriptor_11.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_10.toValue(value_0.signer).concat(_descriptor_11.toValue(value_0.sig));
  }
}

const _descriptor_12 = new _Approval_0();

class _Maybe_0 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_12.alignment());
  }
  fromValue(value_0) {
    return {
      is_some: _descriptor_0.fromValue(value_0),
      value: _descriptor_12.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.is_some).concat(_descriptor_12.toValue(value_0.value));
  }
}

const _descriptor_13 = new _Maybe_0();

const _descriptor_14 = new __compactRuntime.CompactTypeVector(5, _descriptor_13);

class _Owner_0 {
  alignment() {
    return _descriptor_10.alignment().concat(_descriptor_7.alignment());
  }
  fromValue(value_0) {
    return {
      approvalKey: _descriptor_10.fromValue(value_0),
      upgradeKey: _descriptor_7.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_10.toValue(value_0.approvalKey).concat(_descriptor_7.toValue(value_0.upgradeKey));
  }
}

const _descriptor_15 = new _Owner_0();

const _descriptor_16 = new __compactRuntime.CompactTypeVector(5, _descriptor_15);

class _PendingOwners_0 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_16.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment())));
  }
  fromValue(value_0) {
    return {
      active: _descriptor_0.fromValue(value_0),
      owners: _descriptor_16.fromValue(value_0),
      threshold: _descriptor_3.fromValue(value_0),
      executableAfter: _descriptor_4.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.active).concat(_descriptor_16.toValue(value_0.owners).concat(_descriptor_3.toValue(value_0.threshold).concat(_descriptor_4.toValue(value_0.executableAfter))));
  }
}

const _descriptor_17 = new _PendingOwners_0();

const _descriptor_18 = new __compactRuntime.CompactTypeEnum(1, 1);

class _WlEntry_0 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_7.alignment().concat(_descriptor_18.alignment()));
  }
  fromValue(value_0) {
    return {
      active: _descriptor_0.fromValue(value_0),
      recipient: _descriptor_7.fromValue(value_0),
      scope: _descriptor_18.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.active).concat(_descriptor_7.toValue(value_0.recipient).concat(_descriptor_18.toValue(value_0.scope)));
  }
}

const _descriptor_19 = new _WlEntry_0();

const _descriptor_20 = new __compactRuntime.CompactTypeVector(8, _descriptor_19);

const _descriptor_21 = new __compactRuntime.CompactTypeUnsignedInteger(340282366920938463463374607431768211455n, 16);

class _DelegatePolicy_0 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_10.alignment().concat(_descriptor_21.alignment().concat(_descriptor_4.alignment())));
  }
  fromValue(value_0) {
    return {
      active: _descriptor_0.fromValue(value_0),
      key: _descriptor_10.fromValue(value_0),
      cap: _descriptor_21.fromValue(value_0),
      period: _descriptor_4.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.active).concat(_descriptor_10.toValue(value_0.key).concat(_descriptor_21.toValue(value_0.cap).concat(_descriptor_4.toValue(value_0.period))));
  }
}

const _descriptor_22 = new _DelegatePolicy_0();

const _descriptor_23 = new __compactRuntime.CompactTypeVector(2, _descriptor_22);

class _Policy_0 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_20.alignment().concat(_descriptor_23.alignment()));
  }
  fromValue(value_0) {
    return {
      whitelistEnabled: _descriptor_0.fromValue(value_0),
      whitelist: _descriptor_20.fromValue(value_0),
      delegates: _descriptor_23.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.whitelistEnabled).concat(_descriptor_20.toValue(value_0.whitelist).concat(_descriptor_23.toValue(value_0.delegates)));
  }
}

const _descriptor_24 = new _Policy_0();

class _PendingPolicy_0 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_24.alignment().concat(_descriptor_4.alignment()));
  }
  fromValue(value_0) {
    return {
      active: _descriptor_0.fromValue(value_0),
      policy: _descriptor_24.fromValue(value_0),
      executableAfter: _descriptor_4.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.active).concat(_descriptor_24.toValue(value_0.policy).concat(_descriptor_4.toValue(value_0.executableAfter)));
  }
}

const _descriptor_25 = new _PendingPolicy_0();

const _descriptor_26 = new __compactRuntime.CompactTypeVector(5, _descriptor_0);

class _PendingRecovery_0 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_16.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_4.alignment().concat(_descriptor_26.alignment())))));
  }
  fromValue(value_0) {
    return {
      active: _descriptor_0.fromValue(value_0),
      owners: _descriptor_16.fromValue(value_0),
      threshold: _descriptor_3.fromValue(value_0),
      executableAfter: _descriptor_4.fromValue(value_0),
      expiresAfter: _descriptor_4.fromValue(value_0),
      approvedBy: _descriptor_26.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.active).concat(_descriptor_16.toValue(value_0.owners).concat(_descriptor_3.toValue(value_0.threshold).concat(_descriptor_4.toValue(value_0.executableAfter).concat(_descriptor_4.toValue(value_0.expiresAfter).concat(_descriptor_26.toValue(value_0.approvedBy))))));
  }
}

const _descriptor_27 = new _PendingRecovery_0();

class _GuardianSecret_0 {
  alignment() {
    return _descriptor_10.alignment().concat(_descriptor_7.alignment());
  }
  fromValue(value_0) {
    return {
      key: _descriptor_10.fromValue(value_0),
      salt: _descriptor_7.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_10.toValue(value_0.key).concat(_descriptor_7.toValue(value_0.salt));
  }
}

const _descriptor_28 = new _GuardianSecret_0();

const _descriptor_29 = new __compactRuntime.CompactTypeVector(5, _descriptor_28);

class _GuardianApproval_0 {
  alignment() {
    return _descriptor_10.alignment().concat(_descriptor_7.alignment().concat(_descriptor_11.alignment()));
  }
  fromValue(value_0) {
    return {
      key: _descriptor_10.fromValue(value_0),
      salt: _descriptor_7.fromValue(value_0),
      sig: _descriptor_11.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_10.toValue(value_0.key).concat(_descriptor_7.toValue(value_0.salt).concat(_descriptor_11.toValue(value_0.sig)));
  }
}

const _descriptor_30 = new _GuardianApproval_0();

class _Maybe_1 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_30.alignment());
  }
  fromValue(value_0) {
    return {
      is_some: _descriptor_0.fromValue(value_0),
      value: _descriptor_30.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.is_some).concat(_descriptor_30.toValue(value_0.value));
  }
}

const _descriptor_31 = new _Maybe_1();

const _descriptor_32 = new __compactRuntime.CompactTypeVector(5, _descriptor_31);

class _Window_0 {
  alignment() {
    return _descriptor_4.alignment().concat(_descriptor_21.alignment());
  }
  fromValue(value_0) {
    return {
      start: _descriptor_4.fromValue(value_0),
      spent: _descriptor_21.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_4.toValue(value_0.start).concat(_descriptor_21.toValue(value_0.spent));
  }
}

const _descriptor_33 = new _Window_0();

class _UserAddress_0 {
  alignment() {
    return _descriptor_7.alignment();
  }
  fromValue(value_0) {
    return {
      bytes: _descriptor_7.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_7.toValue(value_0.bytes);
  }
}

const _descriptor_34 = new _UserAddress_0();

class _Maybe_2 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_4.alignment());
  }
  fromValue(value_0) {
    return {
      is_some: _descriptor_0.fromValue(value_0),
      value: _descriptor_4.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.is_some).concat(_descriptor_4.toValue(value_0.value));
  }
}

const _descriptor_35 = new _Maybe_2();

const _descriptor_36 = new __compactRuntime.CompactTypeVector(3, _descriptor_4);

const _descriptor_37 = __compactRuntime.CompactTypeJubjubScalar;

const _descriptor_38 = new __compactRuntime.CompactTypeVector(8, _descriptor_7);

const _descriptor_39 = new __compactRuntime.CompactTypeVector(6, _descriptor_7);

class _RecoveryConfigPreimage_0 {
  alignment() {
    return _descriptor_7.alignment().concat(_descriptor_5.alignment());
  }
  fromValue(value_0) {
    return {
      domain: _descriptor_7.fromValue(value_0),
      cfg: _descriptor_5.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_7.toValue(value_0.domain).concat(_descriptor_5.toValue(value_0.cfg));
  }
}

const _descriptor_40 = new _RecoveryConfigPreimage_0();

const _descriptor_41 = new __compactRuntime.CompactTypeVector(7, _descriptor_7);

class _DelegateWords_0 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_21.alignment().concat(_descriptor_4.alignment()))));
  }
  fromValue(value_0) {
    return {
      active: _descriptor_0.fromValue(value_0),
      kx: _descriptor_1.fromValue(value_0),
      ky: _descriptor_1.fromValue(value_0),
      cap: _descriptor_21.fromValue(value_0),
      period: _descriptor_4.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.active).concat(_descriptor_1.toValue(value_0.kx).concat(_descriptor_1.toValue(value_0.ky).concat(_descriptor_21.toValue(value_0.cap).concat(_descriptor_4.toValue(value_0.period)))));
  }
}

const _descriptor_42 = new _DelegateWords_0();

const _descriptor_43 = new __compactRuntime.CompactTypeVector(2, _descriptor_42);

class _PolicyPreimage_0 {
  alignment() {
    return _descriptor_7.alignment().concat(_descriptor_0.alignment().concat(_descriptor_20.alignment().concat(_descriptor_43.alignment())));
  }
  fromValue(value_0) {
    return {
      domain: _descriptor_7.fromValue(value_0),
      whitelistEnabled: _descriptor_0.fromValue(value_0),
      whitelist: _descriptor_20.fromValue(value_0),
      delegates: _descriptor_43.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_7.toValue(value_0.domain).concat(_descriptor_0.toValue(value_0.whitelistEnabled).concat(_descriptor_20.toValue(value_0.whitelist).concat(_descriptor_43.toValue(value_0.delegates))));
  }
}

const _descriptor_44 = new _PolicyPreimage_0();

class _GuardianPreimage_0 {
  alignment() {
    return _descriptor_7.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_7.alignment())));
  }
  fromValue(value_0) {
    return {
      domain: _descriptor_7.fromValue(value_0),
      kx: _descriptor_1.fromValue(value_0),
      ky: _descriptor_1.fromValue(value_0),
      salt: _descriptor_7.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_7.toValue(value_0.domain).concat(_descriptor_1.toValue(value_0.kx).concat(_descriptor_1.toValue(value_0.ky).concat(_descriptor_7.toValue(value_0.salt))));
  }
}

const _descriptor_45 = new _GuardianPreimage_0();

const _descriptor_46 = new __compactRuntime.CompactTypeVector(1, _descriptor_1);

class _JubjubSchnorrHashInput_0 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_46.alignment()))));
  }
  fromValue(value_0) {
    return {
      annX: _descriptor_1.fromValue(value_0),
      annY: _descriptor_1.fromValue(value_0),
      pkX: _descriptor_1.fromValue(value_0),
      pkY: _descriptor_1.fromValue(value_0),
      msg: _descriptor_46.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0.annX).concat(_descriptor_1.toValue(value_0.annY).concat(_descriptor_1.toValue(value_0.pkX).concat(_descriptor_1.toValue(value_0.pkY).concat(_descriptor_46.toValue(value_0.msg)))));
  }
}

const _descriptor_47 = new _JubjubSchnorrHashInput_0();

class _OwnerWords_0 {
  alignment() {
    return _descriptor_1.alignment().concat(_descriptor_1.alignment().concat(_descriptor_7.alignment()));
  }
  fromValue(value_0) {
    return {
      ax: _descriptor_1.fromValue(value_0),
      ay: _descriptor_1.fromValue(value_0),
      upgradeKey: _descriptor_7.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_1.toValue(value_0.ax).concat(_descriptor_1.toValue(value_0.ay).concat(_descriptor_7.toValue(value_0.upgradeKey)));
  }
}

const _descriptor_48 = new _OwnerWords_0();

const _descriptor_49 = new __compactRuntime.CompactTypeVector(5, _descriptor_48);

class _OwnerSetPreimage_0 {
  alignment() {
    return _descriptor_7.alignment().concat(_descriptor_49.alignment().concat(_descriptor_3.alignment()));
  }
  fromValue(value_0) {
    return {
      domain: _descriptor_7.fromValue(value_0),
      owners: _descriptor_49.fromValue(value_0),
      threshold: _descriptor_3.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_7.toValue(value_0.domain).concat(_descriptor_49.toValue(value_0.owners).concat(_descriptor_3.toValue(value_0.threshold)));
  }
}

const _descriptor_50 = new _OwnerSetPreimage_0();

class _Either_0 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_7.alignment().concat(_descriptor_7.alignment()));
  }
  fromValue(value_0) {
    return {
      is_left: _descriptor_0.fromValue(value_0),
      left: _descriptor_7.fromValue(value_0),
      right: _descriptor_7.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.is_left).concat(_descriptor_7.toValue(value_0.left).concat(_descriptor_7.toValue(value_0.right)));
  }
}

const _descriptor_51 = new _Either_0();

class _Either_1 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_8.alignment().concat(_descriptor_34.alignment()));
  }
  fromValue(value_0) {
    return {
      is_left: _descriptor_0.fromValue(value_0),
      left: _descriptor_8.fromValue(value_0),
      right: _descriptor_34.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.is_left).concat(_descriptor_8.toValue(value_0.left).concat(_descriptor_34.toValue(value_0.right)));
  }
}

const _descriptor_52 = new _Either_1();

class _Maybe_3 {
  alignment() {
    return _descriptor_0.alignment().concat(_descriptor_52.alignment());
  }
  fromValue(value_0) {
    return {
      is_some: _descriptor_0.fromValue(value_0),
      value: _descriptor_52.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_0.toValue(value_0.is_some).concat(_descriptor_52.toValue(value_0.value));
  }
}

const _descriptor_53 = new _Maybe_3();

const _descriptor_54 = new __compactRuntime.CompactTypeUnsignedInteger(4294967295n, 4);

export class Contract {
  witnesses;
  constructor(...args_0) {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`Contract constructor: expected 1 argument, received ${args_0.length}`);
    }
    const witnesses_0 = args_0[0];
    if (typeof(witnesses_0) !== 'object') {
      throw new __compactRuntime.CompactError('first (witnesses) argument to Contract constructor is not an object');
    }
    this.witnesses = witnesses_0;
    this.circuits = {
      async guardianCommitment(context, ...args_1) {
        return { result: pureCircuits.guardianCommitment(...args_1), context };
      },
      async recoveryConfigCommitment(context, ...args_1) {
        return { result: pureCircuits.recoveryConfigCommitment(...args_1), context };
      },
      async ownerSetCommitment(context, ...args_1) {
        return { result: pureCircuits.ownerSetCommitment(...args_1), context };
      },
      async policyCommitment(context, ...args_1) {
        return { result: pureCircuits.policyCommitment(...args_1), context };
      },
      async payoutDigest(context, ...args_1) {
        return { result: pureCircuits.payoutDigest(...args_1), context };
      },
      async delegatePayoutDigest(context, ...args_1) {
        return { result: pureCircuits.delegatePayoutDigest(...args_1), context };
      },
      async ownerStatementDigest(context, ...args_1) {
        return { result: pureCircuits.ownerStatementDigest(...args_1), context };
      },
      async buildConstants(context, ...args_1) {
        return { result: pureCircuits.buildConstants(...args_1), context };
      },
      deposit: async (...args_1) => {
        if (args_1.length !== 2) {
          throw new __compactRuntime.CompactError(`deposit: expected 2 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const amount_0 = args_1[1];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('deposit',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 320 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('deposit',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'VaultCore.compact line 320 char 3',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_21.toValue(amount_0),
            alignment: _descriptor_21.alignment()
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._deposit_0(context,
                                               partialProofData,
                                               amount_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      execute: async (...args_1) => {
        if (args_1.length !== 5) {
          throw new __compactRuntime.CompactError(`execute: expected 5 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const recipient_0 = args_1[1];
        const amount_0 = args_1[2];
        const expiry_0 = args_1[3];
        const approvals_0 = args_1[4];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('execute',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 326 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
          __compactRuntime.typeError('execute',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'VaultCore.compact line 326 char 3',
                                     'struct UserAddress<bytes: Bytes<32>>',
                                     recipient_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('execute',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'VaultCore.compact line 326 char 3',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('execute',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'VaultCore.compact line 326 char 3',
                                     'Uint<0..18446744073709551616>',
                                     expiry_0)
        }
        if (!(Array.isArray(approvals_0) && approvals_0.length === 5 && approvals_0.every((t) => typeof(t) === 'object' && typeof(t.is_some) === 'boolean' && typeof(t.value) === 'object' && typeof(t.value.signer.x) === 'bigint' && t.value.signer.x >= 0n && t.value.signer.x <= __compactRuntime.MAX_FIELD && typeof(t.value.signer.y) === 'bigint' && t.value.signer.y >= 0n && t.value.signer.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig) === 'object' && typeof(t.value.sig.announcement.x) === 'bigint' && t.value.sig.announcement.x >= 0n && t.value.sig.announcement.x <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.announcement.y) === 'bigint' && t.value.sig.announcement.y >= 0n && t.value.sig.announcement.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.response) === 'bigint' && t.value.sig.response >= 0 && t.value.sig.response <= __compactRuntime.MAX_FIELD))) {
          __compactRuntime.typeError('execute',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'VaultCore.compact line 326 char 3',
                                     'Vector<5, struct Maybe<is_some: Boolean, value: struct Approval<signer: JubjubPoint, sig: struct JubjubSchnorrSignature<announcement: JubjubPoint, response: Field>>>>',
                                     approvals_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_34.toValue(recipient_0).concat(_descriptor_21.toValue(amount_0).concat(_descriptor_4.toValue(expiry_0).concat(_descriptor_14.toValue(approvals_0)))),
            alignment: _descriptor_34.alignment().concat(_descriptor_21.alignment().concat(_descriptor_4.alignment().concat(_descriptor_14.alignment())))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._execute_0(context,
                                               partialProofData,
                                               recipient_0,
                                               amount_0,
                                               expiry_0,
                                               approvals_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      delegatePayout: async (...args_1) => {
        if (args_1.length !== 7) {
          throw new __compactRuntime.CompactError(`delegatePayout: expected 7 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const slot_0 = args_1[1];
        const recipient_0 = args_1[2];
        const amount_0 = args_1[3];
        const expiry_0 = args_1[4];
        const timeClaim_0 = args_1[5];
        const sig_0 = args_1[6];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('delegatePayout',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 347 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(slot_0) === 'bigint' && slot_0 >= 0n && slot_0 <= 255n)) {
          __compactRuntime.typeError('delegatePayout',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'VaultCore.compact line 347 char 3',
                                     'Uint<0..256>',
                                     slot_0)
        }
        if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
          __compactRuntime.typeError('delegatePayout',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'VaultCore.compact line 347 char 3',
                                     'struct UserAddress<bytes: Bytes<32>>',
                                     recipient_0)
        }
        if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
          __compactRuntime.typeError('delegatePayout',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'VaultCore.compact line 347 char 3',
                                     'Uint<0..340282366920938463463374607431768211456>',
                                     amount_0)
        }
        if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('delegatePayout',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'VaultCore.compact line 347 char 3',
                                     'Uint<0..18446744073709551616>',
                                     expiry_0)
        }
        if (!(typeof(timeClaim_0) === 'object' && typeof(timeClaim_0.is_some) === 'boolean' && typeof(timeClaim_0.value) === 'bigint' && timeClaim_0.value >= 0n && timeClaim_0.value <= 18446744073709551615n)) {
          __compactRuntime.typeError('delegatePayout',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'VaultCore.compact line 347 char 3',
                                     'struct Maybe<is_some: Boolean, value: Uint<0..18446744073709551616>>',
                                     timeClaim_0)
        }
        if (!(typeof(sig_0) === 'object' && typeof(sig_0.announcement.x) === 'bigint' && sig_0.announcement.x >= 0n && sig_0.announcement.x <= __compactRuntime.MAX_FIELD && typeof(sig_0.announcement.y) === 'bigint' && sig_0.announcement.y >= 0n && sig_0.announcement.y <= __compactRuntime.MAX_FIELD && typeof(sig_0.response) === 'bigint' && sig_0.response >= 0 && sig_0.response <= __compactRuntime.MAX_FIELD)) {
          __compactRuntime.typeError('delegatePayout',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'VaultCore.compact line 347 char 3',
                                     'struct JubjubSchnorrSignature<announcement: JubjubPoint, response: Field>',
                                     sig_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_3.toValue(slot_0).concat(_descriptor_34.toValue(recipient_0).concat(_descriptor_21.toValue(amount_0).concat(_descriptor_4.toValue(expiry_0).concat(_descriptor_35.toValue(timeClaim_0).concat(_descriptor_11.toValue(sig_0)))))),
            alignment: _descriptor_3.alignment().concat(_descriptor_34.alignment().concat(_descriptor_21.alignment().concat(_descriptor_4.alignment().concat(_descriptor_35.alignment().concat(_descriptor_11.alignment())))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._delegatePayout_0(context,
                                                      partialProofData,
                                                      slot_0,
                                                      recipient_0,
                                                      amount_0,
                                                      expiry_0,
                                                      timeClaim_0,
                                                      sig_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      proposeOwners: async (...args_1) => {
        if (args_1.length !== 6) {
          throw new __compactRuntime.CompactError(`proposeOwners: expected 6 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const newOwners_0 = args_1[1];
        const newThreshold_0 = args_1[2];
        const notBefore_0 = args_1[3];
        const expiry_0 = args_1[4];
        const approvals_0 = args_1[5];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('proposeOwners',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 382 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(Array.isArray(newOwners_0) && newOwners_0.length === 5 && newOwners_0.every((t) => typeof(t) === 'object' && typeof(t.approvalKey.x) === 'bigint' && t.approvalKey.x >= 0n && t.approvalKey.x <= __compactRuntime.MAX_FIELD && typeof(t.approvalKey.y) === 'bigint' && t.approvalKey.y >= 0n && t.approvalKey.y <= __compactRuntime.MAX_FIELD && t.upgradeKey.buffer instanceof ArrayBuffer && t.upgradeKey.BYTES_PER_ELEMENT === 1 && t.upgradeKey.length === 32))) {
          __compactRuntime.typeError('proposeOwners',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'VaultCore.compact line 382 char 3',
                                     'Vector<5, struct Owner<approvalKey: JubjubPoint, upgradeKey: Bytes<32>>>',
                                     newOwners_0)
        }
        if (!(typeof(newThreshold_0) === 'bigint' && newThreshold_0 >= 0n && newThreshold_0 <= 255n)) {
          __compactRuntime.typeError('proposeOwners',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'VaultCore.compact line 382 char 3',
                                     'Uint<0..256>',
                                     newThreshold_0)
        }
        if (!(typeof(notBefore_0) === 'bigint' && notBefore_0 >= 0n && notBefore_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('proposeOwners',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'VaultCore.compact line 382 char 3',
                                     'Uint<0..18446744073709551616>',
                                     notBefore_0)
        }
        if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('proposeOwners',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'VaultCore.compact line 382 char 3',
                                     'Uint<0..18446744073709551616>',
                                     expiry_0)
        }
        if (!(Array.isArray(approvals_0) && approvals_0.length === 5 && approvals_0.every((t) => typeof(t) === 'object' && typeof(t.is_some) === 'boolean' && typeof(t.value) === 'object' && typeof(t.value.signer.x) === 'bigint' && t.value.signer.x >= 0n && t.value.signer.x <= __compactRuntime.MAX_FIELD && typeof(t.value.signer.y) === 'bigint' && t.value.signer.y >= 0n && t.value.signer.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig) === 'object' && typeof(t.value.sig.announcement.x) === 'bigint' && t.value.sig.announcement.x >= 0n && t.value.sig.announcement.x <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.announcement.y) === 'bigint' && t.value.sig.announcement.y >= 0n && t.value.sig.announcement.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.response) === 'bigint' && t.value.sig.response >= 0 && t.value.sig.response <= __compactRuntime.MAX_FIELD))) {
          __compactRuntime.typeError('proposeOwners',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'VaultCore.compact line 382 char 3',
                                     'Vector<5, struct Maybe<is_some: Boolean, value: struct Approval<signer: JubjubPoint, sig: struct JubjubSchnorrSignature<announcement: JubjubPoint, response: Field>>>>',
                                     approvals_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_16.toValue(newOwners_0).concat(_descriptor_3.toValue(newThreshold_0).concat(_descriptor_4.toValue(notBefore_0).concat(_descriptor_4.toValue(expiry_0).concat(_descriptor_14.toValue(approvals_0))))),
            alignment: _descriptor_16.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_4.alignment().concat(_descriptor_14.alignment()))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._proposeOwners_0(context,
                                                     partialProofData,
                                                     newOwners_0,
                                                     newThreshold_0,
                                                     notBefore_0,
                                                     expiry_0,
                                                     approvals_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      cancelOwners: async (...args_1) => {
        if (args_1.length !== 3) {
          throw new __compactRuntime.CompactError(`cancelOwners: expected 3 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const expiry_0 = args_1[1];
        const approvals_0 = args_1[2];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('cancelOwners',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 400 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('cancelOwners',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'VaultCore.compact line 400 char 3',
                                     'Uint<0..18446744073709551616>',
                                     expiry_0)
        }
        if (!(Array.isArray(approvals_0) && approvals_0.length === 5 && approvals_0.every((t) => typeof(t) === 'object' && typeof(t.is_some) === 'boolean' && typeof(t.value) === 'object' && typeof(t.value.signer.x) === 'bigint' && t.value.signer.x >= 0n && t.value.signer.x <= __compactRuntime.MAX_FIELD && typeof(t.value.signer.y) === 'bigint' && t.value.signer.y >= 0n && t.value.signer.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig) === 'object' && typeof(t.value.sig.announcement.x) === 'bigint' && t.value.sig.announcement.x >= 0n && t.value.sig.announcement.x <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.announcement.y) === 'bigint' && t.value.sig.announcement.y >= 0n && t.value.sig.announcement.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.response) === 'bigint' && t.value.sig.response >= 0 && t.value.sig.response <= __compactRuntime.MAX_FIELD))) {
          __compactRuntime.typeError('cancelOwners',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'VaultCore.compact line 400 char 3',
                                     'Vector<5, struct Maybe<is_some: Boolean, value: struct Approval<signer: JubjubPoint, sig: struct JubjubSchnorrSignature<announcement: JubjubPoint, response: Field>>>>',
                                     approvals_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_4.toValue(expiry_0).concat(_descriptor_14.toValue(approvals_0)),
            alignment: _descriptor_4.alignment().concat(_descriptor_14.alignment())
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._cancelOwners_0(context,
                                                    partialProofData,
                                                    expiry_0,
                                                    approvals_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      applyOwners: async (...args_1) => {
        if (args_1.length !== 1) {
          throw new __compactRuntime.CompactError(`applyOwners: expected 1 argument (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('applyOwners',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 412 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: { value: [], alignment: [] },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._applyOwners_0(context, partialProofData);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      proposePolicy: async (...args_1) => {
        if (args_1.length !== 5) {
          throw new __compactRuntime.CompactError(`proposePolicy: expected 5 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const newPolicy_0 = args_1[1];
        const notBefore_0 = args_1[2];
        const expiry_0 = args_1[3];
        const approvals_0 = args_1[4];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('proposePolicy',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 442 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(newPolicy_0) === 'object' && typeof(newPolicy_0.whitelistEnabled) === 'boolean' && Array.isArray(newPolicy_0.whitelist) && newPolicy_0.whitelist.length === 8 && newPolicy_0.whitelist.every((t) => typeof(t) === 'object' && typeof(t.active) === 'boolean' && t.recipient.buffer instanceof ArrayBuffer && t.recipient.BYTES_PER_ELEMENT === 1 && t.recipient.length === 32 && typeof(t.scope) === 'number' && t.scope >= 0 && t.scope <= 1) && Array.isArray(newPolicy_0.delegates) && newPolicy_0.delegates.length === 2 && newPolicy_0.delegates.every((t) => typeof(t) === 'object' && typeof(t.active) === 'boolean' && typeof(t.key.x) === 'bigint' && t.key.x >= 0n && t.key.x <= __compactRuntime.MAX_FIELD && typeof(t.key.y) === 'bigint' && t.key.y >= 0n && t.key.y <= __compactRuntime.MAX_FIELD && typeof(t.cap) === 'bigint' && t.cap >= 0n && t.cap <= 340282366920938463463374607431768211455n && typeof(t.period) === 'bigint' && t.period >= 0n && t.period <= 18446744073709551615n))) {
          __compactRuntime.typeError('proposePolicy',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'VaultCore.compact line 442 char 3',
                                     'struct Policy<whitelistEnabled: Boolean, whitelist: Vector<8, struct WlEntry<active: Boolean, recipient: Bytes<32>, scope: Enum<Scope, QuorumOnly, Any>>>, delegates: Vector<2, struct DelegatePolicy<active: Boolean, key: JubjubPoint, cap: Uint<0..340282366920938463463374607431768211456>, period: Uint<0..18446744073709551616>>>>',
                                     newPolicy_0)
        }
        if (!(typeof(notBefore_0) === 'bigint' && notBefore_0 >= 0n && notBefore_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('proposePolicy',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'VaultCore.compact line 442 char 3',
                                     'Uint<0..18446744073709551616>',
                                     notBefore_0)
        }
        if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('proposePolicy',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'VaultCore.compact line 442 char 3',
                                     'Uint<0..18446744073709551616>',
                                     expiry_0)
        }
        if (!(Array.isArray(approvals_0) && approvals_0.length === 5 && approvals_0.every((t) => typeof(t) === 'object' && typeof(t.is_some) === 'boolean' && typeof(t.value) === 'object' && typeof(t.value.signer.x) === 'bigint' && t.value.signer.x >= 0n && t.value.signer.x <= __compactRuntime.MAX_FIELD && typeof(t.value.signer.y) === 'bigint' && t.value.signer.y >= 0n && t.value.signer.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig) === 'object' && typeof(t.value.sig.announcement.x) === 'bigint' && t.value.sig.announcement.x >= 0n && t.value.sig.announcement.x <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.announcement.y) === 'bigint' && t.value.sig.announcement.y >= 0n && t.value.sig.announcement.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.response) === 'bigint' && t.value.sig.response >= 0 && t.value.sig.response <= __compactRuntime.MAX_FIELD))) {
          __compactRuntime.typeError('proposePolicy',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'VaultCore.compact line 442 char 3',
                                     'Vector<5, struct Maybe<is_some: Boolean, value: struct Approval<signer: JubjubPoint, sig: struct JubjubSchnorrSignature<announcement: JubjubPoint, response: Field>>>>',
                                     approvals_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_24.toValue(newPolicy_0).concat(_descriptor_4.toValue(notBefore_0).concat(_descriptor_4.toValue(expiry_0).concat(_descriptor_14.toValue(approvals_0)))),
            alignment: _descriptor_24.alignment().concat(_descriptor_4.alignment().concat(_descriptor_4.alignment().concat(_descriptor_14.alignment())))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._proposePolicy_0(context,
                                                     partialProofData,
                                                     newPolicy_0,
                                                     notBefore_0,
                                                     expiry_0,
                                                     approvals_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      cancelPolicy: async (...args_1) => {
        if (args_1.length !== 3) {
          throw new __compactRuntime.CompactError(`cancelPolicy: expected 3 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const expiry_0 = args_1[1];
        const approvals_0 = args_1[2];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('cancelPolicy',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 457 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('cancelPolicy',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'VaultCore.compact line 457 char 3',
                                     'Uint<0..18446744073709551616>',
                                     expiry_0)
        }
        if (!(Array.isArray(approvals_0) && approvals_0.length === 5 && approvals_0.every((t) => typeof(t) === 'object' && typeof(t.is_some) === 'boolean' && typeof(t.value) === 'object' && typeof(t.value.signer.x) === 'bigint' && t.value.signer.x >= 0n && t.value.signer.x <= __compactRuntime.MAX_FIELD && typeof(t.value.signer.y) === 'bigint' && t.value.signer.y >= 0n && t.value.signer.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig) === 'object' && typeof(t.value.sig.announcement.x) === 'bigint' && t.value.sig.announcement.x >= 0n && t.value.sig.announcement.x <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.announcement.y) === 'bigint' && t.value.sig.announcement.y >= 0n && t.value.sig.announcement.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.response) === 'bigint' && t.value.sig.response >= 0 && t.value.sig.response <= __compactRuntime.MAX_FIELD))) {
          __compactRuntime.typeError('cancelPolicy',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'VaultCore.compact line 457 char 3',
                                     'Vector<5, struct Maybe<is_some: Boolean, value: struct Approval<signer: JubjubPoint, sig: struct JubjubSchnorrSignature<announcement: JubjubPoint, response: Field>>>>',
                                     approvals_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_4.toValue(expiry_0).concat(_descriptor_14.toValue(approvals_0)),
            alignment: _descriptor_4.alignment().concat(_descriptor_14.alignment())
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._cancelPolicy_0(context,
                                                    partialProofData,
                                                    expiry_0,
                                                    approvals_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      applyPolicy: async (...args_1) => {
        if (args_1.length !== 1) {
          throw new __compactRuntime.CompactError(`applyPolicy: expected 1 argument (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('applyPolicy',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 472 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: { value: [], alignment: [] },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._applyPolicy_0(context, partialProofData);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      narrowPolicy: async (...args_1) => {
        if (args_1.length !== 4) {
          throw new __compactRuntime.CompactError(`narrowPolicy: expected 4 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const newPolicy_0 = args_1[1];
        const expiry_0 = args_1[2];
        const approvals_0 = args_1[3];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('narrowPolicy',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 492 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(newPolicy_0) === 'object' && typeof(newPolicy_0.whitelistEnabled) === 'boolean' && Array.isArray(newPolicy_0.whitelist) && newPolicy_0.whitelist.length === 8 && newPolicy_0.whitelist.every((t) => typeof(t) === 'object' && typeof(t.active) === 'boolean' && t.recipient.buffer instanceof ArrayBuffer && t.recipient.BYTES_PER_ELEMENT === 1 && t.recipient.length === 32 && typeof(t.scope) === 'number' && t.scope >= 0 && t.scope <= 1) && Array.isArray(newPolicy_0.delegates) && newPolicy_0.delegates.length === 2 && newPolicy_0.delegates.every((t) => typeof(t) === 'object' && typeof(t.active) === 'boolean' && typeof(t.key.x) === 'bigint' && t.key.x >= 0n && t.key.x <= __compactRuntime.MAX_FIELD && typeof(t.key.y) === 'bigint' && t.key.y >= 0n && t.key.y <= __compactRuntime.MAX_FIELD && typeof(t.cap) === 'bigint' && t.cap >= 0n && t.cap <= 340282366920938463463374607431768211455n && typeof(t.period) === 'bigint' && t.period >= 0n && t.period <= 18446744073709551615n))) {
          __compactRuntime.typeError('narrowPolicy',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'VaultCore.compact line 492 char 3',
                                     'struct Policy<whitelistEnabled: Boolean, whitelist: Vector<8, struct WlEntry<active: Boolean, recipient: Bytes<32>, scope: Enum<Scope, QuorumOnly, Any>>>, delegates: Vector<2, struct DelegatePolicy<active: Boolean, key: JubjubPoint, cap: Uint<0..340282366920938463463374607431768211456>, period: Uint<0..18446744073709551616>>>>',
                                     newPolicy_0)
        }
        if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('narrowPolicy',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'VaultCore.compact line 492 char 3',
                                     'Uint<0..18446744073709551616>',
                                     expiry_0)
        }
        if (!(Array.isArray(approvals_0) && approvals_0.length === 5 && approvals_0.every((t) => typeof(t) === 'object' && typeof(t.is_some) === 'boolean' && typeof(t.value) === 'object' && typeof(t.value.signer.x) === 'bigint' && t.value.signer.x >= 0n && t.value.signer.x <= __compactRuntime.MAX_FIELD && typeof(t.value.signer.y) === 'bigint' && t.value.signer.y >= 0n && t.value.signer.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig) === 'object' && typeof(t.value.sig.announcement.x) === 'bigint' && t.value.sig.announcement.x >= 0n && t.value.sig.announcement.x <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.announcement.y) === 'bigint' && t.value.sig.announcement.y >= 0n && t.value.sig.announcement.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.response) === 'bigint' && t.value.sig.response >= 0 && t.value.sig.response <= __compactRuntime.MAX_FIELD))) {
          __compactRuntime.typeError('narrowPolicy',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'VaultCore.compact line 492 char 3',
                                     'Vector<5, struct Maybe<is_some: Boolean, value: struct Approval<signer: JubjubPoint, sig: struct JubjubSchnorrSignature<announcement: JubjubPoint, response: Field>>>>',
                                     approvals_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_24.toValue(newPolicy_0).concat(_descriptor_4.toValue(expiry_0).concat(_descriptor_14.toValue(approvals_0))),
            alignment: _descriptor_24.alignment().concat(_descriptor_4.alignment().concat(_descriptor_14.alignment()))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._narrowPolicy_0(context,
                                                    partialProofData,
                                                    newPolicy_0,
                                                    expiry_0,
                                                    approvals_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      proposeRecovery: async (...args_1) => {
        if (args_1.length !== 6) {
          throw new __compactRuntime.CompactError(`proposeRecovery: expected 6 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const newOwners_0 = args_1[1];
        const newThreshold_0 = args_1[2];
        const notBefore_0 = args_1[3];
        const expiry_0 = args_1[4];
        const approvals_0 = args_1[5];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('proposeRecovery',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 512 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(Array.isArray(newOwners_0) && newOwners_0.length === 5 && newOwners_0.every((t) => typeof(t) === 'object' && typeof(t.approvalKey.x) === 'bigint' && t.approvalKey.x >= 0n && t.approvalKey.x <= __compactRuntime.MAX_FIELD && typeof(t.approvalKey.y) === 'bigint' && t.approvalKey.y >= 0n && t.approvalKey.y <= __compactRuntime.MAX_FIELD && t.upgradeKey.buffer instanceof ArrayBuffer && t.upgradeKey.BYTES_PER_ELEMENT === 1 && t.upgradeKey.length === 32))) {
          __compactRuntime.typeError('proposeRecovery',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'VaultCore.compact line 512 char 3',
                                     'Vector<5, struct Owner<approvalKey: JubjubPoint, upgradeKey: Bytes<32>>>',
                                     newOwners_0)
        }
        if (!(typeof(newThreshold_0) === 'bigint' && newThreshold_0 >= 0n && newThreshold_0 <= 255n)) {
          __compactRuntime.typeError('proposeRecovery',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'VaultCore.compact line 512 char 3',
                                     'Uint<0..256>',
                                     newThreshold_0)
        }
        if (!(typeof(notBefore_0) === 'bigint' && notBefore_0 >= 0n && notBefore_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('proposeRecovery',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'VaultCore.compact line 512 char 3',
                                     'Uint<0..18446744073709551616>',
                                     notBefore_0)
        }
        if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('proposeRecovery',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'VaultCore.compact line 512 char 3',
                                     'Uint<0..18446744073709551616>',
                                     expiry_0)
        }
        if (!(Array.isArray(approvals_0) && approvals_0.length === 5 && approvals_0.every((t) => typeof(t) === 'object' && typeof(t.is_some) === 'boolean' && typeof(t.value) === 'object' && typeof(t.value.key.x) === 'bigint' && t.value.key.x >= 0n && t.value.key.x <= __compactRuntime.MAX_FIELD && typeof(t.value.key.y) === 'bigint' && t.value.key.y >= 0n && t.value.key.y <= __compactRuntime.MAX_FIELD && t.value.salt.buffer instanceof ArrayBuffer && t.value.salt.BYTES_PER_ELEMENT === 1 && t.value.salt.length === 32 && typeof(t.value.sig) === 'object' && typeof(t.value.sig.announcement.x) === 'bigint' && t.value.sig.announcement.x >= 0n && t.value.sig.announcement.x <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.announcement.y) === 'bigint' && t.value.sig.announcement.y >= 0n && t.value.sig.announcement.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.response) === 'bigint' && t.value.sig.response >= 0 && t.value.sig.response <= __compactRuntime.MAX_FIELD))) {
          __compactRuntime.typeError('proposeRecovery',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'VaultCore.compact line 512 char 3',
                                     'Vector<5, struct Maybe<is_some: Boolean, value: struct GuardianApproval<key: JubjubPoint, salt: Bytes<32>, sig: struct JubjubSchnorrSignature<announcement: JubjubPoint, response: Field>>>>',
                                     approvals_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_16.toValue(newOwners_0).concat(_descriptor_3.toValue(newThreshold_0).concat(_descriptor_4.toValue(notBefore_0).concat(_descriptor_4.toValue(expiry_0).concat(_descriptor_32.toValue(approvals_0))))),
            alignment: _descriptor_16.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_4.alignment().concat(_descriptor_32.alignment()))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._proposeRecovery_0(context,
                                                       partialProofData,
                                                       newOwners_0,
                                                       newThreshold_0,
                                                       notBefore_0,
                                                       expiry_0,
                                                       approvals_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      cancelRecovery: async (...args_1) => {
        if (args_1.length !== 4) {
          throw new __compactRuntime.CompactError(`cancelRecovery: expected 4 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const at_0 = args_1[1];
        const expiry_0 = args_1[2];
        const approvals_0 = args_1[3];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('cancelRecovery',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 554 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(at_0) === 'bigint' && at_0 >= 0n && at_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('cancelRecovery',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'VaultCore.compact line 554 char 3',
                                     'Uint<0..18446744073709551616>',
                                     at_0)
        }
        if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('cancelRecovery',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'VaultCore.compact line 554 char 3',
                                     'Uint<0..18446744073709551616>',
                                     expiry_0)
        }
        if (!(Array.isArray(approvals_0) && approvals_0.length === 5 && approvals_0.every((t) => typeof(t) === 'object' && typeof(t.is_some) === 'boolean' && typeof(t.value) === 'object' && typeof(t.value.signer.x) === 'bigint' && t.value.signer.x >= 0n && t.value.signer.x <= __compactRuntime.MAX_FIELD && typeof(t.value.signer.y) === 'bigint' && t.value.signer.y >= 0n && t.value.signer.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig) === 'object' && typeof(t.value.sig.announcement.x) === 'bigint' && t.value.sig.announcement.x >= 0n && t.value.sig.announcement.x <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.announcement.y) === 'bigint' && t.value.sig.announcement.y >= 0n && t.value.sig.announcement.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.response) === 'bigint' && t.value.sig.response >= 0 && t.value.sig.response <= __compactRuntime.MAX_FIELD))) {
          __compactRuntime.typeError('cancelRecovery',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'VaultCore.compact line 554 char 3',
                                     'Vector<5, struct Maybe<is_some: Boolean, value: struct Approval<signer: JubjubPoint, sig: struct JubjubSchnorrSignature<announcement: JubjubPoint, response: Field>>>>',
                                     approvals_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_4.toValue(at_0).concat(_descriptor_4.toValue(expiry_0).concat(_descriptor_14.toValue(approvals_0))),
            alignment: _descriptor_4.alignment().concat(_descriptor_4.alignment().concat(_descriptor_14.alignment()))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._cancelRecovery_0(context,
                                                      partialProofData,
                                                      at_0,
                                                      expiry_0,
                                                      approvals_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      withdrawRecovery: async (...args_1) => {
        if (args_1.length !== 4) {
          throw new __compactRuntime.CompactError(`withdrawRecovery: expected 4 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const at_0 = args_1[1];
        const expiry_0 = args_1[2];
        const approvals_0 = args_1[3];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('withdrawRecovery',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 567 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(at_0) === 'bigint' && at_0 >= 0n && at_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('withdrawRecovery',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'VaultCore.compact line 567 char 3',
                                     'Uint<0..18446744073709551616>',
                                     at_0)
        }
        if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('withdrawRecovery',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'VaultCore.compact line 567 char 3',
                                     'Uint<0..18446744073709551616>',
                                     expiry_0)
        }
        if (!(Array.isArray(approvals_0) && approvals_0.length === 5 && approvals_0.every((t) => typeof(t) === 'object' && typeof(t.is_some) === 'boolean' && typeof(t.value) === 'object' && typeof(t.value.key.x) === 'bigint' && t.value.key.x >= 0n && t.value.key.x <= __compactRuntime.MAX_FIELD && typeof(t.value.key.y) === 'bigint' && t.value.key.y >= 0n && t.value.key.y <= __compactRuntime.MAX_FIELD && t.value.salt.buffer instanceof ArrayBuffer && t.value.salt.BYTES_PER_ELEMENT === 1 && t.value.salt.length === 32 && typeof(t.value.sig) === 'object' && typeof(t.value.sig.announcement.x) === 'bigint' && t.value.sig.announcement.x >= 0n && t.value.sig.announcement.x <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.announcement.y) === 'bigint' && t.value.sig.announcement.y >= 0n && t.value.sig.announcement.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.response) === 'bigint' && t.value.sig.response >= 0 && t.value.sig.response <= __compactRuntime.MAX_FIELD))) {
          __compactRuntime.typeError('withdrawRecovery',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'VaultCore.compact line 567 char 3',
                                     'Vector<5, struct Maybe<is_some: Boolean, value: struct GuardianApproval<key: JubjubPoint, salt: Bytes<32>, sig: struct JubjubSchnorrSignature<announcement: JubjubPoint, response: Field>>>>',
                                     approvals_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_4.toValue(at_0).concat(_descriptor_4.toValue(expiry_0).concat(_descriptor_32.toValue(approvals_0))),
            alignment: _descriptor_4.alignment().concat(_descriptor_4.alignment().concat(_descriptor_32.alignment()))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._withdrawRecovery_0(context,
                                                        partialProofData,
                                                        at_0,
                                                        expiry_0,
                                                        approvals_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      clearExpiredRecovery: async (...args_1) => {
        if (args_1.length !== 1) {
          throw new __compactRuntime.CompactError(`clearExpiredRecovery: expected 1 argument (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('clearExpiredRecovery',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 580 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: { value: [], alignment: [] },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._clearExpiredRecovery_0(context,
                                                            partialProofData);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      applyRecovery: async (...args_1) => {
        if (args_1.length !== 1) {
          throw new __compactRuntime.CompactError(`applyRecovery: expected 1 argument (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('applyRecovery',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 592 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: { value: [], alignment: [] },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._applyRecovery_0(context, partialProofData);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      proposeGuardians: async (...args_1) => {
        if (args_1.length !== 9) {
          throw new __compactRuntime.CompactError(`proposeGuardians: expected 9 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const newGuardians_0 = args_1[1];
        const newThreshold_0 = args_1[2];
        const newRecoveryDelay_0 = args_1[3];
        const newCooldown_0 = args_1[4];
        const newExpiryWindow_0 = args_1[5];
        const notBefore_0 = args_1[6];
        const expiry_0 = args_1[7];
        const approvals_0 = args_1[8];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('proposeGuardians',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 609 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(Array.isArray(newGuardians_0) && newGuardians_0.length === 5 && newGuardians_0.every((t) => typeof(t) === 'object' && typeof(t.key.x) === 'bigint' && t.key.x >= 0n && t.key.x <= __compactRuntime.MAX_FIELD && typeof(t.key.y) === 'bigint' && t.key.y >= 0n && t.key.y <= __compactRuntime.MAX_FIELD && t.salt.buffer instanceof ArrayBuffer && t.salt.BYTES_PER_ELEMENT === 1 && t.salt.length === 32))) {
          __compactRuntime.typeError('proposeGuardians',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'VaultCore.compact line 609 char 3',
                                     'Vector<5, struct GuardianSecret<key: JubjubPoint, salt: Bytes<32>>>',
                                     newGuardians_0)
        }
        if (!(typeof(newThreshold_0) === 'bigint' && newThreshold_0 >= 0n && newThreshold_0 <= 255n)) {
          __compactRuntime.typeError('proposeGuardians',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'VaultCore.compact line 609 char 3',
                                     'Uint<0..256>',
                                     newThreshold_0)
        }
        if (!(typeof(newRecoveryDelay_0) === 'bigint' && newRecoveryDelay_0 >= 0n && newRecoveryDelay_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('proposeGuardians',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'VaultCore.compact line 609 char 3',
                                     'Uint<0..18446744073709551616>',
                                     newRecoveryDelay_0)
        }
        if (!(typeof(newCooldown_0) === 'bigint' && newCooldown_0 >= 0n && newCooldown_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('proposeGuardians',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'VaultCore.compact line 609 char 3',
                                     'Uint<0..18446744073709551616>',
                                     newCooldown_0)
        }
        if (!(typeof(newExpiryWindow_0) === 'bigint' && newExpiryWindow_0 >= 0n && newExpiryWindow_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('proposeGuardians',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'VaultCore.compact line 609 char 3',
                                     'Uint<0..18446744073709551616>',
                                     newExpiryWindow_0)
        }
        if (!(typeof(notBefore_0) === 'bigint' && notBefore_0 >= 0n && notBefore_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('proposeGuardians',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'VaultCore.compact line 609 char 3',
                                     'Uint<0..18446744073709551616>',
                                     notBefore_0)
        }
        if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('proposeGuardians',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'VaultCore.compact line 609 char 3',
                                     'Uint<0..18446744073709551616>',
                                     expiry_0)
        }
        if (!(Array.isArray(approvals_0) && approvals_0.length === 5 && approvals_0.every((t) => typeof(t) === 'object' && typeof(t.is_some) === 'boolean' && typeof(t.value) === 'object' && typeof(t.value.signer.x) === 'bigint' && t.value.signer.x >= 0n && t.value.signer.x <= __compactRuntime.MAX_FIELD && typeof(t.value.signer.y) === 'bigint' && t.value.signer.y >= 0n && t.value.signer.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig) === 'object' && typeof(t.value.sig.announcement.x) === 'bigint' && t.value.sig.announcement.x >= 0n && t.value.sig.announcement.x <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.announcement.y) === 'bigint' && t.value.sig.announcement.y >= 0n && t.value.sig.announcement.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.response) === 'bigint' && t.value.sig.response >= 0 && t.value.sig.response <= __compactRuntime.MAX_FIELD))) {
          __compactRuntime.typeError('proposeGuardians',
                                     'argument 8 (argument 9 as invoked from Typescript)',
                                     'VaultCore.compact line 609 char 3',
                                     'Vector<5, struct Maybe<is_some: Boolean, value: struct Approval<signer: JubjubPoint, sig: struct JubjubSchnorrSignature<announcement: JubjubPoint, response: Field>>>>',
                                     approvals_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_29.toValue(newGuardians_0).concat(_descriptor_3.toValue(newThreshold_0).concat(_descriptor_4.toValue(newRecoveryDelay_0).concat(_descriptor_4.toValue(newCooldown_0).concat(_descriptor_4.toValue(newExpiryWindow_0).concat(_descriptor_4.toValue(notBefore_0).concat(_descriptor_4.toValue(expiry_0).concat(_descriptor_14.toValue(approvals_0)))))))),
            alignment: _descriptor_29.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment().concat(_descriptor_4.alignment().concat(_descriptor_4.alignment().concat(_descriptor_4.alignment().concat(_descriptor_4.alignment().concat(_descriptor_14.alignment())))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._proposeGuardians_0(context,
                                                        partialProofData,
                                                        newGuardians_0,
                                                        newThreshold_0,
                                                        newRecoveryDelay_0,
                                                        newCooldown_0,
                                                        newExpiryWindow_0,
                                                        notBefore_0,
                                                        expiry_0,
                                                        approvals_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      cancelGuardians: async (...args_1) => {
        if (args_1.length !== 3) {
          throw new __compactRuntime.CompactError(`cancelGuardians: expected 3 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const expiry_0 = args_1[1];
        const approvals_0 = args_1[2];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('cancelGuardians',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 629 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
          __compactRuntime.typeError('cancelGuardians',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'VaultCore.compact line 629 char 3',
                                     'Uint<0..18446744073709551616>',
                                     expiry_0)
        }
        if (!(Array.isArray(approvals_0) && approvals_0.length === 5 && approvals_0.every((t) => typeof(t) === 'object' && typeof(t.is_some) === 'boolean' && typeof(t.value) === 'object' && typeof(t.value.signer.x) === 'bigint' && t.value.signer.x >= 0n && t.value.signer.x <= __compactRuntime.MAX_FIELD && typeof(t.value.signer.y) === 'bigint' && t.value.signer.y >= 0n && t.value.signer.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig) === 'object' && typeof(t.value.sig.announcement.x) === 'bigint' && t.value.sig.announcement.x >= 0n && t.value.sig.announcement.x <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.announcement.y) === 'bigint' && t.value.sig.announcement.y >= 0n && t.value.sig.announcement.y <= __compactRuntime.MAX_FIELD && typeof(t.value.sig.response) === 'bigint' && t.value.sig.response >= 0 && t.value.sig.response <= __compactRuntime.MAX_FIELD))) {
          __compactRuntime.typeError('cancelGuardians',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'VaultCore.compact line 629 char 3',
                                     'Vector<5, struct Maybe<is_some: Boolean, value: struct Approval<signer: JubjubPoint, sig: struct JubjubSchnorrSignature<announcement: JubjubPoint, response: Field>>>>',
                                     approvals_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_4.toValue(expiry_0).concat(_descriptor_14.toValue(approvals_0)),
            alignment: _descriptor_4.alignment().concat(_descriptor_14.alignment())
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._cancelGuardians_0(context,
                                                       partialProofData,
                                                       expiry_0,
                                                       approvals_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      applyGuardians: async (...args_1) => {
        if (args_1.length !== 1) {
          throw new __compactRuntime.CompactError(`applyGuardians: expected 1 argument (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('applyGuardians',
                                     'argument 1 (as invoked from Typescript)',
                                     'VaultCore.compact line 642 char 3',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: { value: [], alignment: [] },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._applyGuardians_0(context, partialProofData);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      }
    };
    this.impureCircuits = {
      deposit: this.circuits.deposit,
      execute: this.circuits.execute,
      delegatePayout: this.circuits.delegatePayout,
      proposeOwners: this.circuits.proposeOwners,
      cancelOwners: this.circuits.cancelOwners,
      applyOwners: this.circuits.applyOwners,
      proposePolicy: this.circuits.proposePolicy,
      cancelPolicy: this.circuits.cancelPolicy,
      applyPolicy: this.circuits.applyPolicy,
      narrowPolicy: this.circuits.narrowPolicy,
      proposeRecovery: this.circuits.proposeRecovery,
      cancelRecovery: this.circuits.cancelRecovery,
      withdrawRecovery: this.circuits.withdrawRecovery,
      clearExpiredRecovery: this.circuits.clearExpiredRecovery,
      applyRecovery: this.circuits.applyRecovery,
      proposeGuardians: this.circuits.proposeGuardians,
      cancelGuardians: this.circuits.cancelGuardians,
      applyGuardians: this.circuits.applyGuardians
    };
    this.provableCircuits = {
      deposit: this.circuits.deposit,
      execute: this.circuits.execute,
      delegatePayout: this.circuits.delegatePayout,
      proposeOwners: this.circuits.proposeOwners,
      cancelOwners: this.circuits.cancelOwners,
      applyOwners: this.circuits.applyOwners,
      proposePolicy: this.circuits.proposePolicy,
      cancelPolicy: this.circuits.cancelPolicy,
      applyPolicy: this.circuits.applyPolicy,
      narrowPolicy: this.circuits.narrowPolicy,
      proposeRecovery: this.circuits.proposeRecovery,
      cancelRecovery: this.circuits.cancelRecovery,
      withdrawRecovery: this.circuits.withdrawRecovery,
      clearExpiredRecovery: this.circuits.clearExpiredRecovery,
      applyRecovery: this.circuits.applyRecovery,
      proposeGuardians: this.circuits.proposeGuardians,
      cancelGuardians: this.circuits.cancelGuardians,
      applyGuardians: this.circuits.applyGuardians
    };
  }
  async initialState(...args_0) {
    if (args_0.length !== 12) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 12 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const constructorContext_0 = args_0[0];
    const initialOwners_0 = args_0[1];
    const initialThreshold_0 = args_0[2];
    const networkTag_0 = args_0[3];
    const changeDelay_0 = args_0[4];
    const whitelistEnabled_0 = args_0[5];
    const whitelist_0 = args_0[6];
    const guardians_0 = args_0[7];
    const guardianThreshold_0 = args_0[8];
    const recoveryDelay_0 = args_0[9];
    const cooldown_0 = args_0[10];
    const expiryWindow_0 = args_0[11];
    if (typeof(constructorContext_0) !== 'object') {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'constructorContext' in argument 1 (as invoked from Typescript) to be an object`);
    }
    if (!('initialZswapLocalState' in constructorContext_0)) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialZswapLocalState' in argument 1 (as invoked from Typescript)`);
    }
    if (typeof(constructorContext_0.initialZswapLocalState) !== 'object') {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialZswapLocalState' in argument 1 (as invoked from Typescript) to be an object`);
    }
    if (!(Array.isArray(initialOwners_0) && initialOwners_0.length === 5 && initialOwners_0.every((t) => typeof(t) === 'object' && typeof(t.approvalKey.x) === 'bigint' && t.approvalKey.x >= 0n && t.approvalKey.x <= __compactRuntime.MAX_FIELD && typeof(t.approvalKey.y) === 'bigint' && t.approvalKey.y >= 0n && t.approvalKey.y <= __compactRuntime.MAX_FIELD && t.upgradeKey.buffer instanceof ArrayBuffer && t.upgradeKey.BYTES_PER_ELEMENT === 1 && t.upgradeKey.length === 32))) {
      __compactRuntime.typeError('Contract state constructor',
                                 'argument 1 (argument 2 as invoked from Typescript)',
                                 'main-production.compact line 22 char 1',
                                 'Vector<5, struct Owner<approvalKey: JubjubPoint, upgradeKey: Bytes<32>>>',
                                 initialOwners_0)
    }
    if (!(typeof(initialThreshold_0) === 'bigint' && initialThreshold_0 >= 0n && initialThreshold_0 <= 255n)) {
      __compactRuntime.typeError('Contract state constructor',
                                 'argument 2 (argument 3 as invoked from Typescript)',
                                 'main-production.compact line 22 char 1',
                                 'Uint<0..256>',
                                 initialThreshold_0)
    }
    if (!(networkTag_0.buffer instanceof ArrayBuffer && networkTag_0.BYTES_PER_ELEMENT === 1 && networkTag_0.length === 32)) {
      __compactRuntime.typeError('Contract state constructor',
                                 'argument 3 (argument 4 as invoked from Typescript)',
                                 'main-production.compact line 22 char 1',
                                 'Bytes<32>',
                                 networkTag_0)
    }
    if (!(typeof(changeDelay_0) === 'bigint' && changeDelay_0 >= 0n && changeDelay_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('Contract state constructor',
                                 'argument 4 (argument 5 as invoked from Typescript)',
                                 'main-production.compact line 22 char 1',
                                 'Uint<0..18446744073709551616>',
                                 changeDelay_0)
    }
    if (!(typeof(whitelistEnabled_0) === 'boolean')) {
      __compactRuntime.typeError('Contract state constructor',
                                 'argument 5 (argument 6 as invoked from Typescript)',
                                 'main-production.compact line 22 char 1',
                                 'Boolean',
                                 whitelistEnabled_0)
    }
    if (!(Array.isArray(whitelist_0) && whitelist_0.length === 8 && whitelist_0.every((t) => typeof(t) === 'object' && typeof(t.active) === 'boolean' && t.recipient.buffer instanceof ArrayBuffer && t.recipient.BYTES_PER_ELEMENT === 1 && t.recipient.length === 32 && typeof(t.scope) === 'number' && t.scope >= 0 && t.scope <= 1))) {
      __compactRuntime.typeError('Contract state constructor',
                                 'argument 6 (argument 7 as invoked from Typescript)',
                                 'main-production.compact line 22 char 1',
                                 'Vector<8, struct WlEntry<active: Boolean, recipient: Bytes<32>, scope: Enum<Scope, QuorumOnly, Any>>>',
                                 whitelist_0)
    }
    if (!(Array.isArray(guardians_0) && guardians_0.length === 5 && guardians_0.every((t) => typeof(t) === 'object' && typeof(t.key.x) === 'bigint' && t.key.x >= 0n && t.key.x <= __compactRuntime.MAX_FIELD && typeof(t.key.y) === 'bigint' && t.key.y >= 0n && t.key.y <= __compactRuntime.MAX_FIELD && t.salt.buffer instanceof ArrayBuffer && t.salt.BYTES_PER_ELEMENT === 1 && t.salt.length === 32))) {
      __compactRuntime.typeError('Contract state constructor',
                                 'argument 7 (argument 8 as invoked from Typescript)',
                                 'main-production.compact line 22 char 1',
                                 'Vector<5, struct GuardianSecret<key: JubjubPoint, salt: Bytes<32>>>',
                                 guardians_0)
    }
    if (!(typeof(guardianThreshold_0) === 'bigint' && guardianThreshold_0 >= 0n && guardianThreshold_0 <= 255n)) {
      __compactRuntime.typeError('Contract state constructor',
                                 'argument 8 (argument 9 as invoked from Typescript)',
                                 'main-production.compact line 22 char 1',
                                 'Uint<0..256>',
                                 guardianThreshold_0)
    }
    if (!(typeof(recoveryDelay_0) === 'bigint' && recoveryDelay_0 >= 0n && recoveryDelay_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('Contract state constructor',
                                 'argument 9 (argument 10 as invoked from Typescript)',
                                 'main-production.compact line 22 char 1',
                                 'Uint<0..18446744073709551616>',
                                 recoveryDelay_0)
    }
    if (!(typeof(cooldown_0) === 'bigint' && cooldown_0 >= 0n && cooldown_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('Contract state constructor',
                                 'argument 10 (argument 11 as invoked from Typescript)',
                                 'main-production.compact line 22 char 1',
                                 'Uint<0..18446744073709551616>',
                                 cooldown_0)
    }
    if (!(typeof(expiryWindow_0) === 'bigint' && expiryWindow_0 >= 0n && expiryWindow_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('Contract state constructor',
                                 'argument 11 (argument 12 as invoked from Typescript)',
                                 'main-production.compact line 22 char 1',
                                 'Uint<0..18446744073709551616>',
                                 expiryWindow_0)
    }
    const state_0 = new __compactRuntime.ContractState();
    let stateValue_0 = __compactRuntime.StateValue.newArray();
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    state_0.data = new __compactRuntime.ChargedState(stateValue_0);
    state_0.setOperation('deposit', new __compactRuntime.ContractOperation());
    state_0.setOperation('execute', new __compactRuntime.ContractOperation());
    state_0.setOperation('delegatePayout', new __compactRuntime.ContractOperation());
    state_0.setOperation('proposeOwners', new __compactRuntime.ContractOperation());
    state_0.setOperation('cancelOwners', new __compactRuntime.ContractOperation());
    state_0.setOperation('applyOwners', new __compactRuntime.ContractOperation());
    state_0.setOperation('proposePolicy', new __compactRuntime.ContractOperation());
    state_0.setOperation('cancelPolicy', new __compactRuntime.ContractOperation());
    state_0.setOperation('applyPolicy', new __compactRuntime.ContractOperation());
    state_0.setOperation('narrowPolicy', new __compactRuntime.ContractOperation());
    state_0.setOperation('proposeRecovery', new __compactRuntime.ContractOperation());
    state_0.setOperation('cancelRecovery', new __compactRuntime.ContractOperation());
    state_0.setOperation('withdrawRecovery', new __compactRuntime.ContractOperation());
    state_0.setOperation('clearExpiredRecovery', new __compactRuntime.ContractOperation());
    state_0.setOperation('applyRecovery', new __compactRuntime.ContractOperation());
    state_0.setOperation('proposeGuardians', new __compactRuntime.ContractOperation());
    state_0.setOperation('cancelGuardians', new __compactRuntime.ContractOperation());
    state_0.setOperation('applyGuardians', new __compactRuntime.ContractOperation());
    const context = __compactRuntime.createCircuitContext({circuitId: 'constructor', contractAddress: __compactRuntime.dummyContractAddress(), coinPublicKeyOrZswapState: constructorContext_0.initialZswapLocalState.coinPublicKey, contractState: state_0.data, privateState: constructorContext_0.initialPrivateState});
    const partialProofData = {
      input: { value: [], alignment: [] },
      output: undefined,
      publicTranscript: [],
      privateTranscriptOutputs: []
    };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(0n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_16.toValue(new Array(5).fill({ approvalKey: ({x: 0n, y: 1n}), upgradeKey: new Uint8Array(32) })),
                                                                                              alignment: _descriptor_16.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(1n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(0n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(2n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(0n),
                                                                                              alignment: _descriptor_4.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(3n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_7.toValue(new Uint8Array(32)),
                                                                                              alignment: _descriptor_7.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(4n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(0n),
                                                                                              alignment: _descriptor_4.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(5n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_17.toValue({ active: false, owners: new Array(5).fill({ approvalKey: ({x: 0n, y: 1n}), upgradeKey: new Uint8Array(32) }), threshold: 0n, executableAfter: 0n }),
                                                                                              alignment: _descriptor_17.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(6n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_24.toValue({ whitelistEnabled: false, whitelist: new Array(8).fill({ active: false, recipient: new Uint8Array(32), scope: 0 }), delegates: new Array(2).fill({ active: false, key: ({x: 0n, y: 1n}), cap: 0n, period: 0n }) }),
                                                                                              alignment: _descriptor_24.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(7n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_25.toValue({ active: false, policy: { whitelistEnabled: false, whitelist: new Array(8).fill({ active: false, recipient: new Uint8Array(32), scope: 0 }), delegates: new Array(2).fill({ active: false, key: ({x: 0n, y: 1n}), cap: 0n, period: 0n }) }, executableAfter: 0n }),
                                                                                              alignment: _descriptor_25.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(8n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newMap(
                                                          new __compactRuntime.StateMap()
                                                        ).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(9n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newMap(
                                                          new __compactRuntime.StateMap()
                                                        ).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(10n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_5.toValue({ guardians: new Array(5).fill(0n), threshold: 0n, recoveryDelay: 0n, cooldown: 0n, expiryWindow: 0n }),
                                                                                              alignment: _descriptor_5.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(11n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_6.toValue({ active: false, config: { guardians: new Array(5).fill(0n), threshold: 0n, recoveryDelay: 0n, cooldown: 0n, expiryWindow: 0n }, executableAfter: 0n }),
                                                                                              alignment: _descriptor_6.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(12n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_27.toValue({ active: false, owners: new Array(5).fill({ approvalKey: ({x: 0n, y: 1n}), upgradeKey: new Uint8Array(32) }), threshold: 0n, executableAfter: 0n, expiresAfter: 0n, approvedBy: new Array(5).fill(false) }),
                                                                                              alignment: _descriptor_27.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(13n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(0n),
                                                                                              alignment: _descriptor_4.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(14n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(0n),
                                                                                              alignment: _descriptor_4.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    await this._init_0(context,
                       partialProofData,
                       initialOwners_0,
                       initialThreshold_0,
                       networkTag_0,
                       changeDelay_0,
                       whitelistEnabled_0,
                       whitelist_0,
                       guardians_0,
                       guardianThreshold_0,
                       recoveryDelay_0,
                       cooldown_0,
                       expiryWindow_0);
    state_0.data = new __compactRuntime.ChargedState(context.callContext.currentQueryContext.state.state);
    return {
      currentContractState: state_0,
      currentPrivateState: context.callContext.currentPrivateState,
      currentZswapLocalState: context.callContext.currentZswapLocalState
    }
  }
  _left_0(value_0) {
    return { is_left: true, left: value_0, right: new Uint8Array(32) };
  }
  _right_0(value_0) {
    return { is_left: false, left: { bytes: new Uint8Array(32) }, right: value_0 };
  }
  _nativeToken_0() {
    return new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  }
  async _blockTimeLt_0(context, partialProofData, time_0) {
    return _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                     partialProofData,
                                                                     [
                                                                      { dup: { n: 2 } },
                                                                      { idx: { cached: true,
                                                                               pushPath: false,
                                                                               path: [
                                                                                      { tag: 'value',
                                                                                        value: { value: _descriptor_3.toValue(2n),
                                                                                                 alignment: _descriptor_3.alignment() } }] } },
                                                                      { push: { storage: false,
                                                                                value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(time_0),
                                                                                                                             alignment: _descriptor_4.alignment() }).encode() } },
                                                                      'lt',
                                                                      { popeq: { cached: true,
                                                                                 result: undefined } }]).value);
  }
  async _blockTimeGte_0(context, partialProofData, time_0) {
    return !await this._blockTimeLt_0(context, partialProofData, time_0);
  }
  async _blockTimeGt_0(context, partialProofData, time_0) {
    return _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                     partialProofData,
                                                                     [
                                                                      { push: { storage: false,
                                                                                value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(time_0),
                                                                                                                             alignment: _descriptor_4.alignment() }).encode() } },
                                                                      { dup: { n: 3 } },
                                                                      { idx: { cached: true,
                                                                               pushPath: false,
                                                                               path: [
                                                                                      { tag: 'value',
                                                                                        value: { value: _descriptor_3.toValue(2n),
                                                                                                 alignment: _descriptor_3.alignment() } }] } },
                                                                      'lt',
                                                                      { popeq: { cached: true,
                                                                                 result: undefined } }]).value);
  }
  async _blockTimeLte_0(context, partialProofData, time_0) {
    return !await this._blockTimeGt_0(context, partialProofData, time_0);
  }
  async _sendUnshielded_0(context,
                          partialProofData,
                          color_0,
                          amount_0,
                          recipient_0)
  {
    const tmp_0 = this._left_0(color_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { swap: { n: 0 } },
                                       { idx: { cached: true,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(7n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_51.toValue(tmp_0),
                                                                                              alignment: _descriptor_51.alignment() }).encode() } },
                                       { dup: { n: 1 } },
                                       { dup: { n: 1 } },
                                       'member',
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_21.toValue(amount_0),
                                                                                              alignment: _descriptor_21.alignment() }).encode() } },
                                       { swap: { n: 0 } },
                                       'neg',
                                       { branch: { skip: 4 } },
                                       { dup: { n: 2 } },
                                       { dup: { n: 2 } },
                                       { idx: { cached: true,
                                                pushPath: false,
                                                path: [ { tag: 'stack' }] } },
                                       'add',
                                       { ins: { cached: true, n: 2 } },
                                       { swap: { n: 0 } }]);
    const tmp_1 = this._left_0(color_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { swap: { n: 0 } },
                                       { idx: { cached: true,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(8n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell(__compactRuntime.alignedConcat(
                                                                                              { value: _descriptor_51.toValue(tmp_1),
                                                                                                alignment: _descriptor_51.alignment() },
                                                                                              { value: _descriptor_52.toValue(recipient_0),
                                                                                                alignment: _descriptor_52.alignment() }
                                                                                            )).encode() } },
                                       { dup: { n: 1 } },
                                       { dup: { n: 1 } },
                                       'member',
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_21.toValue(amount_0),
                                                                                              alignment: _descriptor_21.alignment() }).encode() } },
                                       { swap: { n: 0 } },
                                       'neg',
                                       { branch: { skip: 4 } },
                                       { dup: { n: 2 } },
                                       { dup: { n: 2 } },
                                       { idx: { cached: true,
                                                pushPath: false,
                                                path: [ { tag: 'stack' }] } },
                                       'add',
                                       { ins: { cached: true, n: 2 } },
                                       { swap: { n: 0 } }]);
    if (recipient_0.is_left
        &&
        this._equal_0(recipient_0.left.bytes,
                      _descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                partialProofData,
                                                                                [
                                                                                 { dup: { n: 2 } },
                                                                                 { idx: { cached: true,
                                                                                          pushPath: false,
                                                                                          path: [
                                                                                                 { tag: 'value',
                                                                                                   value: { value: _descriptor_3.toValue(0n),
                                                                                                            alignment: _descriptor_3.alignment() } }] } },
                                                                                 { popeq: { cached: true,
                                                                                            result: undefined } }]).value).bytes))
    {
      const tmp_2 = this._left_0(color_0);
      __compactRuntime.queryLedgerState(context,
                                        partialProofData,
                                        [
                                         { swap: { n: 0 } },
                                         { idx: { cached: true,
                                                  pushPath: true,
                                                  path: [
                                                         { tag: 'value',
                                                           value: { value: _descriptor_3.toValue(6n),
                                                                    alignment: _descriptor_3.alignment() } }] } },
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_51.toValue(tmp_2),
                                                                                                alignment: _descriptor_51.alignment() }).encode() } },
                                         { dup: { n: 1 } },
                                         { dup: { n: 1 } },
                                         'member',
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_21.toValue(amount_0),
                                                                                                alignment: _descriptor_21.alignment() }).encode() } },
                                         { swap: { n: 0 } },
                                         'neg',
                                         { branch: { skip: 4 } },
                                         { dup: { n: 2 } },
                                         { dup: { n: 2 } },
                                         { idx: { cached: true,
                                                  pushPath: false,
                                                  path: [ { tag: 'stack' }] } },
                                         'add',
                                         { ins: { cached: true, n: 2 } },
                                         { swap: { n: 0 } }]);
    }
    return [];
  }
  async _receiveUnshielded_0(context, partialProofData, color_0, amount_0) {
    const tmp_0 = this._left_0(color_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { swap: { n: 0 } },
                                       { idx: { cached: true,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(6n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_51.toValue(tmp_0),
                                                                                              alignment: _descriptor_51.alignment() }).encode() } },
                                       { dup: { n: 1 } },
                                       { dup: { n: 1 } },
                                       'member',
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_21.toValue(amount_0),
                                                                                              alignment: _descriptor_21.alignment() }).encode() } },
                                       { swap: { n: 0 } },
                                       'neg',
                                       { branch: { skip: 4 } },
                                       { dup: { n: 2 } },
                                       { dup: { n: 2 } },
                                       { idx: { cached: true,
                                                pushPath: false,
                                                path: [ { tag: 'stack' }] } },
                                       'add',
                                       { ins: { cached: true, n: 2 } },
                                       { swap: { n: 0 } }]);
    return [];
  }
  async _unshieldedBalanceLt_0(context, partialProofData, color_0, amount_0) {
    const tmp_0 = this._left_0(color_0);
    return _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                     partialProofData,
                                                                     [
                                                                      { dup: { n: 2 } },
                                                                      { idx: { cached: true,
                                                                               pushPath: false,
                                                                               path: [
                                                                                      { tag: 'value',
                                                                                        value: { value: _descriptor_3.toValue(5n),
                                                                                                 alignment: _descriptor_3.alignment() } }] } },
                                                                      { dup: { n: 0 } },
                                                                      { push: { storage: false,
                                                                                value: __compactRuntime.StateValue.newCell({ value: _descriptor_51.toValue(tmp_0),
                                                                                                                             alignment: _descriptor_51.alignment() }).encode() } },
                                                                      'member',
                                                                      { branch: { skip: 3 } },
                                                                      'pop',
                                                                      { push: { storage: false,
                                                                                value: __compactRuntime.StateValue.newCell({ value: _descriptor_21.toValue(0n),
                                                                                                                             alignment: _descriptor_21.alignment() }).encode() } },
                                                                      { jmp: { skip: 1 } },
                                                                      { idx: { cached: true,
                                                                               pushPath: false,
                                                                               path: [
                                                                                      { tag: 'value',
                                                                                        value: { value: _descriptor_51.toValue(tmp_0),
                                                                                                 alignment: _descriptor_51.alignment() } }] } },
                                                                      { push: { storage: false,
                                                                                value: __compactRuntime.StateValue.newCell({ value: _descriptor_21.toValue(amount_0),
                                                                                                                             alignment: _descriptor_21.alignment() }).encode() } },
                                                                      'lt',
                                                                      { popeq: { cached: true,
                                                                                 result: undefined } }]).value);
  }
  async _unshieldedBalanceGte_0(context, partialProofData, color_0, amount_0) {
    return !await this._unshieldedBalanceLt_0(context,
                                              partialProofData,
                                              color_0,
                                              amount_0);
  }
  _jubjubSchnorrVerify_0(msg_0, signature_0, pk_0) {
    __compactRuntime.assert(!this._equal_1(pk_0, ({x: 0n, y: 1n})),
                            'JubjubPoint identity is not a permitted jubjubSchnorrVerify verification key');
    const __compact_pattern_tmp1_0 = signature_0;
    const announcement_0 = __compact_pattern_tmp1_0.announcement;
    const response_0 = __compact_pattern_tmp1_0.response;
    const cNative_0 = this._transientHash_0({ annX:
                                                this._jubjubPointX_0(announcement_0),
                                              annY:
                                                this._jubjubPointY_0(announcement_0),
                                              pkX: this._jubjubPointX_0(pk_0),
                                              pkY: this._jubjubPointY_0(pk_0),
                                              msg: msg_0 });
    const c_0 = __compactRuntime.convertNumericToJubjubScalar(cNative_0);
    const lhs_0 = this._ecMulGenerator_0(__compactRuntime.convertNumericToJubjubScalar(response_0));
    const rhs_0 = this._ecAdd_0(announcement_0, this._ecMul_0(pk_0, c_0));
    return this._equal_2(lhs_0, rhs_0);
  }
  _transientHash_0(value_0) {
    const result_0 = __compactRuntime.transientHash(_descriptor_47, value_0);
    return result_0;
  }
  _transientHash_1(value_0) {
    const result_0 = __compactRuntime.transientHash(_descriptor_50, value_0);
    return result_0;
  }
  _transientHash_2(value_0) {
    const result_0 = __compactRuntime.transientHash(_descriptor_44, value_0);
    return result_0;
  }
  _transientHash_3(value_0) {
    const result_0 = __compactRuntime.transientHash(_descriptor_45, value_0);
    return result_0;
  }
  _transientHash_4(value_0) {
    const result_0 = __compactRuntime.transientHash(_descriptor_40, value_0);
    return result_0;
  }
  _transientHash_5(value_0) {
    const result_0 = __compactRuntime.transientHash(_descriptor_41, value_0);
    return result_0;
  }
  _transientHash_6(value_0) {
    const result_0 = __compactRuntime.transientHash(_descriptor_38, value_0);
    return result_0;
  }
  _transientHash_7(value_0) {
    const result_0 = __compactRuntime.transientHash(_descriptor_39, value_0);
    return result_0;
  }
  _jubjubPointX_0(pt_0) {
    const result_0 = __compactRuntime.jubjubPointX(pt_0);
    return result_0;
  }
  _jubjubPointY_0(pt_0) {
    const result_0 = __compactRuntime.jubjubPointY(pt_0);
    return result_0;
  }
  _ecAdd_0(a_0, b_0) {
    const result_0 = __compactRuntime.ecAdd(a_0, b_0);
    return result_0;
  }
  _ecMul_0(a_0, b_0) {
    const result_0 = __compactRuntime.ecMul(a_0, b_0);
    return result_0;
  }
  _ecMulGenerator_0(b_0) {
    const result_0 = __compactRuntime.ecMulGenerator(b_0);
    return result_0;
  }
  _guardianCommitment_0(key_0, salt_0) {
    return this._transientHash_3({ domain:
                                     new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 45, 118, 97, 117, 108, 116, 58, 103, 117, 97, 114, 100, 105, 97, 110, 58, 118, 49, 0, 0, 0, 0, 0, 0]),
                                   kx: this._jubjubPointX_0(key_0),
                                   ky: this._jubjubPointY_0(key_0),
                                   salt: salt_0 });
  }
  _recoveryConfigCommitment_0(cfg_0) {
    return this._transientHash_4({ domain:
                                     new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 45, 118, 97, 117, 108, 116, 58, 114, 101, 99, 111, 118, 101, 114, 121, 45, 99, 102, 103, 58, 118, 49, 0, 0]),
                                   cfg: cfg_0 });
  }
  _ownerSetCommitment_0(owners_0, threshold_0) {
    const words_0 = this._mapper_0(((o_0) =>
                                    {
                                      return { ax:
                                                 this._jubjubPointX_0(o_0.approvalKey),
                                               ay:
                                                 this._jubjubPointY_0(o_0.approvalKey),
                                               upgradeKey: o_0.upgradeKey };
                                    }),
                                   owners_0);
    return this._transientHash_1({ domain:
                                     new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 45, 118, 97, 117, 108, 116, 58, 111, 119, 110, 101, 114, 45, 115, 101, 116, 58, 118, 50, 0, 0, 0, 0, 0]),
                                   owners: words_0,
                                   threshold: threshold_0 });
  }
  _policyCommitment_0(p_0) {
    const ds_0 = this._mapper_1(((d_0) =>
                                 {
                                   return { active: d_0.active,
                                            kx: this._jubjubPointX_0(d_0.key),
                                            ky: this._jubjubPointY_0(d_0.key),
                                            cap: d_0.cap,
                                            period: d_0.period };
                                 }),
                                p_0.delegates);
    return this._transientHash_2({ domain:
                                     new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 45, 118, 97, 117, 108, 116, 58, 112, 111, 108, 105, 99, 121, 58, 118, 49, 0, 0, 0, 0, 0, 0, 0, 0]),
                                   whitelistEnabled: p_0.whitelistEnabled,
                                   whitelist: p_0.whitelist,
                                   delegates: ds_0 });
  }
  _payoutDigest_0(vault_0, network_0, nonce_0, expiry_0, recipient_0, amount_0)
  {
    return this._transientHash_5([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 45, 118, 97, 117, 108, 116, 58, 112, 97, 121, 111, 117, 116, 58, 118, 52, 0, 0, 0, 0, 0, 0, 0, 0]),
                                  network_0,
                                  vault_0.bytes,
                                  __compactRuntime.convertBigintToBytes(32,
                                                                        nonce_0,
                                                                        'Statements.compact line 110 char 7'),
                                  __compactRuntime.convertBigintToBytes(32,
                                                                        expiry_0,
                                                                        'Statements.compact line 110 char 27'),
                                  recipient_0.bytes,
                                  __compactRuntime.convertBigintToBytes(32,
                                                                        amount_0,
                                                                        'Statements.compact line 110 char 65')]);
  }
  _delegatePayoutDigest_0(vault_0,
                          network_0,
                          slot_0,
                          delegateNonce_0,
                          expiry_0,
                          recipient_0,
                          amount_0)
  {
    return this._transientHash_6([new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 45, 118, 97, 117, 108, 116, 58, 100, 101, 108, 101, 103, 97, 116, 101, 45, 112, 97, 121, 58, 118, 49, 0, 0]),
                                  network_0,
                                  vault_0.bytes,
                                  __compactRuntime.convertBigintToBytes(32,
                                                                        slot_0,
                                                                        'Statements.compact line 116 char 7'),
                                  __compactRuntime.convertBigintToBytes(32,
                                                                        delegateNonce_0,
                                                                        'Statements.compact line 116 char 26'),
                                  __compactRuntime.convertBigintToBytes(32,
                                                                        expiry_0,
                                                                        'Statements.compact line 116 char 54'),
                                  recipient_0.bytes,
                                  __compactRuntime.convertBigintToBytes(32,
                                                                        amount_0,
                                                                        'Statements.compact line 116 char 92')]);
  }
  _ownerStatementDigest_0(domain_0,
                          vault_0,
                          network_0,
                          nonce_0,
                          expiry_0,
                          subject_0)
  {
    return this._transientHash_7([domain_0,
                                  network_0,
                                  vault_0.bytes,
                                  __compactRuntime.convertBigintToBytes(32,
                                                                        nonce_0,
                                                                        'Statements.compact line 135 char 7'),
                                  __compactRuntime.convertBigintToBytes(32,
                                                                        expiry_0,
                                                                        'Statements.compact line 135 char 27'),
                                  __compactRuntime.convertBigintToBytes(32,
                                                                        subject_0,
                                                                        'Statements.compact line 135 char 48')]);
  }
  _buildConstants_0() { return [604800n, 2592000n, 172800n]; }
  _isReal_0(o_0) { return !this._equal_3(o_0.approvalKey, ({x: 0n, y: 1n})); }
  _checkOwnerSet_0(os_0, t_0) {
    this._folder_1(((t_1, i_0) =>
                    {
                      __compactRuntime.assert(this._isReal_0(os_0[i_0])
                                              ||
                                              this._equal_4(os_0[i_0].upgradeKey,
                                                            new Uint8Array(32)),
                                              'owner approval key is the identity point');
                      __compactRuntime.assert(!this._isReal_0(os_0[i_0])
                                              ||
                                              !this._equal_5(os_0[i_0].upgradeKey,
                                                             new Uint8Array(32)),
                                              'owner upgrade key is missing');
                      this._folder_0(((t_2, j_0) =>
                                      {
                                        if (i_0 < j_0) {
                                          __compactRuntime.assert(!(this._isReal_0(os_0[i_0])
                                                                    &&
                                                                    this._isReal_0(os_0[j_0])
                                                                    &&
                                                                    this._equal_6(os_0[i_0].approvalKey,
                                                                                  os_0[j_0].approvalKey)),
                                                                  'duplicate approval key');
                                          __compactRuntime.assert(!(this._isReal_0(os_0[i_0])
                                                                    &&
                                                                    this._isReal_0(os_0[j_0])
                                                                    &&
                                                                    this._equal_7(os_0[i_0].upgradeKey,
                                                                                  os_0[j_0].upgradeKey)),
                                                                  'duplicate upgrade key');
                                        }
                                        return t_2;
                                      }),
                                     [],
                                     [0n, 1n, 2n, 3n, 4n]);
                      return t_1;
                    }),
                   [],
                   [0n, 1n, 2n, 3n, 4n]);
    const count_0 = this._folder_2(((acc_0, o_0) =>
                                    {
                                      if (this._isReal_0(o_0)) {
                                        return ((t1) => {
                                                 if (t1 > 255n) {
                                                   throw new __compactRuntime.CompactError('VaultCore.compact line 92 char 73: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 255');
                                                 }
                                                 return t1;
                                               })(acc_0 + 1n);
                                      } else {
                                        return acc_0;
                                      }
                                    }),
                                   0n,
                                   os_0);
    __compactRuntime.assert(t_0 >= 1n, 'threshold must be at least 1');
    __compactRuntime.assert(t_0 <= count_0,
                            'threshold is above the number of owners');
    return [];
  }
  _checkSeparation_0(os_0, ds_0) {
    this._folder_4(((t_0, i_0) =>
                    {
                      this._folder_3(((t_1, k_0) =>
                                      {
                                        __compactRuntime.assert(!(this._isReal_0(os_0[i_0])
                                                                  &&
                                                                  ds_0[k_0].active
                                                                  &&
                                                                  this._equal_8(os_0[i_0].approvalKey,
                                                                                ds_0[k_0].key)),
                                                                'a delegate key is an owner key');
                                        return t_1;
                                      }),
                                     [],
                                     [0n, 1n]);
                      return t_0;
                    }),
                   [],
                   [0n, 1n, 2n, 3n, 4n]);
    return [];
  }
  _checkPolicy_0(p_0) {
    this._folder_6(((t_0, i_0) =>
                    {
                      __compactRuntime.assert(p_0.whitelist[i_0].active
                                              ||
                                              this._equal_9(p_0.whitelist[i_0],
                                                            { active: false, recipient: new Uint8Array(32), scope: 0 }),
                                              'an unused whitelist entry must be empty');
                      __compactRuntime.assert(!p_0.whitelist[i_0].active
                                              ||
                                              !this._equal_10(p_0.whitelist[i_0].recipient,
                                                              new Uint8Array(32)),
                                              'a whitelist entry has no recipient');
                      this._folder_5(((t_1, j_0) =>
                                      {
                                        if (i_0 < j_0) {
                                          __compactRuntime.assert(!(p_0.whitelist[i_0].active
                                                                    &&
                                                                    p_0.whitelist[j_0].active
                                                                    &&
                                                                    this._equal_11(p_0.whitelist[i_0].recipient,
                                                                                   p_0.whitelist[j_0].recipient)),
                                                                  'duplicate whitelist recipient');
                                        }
                                        return t_1;
                                      }),
                                     [],
                                     [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n]);
                      return t_0;
                    }),
                   [],
                   [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n]);
    this._folder_7(((t_2, k_0) =>
                    {
                      __compactRuntime.assert(p_0.delegates[k_0].active
                                              ||
                                              this._equal_12(p_0.delegates[k_0],
                                                             { active: false, key: ({x: 0n, y: 1n}), cap: 0n, period: 0n }),
                                              'an unused delegate slot must be empty');
                      __compactRuntime.assert(!p_0.delegates[k_0].active
                                              ||
                                              !this._equal_13(p_0.delegates[k_0].key,
                                                              ({x: 0n, y: 1n})),
                                              'delegate key is the identity point');
                      let t_3;
                      __compactRuntime.assert(!p_0.delegates[k_0].active
                                              ||
                                              (t_3 = p_0.delegates[k_0].cap,
                                               t_3 > 0n),
                                              'delegate cap must be positive');
                      let t_4;
                      __compactRuntime.assert(!p_0.delegates[k_0].active
                                              ||
                                              (t_4 = p_0.delegates[k_0].period,
                                               t_4 >= 600n),
                                              'delegate period must be at least 600 seconds');
                      return t_2;
                    }),
                   [],
                   [0n, 1n]);
    __compactRuntime.assert(!(p_0.delegates[0].active && p_0.delegates[1].active
                              &&
                              this._equal_14(p_0.delegates[0].key,
                                             p_0.delegates[1].key)),
                            'duplicate delegate key');
    return [];
  }
  _checkNarrowing_0(cur_0, nw_0) {
    __compactRuntime.assert(!(cur_0.whitelistEnabled && !nw_0.whitelistEnabled),
                            'disabling the whitelist widens the policy');
    this._folder_9(((t_0, j_0) =>
                    {
                      __compactRuntime.assert(!nw_0.whitelist[j_0].active
                                              ||
                                              this._folder_8(((acc_0, c_0) =>
                                                              {
                                                                return acc_0
                                                                       ||
                                                                       c_0.active
                                                                       &&
                                                                       this._equal_15(c_0.recipient,
                                                                                      nw_0.whitelist[j_0].recipient)
                                                                       &&
                                                                       (nw_0.whitelist[j_0].scope
                                                                        ===
                                                                        0
                                                                        ||
                                                                        c_0.scope
                                                                        ===
                                                                        1);
                                                              }),
                                                             false,
                                                             cur_0.whitelist),
                                              'a whitelist entry is new or wider');
                      return t_0;
                    }),
                   [],
                   [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n]);
    this._folder_10(((t_1, k_0) =>
                     {
                       __compactRuntime.assert(!nw_0.delegates[k_0].active
                                               ||
                                               cur_0.delegates[k_0].active
                                               &&
                                               this._equal_16(cur_0.delegates[k_0].key,
                                                              nw_0.delegates[k_0].key),
                                               'a delegate is new or has a new key');
                       let t_2;
                       __compactRuntime.assert(!nw_0.delegates[k_0].active
                                               ||
                                               (t_2 = nw_0.delegates[k_0].cap,
                                                t_2 <= cur_0.delegates[k_0].cap),
                                               'a delegate cap is raised');
                       let t_3;
                       __compactRuntime.assert(!nw_0.delegates[k_0].active
                                               ||
                                               (t_3 = nw_0.delegates[k_0].period,
                                                t_3
                                                >=
                                                cur_0.delegates[k_0].period),
                                               'a delegate period is shortened');
                       return t_1;
                     }),
                    [],
                    [0n, 1n]);
    return [];
  }
  _isListed_0(wl_0, r_0, anyOnly_0) {
    return this._folder_11(((acc_0, e_0) =>
                            {
                              return acc_0
                                     ||
                                     e_0.active
                                     &&
                                     this._equal_17(e_0.recipient, r_0)
                                     &&
                                     (!anyOnly_0 || e_0.scope === 1);
                            }),
                           false,
                           wl_0);
  }
  _isOwnerKey_0(os_0, pk_0) {
    return this._folder_12(((acc_0, o_0) =>
                            {
                              return acc_0
                                     ||
                                     this._isReal_0(o_0)
                                     &&
                                     this._equal_18(o_0.approvalKey, pk_0);
                            }),
                           false,
                           os_0);
  }
  async _requireApprovals_0(context, partialProofData, digest_0, approvals_0) {
    const os_0 = _descriptor_16.fromValue(__compactRuntime.queryLedgerState(context,
                                                                            partialProofData,
                                                                            [
                                                                             { dup: { n: 0 } },
                                                                             { idx: { cached: false,
                                                                                      pushPath: false,
                                                                                      path: [
                                                                                             { tag: 'value',
                                                                                               value: { value: _descriptor_3.toValue(0n),
                                                                                                        alignment: _descriptor_3.alignment() } }] } },
                                                                             { popeq: { cached: false,
                                                                                        result: undefined } }]).value);
    await this._folder_14(context,
                          partialProofData,
                          (async (context, partialProofData, t_0, i_0) =>
                           {
                             await this._folder_13(context,
                                                   partialProofData,
                                                   (async (context,
                                                           partialProofData,
                                                           t_1,
                                                           j_0) =>
                                                    {
                                                      if (i_0 < j_0) {
                                                        __compactRuntime.assert(!(approvals_0[i_0].is_some
                                                                                  &&
                                                                                  approvals_0[j_0].is_some
                                                                                  &&
                                                                                  this._equal_19(approvals_0[i_0].value.signer,
                                                                                                 approvals_0[j_0].value.signer)),
                                                                                'duplicate signer');
                                                      }
                                                      return t_1;
                                                    }),
                                                   [],
                                                   [0n, 1n, 2n, 3n, 4n]);
                             return t_0;
                           }),
                          [],
                          [0n, 1n, 2n, 3n, 4n]);
    const n_0 = await this._folder_15(context,
                                      partialProofData,
                                      (async (context,
                                              partialProofData,
                                              acc_0,
                                              a_0) =>
                                       {
                                         if (a_0.is_some) {
                                           __compactRuntime.assert(this._isOwnerKey_0(os_0,
                                                                                      a_0.value.signer),
                                                                   'signer is not an owner');
                                           __compactRuntime.assert(this._jubjubSchnorrVerify_0([digest_0],
                                                                                               a_0.value.sig,
                                                                                               a_0.value.signer),
                                                                   'invalid signature');
                                           return ((t1) => {
                                                    if (t1 > 255n) {
                                                      throw new __compactRuntime.CompactError('VaultCore.compact line 170 char 16: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 255');
                                                    }
                                                    return t1;
                                                  })(acc_0 + 1n);
                                         } else {
                                           return acc_0;
                                         }
                                       }),
                                      0n,
                                      approvals_0);
    __compactRuntime.assert(n_0
                            >=
                            _descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                      partialProofData,
                                                                                      [
                                                                                       { dup: { n: 0 } },
                                                                                       { idx: { cached: false,
                                                                                                pushPath: false,
                                                                                                path: [
                                                                                                       { tag: 'value',
                                                                                                         value: { value: _descriptor_3.toValue(1n),
                                                                                                                  alignment: _descriptor_3.alignment() } }] } },
                                                                                       { popeq: { cached: false,
                                                                                                  result: undefined } }]).value),
                            'not enough approvals');
    return [];
  }
  async _checkNotBefore_0(context, partialProofData, t_0) {
    __compactRuntime.assert(await this._blockTimeLte_0(context,
                                                       partialProofData,
                                                       t_0),
                            'notBefore is in the past');
    __compactRuntime.assert(t_0 >= 3600n
                            &&
                            await this._blockTimeGte_0(context,
                                                       partialProofData,
                                                       (__compactRuntime.assert(t_0
                                                                                >=
                                                                                3600n,
                                                                                'result of subtraction would be negative'),
                                                        t_0 - 3600n)),
                            'notBefore is more than an hour ahead');
    return [];
  }
  _isGuardian_0(g_0) { return !this._equal_20(g_0.key, ({x: 0n, y: 1n})); }
  _guardianCount_0(gs_0) {
    return this._folder_16(((acc_0, g_0) =>
                            {
                              if (g_0 !== 0n) {
                                return ((t1) => {
                                         if (t1 > 255n) {
                                           throw new __compactRuntime.CompactError('VaultCore.compact line 189 char 74: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 255');
                                         }
                                         return t1;
                                       })(acc_0 + 1n);
                              } else {
                                return acc_0;
                              }
                            }),
                           0n,
                           gs_0);
  }
  _guardianSetFrom_0(gs_0, os_0, pos_0, ds_0, pds_0) {
    this._folder_19(((t_0, i_0) =>
                     {
                       __compactRuntime.assert(this._isGuardian_0(gs_0[i_0])
                                               ||
                                               this._equal_21(gs_0[i_0].salt,
                                                              new Uint8Array(32)),
                                               'an unused guardian slot must be empty');
                       this._folder_17(((t_1, j_0) =>
                                        {
                                          if (i_0 < j_0) {
                                            __compactRuntime.assert(!(this._isGuardian_0(gs_0[i_0])
                                                                      &&
                                                                      this._isGuardian_0(gs_0[j_0])
                                                                      &&
                                                                      this._equal_22(gs_0[i_0].key,
                                                                                     gs_0[j_0].key)),
                                                                    'duplicate guardian key');
                                          }
                                          return t_1;
                                        }),
                                       [],
                                       [0n, 1n, 2n, 3n, 4n]);
                       __compactRuntime.assert(!(this._isGuardian_0(gs_0[i_0])
                                                 &&
                                                 (this._isOwnerKey_0(os_0,
                                                                     gs_0[i_0].key)
                                                  ||
                                                  this._isOwnerKey_0(pos_0,
                                                                     gs_0[i_0].key))),
                                               'a guardian key is an owner key');
                       this._folder_18(((t_2, k_0) =>
                                        {
                                          __compactRuntime.assert(!(this._isGuardian_0(gs_0[i_0])
                                                                    &&
                                                                    (ds_0[k_0].active
                                                                     &&
                                                                     this._equal_23(ds_0[k_0].key,
                                                                                    gs_0[i_0].key)
                                                                     ||
                                                                     pds_0[k_0].active
                                                                     &&
                                                                     this._equal_24(pds_0[k_0].key,
                                                                                    gs_0[i_0].key))),
                                                                  'a guardian key is a delegate key');
                                          return t_2;
                                        }),
                                       [],
                                       [0n, 1n]);
                       return t_0;
                     }),
                    [],
                    [0n, 1n, 2n, 3n, 4n]);
    return this._mapper_2(((g_0) =>
                           {
                             if (this._isGuardian_0(g_0)) {
                               return this._guardianCommitment_0(g_0.key,
                                                                 g_0.salt);
                             } else {
                               return 0n;
                             }
                           }),
                          gs_0);
  }
  _checkRecoveryConfig_0(cfg_0) {
    const n_0 = this._guardianCount_0(cfg_0.guardians);
    let t_1, t_2, t_0;
    __compactRuntime.assert(n_0 === 0n && cfg_0.threshold === 0n
                            ||
                            (t_0 = cfg_0.threshold, t_0 >= 1n)
                            &&
                            (t_2 = cfg_0.threshold, t_2 <= n_0)
                            &&
                            (t_1 = 2n * cfg_0.threshold, t_1 > n_0),
                            'guardian threshold must be a majority of the guardians');
    let t_3;
    __compactRuntime.assert((t_3 = cfg_0.recoveryDelay, t_3 >= 604800n),
                            'recovery delay is below the floor');
    __compactRuntime.assert(cfg_0.expiryWindow === 2592000n,
                            'recovery expiry window is not the build value');
    __compactRuntime.assert(cfg_0.cooldown === 172800n,
                            'recovery cool-down is not the build value');
    this._folder_21(((t_4, i_0) =>
                     {
                       this._folder_20(((t_5, j_0) =>
                                        {
                                          if (i_0 < j_0) {
                                            __compactRuntime.assert(!(cfg_0.guardians[i_0]
                                                                      !==
                                                                      0n
                                                                      &&
                                                                      cfg_0.guardians[i_0]
                                                                      ===
                                                                      cfg_0.guardians[j_0]),
                                                                    'duplicate guardian');
                                          }
                                          return t_5;
                                        }),
                                       [],
                                       [0n, 1n, 2n, 3n, 4n]);
                       return t_4;
                     }),
                    [],
                    [0n, 1n, 2n, 3n, 4n]);
    return [];
  }
  _requireGuardians_0(cfg_0, digest_0, approvals_0) {
    this._folder_23(((t_0, i_0) =>
                     {
                       this._folder_22(((t_1, j_0) =>
                                        {
                                          if (i_0 < j_0) {
                                            __compactRuntime.assert(!(approvals_0[i_0].is_some
                                                                      &&
                                                                      approvals_0[j_0].is_some
                                                                      &&
                                                                      this._equal_25(approvals_0[i_0].value.key,
                                                                                     approvals_0[j_0].value.key)),
                                                                    'duplicate guardian');
                                          }
                                          return t_1;
                                        }),
                                       [],
                                       [0n, 1n, 2n, 3n, 4n]);
                       return t_0;
                     }),
                    [],
                    [0n, 1n, 2n, 3n, 4n]);
    const cs_0 = this._mapper_3(((a_0) =>
                                 {
                                   return this._guardianCommitment_0(a_0.value.key,
                                                                     a_0.value.salt);
                                 }),
                                approvals_0);
    this._folder_25(((t_2, i_1) =>
                     {
                       if (approvals_0[i_1].is_some) {
                         __compactRuntime.assert(this._folder_24(((acc_0, g_0) =>
                                                                  {
                                                                    return acc_0
                                                                           ||
                                                                           g_0
                                                                           !==
                                                                           0n
                                                                           &&
                                                                           g_0
                                                                           ===
                                                                           cs_0[i_1];
                                                                  }),
                                                                 false,
                                                                 cfg_0.guardians),
                                                 'guardian is not in the guardian set');
                         __compactRuntime.assert(this._jubjubSchnorrVerify_0([digest_0],
                                                                             approvals_0[i_1].value.sig,
                                                                             approvals_0[i_1].value.key),
                                                 'invalid guardian signature');
                       }
                       return t_2;
                     }),
                    [],
                    [0n, 1n, 2n, 3n, 4n]);
    const by_0 = this._mapper_4(((g_1) =>
                                 {
                                   return g_1 !== 0n
                                          &&
                                          this._folder_26(((acc_1, a_1, c_0) =>
                                                           {
                                                             return acc_1
                                                                    ||
                                                                    a_1.is_some
                                                                    &&
                                                                    c_0 === g_1;
                                                           }),
                                                          false,
                                                          approvals_0,
                                                          cs_0);
                                 }),
                                cfg_0.guardians);
    const n_0 = this._folder_27(((acc_2, b_0) =>
                                 {
                                   if (b_0) {
                                     return ((t1) => {
                                              if (t1 > 255n) {
                                                throw new __compactRuntime.CompactError('VaultCore.compact line 259 char 63: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 255');
                                              }
                                              return t1;
                                            })(acc_2 + 1n);
                                   } else {
                                     return acc_2;
                                   }
                                 }),
                                0n,
                                by_0);
    let t_3;
    __compactRuntime.assert(n_0 >= cfg_0.threshold
                            &&
                            (t_3 = cfg_0.threshold, t_3 > 0n),
                            'not enough guardian approvals');
    return by_0;
  }
  async _dropRecovery_0(context, partialProofData) {
    const tmp_0 = { active: false, owners: new Array(5).fill({ approvalKey: ({x: 0n, y: 1n}), upgradeKey: new Uint8Array(32) }), threshold: 0n, executableAfter: 0n, expiresAfter: 0n, approvedBy: new Array(5).fill(false) };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(12n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_27.toValue(tmp_0),
                                                                                              alignment: _descriptor_27.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_1 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(13n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_9.toValue(tmp_1),
                                                                alignment: _descriptor_9.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  async _extendCooldown_0(context, partialProofData, until_0) {
    if (until_0
        >
        _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                  partialProofData,
                                                                  [
                                                                   { dup: { n: 0 } },
                                                                   { idx: { cached: false,
                                                                            pushPath: false,
                                                                            path: [
                                                                                   { tag: 'value',
                                                                                     value: { value: _descriptor_3.toValue(14n),
                                                                                              alignment: _descriptor_3.alignment() } }] } },
                                                                   { popeq: { cached: false,
                                                                              result: undefined } }]).value))
    {
      __compactRuntime.queryLedgerState(context,
                                        partialProofData,
                                        [
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(14n),
                                                                                                alignment: _descriptor_3.alignment() }).encode() } },
                                         { push: { storage: true,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(until_0),
                                                                                                alignment: _descriptor_4.alignment() }).encode() } },
                                         { ins: { cached: false, n: 1 } }]);
    }
    return [];
  }
  async _dropRecoveryWithCooldown_0(context, partialProofData, at_0) {
    if (_descriptor_27.fromValue(__compactRuntime.queryLedgerState(context,
                                                                   partialProofData,
                                                                   [
                                                                    { dup: { n: 0 } },
                                                                    { idx: { cached: false,
                                                                             pushPath: false,
                                                                             path: [
                                                                                    { tag: 'value',
                                                                                      value: { value: _descriptor_3.toValue(12n),
                                                                                               alignment: _descriptor_3.alignment() } }] } },
                                                                    { popeq: { cached: false,
                                                                               result: undefined } }]).value).active)
    {
      await this._extendCooldown_0(context,
                                   partialProofData,
                                   ((t1) => {
                                     if (t1 > 18446744073709551615n) {
                                       throw new __compactRuntime.CompactError('VaultCore.compact line 285 char 22: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                                     }
                                     return t1;
                                   })(at_0
                                      +
                                      _descriptor_5.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                partialProofData,
                                                                                                [
                                                                                                 { dup: { n: 0 } },
                                                                                                 { idx: { cached: false,
                                                                                                          pushPath: false,
                                                                                                          path: [
                                                                                                                 { tag: 'value',
                                                                                                                   value: { value: _descriptor_3.toValue(10n),
                                                                                                                            alignment: _descriptor_3.alignment() } }] } },
                                                                                                 { popeq: { cached: false,
                                                                                                            result: undefined } }]).value).cooldown));
    }
    await this._dropRecovery_0(context, partialProofData);
    return [];
  }
  async _init_0(context,
                partialProofData,
                initialOwners_0,
                initialThreshold_0,
                networkTag_0,
                changeDelay_0,
                whitelistEnabled_0,
                whitelist_0,
                guardians_0,
                guardianThreshold_0,
                recoveryDelay_0,
                cooldown_0,
                expiryWindow_0)
  {
    __compactRuntime.assert(!this._equal_26(networkTag_0, new Uint8Array(32)),
                            'network tag must be set');
    this._checkOwnerSet_0(initialOwners_0, initialThreshold_0);
    const p_0 = { whitelistEnabled: whitelistEnabled_0,
                  whitelist: whitelist_0,
                  delegates:
                    new Array(2).fill({ active: false, key: ({x: 0n, y: 1n}), cap: 0n, period: 0n }) };
    this._checkPolicy_0(p_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(0n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_16.toValue(initialOwners_0),
                                                                                              alignment: _descriptor_16.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(1n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(initialThreshold_0),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(3n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_7.toValue(networkTag_0),
                                                                                              alignment: _descriptor_7.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(4n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(changeDelay_0),
                                                                                              alignment: _descriptor_4.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(6n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_24.toValue(p_0),
                                                                                              alignment: _descriptor_24.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    await this._folder_28(context,
                          partialProofData,
                          (async (context, partialProofData, t_0, k_0) =>
                           {
                             const tmp_0 = k_0;
                             const tmp_1 = { start: 0n, spent: 0n };
                             __compactRuntime.queryLedgerState(context,
                                                               partialProofData,
                                                               [
                                                                { idx: { cached: false,
                                                                         pushPath: true,
                                                                         path: [
                                                                                { tag: 'value',
                                                                                  value: { value: _descriptor_3.toValue(8n),
                                                                                           alignment: _descriptor_3.alignment() } }] } },
                                                                { push: { storage: false,
                                                                          value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(tmp_0),
                                                                                                                       alignment: _descriptor_3.alignment() }).encode() } },
                                                                { push: { storage: true,
                                                                          value: __compactRuntime.StateValue.newCell({ value: _descriptor_33.toValue(tmp_1),
                                                                                                                       alignment: _descriptor_33.alignment() }).encode() } },
                                                                { ins: { cached: false,
                                                                         n: 1 } },
                                                                { ins: { cached: true,
                                                                         n: 1 } }]);
                             const tmp_2 = k_0;
                             const tmp_3 = 0n;
                             __compactRuntime.queryLedgerState(context,
                                                               partialProofData,
                                                               [
                                                                { idx: { cached: false,
                                                                         pushPath: true,
                                                                         path: [
                                                                                { tag: 'value',
                                                                                  value: { value: _descriptor_3.toValue(9n),
                                                                                           alignment: _descriptor_3.alignment() } }] } },
                                                                { push: { storage: false,
                                                                          value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(tmp_2),
                                                                                                                       alignment: _descriptor_3.alignment() }).encode() } },
                                                                { push: { storage: true,
                                                                          value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(tmp_3),
                                                                                                                       alignment: _descriptor_4.alignment() }).encode() } },
                                                                { ins: { cached: false,
                                                                         n: 1 } },
                                                                { ins: { cached: true,
                                                                         n: 1 } }]);
                             return t_0;
                           }),
                          [],
                          [0n, 1n]);
    const cfg_0 = { guardians:
                      this._guardianSetFrom_0(guardians_0,
                                              initialOwners_0,
                                              new Array(5).fill({ approvalKey: ({x: 0n, y: 1n}), upgradeKey: new Uint8Array(32) }),
                                              p_0.delegates,
                                              p_0.delegates),
                    threshold: guardianThreshold_0,
                    recoveryDelay: recoveryDelay_0,
                    cooldown: cooldown_0,
                    expiryWindow: expiryWindow_0 };
    this._checkRecoveryConfig_0(cfg_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(10n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_5.toValue(cfg_0),
                                                                                              alignment: _descriptor_5.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    return [];
  }
  async _deposit_0(context, partialProofData, amount_0) {
    __compactRuntime.assert(amount_0 > 0n, 'amount must be positive');
    await this._receiveUnshielded_0(context,
                                    partialProofData,
                                    this._nativeToken_0(),
                                    amount_0);
    return [];
  }
  async _execute_0(context,
                   partialProofData,
                   recipient_0,
                   amount_0,
                   expiry_0,
                   approvals_0)
  {
    const amt_0 = amount_0;
    const exp_0 = expiry_0;
    const to_0 = recipient_0;
    __compactRuntime.assert(amt_0 > 0n, 'amount must be positive');
    __compactRuntime.assert(await this._blockTimeLt_0(context,
                                                      partialProofData,
                                                      exp_0),
                            'approval expired');
    const p_0 = _descriptor_24.fromValue(__compactRuntime.queryLedgerState(context,
                                                                           partialProofData,
                                                                           [
                                                                            { dup: { n: 0 } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_3.toValue(6n),
                                                                                                       alignment: _descriptor_3.alignment() } }] } },
                                                                            { popeq: { cached: false,
                                                                                       result: undefined } }]).value);
    __compactRuntime.assert(!p_0.whitelistEnabled
                            ||
                            this._isListed_0(p_0.whitelist, to_0.bytes, false),
                            'recipient is not on the whitelist');
    __compactRuntime.assert(await this._unshieldedBalanceGte_0(context,
                                                               partialProofData,
                                                               this._nativeToken_0(),
                                                               amt_0),
                            'insufficient vault balance');
    await this._requireApprovals_0(context,
                                   partialProofData,
                                   this._payoutDigest_0(_descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                  partialProofData,
                                                                                                                  [
                                                                                                                   { dup: { n: 2 } },
                                                                                                                   { idx: { cached: true,
                                                                                                                            pushPath: false,
                                                                                                                            path: [
                                                                                                                                   { tag: 'value',
                                                                                                                                     value: { value: _descriptor_3.toValue(0n),
                                                                                                                                              alignment: _descriptor_3.alignment() } }] } },
                                                                                                                   { popeq: { cached: true,
                                                                                                                              result: undefined } }]).value),
                                                        _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                  partialProofData,
                                                                                                                  [
                                                                                                                   { dup: { n: 0 } },
                                                                                                                   { idx: { cached: false,
                                                                                                                            pushPath: false,
                                                                                                                            path: [
                                                                                                                                   { tag: 'value',
                                                                                                                                     value: { value: _descriptor_3.toValue(3n),
                                                                                                                                              alignment: _descriptor_3.alignment() } }] } },
                                                                                                                   { popeq: { cached: false,
                                                                                                                              result: undefined } }]).value),
                                                        _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                  partialProofData,
                                                                                                                  [
                                                                                                                   { dup: { n: 0 } },
                                                                                                                   { idx: { cached: false,
                                                                                                                            pushPath: false,
                                                                                                                            path: [
                                                                                                                                   { tag: 'value',
                                                                                                                                     value: { value: _descriptor_3.toValue(2n),
                                                                                                                                              alignment: _descriptor_3.alignment() } }] } },
                                                                                                                   { popeq: { cached: true,
                                                                                                                              result: undefined } }]).value),
                                                        exp_0,
                                                        to_0,
                                                        amt_0),
                                   approvals_0);
    const tmp_0 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(2n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_9.toValue(tmp_0),
                                                                alignment: _descriptor_9.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    await this._sendUnshielded_0(context,
                                 partialProofData,
                                 this._nativeToken_0(),
                                 amt_0,
                                 this._right_0(to_0));
    return [];
  }
  async _delegatePayout_0(context,
                          partialProofData,
                          slot_0,
                          recipient_0,
                          amount_0,
                          expiry_0,
                          timeClaim_0,
                          sig_0)
  {
    const s_0 = slot_0;
    const to_0 = recipient_0;
    const amt_0 = amount_0;
    const exp_0 = expiry_0;
    __compactRuntime.assert(s_0 < 2n, 'no such delegate slot');
    __compactRuntime.assert(amt_0 > 0n, 'amount must be positive');
    __compactRuntime.assert(await this._blockTimeLt_0(context,
                                                      partialProofData,
                                                      exp_0),
                            'approval expired');
    const p_0 = _descriptor_24.fromValue(__compactRuntime.queryLedgerState(context,
                                                                           partialProofData,
                                                                           [
                                                                            { dup: { n: 0 } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_3.toValue(6n),
                                                                                                       alignment: _descriptor_3.alignment() } }] } },
                                                                            { popeq: { cached: false,
                                                                                       result: undefined } }]).value);
    const d_0 = s_0 === 0n ? p_0.delegates[0] : p_0.delegates[1];
    __compactRuntime.assert(d_0.active, 'not an active delegate');
    __compactRuntime.assert(this._isListed_0(p_0.whitelist, to_0.bytes, true),
                            'recipient is not a whitelist entry of scope Any');
    __compactRuntime.assert(await this._unshieldedBalanceGte_0(context,
                                                               partialProofData,
                                                               this._nativeToken_0(),
                                                               amt_0),
                            'insufficient vault balance');
    const n_0 = _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                          partialProofData,
                                                                          [
                                                                           { dup: { n: 0 } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_3.toValue(9n),
                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_3.toValue(s_0),
                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                           { popeq: { cached: false,
                                                                                      result: undefined } }]).value);
    __compactRuntime.assert(this._jubjubSchnorrVerify_0([this._delegatePayoutDigest_0(_descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                                partialProofData,
                                                                                                                                                [
                                                                                                                                                 { dup: { n: 2 } },
                                                                                                                                                 { idx: { cached: true,
                                                                                                                                                          pushPath: false,
                                                                                                                                                          path: [
                                                                                                                                                                 { tag: 'value',
                                                                                                                                                                   value: { value: _descriptor_3.toValue(0n),
                                                                                                                                                                            alignment: _descriptor_3.alignment() } }] } },
                                                                                                                                                 { popeq: { cached: true,
                                                                                                                                                            result: undefined } }]).value),
                                                                                      _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                                partialProofData,
                                                                                                                                                [
                                                                                                                                                 { dup: { n: 0 } },
                                                                                                                                                 { idx: { cached: false,
                                                                                                                                                          pushPath: false,
                                                                                                                                                          path: [
                                                                                                                                                                 { tag: 'value',
                                                                                                                                                                   value: { value: _descriptor_3.toValue(3n),
                                                                                                                                                                            alignment: _descriptor_3.alignment() } }] } },
                                                                                                                                                 { popeq: { cached: false,
                                                                                                                                                            result: undefined } }]).value),
                                                                                      s_0,
                                                                                      n_0,
                                                                                      exp_0,
                                                                                      to_0,
                                                                                      amt_0)],
                                                        sig_0,
                                                        d_0.key),
                            'invalid delegate signature');
    const w_0 = _descriptor_33.fromValue(__compactRuntime.queryLedgerState(context,
                                                                           partialProofData,
                                                                           [
                                                                            { dup: { n: 0 } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_3.toValue(8n),
                                                                                                       alignment: _descriptor_3.alignment() } }] } },
                                                                            { idx: { cached: false,
                                                                                     pushPath: false,
                                                                                     path: [
                                                                                            { tag: 'value',
                                                                                              value: { value: _descriptor_3.toValue(s_0),
                                                                                                       alignment: _descriptor_3.alignment() } }] } },
                                                                            { popeq: { cached: false,
                                                                                       result: undefined } }]).value);
    if (timeClaim_0.is_some) {
      const t_0 = timeClaim_0.value;
      __compactRuntime.assert(t_0 >= w_0.start + d_0.period,
                              'the window has not ended');
      __compactRuntime.assert(await this._blockTimeGte_0(context,
                                                         partialProofData,
                                                         t_0),
                              'time claim is in the future');
      __compactRuntime.assert(await this._blockTimeLt_0(context,
                                                        partialProofData,
                                                        ((t1) => {
                                                          if (t1 > 18446744073709551615n) {
                                                            throw new __compactRuntime.CompactError('VaultCore.compact line 369 char 26: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                                                          }
                                                          return t1;
                                                        })(t_0 + d_0.period)),
                              'time claim is a full period old');
      __compactRuntime.assert(amt_0 <= d_0.cap,
                              'delegate cap exceeded for this window');
      const tmp_0 = { start: t_0, spent: amt_0 };
      __compactRuntime.queryLedgerState(context,
                                        partialProofData,
                                        [
                                         { idx: { cached: false,
                                                  pushPath: true,
                                                  path: [
                                                         { tag: 'value',
                                                           value: { value: _descriptor_3.toValue(8n),
                                                                    alignment: _descriptor_3.alignment() } }] } },
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(s_0),
                                                                                                alignment: _descriptor_3.alignment() }).encode() } },
                                         { push: { storage: true,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_33.toValue(tmp_0),
                                                                                                alignment: _descriptor_33.alignment() }).encode() } },
                                         { ins: { cached: false, n: 1 } },
                                         { ins: { cached: true, n: 1 } }]);
    } else {
      let t_1;
      __compactRuntime.assert((t_1 = w_0.spent + amt_0, t_1 <= d_0.cap),
                              'delegate cap exceeded for this window');
      const tmp_1 = { start: w_0.start,
                      spent:
                        ((t1) => {
                          if (t1 > 340282366920938463463374607431768211455n) {
                            throw new __compactRuntime.CompactError('VaultCore.compact line 374 char 64: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 340282366920938463463374607431768211455');
                          }
                          return t1;
                        })(w_0.spent + amt_0) };
      __compactRuntime.queryLedgerState(context,
                                        partialProofData,
                                        [
                                         { idx: { cached: false,
                                                  pushPath: true,
                                                  path: [
                                                         { tag: 'value',
                                                           value: { value: _descriptor_3.toValue(8n),
                                                                    alignment: _descriptor_3.alignment() } }] } },
                                         { push: { storage: false,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(s_0),
                                                                                                alignment: _descriptor_3.alignment() }).encode() } },
                                         { push: { storage: true,
                                                   value: __compactRuntime.StateValue.newCell({ value: _descriptor_33.toValue(tmp_1),
                                                                                                alignment: _descriptor_33.alignment() }).encode() } },
                                         { ins: { cached: false, n: 1 } },
                                         { ins: { cached: true, n: 1 } }]);
    }
    const tmp_2 = ((t1) => {
                    if (t1 > 18446744073709551615n) {
                      throw new __compactRuntime.CompactError('VaultCore.compact line 376 char 29: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                    }
                    return t1;
                  })(n_0 + 1n);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(9n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(s_0),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(tmp_2),
                                                                                              alignment: _descriptor_4.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } },
                                       { ins: { cached: true, n: 1 } }]);
    await this._sendUnshielded_0(context,
                                 partialProofData,
                                 this._nativeToken_0(),
                                 amt_0,
                                 this._right_0(to_0));
    return [];
  }
  async _proposeOwners_0(context,
                         partialProofData,
                         newOwners_0,
                         newThreshold_0,
                         notBefore_0,
                         expiry_0,
                         approvals_0)
  {
    __compactRuntime.assert(!_descriptor_17.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                        partialProofData,
                                                                                        [
                                                                                         { dup: { n: 0 } },
                                                                                         { idx: { cached: false,
                                                                                                  pushPath: false,
                                                                                                  path: [
                                                                                                         { tag: 'value',
                                                                                                           value: { value: _descriptor_3.toValue(5n),
                                                                                                                    alignment: _descriptor_3.alignment() } }] } },
                                                                                         { popeq: { cached: false,
                                                                                                    result: undefined } }]).value).active,
                            'an owner change is already pending');
    const exp_0 = expiry_0;
    const t_0 = notBefore_0;
    __compactRuntime.assert(await this._blockTimeLt_0(context,
                                                      partialProofData,
                                                      exp_0),
                            'approval expired');
    await this._checkNotBefore_0(context, partialProofData, t_0);
    this._checkOwnerSet_0(newOwners_0, newThreshold_0);
    this._checkSeparation_0(newOwners_0,
                            _descriptor_24.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_3.toValue(6n),
                                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value).delegates);
    this._checkSeparation_0(newOwners_0,
                            _descriptor_25.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_3.toValue(7n),
                                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value).policy.delegates);
    await this._requireApprovals_0(context,
                                   partialProofData,
                                   this._ownerStatementDigest_0(new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 45, 118, 97, 117, 108, 116, 58, 112, 114, 111, 112, 111, 115, 101, 45, 111, 119, 110, 101, 114, 115, 58, 118, 50]),
                                                                _descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 2 } },
                                                                                                                           { idx: { cached: true,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(0n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(3n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: false,
                                                                                                                                      result: undefined } }]).value),
                                                                _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(2n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                exp_0,
                                                                this._ownerSetCommitment_0(newOwners_0,
                                                                                           newThreshold_0)),
                                   approvals_0);
    const tmp_0 = { active: true,
                    owners: newOwners_0,
                    threshold: newThreshold_0,
                    executableAfter:
                      ((t1) => {
                        if (t1 > 18446744073709551615n) {
                          throw new __compactRuntime.CompactError('VaultCore.compact line 395 char 54: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                        }
                        return t1;
                      })(t_0
                         +
                         _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                   partialProofData,
                                                                                   [
                                                                                    { dup: { n: 0 } },
                                                                                    { idx: { cached: false,
                                                                                             pushPath: false,
                                                                                             path: [
                                                                                                    { tag: 'value',
                                                                                                      value: { value: _descriptor_3.toValue(4n),
                                                                                                               alignment: _descriptor_3.alignment() } }] } },
                                                                                    { popeq: { cached: false,
                                                                                               result: undefined } }]).value)) };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(5n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_17.toValue(tmp_0),
                                                                                              alignment: _descriptor_17.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    await this._dropRecoveryWithCooldown_0(context, partialProofData, t_0);
    const tmp_1 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(2n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_9.toValue(tmp_1),
                                                                alignment: _descriptor_9.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  async _cancelOwners_0(context, partialProofData, expiry_0, approvals_0) {
    const pend_0 = _descriptor_17.fromValue(__compactRuntime.queryLedgerState(context,
                                                                              partialProofData,
                                                                              [
                                                                               { dup: { n: 0 } },
                                                                               { idx: { cached: false,
                                                                                        pushPath: false,
                                                                                        path: [
                                                                                               { tag: 'value',
                                                                                                 value: { value: _descriptor_3.toValue(5n),
                                                                                                          alignment: _descriptor_3.alignment() } }] } },
                                                                               { popeq: { cached: false,
                                                                                          result: undefined } }]).value);
    __compactRuntime.assert(pend_0.active, 'no owner change is pending');
    const exp_0 = expiry_0;
    __compactRuntime.assert(await this._blockTimeLt_0(context,
                                                      partialProofData,
                                                      exp_0),
                            'approval expired');
    await this._requireApprovals_0(context,
                                   partialProofData,
                                   this._ownerStatementDigest_0(new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 45, 118, 97, 117, 108, 116, 58, 99, 97, 110, 99, 101, 108, 45, 111, 119, 110, 101, 114, 115, 58, 118, 50, 0]),
                                                                _descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 2 } },
                                                                                                                           { idx: { cached: true,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(0n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(3n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: false,
                                                                                                                                      result: undefined } }]).value),
                                                                _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(2n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                exp_0,
                                                                this._ownerSetCommitment_0(pend_0.owners,
                                                                                           pend_0.threshold)),
                                   approvals_0);
    const tmp_0 = { active: false, owners: new Array(5).fill({ approvalKey: ({x: 0n, y: 1n}), upgradeKey: new Uint8Array(32) }), threshold: 0n, executableAfter: 0n };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(5n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_17.toValue(tmp_0),
                                                                                              alignment: _descriptor_17.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_1 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(2n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_9.toValue(tmp_1),
                                                                alignment: _descriptor_9.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  async _applyOwners_0(context, partialProofData) {
    const pend_0 = _descriptor_17.fromValue(__compactRuntime.queryLedgerState(context,
                                                                              partialProofData,
                                                                              [
                                                                               { dup: { n: 0 } },
                                                                               { idx: { cached: false,
                                                                                        pushPath: false,
                                                                                        path: [
                                                                                               { tag: 'value',
                                                                                                 value: { value: _descriptor_3.toValue(5n),
                                                                                                          alignment: _descriptor_3.alignment() } }] } },
                                                                               { popeq: { cached: false,
                                                                                          result: undefined } }]).value);
    __compactRuntime.assert(pend_0.active, 'no owner change is pending');
    __compactRuntime.assert(await this._blockTimeGte_0(context,
                                                       partialProofData,
                                                       pend_0.executableAfter),
                            'owner change is not executable yet');
    this._checkSeparation_0(pend_0.owners,
                            _descriptor_24.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_3.toValue(6n),
                                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value).delegates);
    const tmp_0 = pend_0.owners;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(0n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_16.toValue(tmp_0),
                                                                                              alignment: _descriptor_16.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_1 = pend_0.threshold;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(1n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(tmp_1),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_2 = { active: false, owners: new Array(5).fill({ approvalKey: ({x: 0n, y: 1n}), upgradeKey: new Uint8Array(32) }), threshold: 0n, executableAfter: 0n };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(5n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_17.toValue(tmp_2),
                                                                                              alignment: _descriptor_17.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    await this._dropRecovery_0(context, partialProofData);
    const tmp_3 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(2n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_9.toValue(tmp_3),
                                                                alignment: _descriptor_9.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  async _retireDelegates_0(context, partialProofData, cur_0, nw_0) {
    await this._folder_29(context,
                          partialProofData,
                          (async (context, partialProofData, t_0, k_0) =>
                           {
                             if (cur_0.delegates[k_0].active
                                 &&
                                 !(nw_0.delegates[k_0].active
                                   &&
                                   this._equal_27(nw_0.delegates[k_0].key,
                                                  cur_0.delegates[k_0].key)))
                             {
                               const tmp_0 = k_0;
                               let tmp_1;
                               const tmp_2 = ((t1) => {
                                               if (t1 > 18446744073709551615n) {
                                                 throw new __compactRuntime.CompactError('VaultCore.compact line 436 char 33: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                                               }
                                               return t1;
                                             })((tmp_1 = k_0,
                                                 _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                           partialProofData,
                                                                                                           [
                                                                                                            { dup: { n: 0 } },
                                                                                                            { idx: { cached: false,
                                                                                                                     pushPath: false,
                                                                                                                     path: [
                                                                                                                            { tag: 'value',
                                                                                                                              value: { value: _descriptor_3.toValue(9n),
                                                                                                                                       alignment: _descriptor_3.alignment() } }] } },
                                                                                                            { idx: { cached: false,
                                                                                                                     pushPath: false,
                                                                                                                     path: [
                                                                                                                            { tag: 'value',
                                                                                                                              value: { value: _descriptor_3.toValue(tmp_1),
                                                                                                                                       alignment: _descriptor_3.alignment() } }] } },
                                                                                                            { popeq: { cached: false,
                                                                                                                       result: undefined } }]).value))
                                                +
                                                1n);
                               __compactRuntime.queryLedgerState(context,
                                                                 partialProofData,
                                                                 [
                                                                  { idx: { cached: false,
                                                                           pushPath: true,
                                                                           path: [
                                                                                  { tag: 'value',
                                                                                    value: { value: _descriptor_3.toValue(9n),
                                                                                             alignment: _descriptor_3.alignment() } }] } },
                                                                  { push: { storage: false,
                                                                            value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(tmp_0),
                                                                                                                         alignment: _descriptor_3.alignment() }).encode() } },
                                                                  { push: { storage: true,
                                                                            value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(tmp_2),
                                                                                                                         alignment: _descriptor_4.alignment() }).encode() } },
                                                                  { ins: { cached: false,
                                                                           n: 1 } },
                                                                  { ins: { cached: true,
                                                                           n: 1 } }]);
                             }
                             return t_0;
                           }),
                          [],
                          [0n, 1n]);
    return [];
  }
  async _proposePolicy_0(context,
                         partialProofData,
                         newPolicy_0,
                         notBefore_0,
                         expiry_0,
                         approvals_0)
  {
    __compactRuntime.assert(!_descriptor_25.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                        partialProofData,
                                                                                        [
                                                                                         { dup: { n: 0 } },
                                                                                         { idx: { cached: false,
                                                                                                  pushPath: false,
                                                                                                  path: [
                                                                                                         { tag: 'value',
                                                                                                           value: { value: _descriptor_3.toValue(7n),
                                                                                                                    alignment: _descriptor_3.alignment() } }] } },
                                                                                         { popeq: { cached: false,
                                                                                                    result: undefined } }]).value).active,
                            'a policy change is already pending');
    const exp_0 = expiry_0;
    const t_0 = notBefore_0;
    __compactRuntime.assert(await this._blockTimeLt_0(context,
                                                      partialProofData,
                                                      exp_0),
                            'approval expired');
    await this._checkNotBefore_0(context, partialProofData, t_0);
    this._checkPolicy_0(newPolicy_0);
    this._checkSeparation_0(_descriptor_16.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_3.toValue(0n),
                                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value),
                            newPolicy_0.delegates);
    this._checkSeparation_0(_descriptor_17.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_3.toValue(5n),
                                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value).owners,
                            newPolicy_0.delegates);
    await this._requireApprovals_0(context,
                                   partialProofData,
                                   this._ownerStatementDigest_0(new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 45, 118, 97, 117, 108, 116, 58, 112, 114, 111, 112, 111, 115, 101, 45, 112, 111, 108, 105, 99, 121, 58, 118, 49]),
                                                                _descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 2 } },
                                                                                                                           { idx: { cached: true,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(0n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(3n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: false,
                                                                                                                                      result: undefined } }]).value),
                                                                _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(2n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                exp_0,
                                                                this._policyCommitment_0(newPolicy_0)),
                                   approvals_0);
    const tmp_0 = { active: true,
                    policy: newPolicy_0,
                    executableAfter:
                      ((t1) => {
                        if (t1 > 18446744073709551615n) {
                          throw new __compactRuntime.CompactError('VaultCore.compact line 453 char 97: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                        }
                        return t1;
                      })(t_0
                         +
                         _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                   partialProofData,
                                                                                   [
                                                                                    { dup: { n: 0 } },
                                                                                    { idx: { cached: false,
                                                                                             pushPath: false,
                                                                                             path: [
                                                                                                    { tag: 'value',
                                                                                                      value: { value: _descriptor_3.toValue(4n),
                                                                                                               alignment: _descriptor_3.alignment() } }] } },
                                                                                    { popeq: { cached: false,
                                                                                               result: undefined } }]).value)) };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(7n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_25.toValue(tmp_0),
                                                                                              alignment: _descriptor_25.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_1 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(2n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_9.toValue(tmp_1),
                                                                alignment: _descriptor_9.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  async _cancelPolicy_0(context, partialProofData, expiry_0, approvals_0) {
    const pend_0 = _descriptor_25.fromValue(__compactRuntime.queryLedgerState(context,
                                                                              partialProofData,
                                                                              [
                                                                               { dup: { n: 0 } },
                                                                               { idx: { cached: false,
                                                                                        pushPath: false,
                                                                                        path: [
                                                                                               { tag: 'value',
                                                                                                 value: { value: _descriptor_3.toValue(7n),
                                                                                                          alignment: _descriptor_3.alignment() } }] } },
                                                                               { popeq: { cached: false,
                                                                                          result: undefined } }]).value);
    __compactRuntime.assert(pend_0.active, 'no policy change is pending');
    const exp_0 = expiry_0;
    __compactRuntime.assert(await this._blockTimeLt_0(context,
                                                      partialProofData,
                                                      exp_0),
                            'approval expired');
    await this._requireApprovals_0(context,
                                   partialProofData,
                                   this._ownerStatementDigest_0(new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 45, 118, 97, 117, 108, 116, 58, 99, 97, 110, 99, 101, 108, 45, 112, 111, 108, 105, 99, 121, 58, 118, 49, 0]),
                                                                _descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 2 } },
                                                                                                                           { idx: { cached: true,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(0n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(3n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: false,
                                                                                                                                      result: undefined } }]).value),
                                                                _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(2n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                exp_0,
                                                                this._policyCommitment_0(pend_0.policy)),
                                   approvals_0);
    const tmp_0 = { active: false, policy: { whitelistEnabled: false, whitelist: new Array(8).fill({ active: false, recipient: new Uint8Array(32), scope: 0 }), delegates: new Array(2).fill({ active: false, key: ({x: 0n, y: 1n}), cap: 0n, period: 0n }) }, executableAfter: 0n };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(7n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_25.toValue(tmp_0),
                                                                                              alignment: _descriptor_25.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_1 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(2n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_9.toValue(tmp_1),
                                                                alignment: _descriptor_9.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  async _applyPolicy_0(context, partialProofData) {
    const pend_0 = _descriptor_25.fromValue(__compactRuntime.queryLedgerState(context,
                                                                              partialProofData,
                                                                              [
                                                                               { dup: { n: 0 } },
                                                                               { idx: { cached: false,
                                                                                        pushPath: false,
                                                                                        path: [
                                                                                               { tag: 'value',
                                                                                                 value: { value: _descriptor_3.toValue(7n),
                                                                                                          alignment: _descriptor_3.alignment() } }] } },
                                                                               { popeq: { cached: false,
                                                                                          result: undefined } }]).value);
    __compactRuntime.assert(pend_0.active, 'no policy change is pending');
    __compactRuntime.assert(await this._blockTimeGte_0(context,
                                                       partialProofData,
                                                       pend_0.executableAfter),
                            'policy change is not executable yet');
    this._checkSeparation_0(_descriptor_16.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_3.toValue(0n),
                                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value),
                            pend_0.policy.delegates);
    const cur_0 = _descriptor_24.fromValue(__compactRuntime.queryLedgerState(context,
                                                                             partialProofData,
                                                                             [
                                                                              { dup: { n: 0 } },
                                                                              { idx: { cached: false,
                                                                                       pushPath: false,
                                                                                       path: [
                                                                                              { tag: 'value',
                                                                                                value: { value: _descriptor_3.toValue(6n),
                                                                                                         alignment: _descriptor_3.alignment() } }] } },
                                                                              { popeq: { cached: false,
                                                                                         result: undefined } }]).value);
    await this._folder_30(context,
                          partialProofData,
                          (async (context, partialProofData, t_0, k_0) =>
                           {
                             if (!this._equal_28(cur_0.delegates[k_0],
                                                 pend_0.policy.delegates[k_0]))
                             {
                               const tmp_0 = k_0;
                               const tmp_1 = { start: pend_0.executableAfter,
                                               spent: 0n };
                               __compactRuntime.queryLedgerState(context,
                                                                 partialProofData,
                                                                 [
                                                                  { idx: { cached: false,
                                                                           pushPath: true,
                                                                           path: [
                                                                                  { tag: 'value',
                                                                                    value: { value: _descriptor_3.toValue(8n),
                                                                                             alignment: _descriptor_3.alignment() } }] } },
                                                                  { push: { storage: false,
                                                                            value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(tmp_0),
                                                                                                                         alignment: _descriptor_3.alignment() }).encode() } },
                                                                  { push: { storage: true,
                                                                            value: __compactRuntime.StateValue.newCell({ value: _descriptor_33.toValue(tmp_1),
                                                                                                                         alignment: _descriptor_33.alignment() }).encode() } },
                                                                  { ins: { cached: false,
                                                                           n: 1 } },
                                                                  { ins: { cached: true,
                                                                           n: 1 } }]);
                             }
                             return t_0;
                           }),
                          [],
                          [0n, 1n]);
    await this._retireDelegates_0(context,
                                  partialProofData,
                                  cur_0,
                                  pend_0.policy);
    const tmp_2 = pend_0.policy;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(6n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_24.toValue(tmp_2),
                                                                                              alignment: _descriptor_24.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_3 = { active: false, policy: { whitelistEnabled: false, whitelist: new Array(8).fill({ active: false, recipient: new Uint8Array(32), scope: 0 }), delegates: new Array(2).fill({ active: false, key: ({x: 0n, y: 1n}), cap: 0n, period: 0n }) }, executableAfter: 0n };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(7n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_25.toValue(tmp_3),
                                                                                              alignment: _descriptor_25.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_4 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(2n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_9.toValue(tmp_4),
                                                                alignment: _descriptor_9.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  async _narrowPolicy_0(context,
                        partialProofData,
                        newPolicy_0,
                        expiry_0,
                        approvals_0)
  {
    const exp_0 = expiry_0;
    __compactRuntime.assert(await this._blockTimeLt_0(context,
                                                      partialProofData,
                                                      exp_0),
                            'approval expired');
    const cur_0 = _descriptor_24.fromValue(__compactRuntime.queryLedgerState(context,
                                                                             partialProofData,
                                                                             [
                                                                              { dup: { n: 0 } },
                                                                              { idx: { cached: false,
                                                                                       pushPath: false,
                                                                                       path: [
                                                                                              { tag: 'value',
                                                                                                value: { value: _descriptor_3.toValue(6n),
                                                                                                         alignment: _descriptor_3.alignment() } }] } },
                                                                              { popeq: { cached: false,
                                                                                         result: undefined } }]).value);
    const nw_0 = newPolicy_0;
    this._checkPolicy_0(nw_0);
    this._checkNarrowing_0(cur_0, nw_0);
    await this._requireApprovals_0(context,
                                   partialProofData,
                                   this._ownerStatementDigest_0(new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 45, 118, 97, 117, 108, 116, 58, 110, 97, 114, 114, 111, 119, 45, 112, 111, 108, 105, 99, 121, 58, 118, 49, 0]),
                                                                _descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 2 } },
                                                                                                                           { idx: { cached: true,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(0n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(3n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: false,
                                                                                                                                      result: undefined } }]).value),
                                                                _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(2n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                exp_0,
                                                                this._policyCommitment_0(nw_0)),
                                   approvals_0);
    await this._retireDelegates_0(context, partialProofData, cur_0, nw_0);
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(6n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_24.toValue(nw_0),
                                                                                              alignment: _descriptor_24.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_0 = { active: false, policy: { whitelistEnabled: false, whitelist: new Array(8).fill({ active: false, recipient: new Uint8Array(32), scope: 0 }), delegates: new Array(2).fill({ active: false, key: ({x: 0n, y: 1n}), cap: 0n, period: 0n }) }, executableAfter: 0n };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(7n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_25.toValue(tmp_0),
                                                                                              alignment: _descriptor_25.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_1 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(2n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_9.toValue(tmp_1),
                                                                alignment: _descriptor_9.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  async _proposeRecovery_0(context,
                           partialProofData,
                           newOwners_0,
                           newThreshold_0,
                           notBefore_0,
                           expiry_0,
                           approvals_0)
  {
    const cfg_0 = _descriptor_5.fromValue(__compactRuntime.queryLedgerState(context,
                                                                            partialProofData,
                                                                            [
                                                                             { dup: { n: 0 } },
                                                                             { idx: { cached: false,
                                                                                      pushPath: false,
                                                                                      path: [
                                                                                             { tag: 'value',
                                                                                               value: { value: _descriptor_3.toValue(10n),
                                                                                                        alignment: _descriptor_3.alignment() } }] } },
                                                                             { popeq: { cached: false,
                                                                                        result: undefined } }]).value);
    let t_0;
    __compactRuntime.assert((t_0 = cfg_0.threshold, t_0 > 0n),
                            'no guardians are set');
    const pend_0 = _descriptor_27.fromValue(__compactRuntime.queryLedgerState(context,
                                                                              partialProofData,
                                                                              [
                                                                               { dup: { n: 0 } },
                                                                               { idx: { cached: false,
                                                                                        pushPath: false,
                                                                                        path: [
                                                                                               { tag: 'value',
                                                                                                 value: { value: _descriptor_3.toValue(12n),
                                                                                                          alignment: _descriptor_3.alignment() } }] } },
                                                                               { popeq: { cached: false,
                                                                                          result: undefined } }]).value);
    if (pend_0.active) {
      __compactRuntime.assert(await this._blockTimeGte_0(context,
                                                         partialProofData,
                                                         pend_0.expiresAfter),
                              'a recovery is already pending');
      __compactRuntime.assert(await this._blockTimeGte_0(context,
                                                         partialProofData,
                                                         ((t1) => {
                                                           if (t1 > 18446744073709551615n) {
                                                             throw new __compactRuntime.CompactError('VaultCore.compact line 520 char 27: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                                                           }
                                                           return t1;
                                                         })(pend_0.expiresAfter
                                                            +
                                                            cfg_0.cooldown)),
                              'recovery is cooling down');
    }
    __compactRuntime.assert(await this._blockTimeGte_0(context,
                                                       partialProofData,
                                                       _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                 partialProofData,
                                                                                                                 [
                                                                                                                  { dup: { n: 0 } },
                                                                                                                  { idx: { cached: false,
                                                                                                                           pushPath: false,
                                                                                                                           path: [
                                                                                                                                  { tag: 'value',
                                                                                                                                    value: { value: _descriptor_3.toValue(14n),
                                                                                                                                             alignment: _descriptor_3.alignment() } }] } },
                                                                                                                  { popeq: { cached: false,
                                                                                                                             result: undefined } }]).value)),
                            'recovery is cooling down');
    const exp_0 = expiry_0;
    const t_1 = notBefore_0;
    __compactRuntime.assert(await this._blockTimeLt_0(context,
                                                      partialProofData,
                                                      exp_0),
                            'approval expired');
    await this._checkNotBefore_0(context, partialProofData, t_1);
    this._checkOwnerSet_0(newOwners_0, newThreshold_0);
    this._checkSeparation_0(newOwners_0,
                            _descriptor_24.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_3.toValue(6n),
                                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value).delegates);
    this._checkSeparation_0(newOwners_0,
                            _descriptor_25.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_3.toValue(7n),
                                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value).policy.delegates);
    const by_0 = this._requireGuardians_0(cfg_0,
                                          this._ownerStatementDigest_0(new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 45, 118, 97, 117, 108, 116, 58, 112, 114, 111, 112, 111, 115, 101, 45, 114, 101, 99, 111, 118, 58, 118, 49, 0]),
                                                                       _descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                 partialProofData,
                                                                                                                                 [
                                                                                                                                  { dup: { n: 2 } },
                                                                                                                                  { idx: { cached: true,
                                                                                                                                           pushPath: false,
                                                                                                                                           path: [
                                                                                                                                                  { tag: 'value',
                                                                                                                                                    value: { value: _descriptor_3.toValue(0n),
                                                                                                                                                             alignment: _descriptor_3.alignment() } }] } },
                                                                                                                                  { popeq: { cached: true,
                                                                                                                                             result: undefined } }]).value),
                                                                       _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                 partialProofData,
                                                                                                                                 [
                                                                                                                                  { dup: { n: 0 } },
                                                                                                                                  { idx: { cached: false,
                                                                                                                                           pushPath: false,
                                                                                                                                           path: [
                                                                                                                                                  { tag: 'value',
                                                                                                                                                    value: { value: _descriptor_3.toValue(3n),
                                                                                                                                                             alignment: _descriptor_3.alignment() } }] } },
                                                                                                                                  { popeq: { cached: false,
                                                                                                                                             result: undefined } }]).value),
                                                                       _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                                 partialProofData,
                                                                                                                                 [
                                                                                                                                  { dup: { n: 0 } },
                                                                                                                                  { idx: { cached: false,
                                                                                                                                           pushPath: false,
                                                                                                                                           path: [
                                                                                                                                                  { tag: 'value',
                                                                                                                                                    value: { value: _descriptor_3.toValue(13n),
                                                                                                                                                             alignment: _descriptor_3.alignment() } }] } },
                                                                                                                                  { popeq: { cached: true,
                                                                                                                                             result: undefined } }]).value),
                                                                       exp_0,
                                                                       this._ownerSetCommitment_0(newOwners_0,
                                                                                                  newThreshold_0)),
                                          approvals_0);
    await this._folder_32(context,
                          partialProofData,
                          (async (context, partialProofData, t_2, i_0) =>
                           {
                             await this._folder_31(context,
                                                   partialProofData,
                                                   (async (context,
                                                           partialProofData,
                                                           t_3,
                                                           j_0) =>
                                                    {
                                                      __compactRuntime.assert(!(approvals_0[i_0].is_some
                                                                                &&
                                                                                this._isReal_0(newOwners_0[j_0])
                                                                                &&
                                                                                this._equal_29(newOwners_0[j_0].approvalKey,
                                                                                               approvals_0[i_0].value.key)),
                                                                              'a new owner key is a guardian key');
                                                      return t_3;
                                                    }),
                                                   [],
                                                   [0n, 1n, 2n, 3n, 4n]);
                             return t_2;
                           }),
                          [],
                          [0n, 1n, 2n, 3n, 4n]);
    const after_0 = ((t1) => {
                      if (t1 > 18446744073709551615n) {
                        throw new __compactRuntime.CompactError('VaultCore.compact line 538 char 19: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                      }
                      return t1;
                    })(t_1 + cfg_0.recoveryDelay);
    const tmp_0 = { active: true,
                    owners: newOwners_0,
                    threshold: newThreshold_0,
                    executableAfter: after_0,
                    expiresAfter:
                      ((t1) => {
                        if (t1 > 18446744073709551615n) {
                          throw new __compactRuntime.CompactError('VaultCore.compact line 540 char 79: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                        }
                        return t1;
                      })(after_0 + cfg_0.expiryWindow),
                    approvedBy: by_0 };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(12n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_27.toValue(tmp_0),
                                                                                              alignment: _descriptor_27.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_1 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(13n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_9.toValue(tmp_1),
                                                                alignment: _descriptor_9.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  async _cancelRecovery_0(context, partialProofData, at_0, expiry_0, approvals_0)
  {
    const pend_0 = _descriptor_27.fromValue(__compactRuntime.queryLedgerState(context,
                                                                              partialProofData,
                                                                              [
                                                                               { dup: { n: 0 } },
                                                                               { idx: { cached: false,
                                                                                        pushPath: false,
                                                                                        path: [
                                                                                               { tag: 'value',
                                                                                                 value: { value: _descriptor_3.toValue(12n),
                                                                                                          alignment: _descriptor_3.alignment() } }] } },
                                                                               { popeq: { cached: false,
                                                                                          result: undefined } }]).value);
    __compactRuntime.assert(pend_0.active, 'no recovery is pending');
    const exp_0 = expiry_0;
    const t_0 = at_0;
    __compactRuntime.assert(await this._blockTimeLt_0(context,
                                                      partialProofData,
                                                      exp_0),
                            'approval expired');
    await this._checkNotBefore_0(context, partialProofData, t_0);
    await this._requireApprovals_0(context,
                                   partialProofData,
                                   this._ownerStatementDigest_0(new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 45, 118, 97, 117, 108, 116, 58, 99, 97, 110, 99, 101, 108, 45, 114, 101, 99, 111, 118, 58, 118, 50, 0, 0]),
                                                                _descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 2 } },
                                                                                                                           { idx: { cached: true,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(0n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(3n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: false,
                                                                                                                                      result: undefined } }]).value),
                                                                _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(13n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                exp_0,
                                                                this._ownerSetCommitment_0(pend_0.owners,
                                                                                           pend_0.threshold)),
                                   approvals_0);
    await this._dropRecoveryWithCooldown_0(context, partialProofData, t_0);
    return [];
  }
  async _withdrawRecovery_0(context,
                            partialProofData,
                            at_0,
                            expiry_0,
                            approvals_0)
  {
    const pend_0 = _descriptor_27.fromValue(__compactRuntime.queryLedgerState(context,
                                                                              partialProofData,
                                                                              [
                                                                               { dup: { n: 0 } },
                                                                               { idx: { cached: false,
                                                                                        pushPath: false,
                                                                                        path: [
                                                                                               { tag: 'value',
                                                                                                 value: { value: _descriptor_3.toValue(12n),
                                                                                                          alignment: _descriptor_3.alignment() } }] } },
                                                                               { popeq: { cached: false,
                                                                                          result: undefined } }]).value);
    __compactRuntime.assert(pend_0.active, 'no recovery is pending');
    const exp_0 = expiry_0;
    const t_0 = at_0;
    __compactRuntime.assert(await this._blockTimeLt_0(context,
                                                      partialProofData,
                                                      exp_0),
                            'approval expired');
    await this._checkNotBefore_0(context, partialProofData, t_0);
    this._requireGuardians_0(_descriptor_5.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_3.toValue(10n),
                                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value),
                             this._ownerStatementDigest_0(new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 45, 118, 97, 117, 108, 116, 58, 119, 105, 116, 104, 100, 114, 97, 119, 45, 114, 101, 99, 111, 118, 58, 118, 49]),
                                                          _descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                    partialProofData,
                                                                                                                    [
                                                                                                                     { dup: { n: 2 } },
                                                                                                                     { idx: { cached: true,
                                                                                                                              pushPath: false,
                                                                                                                              path: [
                                                                                                                                     { tag: 'value',
                                                                                                                                       value: { value: _descriptor_3.toValue(0n),
                                                                                                                                                alignment: _descriptor_3.alignment() } }] } },
                                                                                                                     { popeq: { cached: true,
                                                                                                                                result: undefined } }]).value),
                                                          _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                    partialProofData,
                                                                                                                    [
                                                                                                                     { dup: { n: 0 } },
                                                                                                                     { idx: { cached: false,
                                                                                                                              pushPath: false,
                                                                                                                              path: [
                                                                                                                                     { tag: 'value',
                                                                                                                                       value: { value: _descriptor_3.toValue(3n),
                                                                                                                                                alignment: _descriptor_3.alignment() } }] } },
                                                                                                                     { popeq: { cached: false,
                                                                                                                                result: undefined } }]).value),
                                                          _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                    partialProofData,
                                                                                                                    [
                                                                                                                     { dup: { n: 0 } },
                                                                                                                     { idx: { cached: false,
                                                                                                                              pushPath: false,
                                                                                                                              path: [
                                                                                                                                     { tag: 'value',
                                                                                                                                       value: { value: _descriptor_3.toValue(13n),
                                                                                                                                                alignment: _descriptor_3.alignment() } }] } },
                                                                                                                     { popeq: { cached: true,
                                                                                                                                result: undefined } }]).value),
                                                          exp_0,
                                                          this._ownerSetCommitment_0(pend_0.owners,
                                                                                     pend_0.threshold)),
                             approvals_0);
    await this._dropRecoveryWithCooldown_0(context, partialProofData, t_0);
    return [];
  }
  async _clearExpiredRecovery_0(context, partialProofData) {
    const pend_0 = _descriptor_27.fromValue(__compactRuntime.queryLedgerState(context,
                                                                              partialProofData,
                                                                              [
                                                                               { dup: { n: 0 } },
                                                                               { idx: { cached: false,
                                                                                        pushPath: false,
                                                                                        path: [
                                                                                               { tag: 'value',
                                                                                                 value: { value: _descriptor_3.toValue(12n),
                                                                                                          alignment: _descriptor_3.alignment() } }] } },
                                                                               { popeq: { cached: false,
                                                                                          result: undefined } }]).value);
    __compactRuntime.assert(pend_0.active, 'no recovery is pending');
    __compactRuntime.assert(await this._blockTimeGte_0(context,
                                                       partialProofData,
                                                       pend_0.expiresAfter),
                            'the recovery has not expired');
    await this._extendCooldown_0(context,
                                 partialProofData,
                                 ((t1) => {
                                   if (t1 > 18446744073709551615n) {
                                     throw new __compactRuntime.CompactError('VaultCore.compact line 584 char 20: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                                   }
                                   return t1;
                                 })(pend_0.expiresAfter
                                    +
                                    _descriptor_5.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                              partialProofData,
                                                                                              [
                                                                                               { dup: { n: 0 } },
                                                                                               { idx: { cached: false,
                                                                                                        pushPath: false,
                                                                                                        path: [
                                                                                                               { tag: 'value',
                                                                                                                 value: { value: _descriptor_3.toValue(10n),
                                                                                                                          alignment: _descriptor_3.alignment() } }] } },
                                                                                               { popeq: { cached: false,
                                                                                                          result: undefined } }]).value).cooldown));
    await this._dropRecovery_0(context, partialProofData);
    return [];
  }
  async _applyRecovery_0(context, partialProofData) {
    const pend_0 = _descriptor_27.fromValue(__compactRuntime.queryLedgerState(context,
                                                                              partialProofData,
                                                                              [
                                                                               { dup: { n: 0 } },
                                                                               { idx: { cached: false,
                                                                                        pushPath: false,
                                                                                        path: [
                                                                                               { tag: 'value',
                                                                                                 value: { value: _descriptor_3.toValue(12n),
                                                                                                          alignment: _descriptor_3.alignment() } }] } },
                                                                               { popeq: { cached: false,
                                                                                          result: undefined } }]).value);
    __compactRuntime.assert(pend_0.active, 'no recovery is pending');
    __compactRuntime.assert(await this._blockTimeGte_0(context,
                                                       partialProofData,
                                                       pend_0.executableAfter),
                            'recovery is not executable yet');
    __compactRuntime.assert(await this._blockTimeLt_0(context,
                                                      partialProofData,
                                                      pend_0.expiresAfter),
                            'recovery has expired');
    this._checkSeparation_0(pend_0.owners,
                            _descriptor_24.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_3.toValue(6n),
                                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value).delegates);
    const tmp_0 = pend_0.owners;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(0n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_16.toValue(tmp_0),
                                                                                              alignment: _descriptor_16.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_1 = pend_0.threshold;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(1n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(tmp_1),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_2 = { active: false, owners: new Array(5).fill({ approvalKey: ({x: 0n, y: 1n}), upgradeKey: new Uint8Array(32) }), threshold: 0n, executableAfter: 0n };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(5n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_17.toValue(tmp_2),
                                                                                              alignment: _descriptor_17.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_3 = { active: false, policy: { whitelistEnabled: false, whitelist: new Array(8).fill({ active: false, recipient: new Uint8Array(32), scope: 0 }), delegates: new Array(2).fill({ active: false, key: ({x: 0n, y: 1n}), cap: 0n, period: 0n }) }, executableAfter: 0n };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(7n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_25.toValue(tmp_3),
                                                                                              alignment: _descriptor_25.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_4 = { active: false, config: { guardians: new Array(5).fill(0n), threshold: 0n, recoveryDelay: 0n, cooldown: 0n, expiryWindow: 0n }, executableAfter: 0n };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(11n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_6.toValue(tmp_4),
                                                                                              alignment: _descriptor_6.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    await this._dropRecovery_0(context, partialProofData);
    const tmp_5 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(2n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_9.toValue(tmp_5),
                                                                alignment: _descriptor_9.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  async _proposeGuardians_0(context,
                            partialProofData,
                            newGuardians_0,
                            newThreshold_0,
                            newRecoveryDelay_0,
                            newCooldown_0,
                            newExpiryWindow_0,
                            notBefore_0,
                            expiry_0,
                            approvals_0)
  {
    __compactRuntime.assert(!_descriptor_6.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                       partialProofData,
                                                                                       [
                                                                                        { dup: { n: 0 } },
                                                                                        { idx: { cached: false,
                                                                                                 pushPath: false,
                                                                                                 path: [
                                                                                                        { tag: 'value',
                                                                                                          value: { value: _descriptor_3.toValue(11n),
                                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                                        { popeq: { cached: false,
                                                                                                   result: undefined } }]).value).active,
                            'a guardian change is already pending');
    const exp_0 = expiry_0;
    const t_0 = notBefore_0;
    __compactRuntime.assert(await this._blockTimeLt_0(context,
                                                      partialProofData,
                                                      exp_0),
                            'approval expired');
    await this._checkNotBefore_0(context, partialProofData, t_0);
    const cfg_0 = { guardians:
                      this._guardianSetFrom_0(newGuardians_0,
                                              _descriptor_16.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                         partialProofData,
                                                                                                         [
                                                                                                          { dup: { n: 0 } },
                                                                                                          { idx: { cached: false,
                                                                                                                   pushPath: false,
                                                                                                                   path: [
                                                                                                                          { tag: 'value',
                                                                                                                            value: { value: _descriptor_3.toValue(0n),
                                                                                                                                     alignment: _descriptor_3.alignment() } }] } },
                                                                                                          { popeq: { cached: false,
                                                                                                                     result: undefined } }]).value),
                                              _descriptor_17.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                         partialProofData,
                                                                                                         [
                                                                                                          { dup: { n: 0 } },
                                                                                                          { idx: { cached: false,
                                                                                                                   pushPath: false,
                                                                                                                   path: [
                                                                                                                          { tag: 'value',
                                                                                                                            value: { value: _descriptor_3.toValue(5n),
                                                                                                                                     alignment: _descriptor_3.alignment() } }] } },
                                                                                                          { popeq: { cached: false,
                                                                                                                     result: undefined } }]).value).owners,
                                              _descriptor_24.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                         partialProofData,
                                                                                                         [
                                                                                                          { dup: { n: 0 } },
                                                                                                          { idx: { cached: false,
                                                                                                                   pushPath: false,
                                                                                                                   path: [
                                                                                                                          { tag: 'value',
                                                                                                                            value: { value: _descriptor_3.toValue(6n),
                                                                                                                                     alignment: _descriptor_3.alignment() } }] } },
                                                                                                          { popeq: { cached: false,
                                                                                                                     result: undefined } }]).value).delegates,
                                              _descriptor_25.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                         partialProofData,
                                                                                                         [
                                                                                                          { dup: { n: 0 } },
                                                                                                          { idx: { cached: false,
                                                                                                                   pushPath: false,
                                                                                                                   path: [
                                                                                                                          { tag: 'value',
                                                                                                                            value: { value: _descriptor_3.toValue(7n),
                                                                                                                                     alignment: _descriptor_3.alignment() } }] } },
                                                                                                          { popeq: { cached: false,
                                                                                                                     result: undefined } }]).value).policy.delegates),
                    threshold: newThreshold_0,
                    recoveryDelay: newRecoveryDelay_0,
                    cooldown: newCooldown_0,
                    expiryWindow: newExpiryWindow_0 };
    this._checkRecoveryConfig_0(cfg_0);
    await this._requireApprovals_0(context,
                                   partialProofData,
                                   this._ownerStatementDigest_0(new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 45, 118, 97, 117, 108, 116, 58, 112, 114, 111, 112, 111, 115, 101, 45, 103, 117, 97, 114, 100, 58, 118, 49, 0]),
                                                                _descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 2 } },
                                                                                                                           { idx: { cached: true,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(0n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(3n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: false,
                                                                                                                                      result: undefined } }]).value),
                                                                _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(2n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                exp_0,
                                                                this._recoveryConfigCommitment_0(cfg_0)),
                                   approvals_0);
    const tmp_0 = { active: true,
                    config: cfg_0,
                    executableAfter:
                      ((t1) => {
                        if (t1 > 18446744073709551615n) {
                          throw new __compactRuntime.CompactError('VaultCore.compact line 624 char 87: cast from Field or Uint value to smaller Uint value failed: ' + t1 + ' is greater than 18446744073709551615');
                        }
                        return t1;
                      })(t_0
                         +
                         _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                   partialProofData,
                                                                                   [
                                                                                    { dup: { n: 0 } },
                                                                                    { idx: { cached: false,
                                                                                             pushPath: false,
                                                                                             path: [
                                                                                                    { tag: 'value',
                                                                                                      value: { value: _descriptor_3.toValue(4n),
                                                                                                               alignment: _descriptor_3.alignment() } }] } },
                                                                                    { popeq: { cached: false,
                                                                                               result: undefined } }]).value)) };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(11n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_6.toValue(tmp_0),
                                                                                              alignment: _descriptor_6.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    await this._dropRecoveryWithCooldown_0(context, partialProofData, t_0);
    const tmp_1 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(2n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_9.toValue(tmp_1),
                                                                alignment: _descriptor_9.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  async _cancelGuardians_0(context, partialProofData, expiry_0, approvals_0) {
    const pend_0 = _descriptor_6.fromValue(__compactRuntime.queryLedgerState(context,
                                                                             partialProofData,
                                                                             [
                                                                              { dup: { n: 0 } },
                                                                              { idx: { cached: false,
                                                                                       pushPath: false,
                                                                                       path: [
                                                                                              { tag: 'value',
                                                                                                value: { value: _descriptor_3.toValue(11n),
                                                                                                         alignment: _descriptor_3.alignment() } }] } },
                                                                              { popeq: { cached: false,
                                                                                         result: undefined } }]).value);
    __compactRuntime.assert(pend_0.active, 'no guardian change is pending');
    const exp_0 = expiry_0;
    __compactRuntime.assert(await this._blockTimeLt_0(context,
                                                      partialProofData,
                                                      exp_0),
                            'approval expired');
    await this._requireApprovals_0(context,
                                   partialProofData,
                                   this._ownerStatementDigest_0(new Uint8Array([109, 105, 100, 110, 105, 103, 104, 116, 45, 118, 97, 117, 108, 116, 58, 99, 97, 110, 99, 101, 108, 45, 103, 117, 97, 114, 100, 58, 118, 49, 0, 0]),
                                                                _descriptor_8.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 2 } },
                                                                                                                           { idx: { cached: true,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(0n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(3n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: false,
                                                                                                                                      result: undefined } }]).value),
                                                                _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                                                                          partialProofData,
                                                                                                                          [
                                                                                                                           { dup: { n: 0 } },
                                                                                                                           { idx: { cached: false,
                                                                                                                                    pushPath: false,
                                                                                                                                    path: [
                                                                                                                                           { tag: 'value',
                                                                                                                                             value: { value: _descriptor_3.toValue(2n),
                                                                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                                                                           { popeq: { cached: true,
                                                                                                                                      result: undefined } }]).value),
                                                                exp_0,
                                                                this._recoveryConfigCommitment_0(pend_0.config)),
                                   approvals_0);
    const tmp_0 = { active: false, config: { guardians: new Array(5).fill(0n), threshold: 0n, recoveryDelay: 0n, cooldown: 0n, expiryWindow: 0n }, executableAfter: 0n };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(11n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_6.toValue(tmp_0),
                                                                                              alignment: _descriptor_6.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_1 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(2n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_9.toValue(tmp_1),
                                                                alignment: _descriptor_9.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    return [];
  }
  async _applyGuardians_0(context, partialProofData) {
    const pend_0 = _descriptor_6.fromValue(__compactRuntime.queryLedgerState(context,
                                                                             partialProofData,
                                                                             [
                                                                              { dup: { n: 0 } },
                                                                              { idx: { cached: false,
                                                                                       pushPath: false,
                                                                                       path: [
                                                                                              { tag: 'value',
                                                                                                value: { value: _descriptor_3.toValue(11n),
                                                                                                         alignment: _descriptor_3.alignment() } }] } },
                                                                              { popeq: { cached: false,
                                                                                         result: undefined } }]).value);
    __compactRuntime.assert(pend_0.active, 'no guardian change is pending');
    __compactRuntime.assert(await this._blockTimeGte_0(context,
                                                       partialProofData,
                                                       pend_0.executableAfter),
                            'guardian change is not executable yet');
    this._checkRecoveryConfig_0(pend_0.config);
    const tmp_0 = pend_0.config;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(10n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_5.toValue(tmp_0),
                                                                                              alignment: _descriptor_5.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    const tmp_1 = { active: false, config: { guardians: new Array(5).fill(0n), threshold: 0n, recoveryDelay: 0n, cooldown: 0n, expiryWindow: 0n }, executableAfter: 0n };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(11n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_6.toValue(tmp_1),
                                                                                              alignment: _descriptor_6.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    await this._dropRecovery_0(context, partialProofData);
    return [];
  }
  _equal_0(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_1(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _equal_2(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _mapper_0(f, a0) {
    let a = [];
    for (let i = 0; i < 5; i++) { a[i] = f(a0[i]); }
    return a;
  }
  _mapper_1(f, a0) {
    let a = [];
    for (let i = 0; i < 2; i++) { a[i] = f(a0[i]); }
    return a;
  }
  _equal_3(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _equal_4(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_5(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_6(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _equal_7(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _folder_0(f, x, a0) {
    for (let i = 0; i < 5; i++) { x = f(x, a0[i]); }
    return x;
  }
  _folder_1(f, x, a0) {
    for (let i = 0; i < 5; i++) { x = f(x, a0[i]); }
    return x;
  }
  _folder_2(f, x, a0) {
    for (let i = 0; i < 5; i++) { x = f(x, a0[i]); }
    return x;
  }
  _equal_8(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _folder_3(f, x, a0) {
    for (let i = 0; i < 2; i++) { x = f(x, a0[i]); }
    return x;
  }
  _folder_4(f, x, a0) {
    for (let i = 0; i < 5; i++) { x = f(x, a0[i]); }
    return x;
  }
  _equal_9(x0, y0) {
    {
      let x1 = x0.active;
      let y1 = y0.active;
      if (x1 !== y1) { return false; }
    }
    {
      let x1 = x0.recipient;
      let y1 = y0.recipient;
      if (!x1.every((x, i) => y1[i] === x)) { return false; }
    }
    {
      let x1 = x0.scope;
      let y1 = y0.scope;
      if (x1 !== y1) { return false; }
    }
    return true;
  }
  _equal_10(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_11(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _folder_5(f, x, a0) {
    for (let i = 0; i < 8; i++) { x = f(x, a0[i]); }
    return x;
  }
  _folder_6(f, x, a0) {
    for (let i = 0; i < 8; i++) { x = f(x, a0[i]); }
    return x;
  }
  _equal_12(x0, y0) {
    {
      let x1 = x0.active;
      let y1 = y0.active;
      if (x1 !== y1) { return false; }
    }
    {
      let x1 = x0.key;
      let y1 = y0.key;
      if (x1.x != y1.x || x1.y != y1.y) {
        return false;
      }
    }
    {
      let x1 = x0.cap;
      let y1 = y0.cap;
      if (x1 !== y1) { return false; }
    }
    {
      let x1 = x0.period;
      let y1 = y0.period;
      if (x1 !== y1) { return false; }
    }
    return true;
  }
  _equal_13(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _folder_7(f, x, a0) {
    for (let i = 0; i < 2; i++) { x = f(x, a0[i]); }
    return x;
  }
  _equal_14(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _equal_15(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _folder_8(f, x, a0) {
    for (let i = 0; i < 8; i++) { x = f(x, a0[i]); }
    return x;
  }
  _folder_9(f, x, a0) {
    for (let i = 0; i < 8; i++) { x = f(x, a0[i]); }
    return x;
  }
  _equal_16(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _folder_10(f, x, a0) {
    for (let i = 0; i < 2; i++) { x = f(x, a0[i]); }
    return x;
  }
  _equal_17(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _folder_11(f, x, a0) {
    for (let i = 0; i < 8; i++) { x = f(x, a0[i]); }
    return x;
  }
  _equal_18(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _folder_12(f, x, a0) {
    for (let i = 0; i < 5; i++) { x = f(x, a0[i]); }
    return x;
  }
  _equal_19(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  async _folder_13(context, partialProofData, f, x, a0) {
    for (let i = 0; i < 5; i++) { x = await f(context, partialProofData, x, a0[i]); }
    return x;
  }
  async _folder_14(context, partialProofData, f, x, a0) {
    for (let i = 0; i < 5; i++) { x = await f(context, partialProofData, x, a0[i]); }
    return x;
  }
  async _folder_15(context, partialProofData, f, x, a0) {
    for (let i = 0; i < 5; i++) { x = await f(context, partialProofData, x, a0[i]); }
    return x;
  }
  _equal_20(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _folder_16(f, x, a0) {
    for (let i = 0; i < 5; i++) { x = f(x, a0[i]); }
    return x;
  }
  _equal_21(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  _equal_22(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _folder_17(f, x, a0) {
    for (let i = 0; i < 5; i++) { x = f(x, a0[i]); }
    return x;
  }
  _equal_23(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _equal_24(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _folder_18(f, x, a0) {
    for (let i = 0; i < 2; i++) { x = f(x, a0[i]); }
    return x;
  }
  _folder_19(f, x, a0) {
    for (let i = 0; i < 5; i++) { x = f(x, a0[i]); }
    return x;
  }
  _mapper_2(f, a0) {
    let a = [];
    for (let i = 0; i < 5; i++) { a[i] = f(a0[i]); }
    return a;
  }
  _folder_20(f, x, a0) {
    for (let i = 0; i < 5; i++) { x = f(x, a0[i]); }
    return x;
  }
  _folder_21(f, x, a0) {
    for (let i = 0; i < 5; i++) { x = f(x, a0[i]); }
    return x;
  }
  _equal_25(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  _folder_22(f, x, a0) {
    for (let i = 0; i < 5; i++) { x = f(x, a0[i]); }
    return x;
  }
  _folder_23(f, x, a0) {
    for (let i = 0; i < 5; i++) { x = f(x, a0[i]); }
    return x;
  }
  _mapper_3(f, a0) {
    let a = [];
    for (let i = 0; i < 5; i++) { a[i] = f(a0[i]); }
    return a;
  }
  _folder_24(f, x, a0) {
    for (let i = 0; i < 5; i++) { x = f(x, a0[i]); }
    return x;
  }
  _folder_25(f, x, a0) {
    for (let i = 0; i < 5; i++) { x = f(x, a0[i]); }
    return x;
  }
  _folder_26(f, x, a0, a1) {
    for (let i = 0; i < 5; i++) { x = f(x, a0[i], a1[i]); }
    return x;
  }
  _mapper_4(f, a0) {
    let a = [];
    for (let i = 0; i < 5; i++) { a[i] = f(a0[i]); }
    return a;
  }
  _folder_27(f, x, a0) {
    for (let i = 0; i < 5; i++) { x = f(x, a0[i]); }
    return x;
  }
  _equal_26(x0, y0) {
    if (!x0.every((x, i) => y0[i] === x)) { return false; }
    return true;
  }
  async _folder_28(context, partialProofData, f, x, a0) {
    for (let i = 0; i < 2; i++) { x = await f(context, partialProofData, x, a0[i]); }
    return x;
  }
  _equal_27(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  async _folder_29(context, partialProofData, f, x, a0) {
    for (let i = 0; i < 2; i++) { x = await f(context, partialProofData, x, a0[i]); }
    return x;
  }
  _equal_28(x0, y0) {
    {
      let x1 = x0.active;
      let y1 = y0.active;
      if (x1 !== y1) { return false; }
    }
    {
      let x1 = x0.key;
      let y1 = y0.key;
      if (x1.x != y1.x || x1.y != y1.y) {
        return false;
      }
    }
    {
      let x1 = x0.cap;
      let y1 = y0.cap;
      if (x1 !== y1) { return false; }
    }
    {
      let x1 = x0.period;
      let y1 = y0.period;
      if (x1 !== y1) { return false; }
    }
    return true;
  }
  async _folder_30(context, partialProofData, f, x, a0) {
    for (let i = 0; i < 2; i++) { x = await f(context, partialProofData, x, a0[i]); }
    return x;
  }
  _equal_29(x0, y0) {
    if (x0.x != y0.x || x0.y != y0.y) {
      return false;
    }
    return true;
  }
  async _folder_31(context, partialProofData, f, x, a0) {
    for (let i = 0; i < 5; i++) { x = await f(context, partialProofData, x, a0[i]); }
    return x;
  }
  async _folder_32(context, partialProofData, f, x, a0) {
    for (let i = 0; i < 5; i++) { x = await f(context, partialProofData, x, a0[i]); }
    return x;
  }
}
export function ledger(stateOrChargedState) {
  const state = stateOrChargedState instanceof __compactRuntime.StateValue ? stateOrChargedState : stateOrChargedState.state;
  const chargedState = stateOrChargedState instanceof __compactRuntime.StateValue ? new __compactRuntime.ChargedState(stateOrChargedState) : stateOrChargedState;
  const context = {
    callContext: { currentQueryContext: new __compactRuntime.QueryContext(chargedState, __compactRuntime.dummyContractAddress()), currentGasCost: __compactRuntime.emptyRunningCost() },
    costModel: __compactRuntime.CostModel.initialCostModel()
  };
  const partialProofData = {
    input: { value: [], alignment: [] },
    output: undefined,
    publicTranscript: [],
    privateTranscriptOutputs: []
  };
  return {
    get owners() {
      return _descriptor_16.fromValue(__compactRuntime.queryLedgerState(context,
                                                                        partialProofData,
                                                                        [
                                                                         { dup: { n: 0 } },
                                                                         { idx: { cached: false,
                                                                                  pushPath: false,
                                                                                  path: [
                                                                                         { tag: 'value',
                                                                                           value: { value: _descriptor_3.toValue(0n),
                                                                                                    alignment: _descriptor_3.alignment() } }] } },
                                                                         { popeq: { cached: false,
                                                                                    result: undefined } }]).value);
    },
    get threshold() {
      return _descriptor_3.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_3.toValue(1n),
                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    },
    get nonce() {
      return _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_3.toValue(2n),
                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                        { popeq: { cached: true,
                                                                                   result: undefined } }]).value);
    },
    get network() {
      return _descriptor_7.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_3.toValue(3n),
                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    },
    get delay() {
      return _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_3.toValue(4n),
                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    },
    get pendingOwners() {
      return _descriptor_17.fromValue(__compactRuntime.queryLedgerState(context,
                                                                        partialProofData,
                                                                        [
                                                                         { dup: { n: 0 } },
                                                                         { idx: { cached: false,
                                                                                  pushPath: false,
                                                                                  path: [
                                                                                         { tag: 'value',
                                                                                           value: { value: _descriptor_3.toValue(5n),
                                                                                                    alignment: _descriptor_3.alignment() } }] } },
                                                                         { popeq: { cached: false,
                                                                                    result: undefined } }]).value);
    },
    get policy() {
      return _descriptor_24.fromValue(__compactRuntime.queryLedgerState(context,
                                                                        partialProofData,
                                                                        [
                                                                         { dup: { n: 0 } },
                                                                         { idx: { cached: false,
                                                                                  pushPath: false,
                                                                                  path: [
                                                                                         { tag: 'value',
                                                                                           value: { value: _descriptor_3.toValue(6n),
                                                                                                    alignment: _descriptor_3.alignment() } }] } },
                                                                         { popeq: { cached: false,
                                                                                    result: undefined } }]).value);
    },
    get pendingPolicy() {
      return _descriptor_25.fromValue(__compactRuntime.queryLedgerState(context,
                                                                        partialProofData,
                                                                        [
                                                                         { dup: { n: 0 } },
                                                                         { idx: { cached: false,
                                                                                  pushPath: false,
                                                                                  path: [
                                                                                         { tag: 'value',
                                                                                           value: { value: _descriptor_3.toValue(7n),
                                                                                                    alignment: _descriptor_3.alignment() } }] } },
                                                                         { popeq: { cached: false,
                                                                                    result: undefined } }]).value);
    },
    delegateWindow: {
      isEmpty(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`isEmpty: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_3.toValue(8n),
                                                                                                     alignment: _descriptor_3.alignment() } }] } },
                                                                          'size',
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(0n),
                                                                                                                                 alignment: _descriptor_4.alignment() }).encode() } },
                                                                          'eq',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      size(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`size: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_3.toValue(8n),
                                                                                                     alignment: _descriptor_3.alignment() } }] } },
                                                                          'size',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      member(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`member: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(typeof(key_0) === 'bigint' && key_0 >= 0n && key_0 <= 255n)) {
          __compactRuntime.typeError('member',
                                     'argument 1',
                                     'VaultCore.compact line 63 char 3',
                                     'Uint<0..256>',
                                     key_0)
        }
        return _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_3.toValue(8n),
                                                                                                     alignment: _descriptor_3.alignment() } }] } },
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(key_0),
                                                                                                                                 alignment: _descriptor_3.alignment() }).encode() } },
                                                                          'member',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      lookup(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`lookup: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(typeof(key_0) === 'bigint' && key_0 >= 0n && key_0 <= 255n)) {
          __compactRuntime.typeError('lookup',
                                     'argument 1',
                                     'VaultCore.compact line 63 char 3',
                                     'Uint<0..256>',
                                     key_0)
        }
        return _descriptor_33.fromValue(__compactRuntime.queryLedgerState(context,
                                                                          partialProofData,
                                                                          [
                                                                           { dup: { n: 0 } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_3.toValue(8n),
                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                           { idx: { cached: false,
                                                                                    pushPath: false,
                                                                                    path: [
                                                                                           { tag: 'value',
                                                                                             value: { value: _descriptor_3.toValue(key_0),
                                                                                                      alignment: _descriptor_3.alignment() } }] } },
                                                                           { popeq: { cached: false,
                                                                                      result: undefined } }]).value);
      },
      [Symbol.iterator](...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`iter: expected 0 arguments, received ${args_0.length}`);
        }
        const self_0 = state.asArray()[8];
        return self_0.asMap().keys().map(  (key) => {    const value = self_0.asMap().get(key).asCell();    return [      _descriptor_3.fromValue(key.value),      _descriptor_33.fromValue(value.value)    ];  })[Symbol.iterator]();
      }
    },
    delegateNonce: {
      isEmpty(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`isEmpty: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_3.toValue(9n),
                                                                                                     alignment: _descriptor_3.alignment() } }] } },
                                                                          'size',
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_4.toValue(0n),
                                                                                                                                 alignment: _descriptor_4.alignment() }).encode() } },
                                                                          'eq',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      size(...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`size: expected 0 arguments, received ${args_0.length}`);
        }
        return _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_3.toValue(9n),
                                                                                                     alignment: _descriptor_3.alignment() } }] } },
                                                                          'size',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      member(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`member: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(typeof(key_0) === 'bigint' && key_0 >= 0n && key_0 <= 255n)) {
          __compactRuntime.typeError('member',
                                     'argument 1',
                                     'VaultCore.compact line 64 char 3',
                                     'Uint<0..256>',
                                     key_0)
        }
        return _descriptor_0.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_3.toValue(9n),
                                                                                                     alignment: _descriptor_3.alignment() } }] } },
                                                                          { push: { storage: false,
                                                                                    value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(key_0),
                                                                                                                                 alignment: _descriptor_3.alignment() }).encode() } },
                                                                          'member',
                                                                          { popeq: { cached: true,
                                                                                     result: undefined } }]).value);
      },
      lookup(...args_0) {
        if (args_0.length !== 1) {
          throw new __compactRuntime.CompactError(`lookup: expected 1 argument, received ${args_0.length}`);
        }
        const key_0 = args_0[0];
        if (!(typeof(key_0) === 'bigint' && key_0 >= 0n && key_0 <= 255n)) {
          __compactRuntime.typeError('lookup',
                                     'argument 1',
                                     'VaultCore.compact line 64 char 3',
                                     'Uint<0..256>',
                                     key_0)
        }
        return _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                         partialProofData,
                                                                         [
                                                                          { dup: { n: 0 } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_3.toValue(9n),
                                                                                                     alignment: _descriptor_3.alignment() } }] } },
                                                                          { idx: { cached: false,
                                                                                   pushPath: false,
                                                                                   path: [
                                                                                          { tag: 'value',
                                                                                            value: { value: _descriptor_3.toValue(key_0),
                                                                                                     alignment: _descriptor_3.alignment() } }] } },
                                                                          { popeq: { cached: false,
                                                                                     result: undefined } }]).value);
      },
      [Symbol.iterator](...args_0) {
        if (args_0.length !== 0) {
          throw new __compactRuntime.CompactError(`iter: expected 0 arguments, received ${args_0.length}`);
        }
        const self_0 = state.asArray()[9];
        return self_0.asMap().keys().map(  (key) => {    const value = self_0.asMap().get(key).asCell();    return [      _descriptor_3.fromValue(key.value),      _descriptor_4.fromValue(value.value)    ];  })[Symbol.iterator]();
      }
    },
    get recovery() {
      return _descriptor_5.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_3.toValue(10n),
                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    },
    get pendingGuardians() {
      return _descriptor_6.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_3.toValue(11n),
                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    },
    get pendingRecovery() {
      return _descriptor_27.fromValue(__compactRuntime.queryLedgerState(context,
                                                                        partialProofData,
                                                                        [
                                                                         { dup: { n: 0 } },
                                                                         { idx: { cached: false,
                                                                                  pushPath: false,
                                                                                  path: [
                                                                                         { tag: 'value',
                                                                                           value: { value: _descriptor_3.toValue(12n),
                                                                                                    alignment: _descriptor_3.alignment() } }] } },
                                                                         { popeq: { cached: false,
                                                                                    result: undefined } }]).value);
    },
    get recoveryNonce() {
      return _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_3.toValue(13n),
                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                        { popeq: { cached: true,
                                                                                   result: undefined } }]).value);
    },
    get cooldownUntil() {
      return _descriptor_4.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_3.toValue(14n),
                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                        { popeq: { cached: false,
                                                                                   result: undefined } }]).value);
    }
  };
}
const _emptyContext = {
  callContext: { currentQueryContext: new __compactRuntime.QueryContext(new __compactRuntime.ContractState().data, __compactRuntime.dummyContractAddress()), currentGasCost: __compactRuntime.emptyRunningCost() }
};
const _dummyContract = new Contract({ });
export const pureCircuits = {
  guardianCommitment: (...args_0) => {
    if (args_0.length !== 2) {
      throw new __compactRuntime.CompactError(`guardianCommitment: expected 2 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const key_0 = args_0[0];
    const salt_0 = args_0[1];
    if (!(typeof(key_0.x) === 'bigint' && key_0.x >= 0n && key_0.x <= __compactRuntime.MAX_FIELD && typeof(key_0.y) === 'bigint' && key_0.y >= 0n && key_0.y <= __compactRuntime.MAX_FIELD)) {
      __compactRuntime.typeError('guardianCommitment',
                                 'argument 1',
                                 'Statements.compact line 74 char 3',
                                 'JubjubPoint',
                                 key_0)
    }
    if (!(salt_0.buffer instanceof ArrayBuffer && salt_0.BYTES_PER_ELEMENT === 1 && salt_0.length === 32)) {
      __compactRuntime.typeError('guardianCommitment',
                                 'argument 2',
                                 'Statements.compact line 74 char 3',
                                 'Bytes<32>',
                                 salt_0)
    }
    return _dummyContract._guardianCommitment_0(key_0, salt_0);
  },
  recoveryConfigCommitment: (...args_0) => {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`recoveryConfigCommitment: expected 1 argument (as invoked from Typescript), received ${args_0.length}`);
    }
    const cfg_0 = args_0[0];
    if (!(typeof(cfg_0) === 'object' && Array.isArray(cfg_0.guardians) && cfg_0.guardians.length === 5 && cfg_0.guardians.every((t) => typeof(t) === 'bigint' && t >= 0 && t <= __compactRuntime.MAX_FIELD) && typeof(cfg_0.threshold) === 'bigint' && cfg_0.threshold >= 0n && cfg_0.threshold <= 255n && typeof(cfg_0.recoveryDelay) === 'bigint' && cfg_0.recoveryDelay >= 0n && cfg_0.recoveryDelay <= 18446744073709551615n && typeof(cfg_0.cooldown) === 'bigint' && cfg_0.cooldown >= 0n && cfg_0.cooldown <= 18446744073709551615n && typeof(cfg_0.expiryWindow) === 'bigint' && cfg_0.expiryWindow >= 0n && cfg_0.expiryWindow <= 18446744073709551615n)) {
      __compactRuntime.typeError('recoveryConfigCommitment',
                                 'argument 1',
                                 'Statements.compact line 81 char 3',
                                 'struct RecoveryConfig<guardians: Vector<5, Field>, threshold: Uint<0..256>, recoveryDelay: Uint<0..18446744073709551616>, cooldown: Uint<0..18446744073709551616>, expiryWindow: Uint<0..18446744073709551616>>',
                                 cfg_0)
    }
    return _dummyContract._recoveryConfigCommitment_0(cfg_0);
  },
  ownerSetCommitment: (...args_0) => {
    if (args_0.length !== 2) {
      throw new __compactRuntime.CompactError(`ownerSetCommitment: expected 2 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const owners_0 = args_0[0];
    const threshold_0 = args_0[1];
    if (!(Array.isArray(owners_0) && owners_0.length === 5 && owners_0.every((t) => typeof(t) === 'object' && typeof(t.approvalKey.x) === 'bigint' && t.approvalKey.x >= 0n && t.approvalKey.x <= __compactRuntime.MAX_FIELD && typeof(t.approvalKey.y) === 'bigint' && t.approvalKey.y >= 0n && t.approvalKey.y <= __compactRuntime.MAX_FIELD && t.upgradeKey.buffer instanceof ArrayBuffer && t.upgradeKey.BYTES_PER_ELEMENT === 1 && t.upgradeKey.length === 32))) {
      __compactRuntime.typeError('ownerSetCommitment',
                                 'argument 1',
                                 'Statements.compact line 88 char 3',
                                 'Vector<5, struct Owner<approvalKey: JubjubPoint, upgradeKey: Bytes<32>>>',
                                 owners_0)
    }
    if (!(typeof(threshold_0) === 'bigint' && threshold_0 >= 0n && threshold_0 <= 255n)) {
      __compactRuntime.typeError('ownerSetCommitment',
                                 'argument 2',
                                 'Statements.compact line 88 char 3',
                                 'Uint<0..256>',
                                 threshold_0)
    }
    return _dummyContract._ownerSetCommitment_0(owners_0, threshold_0);
  },
  policyCommitment: (...args_0) => {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`policyCommitment: expected 1 argument (as invoked from Typescript), received ${args_0.length}`);
    }
    const p_0 = args_0[0];
    if (!(typeof(p_0) === 'object' && typeof(p_0.whitelistEnabled) === 'boolean' && Array.isArray(p_0.whitelist) && p_0.whitelist.length === 8 && p_0.whitelist.every((t) => typeof(t) === 'object' && typeof(t.active) === 'boolean' && t.recipient.buffer instanceof ArrayBuffer && t.recipient.BYTES_PER_ELEMENT === 1 && t.recipient.length === 32 && typeof(t.scope) === 'number' && t.scope >= 0 && t.scope <= 1) && Array.isArray(p_0.delegates) && p_0.delegates.length === 2 && p_0.delegates.every((t) => typeof(t) === 'object' && typeof(t.active) === 'boolean' && typeof(t.key.x) === 'bigint' && t.key.x >= 0n && t.key.x <= __compactRuntime.MAX_FIELD && typeof(t.key.y) === 'bigint' && t.key.y >= 0n && t.key.y <= __compactRuntime.MAX_FIELD && typeof(t.cap) === 'bigint' && t.cap >= 0n && t.cap <= 340282366920938463463374607431768211455n && typeof(t.period) === 'bigint' && t.period >= 0n && t.period <= 18446744073709551615n))) {
      __compactRuntime.typeError('policyCommitment',
                                 'argument 1',
                                 'Statements.compact line 98 char 3',
                                 'struct Policy<whitelistEnabled: Boolean, whitelist: Vector<8, struct WlEntry<active: Boolean, recipient: Bytes<32>, scope: Enum<Scope, QuorumOnly, Any>>>, delegates: Vector<2, struct DelegatePolicy<active: Boolean, key: JubjubPoint, cap: Uint<0..340282366920938463463374607431768211456>, period: Uint<0..18446744073709551616>>>>',
                                 p_0)
    }
    return _dummyContract._policyCommitment_0(p_0);
  },
  payoutDigest: (...args_0) => {
    if (args_0.length !== 6) {
      throw new __compactRuntime.CompactError(`payoutDigest: expected 6 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const vault_0 = args_0[0];
    const network_0 = args_0[1];
    const nonce_0 = args_0[2];
    const expiry_0 = args_0[3];
    const recipient_0 = args_0[4];
    const amount_0 = args_0[5];
    if (!(typeof(vault_0) === 'object' && vault_0.bytes.buffer instanceof ArrayBuffer && vault_0.bytes.BYTES_PER_ELEMENT === 1 && vault_0.bytes.length === 32)) {
      __compactRuntime.typeError('payoutDigest',
                                 'argument 1',
                                 'Statements.compact line 107 char 3',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 vault_0)
    }
    if (!(network_0.buffer instanceof ArrayBuffer && network_0.BYTES_PER_ELEMENT === 1 && network_0.length === 32)) {
      __compactRuntime.typeError('payoutDigest',
                                 'argument 2',
                                 'Statements.compact line 107 char 3',
                                 'Bytes<32>',
                                 network_0)
    }
    if (!(typeof(nonce_0) === 'bigint' && nonce_0 >= 0n && nonce_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('payoutDigest',
                                 'argument 3',
                                 'Statements.compact line 107 char 3',
                                 'Uint<0..18446744073709551616>',
                                 nonce_0)
    }
    if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('payoutDigest',
                                 'argument 4',
                                 'Statements.compact line 107 char 3',
                                 'Uint<0..18446744073709551616>',
                                 expiry_0)
    }
    if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
      __compactRuntime.typeError('payoutDigest',
                                 'argument 5',
                                 'Statements.compact line 107 char 3',
                                 'struct UserAddress<bytes: Bytes<32>>',
                                 recipient_0)
    }
    if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('payoutDigest',
                                 'argument 6',
                                 'Statements.compact line 107 char 3',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 amount_0)
    }
    return _dummyContract._payoutDigest_0(vault_0,
                                          network_0,
                                          nonce_0,
                                          expiry_0,
                                          recipient_0,
                                          amount_0);
  },
  delegatePayoutDigest: (...args_0) => {
    if (args_0.length !== 7) {
      throw new __compactRuntime.CompactError(`delegatePayoutDigest: expected 7 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const vault_0 = args_0[0];
    const network_0 = args_0[1];
    const slot_0 = args_0[2];
    const delegateNonce_0 = args_0[3];
    const expiry_0 = args_0[4];
    const recipient_0 = args_0[5];
    const amount_0 = args_0[6];
    if (!(typeof(vault_0) === 'object' && vault_0.bytes.buffer instanceof ArrayBuffer && vault_0.bytes.BYTES_PER_ELEMENT === 1 && vault_0.bytes.length === 32)) {
      __compactRuntime.typeError('delegatePayoutDigest',
                                 'argument 1',
                                 'Statements.compact line 113 char 3',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 vault_0)
    }
    if (!(network_0.buffer instanceof ArrayBuffer && network_0.BYTES_PER_ELEMENT === 1 && network_0.length === 32)) {
      __compactRuntime.typeError('delegatePayoutDigest',
                                 'argument 2',
                                 'Statements.compact line 113 char 3',
                                 'Bytes<32>',
                                 network_0)
    }
    if (!(typeof(slot_0) === 'bigint' && slot_0 >= 0n && slot_0 <= 255n)) {
      __compactRuntime.typeError('delegatePayoutDigest',
                                 'argument 3',
                                 'Statements.compact line 113 char 3',
                                 'Uint<0..256>',
                                 slot_0)
    }
    if (!(typeof(delegateNonce_0) === 'bigint' && delegateNonce_0 >= 0n && delegateNonce_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('delegatePayoutDigest',
                                 'argument 4',
                                 'Statements.compact line 113 char 3',
                                 'Uint<0..18446744073709551616>',
                                 delegateNonce_0)
    }
    if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('delegatePayoutDigest',
                                 'argument 5',
                                 'Statements.compact line 113 char 3',
                                 'Uint<0..18446744073709551616>',
                                 expiry_0)
    }
    if (!(typeof(recipient_0) === 'object' && recipient_0.bytes.buffer instanceof ArrayBuffer && recipient_0.bytes.BYTES_PER_ELEMENT === 1 && recipient_0.bytes.length === 32)) {
      __compactRuntime.typeError('delegatePayoutDigest',
                                 'argument 6',
                                 'Statements.compact line 113 char 3',
                                 'struct UserAddress<bytes: Bytes<32>>',
                                 recipient_0)
    }
    if (!(typeof(amount_0) === 'bigint' && amount_0 >= 0n && amount_0 <= 340282366920938463463374607431768211455n)) {
      __compactRuntime.typeError('delegatePayoutDigest',
                                 'argument 7',
                                 'Statements.compact line 113 char 3',
                                 'Uint<0..340282366920938463463374607431768211456>',
                                 amount_0)
    }
    return _dummyContract._delegatePayoutDigest_0(vault_0,
                                                  network_0,
                                                  slot_0,
                                                  delegateNonce_0,
                                                  expiry_0,
                                                  recipient_0,
                                                  amount_0);
  },
  ownerStatementDigest: (...args_0) => {
    if (args_0.length !== 6) {
      throw new __compactRuntime.CompactError(`ownerStatementDigest: expected 6 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    const domain_0 = args_0[0];
    const vault_0 = args_0[1];
    const network_0 = args_0[2];
    const nonce_0 = args_0[3];
    const expiry_0 = args_0[4];
    const subject_0 = args_0[5];
    if (!(domain_0.buffer instanceof ArrayBuffer && domain_0.BYTES_PER_ELEMENT === 1 && domain_0.length === 32)) {
      __compactRuntime.typeError('ownerStatementDigest',
                                 'argument 1',
                                 'Statements.compact line 132 char 3',
                                 'Bytes<32>',
                                 domain_0)
    }
    if (!(typeof(vault_0) === 'object' && vault_0.bytes.buffer instanceof ArrayBuffer && vault_0.bytes.BYTES_PER_ELEMENT === 1 && vault_0.bytes.length === 32)) {
      __compactRuntime.typeError('ownerStatementDigest',
                                 'argument 2',
                                 'Statements.compact line 132 char 3',
                                 'struct ContractAddress<bytes: Bytes<32>>',
                                 vault_0)
    }
    if (!(network_0.buffer instanceof ArrayBuffer && network_0.BYTES_PER_ELEMENT === 1 && network_0.length === 32)) {
      __compactRuntime.typeError('ownerStatementDigest',
                                 'argument 3',
                                 'Statements.compact line 132 char 3',
                                 'Bytes<32>',
                                 network_0)
    }
    if (!(typeof(nonce_0) === 'bigint' && nonce_0 >= 0n && nonce_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('ownerStatementDigest',
                                 'argument 4',
                                 'Statements.compact line 132 char 3',
                                 'Uint<0..18446744073709551616>',
                                 nonce_0)
    }
    if (!(typeof(expiry_0) === 'bigint' && expiry_0 >= 0n && expiry_0 <= 18446744073709551615n)) {
      __compactRuntime.typeError('ownerStatementDigest',
                                 'argument 5',
                                 'Statements.compact line 132 char 3',
                                 'Uint<0..18446744073709551616>',
                                 expiry_0)
    }
    if (!(typeof(subject_0) === 'bigint' && subject_0 >= 0 && subject_0 <= __compactRuntime.MAX_FIELD)) {
      __compactRuntime.typeError('ownerStatementDigest',
                                 'argument 6',
                                 'Statements.compact line 132 char 3',
                                 'Field',
                                 subject_0)
    }
    return _dummyContract._ownerStatementDigest_0(domain_0,
                                                  vault_0,
                                                  network_0,
                                                  nonce_0,
                                                  expiry_0,
                                                  subject_0);
  },
  buildConstants: (...args_0) => {
    if (args_0.length !== 0) {
      throw new __compactRuntime.CompactError(`buildConstants: expected 0 arguments (as invoked from Typescript), received ${args_0.length}`);
    }
    return _dummyContract._buildConstants_0();
  }
};
export const expectedVk = {
  'applyGuardians': 'bc84e98221dc5a78befcb28eecaff0fd9f51cf684033bcea23334f426fb2e20b',
  'applyOwners': '1826170088aa31600b67440574709b854b9bb3c9793203672f622db0c0838ac2',
  'applyPolicy': 'fbf36134d61564a28f1b77654189bc7a7a3f7f9d92b50a71ac1c0a89c29112b7',
  'applyRecovery': '79171f897d90880eedbf992b089a0ab065d9af1aae8137e7d9fe7cbd9db91c71',
  'cancelGuardians': 'd3be8e09f38b6066e99c72352913feae7dd97032b688549bf14819537978bc4b',
  'cancelOwners': '18a78eb7186d7d3e238dd5231fc3bcf180bd1cc69f2761f53d94e5079b35baa4',
  'cancelPolicy': '3e08c20e952110f86affc0e26e0776d19bbd38b806efd1d556184b5da6df0876',
  'cancelRecovery': 'b63bc05c02a740eede067ce1e4f767974f3abbec24e83845b452850e38c820a3',
  'clearExpiredRecovery': '07ba1c8f736bdd416f06ae4aa485bf3bcc4cbe2e40851b77edd1c2b533be5605',
  'delegatePayout': 'bbfbaa16b2d93b391b285a6cac1571589f90adeaa789018be0c47aeaf16322fd',
  'deposit': '54ed511dbde77cbfa96fe6f8e6d7003e69297169563e31f0d5408a55c0370d88',
  'execute': 'dca1150a4e0686dc3d8f90ce5a006e49d23566ea6a283fe8e881697841403543',
  'narrowPolicy': 'b8e3f2a38fa1e2eece38f4f84a106aff8b1de80bff2113915af402b55a2c5410',
  'proposeGuardians': 'cf2d14f73d11a38d04285e3a683e6dba129bdc0af698b243235ce9f17cfde4c2',
  'proposeOwners': 'bee73a7f962f3f893dcc64a79cab298cf7b7f6a1511fe0a9ce9c244b6285d2f9',
  'proposePolicy': 'be9f7a7b44c555e22145d18e4ebfca9cf383a3ad4851b4df60861da227b7bae4',
  'proposeRecovery': '3bb687626d941a18ed33ceec116258372a19bc1ffa3b01a09ea0354bb4eb18a1',
  'withdrawRecovery': '2b4240eb611caa02d6dd51eab9f64b18eb029741d837a0d22d4f9debfcbefa88',
};

export const circuitSignatures = {
  'guardianCommitment': {pure: true, provable: false, argumentTypes: [{tag: 'JubjubPoint'}, {tag: 'Bytes', length: 32}], resultType: {tag: 'Field'}},
  'recoveryConfigCommitment': {pure: true, provable: false, argumentTypes: [{tag: 'Struct', name: 'RecoveryConfig', elements: [{name: 'guardians', type: {tag: 'Vector', length: 5, type: {tag: 'Field'}}}, {name: 'threshold', type: {tag: 'Uint', maxval: '255'}}, {name: 'recoveryDelay', type: {tag: 'Uint', maxval: '18446744073709551615'}}, {name: 'cooldown', type: {tag: 'Uint', maxval: '18446744073709551615'}}, {name: 'expiryWindow', type: {tag: 'Uint', maxval: '18446744073709551615'}}]}], resultType: {tag: 'Field'}},
  'ownerSetCommitment': {pure: true, provable: false, argumentTypes: [{tag: 'Vector', length: 5, type: {tag: 'Struct', name: 'Owner', elements: [{name: 'approvalKey', type: {tag: 'JubjubPoint'}}, {name: 'upgradeKey', type: {tag: 'Bytes', length: 32}}]}}, {tag: 'Uint', maxval: '255'}], resultType: {tag: 'Field'}},
  'policyCommitment': {pure: true, provable: false, argumentTypes: [{tag: 'Struct', name: 'Policy', elements: [{name: 'whitelistEnabled', type: {tag: 'Boolean'}}, {name: 'whitelist', type: {tag: 'Vector', length: 8, type: {tag: 'Struct', name: 'WlEntry', elements: [{name: 'active', type: {tag: 'Boolean'}}, {name: 'recipient', type: {tag: 'Bytes', length: 32}}, {name: 'scope', type: {tag: 'Enum', name: 'Scope', elements: ['QuorumOnly', 'Any']}}]}}}, {name: 'delegates', type: {tag: 'Vector', length: 2, type: {tag: 'Struct', name: 'DelegatePolicy', elements: [{name: 'active', type: {tag: 'Boolean'}}, {name: 'key', type: {tag: 'JubjubPoint'}}, {name: 'cap', type: {tag: 'Uint', maxval: '340282366920938463463374607431768211455'}}, {name: 'period', type: {tag: 'Uint', maxval: '18446744073709551615'}}]}}}]}], resultType: {tag: 'Field'}},
  'payoutDigest': {pure: true, provable: false, argumentTypes: [{tag: 'Struct', name: 'ContractAddress', elements: [{name: 'bytes', type: {tag: 'Bytes', length: 32}}]}, {tag: 'Bytes', length: 32}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Struct', name: 'UserAddress', elements: [{name: 'bytes', type: {tag: 'Bytes', length: 32}}]}, {tag: 'Uint', maxval: '340282366920938463463374607431768211455'}], resultType: {tag: 'Field'}},
  'delegatePayoutDigest': {pure: true, provable: false, argumentTypes: [{tag: 'Struct', name: 'ContractAddress', elements: [{name: 'bytes', type: {tag: 'Bytes', length: 32}}]}, {tag: 'Bytes', length: 32}, {tag: 'Uint', maxval: '255'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Struct', name: 'UserAddress', elements: [{name: 'bytes', type: {tag: 'Bytes', length: 32}}]}, {tag: 'Uint', maxval: '340282366920938463463374607431768211455'}], resultType: {tag: 'Field'}},
  'ownerStatementDigest': {pure: true, provable: false, argumentTypes: [{tag: 'Bytes', length: 32}, {tag: 'Struct', name: 'ContractAddress', elements: [{name: 'bytes', type: {tag: 'Bytes', length: 32}}]}, {tag: 'Bytes', length: 32}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Field'}], resultType: {tag: 'Field'}},
  'buildConstants': {pure: true, provable: false, argumentTypes: [], resultType: {tag: 'Vector', length: 3, type: {tag: 'Uint', maxval: '18446744073709551615'}}},
  'deposit': {pure: false, provable: true, argumentTypes: [{tag: 'Uint', maxval: '340282366920938463463374607431768211455'}], resultType: {tag: 'Tuple', types: []}},
  'execute': {pure: false, provable: true, argumentTypes: [{tag: 'Struct', name: 'UserAddress', elements: [{name: 'bytes', type: {tag: 'Bytes', length: 32}}]}, {tag: 'Uint', maxval: '340282366920938463463374607431768211455'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Vector', length: 5, type: {tag: 'Struct', name: 'Maybe', elements: [{name: 'is_some', type: {tag: 'Boolean'}}, {name: 'value', type: {tag: 'Struct', name: 'Approval', elements: [{name: 'signer', type: {tag: 'JubjubPoint'}}, {name: 'sig', type: {tag: 'Struct', name: 'JubjubSchnorrSignature', elements: [{name: 'announcement', type: {tag: 'JubjubPoint'}}, {name: 'response', type: {tag: 'Field'}}]}}]}}]}}], resultType: {tag: 'Tuple', types: []}},
  'delegatePayout': {pure: false, provable: true, argumentTypes: [{tag: 'Uint', maxval: '255'}, {tag: 'Struct', name: 'UserAddress', elements: [{name: 'bytes', type: {tag: 'Bytes', length: 32}}]}, {tag: 'Uint', maxval: '340282366920938463463374607431768211455'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Struct', name: 'Maybe', elements: [{name: 'is_some', type: {tag: 'Boolean'}}, {name: 'value', type: {tag: 'Uint', maxval: '18446744073709551615'}}]}, {tag: 'Struct', name: 'JubjubSchnorrSignature', elements: [{name: 'announcement', type: {tag: 'JubjubPoint'}}, {name: 'response', type: {tag: 'Field'}}]}], resultType: {tag: 'Tuple', types: []}},
  'proposeOwners': {pure: false, provable: true, argumentTypes: [{tag: 'Vector', length: 5, type: {tag: 'Struct', name: 'Owner', elements: [{name: 'approvalKey', type: {tag: 'JubjubPoint'}}, {name: 'upgradeKey', type: {tag: 'Bytes', length: 32}}]}}, {tag: 'Uint', maxval: '255'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Vector', length: 5, type: {tag: 'Struct', name: 'Maybe', elements: [{name: 'is_some', type: {tag: 'Boolean'}}, {name: 'value', type: {tag: 'Struct', name: 'Approval', elements: [{name: 'signer', type: {tag: 'JubjubPoint'}}, {name: 'sig', type: {tag: 'Struct', name: 'JubjubSchnorrSignature', elements: [{name: 'announcement', type: {tag: 'JubjubPoint'}}, {name: 'response', type: {tag: 'Field'}}]}}]}}]}}], resultType: {tag: 'Tuple', types: []}},
  'cancelOwners': {pure: false, provable: true, argumentTypes: [{tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Vector', length: 5, type: {tag: 'Struct', name: 'Maybe', elements: [{name: 'is_some', type: {tag: 'Boolean'}}, {name: 'value', type: {tag: 'Struct', name: 'Approval', elements: [{name: 'signer', type: {tag: 'JubjubPoint'}}, {name: 'sig', type: {tag: 'Struct', name: 'JubjubSchnorrSignature', elements: [{name: 'announcement', type: {tag: 'JubjubPoint'}}, {name: 'response', type: {tag: 'Field'}}]}}]}}]}}], resultType: {tag: 'Tuple', types: []}},
  'applyOwners': {pure: false, provable: true, argumentTypes: [], resultType: {tag: 'Tuple', types: []}},
  'proposePolicy': {pure: false, provable: true, argumentTypes: [{tag: 'Struct', name: 'Policy', elements: [{name: 'whitelistEnabled', type: {tag: 'Boolean'}}, {name: 'whitelist', type: {tag: 'Vector', length: 8, type: {tag: 'Struct', name: 'WlEntry', elements: [{name: 'active', type: {tag: 'Boolean'}}, {name: 'recipient', type: {tag: 'Bytes', length: 32}}, {name: 'scope', type: {tag: 'Enum', name: 'Scope', elements: ['QuorumOnly', 'Any']}}]}}}, {name: 'delegates', type: {tag: 'Vector', length: 2, type: {tag: 'Struct', name: 'DelegatePolicy', elements: [{name: 'active', type: {tag: 'Boolean'}}, {name: 'key', type: {tag: 'JubjubPoint'}}, {name: 'cap', type: {tag: 'Uint', maxval: '340282366920938463463374607431768211455'}}, {name: 'period', type: {tag: 'Uint', maxval: '18446744073709551615'}}]}}}]}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Vector', length: 5, type: {tag: 'Struct', name: 'Maybe', elements: [{name: 'is_some', type: {tag: 'Boolean'}}, {name: 'value', type: {tag: 'Struct', name: 'Approval', elements: [{name: 'signer', type: {tag: 'JubjubPoint'}}, {name: 'sig', type: {tag: 'Struct', name: 'JubjubSchnorrSignature', elements: [{name: 'announcement', type: {tag: 'JubjubPoint'}}, {name: 'response', type: {tag: 'Field'}}]}}]}}]}}], resultType: {tag: 'Tuple', types: []}},
  'cancelPolicy': {pure: false, provable: true, argumentTypes: [{tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Vector', length: 5, type: {tag: 'Struct', name: 'Maybe', elements: [{name: 'is_some', type: {tag: 'Boolean'}}, {name: 'value', type: {tag: 'Struct', name: 'Approval', elements: [{name: 'signer', type: {tag: 'JubjubPoint'}}, {name: 'sig', type: {tag: 'Struct', name: 'JubjubSchnorrSignature', elements: [{name: 'announcement', type: {tag: 'JubjubPoint'}}, {name: 'response', type: {tag: 'Field'}}]}}]}}]}}], resultType: {tag: 'Tuple', types: []}},
  'applyPolicy': {pure: false, provable: true, argumentTypes: [], resultType: {tag: 'Tuple', types: []}},
  'narrowPolicy': {pure: false, provable: true, argumentTypes: [{tag: 'Struct', name: 'Policy', elements: [{name: 'whitelistEnabled', type: {tag: 'Boolean'}}, {name: 'whitelist', type: {tag: 'Vector', length: 8, type: {tag: 'Struct', name: 'WlEntry', elements: [{name: 'active', type: {tag: 'Boolean'}}, {name: 'recipient', type: {tag: 'Bytes', length: 32}}, {name: 'scope', type: {tag: 'Enum', name: 'Scope', elements: ['QuorumOnly', 'Any']}}]}}}, {name: 'delegates', type: {tag: 'Vector', length: 2, type: {tag: 'Struct', name: 'DelegatePolicy', elements: [{name: 'active', type: {tag: 'Boolean'}}, {name: 'key', type: {tag: 'JubjubPoint'}}, {name: 'cap', type: {tag: 'Uint', maxval: '340282366920938463463374607431768211455'}}, {name: 'period', type: {tag: 'Uint', maxval: '18446744073709551615'}}]}}}]}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Vector', length: 5, type: {tag: 'Struct', name: 'Maybe', elements: [{name: 'is_some', type: {tag: 'Boolean'}}, {name: 'value', type: {tag: 'Struct', name: 'Approval', elements: [{name: 'signer', type: {tag: 'JubjubPoint'}}, {name: 'sig', type: {tag: 'Struct', name: 'JubjubSchnorrSignature', elements: [{name: 'announcement', type: {tag: 'JubjubPoint'}}, {name: 'response', type: {tag: 'Field'}}]}}]}}]}}], resultType: {tag: 'Tuple', types: []}},
  'proposeRecovery': {pure: false, provable: true, argumentTypes: [{tag: 'Vector', length: 5, type: {tag: 'Struct', name: 'Owner', elements: [{name: 'approvalKey', type: {tag: 'JubjubPoint'}}, {name: 'upgradeKey', type: {tag: 'Bytes', length: 32}}]}}, {tag: 'Uint', maxval: '255'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Vector', length: 5, type: {tag: 'Struct', name: 'Maybe', elements: [{name: 'is_some', type: {tag: 'Boolean'}}, {name: 'value', type: {tag: 'Struct', name: 'GuardianApproval', elements: [{name: 'key', type: {tag: 'JubjubPoint'}}, {name: 'salt', type: {tag: 'Bytes', length: 32}}, {name: 'sig', type: {tag: 'Struct', name: 'JubjubSchnorrSignature', elements: [{name: 'announcement', type: {tag: 'JubjubPoint'}}, {name: 'response', type: {tag: 'Field'}}]}}]}}]}}], resultType: {tag: 'Tuple', types: []}},
  'cancelRecovery': {pure: false, provable: true, argumentTypes: [{tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Vector', length: 5, type: {tag: 'Struct', name: 'Maybe', elements: [{name: 'is_some', type: {tag: 'Boolean'}}, {name: 'value', type: {tag: 'Struct', name: 'Approval', elements: [{name: 'signer', type: {tag: 'JubjubPoint'}}, {name: 'sig', type: {tag: 'Struct', name: 'JubjubSchnorrSignature', elements: [{name: 'announcement', type: {tag: 'JubjubPoint'}}, {name: 'response', type: {tag: 'Field'}}]}}]}}]}}], resultType: {tag: 'Tuple', types: []}},
  'withdrawRecovery': {pure: false, provable: true, argumentTypes: [{tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Vector', length: 5, type: {tag: 'Struct', name: 'Maybe', elements: [{name: 'is_some', type: {tag: 'Boolean'}}, {name: 'value', type: {tag: 'Struct', name: 'GuardianApproval', elements: [{name: 'key', type: {tag: 'JubjubPoint'}}, {name: 'salt', type: {tag: 'Bytes', length: 32}}, {name: 'sig', type: {tag: 'Struct', name: 'JubjubSchnorrSignature', elements: [{name: 'announcement', type: {tag: 'JubjubPoint'}}, {name: 'response', type: {tag: 'Field'}}]}}]}}]}}], resultType: {tag: 'Tuple', types: []}},
  'clearExpiredRecovery': {pure: false, provable: true, argumentTypes: [], resultType: {tag: 'Tuple', types: []}},
  'applyRecovery': {pure: false, provable: true, argumentTypes: [], resultType: {tag: 'Tuple', types: []}},
  'proposeGuardians': {pure: false, provable: true, argumentTypes: [{tag: 'Vector', length: 5, type: {tag: 'Struct', name: 'GuardianSecret', elements: [{name: 'key', type: {tag: 'JubjubPoint'}}, {name: 'salt', type: {tag: 'Bytes', length: 32}}]}}, {tag: 'Uint', maxval: '255'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Vector', length: 5, type: {tag: 'Struct', name: 'Maybe', elements: [{name: 'is_some', type: {tag: 'Boolean'}}, {name: 'value', type: {tag: 'Struct', name: 'Approval', elements: [{name: 'signer', type: {tag: 'JubjubPoint'}}, {name: 'sig', type: {tag: 'Struct', name: 'JubjubSchnorrSignature', elements: [{name: 'announcement', type: {tag: 'JubjubPoint'}}, {name: 'response', type: {tag: 'Field'}}]}}]}}]}}], resultType: {tag: 'Tuple', types: []}},
  'cancelGuardians': {pure: false, provable: true, argumentTypes: [{tag: 'Uint', maxval: '18446744073709551615'}, {tag: 'Vector', length: 5, type: {tag: 'Struct', name: 'Maybe', elements: [{name: 'is_some', type: {tag: 'Boolean'}}, {name: 'value', type: {tag: 'Struct', name: 'Approval', elements: [{name: 'signer', type: {tag: 'JubjubPoint'}}, {name: 'sig', type: {tag: 'Struct', name: 'JubjubSchnorrSignature', elements: [{name: 'announcement', type: {tag: 'JubjubPoint'}}, {name: 'response', type: {tag: 'Field'}}]}}]}}]}}], resultType: {tag: 'Tuple', types: []}},
  'applyGuardians': {pure: false, provable: true, argumentTypes: [], resultType: {tag: 'Tuple', types: []}},
};

export const declaredInterfaces = {};

