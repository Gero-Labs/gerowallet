// Quick smoke test: subscribe to unshieldedTransactions for our funded address
// against the public Midnight Preview indexer using graphql-transport-ws.
// Logs every event received. Kills itself after 30s.

import WebSocket from 'ws';

const WS_URL = 'wss://indexer.preview.midnight.network/api/v4/graphql/ws';
const ADDRESS = 'mn_addr_preview13vjdtfqdrsrhkmy3qsg9e4d74au3m93h3fguah66w9zps7mud6cseegqsd';

// The exact query gero-sync v0.1.27 uses (with the new output fields).
const QUERY = `
subscription Unshielded($address: UnshieldedAddress!, $transactionId: Int) {
  unshieldedTransactions(address: $address, transactionId: $transactionId) {
    __typename
    ... on UnshieldedTransaction {
      transaction {
        id hash protocolVersion raw
        block { hash height timestamp }
        unshieldedCreatedOutputs { owner value tokenType intentHash outputIndex }
        unshieldedSpentOutputs { owner value tokenType intentHash outputIndex }
      }
    }
    ... on UnshieldedTransactionsProgress {
      highestTransactionId
    }
  }
}`;

const ws = new WebSocket(WS_URL, ['graphql-transport-ws']);
const SUB_ID = '1';

ws.on('open', () => {
  console.log('[ws] open');
  ws.send(JSON.stringify({ type: 'connection_init', payload: {} }));
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());
  console.log('[recv]', msg.type, JSON.stringify(msg.payload ?? {}).slice(0, 500));

  if (msg.type === 'connection_ack') {
    console.log('[ws] connection_ack — subscribing');
    ws.send(JSON.stringify({
      id: SUB_ID,
      type: 'subscribe',
      payload: {
        query: QUERY,
        variables: { address: ADDRESS },  // no transactionId — full history
      },
    }));
  }
});

ws.on('error', (e) => console.error('[ws] error', e.message));
ws.on('close', (code, reason) => console.log('[ws] close', code, reason.toString()));

setTimeout(() => {
  console.log('[ws] killing after 30s');
  ws.close();
  process.exit(0);
}, 30000);
