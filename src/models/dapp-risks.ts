import {DappRisk, DappScore} from "@/models/dapp-statuses";

export default interface DappRisks {
  domainRisk: DappRisk;
  addressRisk: DappRisk;
  receivingRisk: boolean;
  givingRisk: boolean;
  score: DappScore;
}
