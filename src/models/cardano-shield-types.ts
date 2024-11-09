export interface TxScanResponse {
  domainRisk: DappRisk;
  addressRisk: DappRisk;
  receivingRisk: boolean;
  score: DappScore;
}

export enum DappRisk {
  unknown,
  whitelist,
  blacklist ,
  suspicious ,
  timeout ,
}

export enum DappScore {
  low,
  medium,
  high,
}

export interface TxScanRequest {
  cborHex: string,
  toAddress: string,
  fromAddress: string,
  url: string
}

export enum ReportType {
  transaction,
  website
}

export enum ReportLabel {
  safe,
  scam
}
