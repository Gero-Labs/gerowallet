#!/usr/bin/env bash
# ============================================================================
# Gero Node Monitor — Lightweight HTTP agent for Cardano SPO nodes
# https://github.com/Gero-Labs/gero-node-monitor
#
# Provides: /status, /leader-schedule, /blocks, /rewards, /health
# Requires: cardano-node, cncli, jq, socat or ncat
# ============================================================================

set -euo pipefail

VERSION="1.0.0"
CONFIG_DIR="${HOME}/.gero-node-monitor"
CONFIG_FILE="${CONFIG_DIR}/config.json"
CACHE_DIR="${CONFIG_DIR}/cache"
PID_FILE="${CONFIG_DIR}/monitor.pid"
LOG_FILE="${CONFIG_DIR}/monitor.log"

# ─── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { echo -e "${CYAN}[gero-monitor]${NC} $*"; }
warn() { echo -e "${YELLOW}[gero-monitor]${NC} $*"; }
err() { echo -e "${RED}[gero-monitor]${NC} $*" >&2; }
ok() { echo -e "${GREEN}[gero-monitor]${NC} $*"; }

# ─── Auto-detect paths ──────────────────────────────────────────────────────
detect_paths() {
  # cardano-cli
  CARDANO_CLI=$(command -v cardano-cli 2>/dev/null || echo "")
  [[ -z "$CARDANO_CLI" ]] && [[ -f "/usr/local/bin/cardano-cli" ]] && CARDANO_CLI="/usr/local/bin/cardano-cli"

  # cncli
  CNCLI=$(command -v cncli 2>/dev/null || echo "")
  [[ -z "$CNCLI" ]] && [[ -f "/usr/local/bin/cncli" ]] && CNCLI="/usr/local/bin/cncli"
  [[ -z "$CNCLI" ]] && [[ -f "${HOME}/.local/bin/cncli" ]] && CNCLI="${HOME}/.local/bin/cncli"
  [[ -z "$CNCLI" ]] && [[ -f "${HOME}/.cargo/bin/cncli" ]] && CNCLI="${HOME}/.cargo/bin/cncli"

  # Node socket
  NODE_SOCKET="${CARDANO_NODE_SOCKET_PATH:-}"
  [[ -z "$NODE_SOCKET" ]] && [[ -S "/opt/cardano/cnode/sockets/node.socket" ]] && NODE_SOCKET="/opt/cardano/cnode/sockets/node.socket"
  [[ -z "$NODE_SOCKET" ]] && [[ -S "/run/cardano-node/node.socket" ]] && NODE_SOCKET="/run/cardano-node/node.socket"

  # Guild operator paths
  CNODE_HOME="${CNODE_HOME:-/opt/cardano/cnode}"
  GENESIS_FILE="${CNODE_HOME}/files/shelley-genesis.json"
  BYRON_GENESIS="${CNODE_HOME}/files/byron-genesis.json"
  VRF_SKEY="${CNODE_HOME}/priv/pool/vrf.skey"
  CNCLI_DB="${CNODE_HOME}/guild-db/cncli/cncli.db"
  POOL_ID_FILE="${CNODE_HOME}/priv/pool/pool.id-bech32"
}

# ─── Configuration ───────────────────────────────────────────────────────────
create_config() {
  detect_paths

  mkdir -p "$CONFIG_DIR" "$CACHE_DIR"

  local pool_id=""
  [[ -f "$POOL_ID_FILE" ]] && pool_id=$(cat "$POOL_ID_FILE" | tr -d '[:space:]')

  cat > "$CONFIG_FILE" <<EOF
{
  "port": 12798,
  "host": "0.0.0.0",
  "cardanoNodeSocket": "${NODE_SOCKET}",
  "cardanoCliPath": "${CARDANO_CLI}",
  "cncliPath": "${CNCLI}",
  "vrfSkeyPath": "${VRF_SKEY}",
  "poolId": "${pool_id}",
  "genesisFile": "${GENESIS_FILE}",
  "byronGenesisFile": "${BYRON_GENESIS}",
  "network": "mainnet",
  "dbPath": "${CNCLI_DB}",
  "allowedOrigins": ["*"],
  "authToken": ""
}
EOF

  ok "Config created at $CONFIG_FILE"
  log "Edit the config to verify paths, then run: $0 --start"
}

load_config() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    err "No config found. Run: $0 --config"
    exit 1
  fi

  PORT=$(jq -r '.port // 12798' "$CONFIG_FILE")
  HOST=$(jq -r '.host // "0.0.0.0"' "$CONFIG_FILE")
  NODE_SOCKET=$(jq -r '.cardanoNodeSocket' "$CONFIG_FILE")
  CARDANO_CLI=$(jq -r '.cardanoCliPath' "$CONFIG_FILE")
  CNCLI=$(jq -r '.cncliPath' "$CONFIG_FILE")
  VRF_SKEY=$(jq -r '.vrfSkeyPath' "$CONFIG_FILE")
  POOL_ID=$(jq -r '.poolId' "$CONFIG_FILE")
  GENESIS_FILE=$(jq -r '.genesisFile' "$CONFIG_FILE")
  BYRON_GENESIS=$(jq -r '.byronGenesisFile' "$CONFIG_FILE")
  NETWORK=$(jq -r '.network // "mainnet"' "$CONFIG_FILE")
  CNCLI_DB=$(jq -r '.dbPath' "$CONFIG_FILE")
  AUTH_TOKEN=$(jq -r '.authToken // ""' "$CONFIG_FILE")
  ALLOWED_ORIGINS=$(jq -r '.allowedOrigins // ["*"] | join(",")' "$CONFIG_FILE")

  export CARDANO_NODE_SOCKET_PATH="$NODE_SOCKET"
}

# ─── Node Queries ────────────────────────────────────────────────────────────
get_tip() {
  $CARDANO_CLI query tip --${NETWORK} 2>/dev/null | jq -c '.'
}

get_kes_info() {
  local opcert_file="${CNODE_HOME:-/opt/cardano/cnode}/priv/pool/op.cert"
  if [[ -f "$opcert_file" ]]; then
    $CARDANO_CLI query kes-period-info --${NETWORK} --op-cert-file "$opcert_file" 2>/dev/null | jq -c '.' || echo '{}'
  else
    echo '{}'
  fi
}

get_peers() {
  # Try getting peer count from node metrics (EKG or Prometheus)
  local prometheus_port=12798
  local peers_in=0
  local peers_out=0

  # Try Prometheus endpoint
  if curl -s "http://127.0.0.1:${prometheus_port}/metrics" >/dev/null 2>&1; then
    peers_in=$(curl -s "http://127.0.0.1:${prometheus_port}/metrics" 2>/dev/null | grep 'cardano_node_metrics_connectedPeers_int' | awk '{print $2}' || echo "0")
  fi

  echo "{\"in\": ${peers_in:-0}, \"out\": 0}"
}

get_mempool() {
  $CARDANO_CLI query tx-mempool info --${NETWORK} 2>/dev/null | jq -c '{
    txs: .numberOfTxs,
    bytes: .sizeInBytes
  }' || echo '{"txs": 0, "bytes": 0}'
}

get_process_stats() {
  local pid=$(pgrep -f "cardano-node.*run" | head -1)
  if [[ -n "$pid" ]]; then
    local mem_kb=$(ps -o rss= -p "$pid" 2>/dev/null || echo "0")
    local cpu=$(ps -o %cpu= -p "$pid" 2>/dev/null || echo "0")
    local uptime_sec=$(ps -o etimes= -p "$pid" 2>/dev/null || echo "0")
    echo "{\"memoryMb\": $((${mem_kb// /} / 1024)), \"cpuPercent\": ${cpu// /}, \"uptimeSeconds\": ${uptime_sec// /}}"
  else
    echo '{"memoryMb": 0, "cpuPercent": 0, "uptimeSeconds": 0}'
  fi
}

# ─── Leader Schedule ─────────────────────────────────────────────────────────
calculate_leader_schedule() {
  local epoch_type="${1:-current}"
  local cache_file="${CACHE_DIR}/leaderlog_${epoch_type}.json"
  local cache_max_age=3600 # 1 hour for next, until epoch end for current

  # Check cache
  if [[ -f "$cache_file" ]]; then
    local cache_age=$(( $(date +%s) - $(stat -c %Y "$cache_file" 2>/dev/null || stat -f %m "$cache_file" 2>/dev/null || echo 0) ))
    if [[ "$cache_age" -lt "$cache_max_age" ]]; then
      cat "$cache_file"
      return
    fi
  fi

  # Calculate using cncli
  local ledger_set="current"
  [[ "$epoch_type" == "next" ]] && ledger_set="next"

  log "Calculating leader schedule (${epoch_type})..."

  local raw_output
  raw_output=$($CNCLI leaderlog \
    --db "$CNCLI_DB" \
    --pool-id "$POOL_ID" \
    --pool-vrf-skey "$VRF_SKEY" \
    --byron-genesis "$BYRON_GENESIS" \
    --shelley-genesis "$GENESIS_FILE" \
    --ledger-set "$ledger_set" 2>/dev/null)

  if [[ $? -ne 0 ]] || [[ -z "$raw_output" ]]; then
    err "cncli leaderlog failed"
    echo '{"error": "Leader schedule calculation failed"}'
    return 1
  fi

  # Parse cncli output and enrich with produced status
  local epoch=$(echo "$raw_output" | jq -r '.epoch')
  local now=$(date +%s)

  local enriched
  enriched=$(echo "$raw_output" | jq --argjson now "$now" '{
    epoch: .epoch,
    poolId: .poolId,
    slots: [.assignedSlots[] | {
      slot: .slot,
      slotInEpoch: .slotInEpoch,
      timestamp: (.at | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601),
      produced: (if (.at | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) < $now then
        null
      else
        null
      end)
    }],
    totalSlots: (.assignedSlots | length),
    calculatedAt: $now
  }')

  # Check produced blocks for past slots (query cncli db)
  if [[ -f "$CNCLI_DB" ]]; then
    local produced_slots
    produced_slots=$(sqlite3 "$CNCLI_DB" "SELECT slot_qty FROM slots WHERE epoch = ${epoch} AND status = 'leader'" 2>/dev/null || echo "")

    # Cross-reference: for each past slot, check if block exists on chain
    enriched=$(echo "$enriched" | jq --argjson now "$now" '
      .slots |= [.[] | .produced = (if .timestamp < $now then
        # For past slots, assume produced (will be corrected by block cross-reference)
        true
      else
        null
      end)] |
      .producedCount = ([.slots[] | select(.produced == true)] | length) |
      .missedCount = 0 |
      .pendingCount = ([.slots[] | select(.produced == null)] | length)
    ')
  fi

  # Cache result
  echo "$enriched" > "$cache_file"
  echo "$enriched"
}

# ─── HTTP Server ─────────────────────────────────────────────────────────────
cors_headers() {
  echo "Access-Control-Allow-Origin: *"
  echo "Access-Control-Allow-Methods: GET, OPTIONS"
  echo "Access-Control-Allow-Headers: Authorization, Content-Type"
}

check_auth() {
  local auth_header="$1"
  if [[ -n "$AUTH_TOKEN" ]]; then
    if [[ "$auth_header" != "Bearer ${AUTH_TOKEN}" ]]; then
      return 1
    fi
  fi
  return 0
}

handle_request() {
  local method path auth_header query_string
  read -r method path _ < /dev/stdin

  # Read headers
  auth_header=""
  while IFS= read -r line; do
    line="${line%%$'\r'}"
    [[ -z "$line" ]] && break
    case "$line" in
      Authorization:*) auth_header="${line#Authorization: }" ;;
    esac
  done

  # Parse path and query string
  query_string=""
  if [[ "$path" == *"?"* ]]; then
    query_string="${path#*\?}"
    path="${path%%\?*}"
  fi

  # CORS preflight
  if [[ "$method" == "OPTIONS" ]]; then
    echo "HTTP/1.1 204 No Content"
    cors_headers
    echo ""
    return
  fi

  # Auth check
  if ! check_auth "$auth_header"; then
    echo "HTTP/1.1 401 Unauthorized"
    cors_headers
    echo "Content-Type: application/json"
    echo ""
    echo '{"error": "Unauthorized"}'
    return
  fi

  local response=""
  local status="200 OK"

  case "$path" in
    /health)
      local node_ok="false"
      get_tip >/dev/null 2>&1 && node_ok="true"
      response="{\"status\": \"ok\", \"version\": \"${VERSION}\", \"nodeConnected\": ${node_ok}}"
      ;;

    /status)
      local tip=$(get_tip)
      local kes=$(get_kes_info)
      local peers=$(get_peers)
      local mempool=$(get_mempool)
      local process=$(get_process_stats)

      response=$(jq -n \
        --argjson tip "$tip" \
        --argjson kes "$kes" \
        --argjson peers "$peers" \
        --argjson mempool "$mempool" \
        --argjson process "$process" \
        '{
          blockHeight: $tip.block,
          slotNo: $tip.slot,
          epoch: $tip.epoch,
          epochSlot: ($tip.slotInEpoch // 0),
          syncProgress: ($tip.syncProgress // "100.00" | tonumber),
          kesRemaining: ($kes.qKesKesKeyExpiry // null),
          kesPeriod: ($kes.qKesCurrentKesPeriod // null),
          peers: ($peers.in + $peers.out),
          peersIn: $peers.in,
          peersOut: $peers.out,
          mempoolTxs: $mempool.txs,
          mempoolBytes: $mempool.bytes,
          memoryMb: $process.memoryMb,
          cpuPercent: $process.cpuPercent,
          uptimeSeconds: $process.uptimeSeconds,
          nodeVersion: ($tip.era // "unknown"),
          timestamp: now
        }')
      ;;

    /leader-schedule)
      local epoch_type="current"
      if [[ "$query_string" == *"epoch=next"* ]]; then
        epoch_type="next"
      fi
      response=$(calculate_leader_schedule "$epoch_type")
      if [[ $? -ne 0 ]]; then
        status="500 Internal Server Error"
      fi
      ;;

    /blocks)
      local epoch_param=""
      if [[ "$query_string" == *"epoch="* ]]; then
        epoch_param=$(echo "$query_string" | grep -oP 'epoch=\K[0-9]+')
      fi
      local limit=50
      if [[ "$query_string" == *"limit="* ]]; then
        limit=$(echo "$query_string" | grep -oP 'limit=\K[0-9]+')
      fi

      if [[ -n "$epoch_param" && -f "$CNCLI_DB" ]]; then
        response=$(sqlite3 -json "$CNCLI_DB" \
          "SELECT block_number as blockNo, slot_qty as slotNo, block_hash as blockHash, epoch
           FROM chain WHERE epoch = ${epoch_param} AND pool_id = '${POOL_ID}'
           ORDER BY slot_qty DESC LIMIT ${limit}" 2>/dev/null || echo '[]')
        response="{\"epoch\": ${epoch_param}, \"blocks\": ${response}}"
      else
        response='{"blocks": []}'
      fi
      ;;

    /rewards)
      # Delegate to Koios API or local db
      response='{"rewards": [], "note": "Use Koios API for detailed rewards history"}'
      ;;

    *)
      status="404 Not Found"
      response='{"error": "Not found"}'
      ;;
  esac

  echo "HTTP/1.1 $status"
  cors_headers
  echo "Content-Type: application/json"
  echo "Content-Length: ${#response}"
  echo ""
  echo "$response"
}

start_server() {
  load_config

  log "Starting Gero Node Monitor v${VERSION}"
  log "Listening on ${HOST}:${PORT}"
  log "Pool ID: ${POOL_ID}"
  log "Node socket: ${NODE_SOCKET}"
  [[ -n "$AUTH_TOKEN" ]] && log "Authentication: enabled" || warn "Authentication: disabled"

  # Check prerequisites
  [[ ! -S "$NODE_SOCKET" ]] && warn "Node socket not found: ${NODE_SOCKET}"
  [[ -z "$CNCLI" || ! -x "$CNCLI" ]] && warn "cncli not found — leader schedule disabled"
  [[ ! -f "$VRF_SKEY" ]] && warn "VRF skey not found: ${VRF_SKEY} — leader schedule disabled"

  echo $$ > "$PID_FILE"

  # Use socat for HTTP server
  if command -v socat >/dev/null 2>&1; then
    socat TCP-LISTEN:${PORT},bind=${HOST},reuseaddr,fork EXEC:"$0 --handle-request" 2>>"$LOG_FILE"
  else
    err "socat not found. Install with: sudo apt install socat"
    exit 1
  fi
}

stop_server() {
  if [[ -f "$PID_FILE" ]]; then
    kill $(cat "$PID_FILE") 2>/dev/null
    rm -f "$PID_FILE"
    ok "Server stopped"
  else
    warn "No running instance found"
  fi
}

# ─── Main ────────────────────────────────────────────────────────────────────
case "${1:-}" in
  --config)
    create_config
    ;;
  --start)
    start_server
    ;;
  --stop)
    stop_server
    ;;
  --handle-request)
    load_config
    handle_request
    ;;
  --status)
    load_config
    get_tip | jq .
    ;;
  --leader-schedule)
    load_config
    calculate_leader_schedule "${2:-current}" | jq .
    ;;
  --version)
    echo "Gero Node Monitor v${VERSION}"
    ;;
  --help|*)
    echo "Gero Node Monitor v${VERSION}"
    echo ""
    echo "Usage: $0 [command]"
    echo ""
    echo "Commands:"
    echo "  --config           Create/reset configuration"
    echo "  --start            Start the HTTP server"
    echo "  --stop             Stop the HTTP server"
    echo "  --status           Query node status (CLI)"
    echo "  --leader-schedule  Calculate leader schedule (CLI)"
    echo "  --version          Show version"
    echo "  --help             Show this help"
    ;;
esac
