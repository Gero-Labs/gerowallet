export type Cip45Status = 'idle' | 'connecting' | 'connected' | 'disconnected';

export interface Cip45Session {
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
