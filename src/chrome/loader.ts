import * as serialization from '@emurgo/cardano-serialization-lib-browser';
import * as signing from '@emurgo/cardano-message-signing-browser';

class Serialization {
  private _serialization: typeof serialization;
  private _signing: typeof signing;

  async load(): Promise<void> {
    if (this._serialization != null || this._signing != null) return;
    this._serialization = await import('@emurgo/cardano-serialization-lib-browser');
    this._signing = await import('@emurgo/cardano-message-signing-browser');
  }

  get Serialization(): typeof serialization {
    return this._serialization;
  }
  get Signing(): typeof signing {
    return this._signing;
  }
}

export const Loader: Serialization = new Serialization();
