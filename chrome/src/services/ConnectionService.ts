import { autoInjectable, singleton } from 'tsyringe';
import { ConnectionRepository } from '../repositories';

@singleton()
@autoInjectable()
export class ConnectionService {
    private repository = new ConnectionRepository();

    async getWebsites(conceptualWalletId: number): Promise<string[]> {
        const connection = await this.repository.get(conceptualWalletId);

        return connection?.websites.filter(website => website !== '') ?? [];
    }

    async addWebsite(conceptualWalletId: number, website: string) {
        const connection = await this.repository.get(conceptualWalletId);
        const updatedConnection = { ...connection, websites: [...connection.websites, website] };

        await this.repository.put(connection.id, updatedConnection);
    }

    async removeWebsite(conceptualWalletId: number, website: string) {
        const connection = await this.repository.get(conceptualWalletId);
        const updatedConnection = { ...connection, websites: connection.websites.filter((w) => w !== website) };

        await this.repository.put(connection.id, updatedConnection);
    }

    async connectWebsite(conceptualWalletIds: number[], website: string) {
        const connections = await Promise.all(conceptualWalletIds.map((id) => this.repository.get(id)));
        const updatedConnections = connections
            .filter(Boolean)
            .map((c) => ({ ...c, websites: Array.from(new Set([...c.websites, website])) }));
        await Promise.all(updatedConnections.map((c) => this.repository.put(c.id, c)));
    }

    async isWebsiteConnected(website: string): Promise<boolean> {
        const connections = await this.repository.getAll();
        return connections.some((c) => c.websites.find((w) => w === website));
    }
}
