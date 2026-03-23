# Gero Node Monitor

Lightweight monitoring agent for Cardano block producer nodes. Exposes a simple HTTP API that the Gero Wallet SPO dashboard polls for node health, KES status, and leader schedule.

## Quick Install

```bash
curl -sSL https://raw.githubusercontent.com/Gero-Labs/gero-node-monitor/main/install.sh | bash
```

Or manual:
```bash
git clone https://github.com/Gero-Labs/gero-node-monitor.git
cd gero-node-monitor
chmod +x gero-node-monitor.sh
./gero-node-monitor.sh --config
```

## Requirements

- **cardano-node** running on the same machine
- **cncli** installed (for leader schedule calculation)
- **jq** installed
- **socat** or **netcat** for socket queries
- Access to the node socket (usually `$CARDANO_NODE_SOCKET_PATH`)
- Access to `vrf.skey` (for leader schedule)

## Configuration

On first run with `--config`, the agent creates `~/.gero-node-monitor/config.json`:

```json
{
  "port": 12798,
  "host": "0.0.0.0",
  "cardanoNodeSocket": "/opt/cardano/cnode/sockets/node.socket",
  "cardanoCliPath": "/usr/local/bin/cardano-cli",
  "cncliPath": "/usr/local/bin/cncli",
  "vrfSkeyPath": "/opt/cardano/cnode/priv/pool/vrf.skey",
  "poolId": "pool1...",
  "genesisFile": "/opt/cardano/cnode/files/shelley-genesis.json",
  "byronGenesisFile": "/opt/cardano/cnode/files/byron-genesis.json",
  "network": "mainnet",
  "dbPath": "/opt/cardano/cnode/guild-db/cncli/cncli.db",
  "allowedOrigins": ["*"],
  "authToken": ""
}
```

### Config Fields

| Field | Description | Default |
|-------|-------------|---------|
| `port` | HTTP server port | `12798` |
| `host` | Bind address (`0.0.0.0` for all, `127.0.0.1` for local only) | `0.0.0.0` |
| `cardanoNodeSocket` | Path to `node.socket` | Auto-detected from `$CARDANO_NODE_SOCKET_PATH` |
| `cardanoCliPath` | Path to `cardano-cli` binary | Auto-detected |
| `cncliPath` | Path to `cncli` binary | Auto-detected |
| `vrfSkeyPath` | Path to `vrf.skey` | Required for leader schedule |
| `poolId` | Pool ID (bech32) | Required |
| `genesisFile` | Shelley genesis JSON | Auto-detected from cntools paths |
| `byronGenesisFile` | Byron genesis JSON | Auto-detected |
| `network` | `mainnet` / `preprod` / `preview` | `mainnet` |
| `dbPath` | cncli SQLite database path | Auto-detected |
| `allowedOrigins` | CORS allowed origins | `["*"]` |
| `authToken` | Optional Bearer token for authentication | `""` (disabled) |

## API Endpoints

### `GET /status`

Node health and metrics.

**Response:**
```json
{
  "blockHeight": 13196353,
  "slotNo": 182707368,
  "epoch": 620,
  "epochSlot": 307368,
  "epochSlotsRemaining": 124632,
  "kesRemaining": 287,
  "kesPeriod": 481,
  "kesExpiryEpoch": 635,
  "peers": 12,
  "peersIn": 8,
  "peersOut": 4,
  "memoryMb": 14200,
  "cpuPercent": 3.2,
  "mempoolTxs": 5,
  "mempoolBytes": 12400,
  "uptimeSeconds": 864000,
  "nodeVersion": "10.4.0",
  "syncProgress": 100.0,
  "timestamp": 1774273659
}
```

### `GET /leader-schedule?epoch=current|next`

Leader schedule calculated via cncli.

**Query Parameters:**
| Param | Values | Description |
|-------|--------|-------------|
| `epoch` | `current` (default), `next` | Which epoch to calculate |

**Response:**
```json
{
  "epoch": 620,
  "poolId": "pool12yscr8j3zs34ewxrwlk0p2w5uvgcnrzywpp78ddjsj8kxd530f9",
  "slots": [
    {
      "slot": 182534400,
      "slotInEpoch": 134400,
      "timestamp": 1774100400,
      "produced": true
    },
    {
      "slot": 182598000,
      "slotInEpoch": 198000,
      "timestamp": 1774164000,
      "produced": false
    },
    {
      "slot": 182712000,
      "slotInEpoch": 312000,
      "timestamp": 1774278000,
      "produced": null
    }
  ],
  "totalSlots": 3,
  "producedCount": 1,
  "missedCount": 1,
  "pendingCount": 1,
  "calculatedAt": 1774273659
}
```

`produced` values:
- `true` — block was produced successfully
- `false` — slot was assigned but block was not found on chain (missed/ghosted/stolen)
- `null` — slot is in the future (not yet due)

### `GET /blocks?epoch=620&limit=50`

Recent blocks produced by the pool.

**Response:**
```json
{
  "epoch": 620,
  "blocks": [
    {
      "blockNo": 13196200,
      "slotNo": 182600000,
      "slotInEpoch": 200000,
      "blockHash": "abc123...",
      "blockSize": 1234,
      "txCount": 5,
      "timestamp": 1774166000
    }
  ]
}
```

### `GET /rewards?epochs=10`

Pool rewards history.

**Response:**
```json
{
  "rewards": [
    {
      "epoch": 620,
      "poolRewards": "1290968354",
      "delegatorRewards": "4560000000",
      "activeStake": "983000000000",
      "blocksProduced": 3,
      "blocksExpected": 2.8,
      "luck": 107.1
    }
  ]
}
```

### `GET /health`

Simple health check.

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "nodeConnected": true
}
```

## Security

### Network Access
- By default binds to `0.0.0.0:12798` — restrict with firewall rules
- Recommended: use a reverse proxy (nginx/caddy) with HTTPS
- Or bind to `127.0.0.1` and use SSH tunnel / WireGuard

### Authentication
Set `authToken` in config to require `Authorization: Bearer <token>` header:
```json
{
  "authToken": "your-secret-token-here"
}
```

The Gero Wallet will prompt for this token during Node Monitor setup.

### CORS
By default allows all origins (`*`). Restrict to your extension ID:
```json
{
  "allowedOrigins": ["chrome-extension://your-extension-id"]
}
```

## Running as a Service

### systemd
```bash
sudo cp gero-node-monitor.service /etc/systemd/system/
sudo systemctl enable gero-node-monitor
sudo systemctl start gero-node-monitor
```

### Docker
```bash
docker run -d \
  --name gero-node-monitor \
  -p 12798:12798 \
  -v /opt/cardano/cnode:/cnode:ro \
  -v /run/cardano-node:/run/cardano-node:ro \
  gerolabs/gero-node-monitor
```

## Implementation Notes

### How the Leader Schedule Works

1. Agent receives `GET /leader-schedule?epoch=current`
2. Runs `cncli leaderlog` with the pool's VRF key:
   ```bash
   cncli leaderlog \
     --db $DB_PATH \
     --pool-id $POOL_ID \
     --pool-vrf-skey $VRF_SKEY_PATH \
     --byron-genesis $BYRON_GENESIS \
     --shelley-genesis $SHELLEY_GENESIS \
     --ledger-set current
   ```
3. Parses the JSON output (slot assignments)
4. Cross-references with produced blocks from the cncli database
5. Returns enriched slot list with `produced` status

### How Missed Blocks Are Detected

For past slots:
1. Get assigned slots from `cncli leaderlog`
2. Query `cncli` db or chain for blocks at those slots
3. If no block found at an assigned slot → `produced: false`

Categories of "missed" blocks:
- **Height battle** — another pool produced at the same slot, chain picked theirs
- **Ghosted** — block was produced but didn't propagate fast enough
- **Missed** — node was down or couldn't produce in time

### Caching

Leader schedule calculation is expensive (~10-30s). The agent caches results:
- Current epoch schedule: cached until epoch boundary
- Next epoch schedule: cached for 1 hour (recalculated if stake snapshot changes)
- Results stored in memory + optional disk cache
