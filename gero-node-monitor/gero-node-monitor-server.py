#!/usr/bin/env python3
"""
Gero Node Monitor — HTTP Server
Lightweight monitoring agent for Cardano block producer nodes.
"""

import json
import os
import subprocess
import time
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

VERSION = "1.0.0"
CONFIG_DIR = os.path.expanduser("~/.gero-node-monitor")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")
CACHE_DIR = os.path.join(CONFIG_DIR, "cache")

# Load config
def load_config():
    with open(CONFIG_FILE) as f:
        return json.load(f)

CFG = load_config()

def run_cmd(cmd, timeout=30):
    """Run a shell command and return stdout."""
    try:
        env = os.environ.copy()
        env["CARDANO_NODE_SOCKET_PATH"] = CFG["cardanoNodeSocket"]
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout, env=env)
        return result.stdout.strip()
    except Exception as e:
        return ""

def get_tip():
    raw = run_cmd(f'{CFG["cardanoCliPath"]} query tip --mainnet')
    if raw:
        return json.loads(raw)
    return {}

def get_kes_info():
    opcert = os.path.join(os.path.dirname(CFG["vrfSkeyPath"]), "op.cert")
    if os.path.exists(opcert):
        raw = run_cmd(f'{CFG["cardanoCliPath"]} query kes-period-info --mainnet --op-cert-file {opcert}')
        if raw:
            try:
                return json.loads(raw)
            except:
                pass
    return {}

def get_prometheus_metrics():
    """Scrape Cardano node's Prometheus endpoint for rich metrics."""
    prom_port = CFG.get("prometheusPort", 12798)
    try:
        import urllib.request
        raw = urllib.request.urlopen(f"http://127.0.0.1:{prom_port}/metrics", timeout=5).read().decode()
        metrics = {}
        for line in raw.split("\n"):
            if line.startswith("#") or not line.strip():
                continue
            parts = line.split(" ", 1)
            if len(parts) == 2:
                metrics[parts[0]] = parts[1].strip()
        return metrics
    except:
        return {}

def parse_prom(metrics, key, default=0):
    """Parse a Prometheus metric value."""
    val = metrics.get(key, str(default))
    try:
        return float(val) if "." in val else int(val)
    except:
        return default

def get_process_stats():
    try:
        pid = run_cmd("pgrep -f 'cardano-node.*run' | head -1")
        if pid:
            mem_kb = run_cmd(f"ps -o rss= -p {pid}").strip()
            cpu = run_cmd(f"ps -o %cpu= -p {pid}").strip()
            uptime = run_cmd(f"ps -o etimes= -p {pid}").strip()
            return {
                "memoryMb": int(mem_kb) // 1024 if mem_kb else 0,
                "cpuPercent": float(cpu) if cpu else 0,
                "uptimeSeconds": int(uptime) if uptime else 0,
            }
    except:
        pass
    return {"memoryMb": 0, "cpuPercent": 0, "uptimeSeconds": 0}

def get_mempool():
    raw = run_cmd(f'{CFG["cardanoCliPath"]} query tx-mempool info --mainnet')
    if raw:
        try:
            data = json.loads(raw)
            return {"txs": data.get("numberOfTxs", 0), "bytes": data.get("sizeInBytes", 0)}
        except:
            pass
    return {"txs": 0, "bytes": 0}

def handle_status():
    tip = get_tip()
    kes = get_kes_info()
    process = get_process_stats()
    mempool = get_mempool()
    prom = get_prometheus_metrics()

    # Prefer Prometheus metrics when available (faster + richer than cardano-cli)
    peers = parse_prom(prom, "cardano_node_metrics_peersFromNodeKernel_int", 0)
    prom_block = parse_prom(prom, "cardano_node_metrics_blockNum_int", 0)
    prom_slot = parse_prom(prom, "cardano_node_metrics_slotNum_int", 0)
    prom_epoch = parse_prom(prom, "cardano_node_metrics_epoch_int", 0)
    prom_kes_remaining = parse_prom(prom, "cardano_node_metrics_remainingKESPeriods_int", None)
    prom_kes_current = parse_prom(prom, "cardano_node_metrics_currentKESPeriod_int", None)
    prom_mempool_txs = parse_prom(prom, "cardano_node_metrics_txsInMempool_int", 0)
    prom_mempool_bytes = parse_prom(prom, "cardano_node_metrics_mempoolBytes_int", 0)
    prom_mem_rss = parse_prom(prom, "rts_gc_max_bytes_used", 0)
    prom_uptime = parse_prom(prom, "cardano_node_metrics_upTime_ns", 0)

    return {
        "blockHeight": prom_block or tip.get("block", 0),
        "slotNo": prom_slot or tip.get("slot", 0),
        "epoch": prom_epoch or tip.get("epoch", 0),
        "epochSlot": tip.get("slotInEpoch", 0),
        "epochSlotsRemaining": tip.get("slotsToEpochEnd", 0),
        "syncProgress": float(tip.get("syncProgress", "0")),
        "kesRemaining": prom_kes_remaining if prom_kes_remaining is not None else kes.get("qKesRemainingSlotsInKesPeriod", None),
        "kesPeriod": prom_kes_current if prom_kes_current is not None else kes.get("qKesCurrentKesPeriod", None),
        "peers": peers,
        "mempoolTxs": prom_mempool_txs or mempool["txs"],
        "mempoolBytes": prom_mempool_bytes or mempool["bytes"],
        "memoryMb": int(prom_mem_rss / 1048576) if prom_mem_rss else process["memoryMb"],
        "cpuPercent": process["cpuPercent"],
        "uptimeSeconds": int(prom_uptime / 1000000000) if prom_uptime else process["uptimeSeconds"],
        "nodeVersion": tip.get("era", "unknown"),
        "timestamp": int(time.time()),
    }

def handle_leader_schedule(epoch_type="current"):
    """Read leader schedule from guild-operators blocklog database.

    The cncli.sh leaderlog service pre-calculates and stores assigned slots
    in the blocklog SQLite database. We read from there instead of running
    cncli leaderlog directly (which requires stake params and is slow).
    """
    import sqlite3
    from datetime import datetime

    blocklog_db = CFG.get("blocklogDbPath",
        os.path.join(os.path.dirname(CFG["dbPath"]), "..", "blocklog", "blocklog.db"))

    if not os.path.exists(blocklog_db):
        return {"error": f"Blocklog database not found at {blocklog_db}"}

    now = int(time.time())

    try:
        conn = sqlite3.connect(blocklog_db)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # Determine epoch
        if epoch_type == "next":
            tip = get_tip()
            epoch = tip.get("epoch", 0) + 1
        else:
            tip = get_tip()
            epoch = tip.get("epoch", 0)

        # Query blocklog for assigned slots
        # Schema: id, slot, at, epoch, block, slot_in_epoch, hash, size, status
        cur.execute(
            "SELECT slot, at, epoch, block, slot_in_epoch, hash, status "
            "FROM blocklog WHERE epoch = ? ORDER BY slot",
            (epoch,)
        )
        rows = cur.fetchall()
        conn.close()

        slots = []
        produced_count = 0
        missed_count = 0
        pending_count = 0

        for row in rows:
            # Parse timestamp
            ts_str = row["at"] or ""
            try:
                dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                timestamp = int(dt.timestamp())
            except:
                timestamp = 0

            status = (row["status"] or "").lower()
            is_past = timestamp < now

            if status in ("confirmed", "adopted"):
                produced = True
                produced_count += 1
            elif status in ("missed", "ghosted", "stolen", "invalid"):
                produced = False
                missed_count += 1
            elif is_past:
                # Past slot with no clear status — assume produced if block_no exists
                if row["block"]:
                    produced = True
                    produced_count += 1
                else:
                    produced = False
                    missed_count += 1
            else:
                produced = None
                pending_count += 1

            slots.append({
                "slot": row["slot"],
                "slotInEpoch": row["slot_in_epoch"] or 0,
                "timestamp": timestamp,
                "produced": produced,
                "status": status,
                "blockNo": row["block"],
                "blockHash": row["hash"],
            })

        return {
            "epoch": epoch,
            "poolId": CFG["poolId"],
            "slots": slots,
            "totalSlots": len(slots),
            "producedCount": produced_count,
            "missedCount": missed_count,
            "pendingCount": pending_count,
            "calculatedAt": now,
        }

    except Exception as e:
        return {"error": f"Failed to read blocklog: {str(e)}"}

def handle_blocks(epoch=None, limit=50):
    if not epoch or not os.path.exists(CFG["dbPath"]):
        return {"blocks": []}

    try:
        import sqlite3
        conn = sqlite3.connect(CFG["dbPath"])
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(
            "SELECT block_number, slot_qty, hash, epoch FROM chain WHERE epoch = ? ORDER BY slot_qty DESC LIMIT ?",
            (epoch, limit)
        )
        blocks = [
            {"blockNo": r["block_number"], "slotNo": r["slot_qty"], "blockHash": r["hash"], "epoch": r["epoch"]}
            for r in cur.fetchall()
        ]
        conn.close()
        return {"epoch": epoch, "blocks": blocks}
    except Exception as e:
        return {"blocks": [], "error": str(e)}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress default logging

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        # Auth check
        token = CFG.get("authToken", "")
        if token:
            auth = self.headers.get("Authorization", "")
            if auth != f"Bearer {token}":
                self.send_json({"error": "Unauthorized"}, 401)
                return

        try:
            if path == "/health":
                tip = get_tip()
                self.send_json({"status": "ok", "version": VERSION, "nodeConnected": bool(tip)})

            elif path == "/status":
                self.send_json(handle_status())

            elif path == "/leader-schedule":
                epoch_type = params.get("epoch", ["current"])[0]
                self.send_json(handle_leader_schedule(epoch_type))

            elif path == "/blocks":
                epoch = params.get("epoch", [None])[0]
                limit = int(params.get("limit", [50])[0])
                self.send_json(handle_blocks(int(epoch) if epoch else None, limit))

            elif path == "/rewards":
                self.send_json({"rewards": [], "note": "Use Koios API for detailed rewards"})

            else:
                self.send_json({"error": "Not found"}, 404)

        except Exception as e:
            self.send_json({"error": str(e)}, 500)


def main():
    host = CFG.get("host", "0.0.0.0")
    port = CFG.get("port", 12798)

    print(f"\033[0;36m[gero-monitor]\033[0m Gero Node Monitor v{VERSION}")
    print(f"\033[0;36m[gero-monitor]\033[0m Listening on {host}:{port}")
    print(f"\033[0;36m[gero-monitor]\033[0m Pool ID: {CFG['poolId']}")
    print(f"\033[0;36m[gero-monitor]\033[0m Node socket: {CFG['cardanoNodeSocket']}")
    if CFG.get("authToken"):
        print(f"\033[0;36m[gero-monitor]\033[0m Authentication: enabled")
    else:
        print(f"\033[1;33m[gero-monitor]\033[0m Authentication: disabled")

    server = HTTPServer((host, port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print(f"\n\033[0;36m[gero-monitor]\033[0m Shutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
