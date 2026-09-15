export interface MidnightSigningSessionState {
  walletId?: number;
  network?: string;
  locked: boolean;
  epoch: number;
}

/** Keep a prepared transaction attached to the wallet session that authorized it. */
export function captureMidnightSigningSession(
  walletId: number,
  network: string,
  read: () => MidnightSigningSessionState,
): () => void {
  const epoch = read().epoch;
  const assertCurrent = () => {
    const state = read();
    if (state.locked || state.walletId !== walletId || state.network !== network || state.epoch !== epoch) {
      throw new Error('Wallet changed or locked during Midnight transaction preparation');
    }
  };
  assertCurrent();
  return assertCurrent;
}
