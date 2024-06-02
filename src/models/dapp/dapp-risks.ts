import { DappRisk, DappScore } from "./statuses.enum";

export default interface DappRisks {
  domainRisk: DappRisk;
  addressRisk: DappRisk;
  receivingRisk: boolean;
  givingRisk: boolean;
  score: DappScore;
}