import { autoInjectable, singleton } from 'tsyringe';
import { Risk, Score, TxScanInfo } from '../shared/txscan';
import { config } from '../config';
import { TxScanMessageParams, TxScanMessageRequest } from '../messaging/handlers';

@singleton()
@autoInjectable()
export class ScanTxService  {
  public async scanTx(request: TxScanMessageParams): Promise<TxScanInfo> {
    const result = await fetch(`${config.scanUrl}/api/v1/tx/scan`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.candanoShieldAPIKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    return result.json().then(res => this.responseMapper(res))
    .catch(() => {
      return {
        receivingRisk: false,
      }
    });
  }

  private responseMapper(response): TxScanInfo {
    const domainRisk = this.riskMapper(response.domainRisk);
    const addressRisk = this.riskMapper(response.addressRisk);
    const receivingRisk = response.receivingRisk === true;
    const score = this.scoreMapper(response.score);

    return {
      domainRisk,
      addressRisk,
      receivingRisk,
      score,
    };
  }

  private riskMapper(risk: string | undefined): Risk | undefined {
    if (risk) {
      if (risk === 'suspicious') {
        return Risk.Suspicious;
      } else if (risk === 'unknown') {
        return Risk.Unknown
      } else if (risk === 'blacklist') {
        return Risk.Blacklist
      } else if (risk === 'whitelist') {
        return Risk.Whitelist
      }
    }
    return undefined;
  }

  private scoreMapper(score: string | undefined): Score | undefined {
    if (score) {
      if (score === 'low') {
        return Score.Low;
      } else if (score === 'medium') {
        return Score.Medium;
      } else if (score === 'high') {
        return Score.High;
      }
    }
    return undefined;
  }
}
