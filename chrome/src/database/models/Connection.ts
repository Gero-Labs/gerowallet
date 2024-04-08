import 'reflect-metadata';

export interface IConnection {
  id?: number;
  conceptualWalletId: number;
  websites: string[];
}

export class Connection implements IConnection {
  constructor(public id: number, public conceptualWalletId: number, public websites: string[]
  ) {
  }
}
