import { autoInjectable, singleton } from "tsyringe";
import * as CryptoTS from 'crypto-ts';
import { Observable, of } from "rxjs";

@singleton()
@autoInjectable()
export class EncodingService {
  public encode<T>(payload: T, hashKey: string): Observable<string> {
    const str = JSON.stringify(payload);
    return of(CryptoTS.AES.encrypt(str, hashKey).toString());
  }

  public decode<T>(payload: string, hashKey: string): T | undefined {
    const bytes = CryptoTS.AES.decrypt(payload, hashKey);
    try {
      const originalText = bytes.toString(CryptoTS.enc.Utf8);
      const json = JSON.parse(originalText);
      return json;
    } catch(e) {
      return undefined;
    }
  }
}
