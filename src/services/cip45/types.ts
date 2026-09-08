export type Cip45Status = 'idle' | 'connecting' | 'connected' | 'disconnected';

export interface Cip45WalletContext {
  walletId: string;
  chain: string;
  network: string;
}

export interface Cip45Authorization extends Cip45WalletContext {
  sessionId: string;
  dappPeerId: string;
}

export interface Cip45Session {
  authorization: Cip45Authorization;
  dappPeerId: string;
  dappName: string;
  dappUrl: string;
  identicon: string | null;
  connectedAt: number;
}

export interface Cip45Pairing {
  dappPeerId: string;
  dappName: string;
  dappUrl: string;
  walletId: string;
  pairedAt: number;
}
