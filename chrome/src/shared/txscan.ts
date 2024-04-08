export enum Risk {
  Suspicious = 'suspicious',
  Unknown = 'unknown',
  Blacklist = 'blacklist',
  Whitelist = 'whitelist',
}

export enum Score {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export interface TxScanInfo {
  domainRisk?: Risk;
  addressRisk?: Risk;
  receivingRisk: boolean;
  score?: Score;
}
