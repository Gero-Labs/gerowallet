import { autoInjectable, singleton } from 'tsyringe';
import { environment } from '../../../angular/src/environments/environment';
import { HandleApiResponse } from '../models/handle-api.response';

/*
* https://api.handle.me/swagger/#/
* */
@singleton()
@autoInjectable()
export class HandleApiService {
  private readonly successfulStatuses = [200, 202];


  async getHandle(handle: string): Promise<HandleApiResponse> {
    try {
      const url = `${environment.adaHandleApiUrl}/handles/${handle}`;
      const res = await fetch(url);

      if (!this.successfulStatuses.includes(res.status)) {
        return undefined;
      }

      return res.json();
    } catch (e) {
      return undefined;
    }
  }
}
