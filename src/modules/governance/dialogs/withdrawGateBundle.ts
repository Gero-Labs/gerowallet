import { Cardano } from '@cardano-sdk/core';
import { toLovelace, type LovelaceLike } from '@/shared/utils/lovelace';

/**
 * The "withdraw with always-abstain" bundle.
 *
 * CIP-1694 holds staking rewards on a registered stake key until that key has
 * delegated its vote. The wallet therefore cannot offer a bare withdrawal to a
 * blocked user: the node would reject it. What it CAN offer is one transaction
 * that takes the cheapest position available (always-abstain) and withdraws in
 * the same body, so the user signs once instead of twice.
 *
 * Both server-side builders are single-purpose here, which is why this path
 * stays on the local builder: nexus `POST /build/vote-delegation` carries no
 * withdrawal and `POST /build/withdrawal` carries no certificate. The local
 * `buildCardanoTransaction` copies `certificates` and `withdrawals` onto the
 * same body (src/shared/utils/builder.ts), which is exactly the bundling this
 * needs.
 *
 * Pure over its arguments and free of store imports, so the whole shape of the
 * transaction is testable without a wallet, a network or WASM.
 */

export interface AbstainWithdrawalBundleInput {
  /** The stake key hash: `walletStore.keys.stake[0].cred`. */
  stakeKeyHash: string;
  /** The bech32 reward address: `loggedWallet.stakeAddress`. */
  stakeAddress: string;
  /**
   * `account.withdrawable_amount`, a decimal lovelace STRING. Parsed with
   * `toLovelace` — rewards on a large account exceed Number's safe range, and
   * a withdrawal that does not name the exact balance is rejected outright.
   */
  withdrawableAmount: LovelaceLike;
  /** Is the stake key already registered on chain (`isStakeKeyRegistered`)? */
  registered: boolean;
  /** `epochParams.stakeKeyDeposit`. Only read when the key is unregistered. */
  stakeKeyDeposit?: LovelaceLike;
}

export interface AbstainWithdrawalBundle {
  certificates: Cardano.Certificate[];
  withdrawals: Cardano.Withdrawal[];
  /** Deposit the body must fund; 0n whenever no registration is attached. */
  implicitCoin: bigint;
}

/**
 * The subset of `buildCardanoTransaction` this module drives. Injected rather
 * than imported so the wiring can be asserted without pulling the real builder
 * (and the wallet store behind it) into a unit test.
 */
export type BuildTxFn = (params: {
  certificates?: Cardano.Certificate[];
  withdrawals?: Cardano.Withdrawal[];
  implicitCoin?: bigint;
  utxos: Cardano.Utxo[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the builder's epochParams/tip/walletContext types are structural and pass straight through
  [key: string]: any;
}) => Promise<Cardano.Tx>;

/** Everything the builder needs beyond the bundle itself. */
export interface AbstainWithdrawalTxContext {
  utxos: Cardano.Utxo[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors buildCardanoTransaction's own structural params
  epochParams: any;
  changeAddress: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the store's Cardano/Bitcoin tip union
  tip: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Keys | null, passed through unchanged
  walletContext?: any;
}

/**
 * Build the certificate + withdrawal pair for one always-abstain unlock.
 *
 * A registered key needs only the `VoteDelegation`. An unregistered one gets a
 * separate `Registration` first rather than the combined
 * `VoteRegistrationDelegation`: separate certificates are what Trezor can sign,
 * and this path has no reason to prefer the combined form.
 */
export function buildAbstainWithdrawalBundle(
  input: AbstainWithdrawalBundleInput,
): AbstainWithdrawalBundle {
  const stakeCredential: Cardano.Credential = {
    type: Cardano.CredentialType.KeyHash,
    hash: input.stakeKeyHash as Cardano.Credential['hash'],
  };

  const certificates: Cardano.Certificate[] = [];
  let implicitCoin = 0n;

  if (!input.registered) {
    const deposit = toLovelace(input.stakeKeyDeposit);
    certificates.push({
      __typename: Cardano.CertificateType.Registration,
      stakeCredential,
      deposit,
    } as Cardano.NewStakeAddressCertificate);
    implicitCoin = deposit;
  }

  certificates.push({
    __typename: Cardano.CertificateType.VoteDelegation,
    stakeCredential,
    dRep: { __typename: 'AlwaysAbstain' } as Cardano.AlwaysAbstain,
  } as Cardano.VoteDelegationCertificate);

  // A zero balance yields no withdrawal rather than a zero-quantity one: the
  // node rejects an empty withdrawal, and the certificate alone still unlocks
  // the account for next epoch.
  const quantity = toLovelace(input.withdrawableAmount);
  const withdrawals: Cardano.Withdrawal[] =
    quantity > 0n
      ? [{ stakeAddress: input.stakeAddress as Cardano.RewardAccount, quantity }]
      : [];

  return { certificates, withdrawals, implicitCoin };
}

/**
 * Bundle and build in one call: ONE transaction body carrying both the
 * always-abstain vote delegation and the reward withdrawal.
 */
export async function buildAbstainWithdrawalTx(
  input: AbstainWithdrawalBundleInput,
  context: AbstainWithdrawalTxContext,
  buildTx: BuildTxFn,
): Promise<Cardano.Tx> {
  const bundle = buildAbstainWithdrawalBundle(input);
  return buildTx({
    certificates: bundle.certificates,
    withdrawals: bundle.withdrawals,
    implicitCoin: bundle.implicitCoin,
    utxos: context.utxos,
    epochParams: context.epochParams,
    changeAddress: context.changeAddress,
    tip: context.tip,
    walletContext: context.walletContext,
  });
}

/** Does this certificate delegate the vote to always-abstain? */
export function isAlwaysAbstainDelegation(certificate: Cardano.Certificate): boolean {
  if (certificate.__typename !== Cardano.CertificateType.VoteDelegation) return false;
  const { dRep } = certificate as Cardano.VoteDelegationCertificate;
  return !!dRep && '__typename' in dRep && dRep.__typename === 'AlwaysAbstain';
}
