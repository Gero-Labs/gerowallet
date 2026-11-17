import { Blockchain, Network } from '@/models/types';

/** A Midnight wallet on Stagenet, which is being retired in favour of Preview (issue 1477). */
export function isMidnightStagenetWallet(wallet: { chain?: string; network?: string } | null | undefined): boolean {
  return wallet?.chain === Blockchain.MIDNIGHT && wallet?.network === Network.STAGENET;
}
