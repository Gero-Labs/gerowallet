/**
 * What a failed tx submit means, from the backend's HTTP status. Shared by the in-wallet send
 * (WalletBg.submitTx) and the CIP-30 submitTx handler so the two can't drift apart.
 *
 * Any 5xx is a server-side failure, not a bad request: gero-backend answers 502 when Ogmios is
 * unreachable and 504 on upstream timeouts, and the ingress answers 502/504 too. Only 500 used to
 * count, so those surfaced as "invalid request".
 */
export type SubmitFailureKind = 'failure' | 'refused' | 'mempoolFull' | 'internal' | 'invalidRequest';

export function classifySubmitFailure(status: number | undefined): SubmitFailureKind {
  if (status === 400) return 'failure';
  if (status === 429) return 'refused';
  if (status === 425) return 'mempoolFull';
  if (status !== undefined && status >= 500 && status < 600) return 'internal';
  return 'invalidRequest';
}
