import { GERO_CARDANO_SERVER } from '../constants';

export type ServerStatus = true | false;
export interface IServerStatus {
    status: ServerStatus;
}

export class ServerStatusService {
    public async getServerStatus(): Promise<IServerStatus> {
        const response: IServerStatus = { status: false };

        const result = await fetch(`${GERO_CARDANO_SERVER}/status`)
            .then((res) => res.json())
            .catch((e) => (response.status = false));

        if (result && result.isServerOk === true && result.isMaintenance === false) {
            response.status = true;
        } else {
            response.status = false;
        }
        return response;
    }
}
