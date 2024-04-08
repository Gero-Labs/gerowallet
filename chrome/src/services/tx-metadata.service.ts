import { autoInjectable, singleton } from 'tsyringe';
import { Transaction, TransactionMetadatum } from '@emurgo/cardano-serialization-lib-nodejs';
import { AsyncLoader } from '../shared/AsyncLoader';

const TX_MESSAGE_LABEL = "674";
const TX_MESSAGE_PROPERTY = "msg";

@singleton()
@autoInjectable()
export class TxMetadataService  {
  
  parseMetadata(tx: Transaction): string[] {
    let metadata = tx.auxiliary_data()?.metadata();
    if (metadata && metadata.keys()) {
      const keys = metadata.keys();
      for (let i = 0; i < keys.len(); i++) {
        const key = keys.get(i);
        if (key.to_str() === TX_MESSAGE_LABEL) {
          const jsonString = this.getMessageContent(metadata.get(key));
          const metadataObject = JSON.parse(jsonString);
          if (metadataObject && metadataObject[TX_MESSAGE_PROPERTY]) {
            const messages: string[] = metadataObject[TX_MESSAGE_PROPERTY];
            return messages;
          }
        }
      }
    }
    return [];
  }

  private getMessageContent(txMetadatum: TransactionMetadatum) {
    return AsyncLoader.Serialization.decode_metadatum_to_json_str(
      txMetadatum,
      AsyncLoader.Serialization.MetadataJsonSchema.BasicConversions
    );
  }
}
