export interface WCSessionMeta {
  name: string;
  url: string;
  icons: string[];
  description: string;
}

export interface WCSession {
  topic: string;
  peerMeta: WCSessionMeta;
  chains: string[];
  methods: string[];
  events: string[];
  expiry: number;
  connectedAt: number;
}

export interface WCNamespace {
  chains?: string[];
  methods: string[];
  events: string[];
  accounts?: string[];
}

export interface WCProposal {
  id: number;
  proposer: {
    publicKey: string;
    metadata: WCSessionMeta;
  };
  requiredNamespaces: Record<string, WCNamespace>;
  optionalNamespaces: Record<string, WCNamespace>;
}
