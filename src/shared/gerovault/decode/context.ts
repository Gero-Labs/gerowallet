import type { NetworkId } from './address';
import type { Refusals } from './refusals';

/** What every field decoder of one decode shares. */
export interface DecodeContext {
  /** The network the signer is on: every address, reward account and the body network id must say it. */
  networkId: NetworkId;
  /**
   * The protocol's stake key deposit (`keyDeposit`), for the pre-Conway stake registration and
   * deregistration certificates, which state no amount. Without it those certificates refuse
   * (`deposit_unknown`). Whatever it says, the balance check holds the body to it.
   */
  stakeKeyDepositLovelace?: bigint;
  refusals: Refusals;
}
