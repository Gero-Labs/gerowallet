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

# Load config (lazy — may not exist yet on first run)
def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return {}

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

    # Additional Prometheus metrics for gLiveView parity (exact metric names from node 10.x)
    prom_density = parse_prom(prom, "cardano_node_metrics_density_real", 0)
    prom_txs_processed = parse_prom(prom, "cardano_node_metrics_txsProcessedNum_counter", 0)
    prom_forks = parse_prom(prom, "cardano_node_metrics_forks_counter", 0)
    prom_gc_minor = parse_prom(prom, "rts_gc_num_gcs", 0)
    prom_gc_major = parse_prom(prom, "rts_gc_major_gcs", 0)
    prom_gc_live = parse_prom(prom, "rts_gc_gcLiveBytes", 0)
    prom_gc_heap = parse_prom(prom, "rts_gc_currentBytesUsed", 0) or parse_prom(prom, "rts_gc_max_bytes_used", 0)
    prom_served = parse_prom(prom, "cardano_node_metrics_served_header_counter", 0)
    prom_late = parse_prom(prom, "cardano_node_metrics_blockfetchclient_lateblocks_counter", 0)
    prom_last_delay = parse_prom(prom, "cardano_node_metrics_blockfetchclient_blockdelay_real", 0)
    prom_within_1s = parse_prom(prom, "cardano_node_metrics_blockfetchclient_blockdelay_cdfOne_real", 0)
    prom_within_3s = parse_prom(prom, "cardano_node_metrics_blockfetchclient_blockdelay_cdfThree_real", 0)
    prom_within_5s = parse_prom(prom, "cardano_node_metrics_blockfetchclient_blockdelay_cdfFive_real", 0)

    # Connection metrics (exact metric names from node 10.x Prometheus)
    conn_duplex = parse_prom(prom, "cardano_node_metrics_connectionManager_duplexConns_int", 0)
    conn_full_duplex = parse_prom(prom, "cardano_node_metrics_connectionManager_fullDuplexConns_int", 0)
    conn_unidir = parse_prom(prom, "cardano_node_metrics_connectionManager_unidirectionalConns_int", 0)
    conn_outbound = parse_prom(prom, "cardano_node_metrics_connectionManager_outboundConns_int", 0)
    conn_inbound = parse_prom(prom, "cardano_node_metrics_connectionManager_inboundConns_int", 0)
    in_warm = parse_prom(prom, "cardano_node_metrics_inboundGovernor_warm_int", 0)
    in_hot = parse_prom(prom, "cardano_node_metrics_inboundGovernor_hot_int", 0)
    in_cold = parse_prom(prom, "cardano_node_metrics_inboundGovernor_cold_int", 0)
    out_warm = parse_prom(prom, "cardano_node_metrics_peerSelection_Warm_int", 0)
    out_hot = parse_prom(prom, "cardano_node_metrics_peerSelection_Hot_int", 0)
    out_cold = parse_prom(prom, "cardano_node_metrics_peerSelection_Cold_int", 0)

    # Tip reference — extract from tipBlock metric which has hash in labels
    tip_hash = tip.get("hash", "")
    tip_ref_slot = 0
    for key in prom:
        if key.startswith("cardano_node_metrics_tipBlock"):
            # Extract hash from label: {hash="abc...",parent_hash="...",issuer_verification_key_hash="..."}
            import re
            m = re.search(r'hash="([a-f0-9]+)"', key)
            if m:
                tip_hash = m.group(1)
            break

    # Disk utilization — check the filesystem where the node DB lives
    disk_pct = 0
    try:
        import shutil
        # Try multiple paths to find the right filesystem
        for check_path in [
            CFG.get("dbPath", ""),
            CFG.get("cardanoNodeSocket", ""),
            os.environ.get("CNODE_HOME", "/opt/cardano/cnode"),
            "/",
        ]:
            if check_path and os.path.exists(os.path.dirname(check_path) if not os.path.isdir(check_path) else check_path):
                usage = shutil.disk_usage(os.path.dirname(check_path) if not os.path.isdir(check_path) else check_path)
                if usage.total:
                    disk_pct = round((usage.used / usage.total) * 100, 1)
                    break
    except:
        pass

    # OP Cert counters (cardano-cli query kes-period-info output)
    op_cert_disk = (kes.get("qKesOnDiskOperationalCertificateNumber", None) or
                    kes.get("onDiskOperationalCertificateNumber", None))
    op_cert_chain = (kes.get("qKesNodeStateOperationalCertificateNumber", None) or
                     kes.get("nodeStateOperationalCertificateNumber", None))

    # KES expiry calculation
    kes_remaining = prom_kes_remaining if prom_kes_remaining is not None else kes.get("qKesRemainingSlotsInKesPeriod", None)
    kes_expiry = None
    if kes_remaining is not None and kes_remaining > 0:
        kes_expiry = int(time.time()) + (kes_remaining * 129600)  # 1 KES period = 36 hours = 129600 seconds

    return {
        "blockHeight": prom_block or tip.get("block", 0),
        "slotNo": prom_slot or tip.get("slot", 0),
        "epoch": prom_epoch or tip.get("epoch", 0),
        "epochSlot": tip.get("slotInEpoch", 0),
        "epochSlotsRemaining": tip.get("slotsToEpochEnd", 0),
        "syncProgress": float(tip.get("syncProgress", "0")),
        "kesRemaining": kes_remaining,
        "kesPeriod": prom_kes_current if prom_kes_current is not None else kes.get("qKesCurrentKesPeriod", None),
        "kesExpiry": kes_expiry,
        "peers": peers,
        "mempoolTxs": prom_mempool_txs or mempool["txs"],
        "mempoolBytes": prom_mempool_bytes or mempool["bytes"],
        "memoryMb": int(prom_mem_rss / 1048576) if prom_mem_rss else process["memoryMb"],
        "cpuPercent": process["cpuPercent"],
        "uptimeSeconds": int(prom_uptime / 1000000000) if prom_uptime else process["uptimeSeconds"],
        "nodeVersion": tip.get("era", "unknown"),
        "timestamp": int(time.time()),
        # gLiveView-style extended metrics
        "density": round(prom_density * 100, 2) if prom_density else 0,
        "txsProcessed": prom_txs_processed,
        "forks": prom_forks,
        "blocksServed": prom_served,
        "lateBlocks": prom_late,
        "lastBlockDelay": round(prom_last_delay, 3) if prom_last_delay else 0,
        "blockDelayPct": {
            "within1s": round(prom_within_1s * 100, 1) if prom_within_1s else 0,
            "within3s": round(prom_within_3s * 100, 1) if prom_within_3s else 0,
            "within5s": round(prom_within_5s * 100, 1) if prom_within_5s else 0,
        },
        "gcMinor": prom_gc_minor,
        "gcMajor": prom_gc_major,
        "gcLiveMb": int(prom_gc_live / 1048576) if prom_gc_live else 0,
        "heapMb": int(prom_gc_heap / 1048576) if prom_gc_heap else 0,
        # Connection details (gLiveView parity)
        "connections": {
            "biDir": conn_duplex,        # duplex = bidirectional in gLiveView
            "duplex": conn_full_duplex,
            "uniDir": conn_unidir,
            "outbound": conn_outbound,
            "inbound": conn_inbound,
            "inWarm": in_warm,
            "inHot": in_hot,
            "inCold": in_cold,
            "outWarm": out_warm,
            "outHot": out_hot,
            "outCold": out_cold,
        },
        "tipHash": tip_hash[:16] if tip_hash else "",
        "tipRef": tip.get("slot", 0),  # Tip ref = slot of tip (not block height)
        "diskPct": disk_pct,
        "opCert": {
            "disk": op_cert_disk,
            "chain": op_cert_chain,
        },
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


def handle_kes_rotate(cold_key_hex=None, gpg_passphrase=None):
    """Rotate KES keys using cardano-cli.

    Accepts either:
    - cold_key_hex: Raw cold key hex from wallet (decrypted via PassKey)
    - gpg_passphrase: GPG passphrase to decrypt cold.skey.gpg on disk

    Steps:
    1. Write cold key to temp file (from hex or GPG decrypt)
    2. Generate new KES keypair
    3. Increment op cert counter
    4. Sign new op cert with cold key
    5. Remove temp cold key
    6. Restart node
    """
    pool_dir = os.path.dirname(CFG["vrfSkeyPath"])
    cold_skey_gpg = os.path.join(pool_dir, "cold.skey.gpg")
    cold_skey = os.path.join(pool_dir, "cold.skey")
    cold_counter = os.path.join(pool_dir, "cold.counter")
    hot_skey = os.path.join(pool_dir, "hot.skey")
    hot_vkey = os.path.join(pool_dir, "hot.vkey")
    op_cert = os.path.join(pool_dir, "op.cert")
    kes_start_file = os.path.join(pool_dir, "kes.start")

    steps = []
    cold_key_written = False

    try:
        # Step 1: Get cold key
        if cold_key_hex:
            # Cold key sent from wallet (decrypted via PassKey)
            cold_skey_content = json.dumps({
                "type": "StakePoolSigningKey_ed25519",
                "description": "Stake Pool Signing Key",
                "cborHex": "5820" + cold_key_hex
            })
            with open(cold_skey, "w") as f:
                f.write(cold_skey_content)
            pool_stat = os.stat(pool_dir)
            os.chown(cold_skey, pool_stat.st_uid, pool_stat.st_gid)
            os.chmod(cold_skey, 0o400)
            cold_key_written = True
            steps.append("Cold key received from wallet")
        elif gpg_passphrase:
            # Decrypt from GPG on disk
            if not os.path.exists(cold_skey_gpg):
                return {"error": "No cold.skey.gpg found on node"}
            result = subprocess.run(
                ["gpg", "--batch", "--yes", "--passphrase-fd", "0", "--output", cold_skey, "--decrypt", cold_skey_gpg],
                input=gpg_passphrase, capture_output=True, text=True, timeout=30
            )
            if result.returncode != 0:
                return {"error": f"GPG decrypt failed: {result.stderr.strip()}"}
            cold_key_written = True
            steps.append("Cold key decrypted from GPG")
        elif os.path.exists(cold_skey):
            steps.append("Using existing cold.skey")
        else:
            return {"error": "No cold key available. Send cold key from wallet or provide GPG passphrase."}

        # Step 2: Get current KES period from node
        tip = get_tip()
        if not tip:
            return {"error": "Cannot query node tip"}

        # Read shelley genesis for slotsPerKESPeriod
        with open(CFG["genesisFile"]) as f:
            genesis = json.load(f)
        slots_per_kes = genesis.get("slotsPerKESPeriod", 129600)
        current_slot = tip.get("slot", 0)
        current_kes_period = current_slot // slots_per_kes
        steps.append(f"Current KES period: {current_kes_period}")

        # Remove immutable flags and make pool files writable for rotation
        pool_files = [hot_skey, hot_vkey, op_cert, cold_counter, kes_start_file]
        existing_files = [f for f in pool_files if os.path.exists(f)]
        if existing_files:
            subprocess.run(["chattr", "-i"] + existing_files, capture_output=True, timeout=10)
            for f in existing_files:
                os.chmod(f, 0o600)

        # Step 3: Generate new KES keypair
        result = run_cmd(
            f'{CFG["cardanoCliPath"]} latest node key-gen-KES '
            f'--signing-key-file {hot_skey} '
            f'--verification-key-file {hot_vkey}'
        )
        steps.append("New KES keypair generated")

        # Step 4: Issue new operational certificate
        result = run_cmd(
            f'{CFG["cardanoCliPath"]} latest node issue-op-cert '
            f'--kes-verification-key-file {hot_vkey} '
            f'--cold-signing-key-file {cold_skey} '
            f'--operational-certificate-issue-counter-file {cold_counter} '
            f'--kes-period {current_kes_period} '
            f'--out-file {op_cert}'
        )
        steps.append(f"New op cert issued (KES period {current_kes_period})")

        # Save KES start period
        with open(kes_start_file, "w") as f:
            f.write(str(current_kes_period))

        # Restore ownership and read-only permissions
        # Get original owner from pool directory
        pool_stat = os.stat(pool_dir)
        for f in pool_files:
            if os.path.exists(f):
                os.chown(f, pool_stat.st_uid, pool_stat.st_gid)
                os.chmod(f, 0o400)

        # Step 5: Re-encrypt and remove decrypted cold key
        if cold_key_written and os.path.exists(cold_skey):
            os.remove(cold_skey)
            steps.append("Cold key removed from disk")

        # Step 6: Restart node
        restart_result = subprocess.run(
            ["systemctl", "restart", "cnode"],
            capture_output=True, text=True, timeout=30
        )
        if restart_result.returncode == 0:
            steps.append("Node restarted")
        else:
            steps.append(f"Node restart failed: {restart_result.stderr.strip()}")

        return {
            "success": True,
            "kesPeriod": current_kes_period,
            "steps": steps,
            "message": f"KES rotated successfully. New KES period: {current_kes_period}"
        }

    except Exception as e:
        # Clean up decrypted cold key on error
        if cold_key_written and os.path.exists(cold_skey):
            os.remove(cold_skey)
        return {"error": str(e), "steps": steps}


def handle_peers():
    """Get P2P peer information from cardano-node.

    Tries multiple sources in order of detail:
    1. cardano-cli query peer-snapshot (live peers with state)
    2. Topology file (configured peers)
    3. Prometheus metrics (peer counts)
    """
    result = {
        "mode": "unknown",
        "hotPeers": 0,
        "warmPeers": 0,
        "coldPeers": 0,
        "peers": [],
    }

    # Relay addresses from config — IPs/hostnames of your own relay nodes
    relay_addrs = set(CFG.get("relayAddresses", []))

    # Auto-detect topology file if not configured
    topo_path = CFG.get("topologyPath", "")
    if not topo_path or not os.path.exists(topo_path):
        # Try common locations
        cnode_home = os.environ.get("CNODE_HOME", "/opt/cardano/cnode")
        candidates = [
            f"{cnode_home}/files/topology.json",
            f"{cnode_home}/topology.json",
            os.path.join(os.path.dirname(CFG.get("cardanoNodeSocket", "")), "..", "files", "topology.json"),
        ]
        for c in candidates:
            c = os.path.normpath(c)
            if os.path.exists(c):
                topo_path = c
                break

    # Parse topology file
    if topo_path and os.path.exists(topo_path):
        try:
            with open(topo_path) as f:
                topo = json.load(f)

            if "localRoots" in topo or "LocalRoots" in topo:
                result["mode"] = "p2p"
                local_roots = topo.get("localRoots", topo.get("LocalRoots", []))
                public_roots = topo.get("publicRoots", topo.get("PublicRoots", []))

                for group in local_roots:
                    access_points = group.get("accessPoints", [])
                    trustable = group.get("trustable", group.get("advertise", False))
                    for ap in access_points:
                        result["peers"].append({
                            "address": ap.get("address", ""),
                            "port": ap.get("port", 3001),
                            "source": "localRoots",
                            "trustable": trustable,
                            "direction": "out",
                            "state": "configured",
                        })

                for group in public_roots:
                    access_points = group.get("accessPoints", [])
                    if isinstance(access_points, list):
                        for ap in access_points:
                            if isinstance(ap, dict):
                                result["peers"].append({
                                    "address": ap.get("address", ""),
                                    "port": ap.get("port", 3001),
                                    "source": "publicRoots",
                                    "direction": "out",
                                    "state": "configured",
                                })

            elif "Producers" in topo or "producers" in topo:
                result["mode"] = "legacy"
                producers = topo.get("Producers", topo.get("producers", []))
                for p in producers:
                    result["peers"].append({
                        "address": p.get("addr", p.get("address", "")),
                        "port": p.get("port", 3001),
                        "source": "topology",
                        "direction": "out",
                        "state": "configured",
                    })
        except Exception as e:
            result["topoError"] = str(e)

    # Get peer counts from Prometheus
    prom = get_prometheus_metrics()
    total = parse_prom(prom, "cardano_node_metrics_peersFromNodeKernel_int", 0)
    result["totalConnected"] = total

    # Search for peer selection metrics dynamically (metric names vary by node version)
    hot = 0
    warm = 0
    cold = 0
    for key, val in prom.items():
        kl = key.lower()
        if "peerselection" in kl or "peer_selection" in kl:
            try:
                v = int(float(val))
            except:
                continue
            if "hot" in kl:
                hot = max(hot, v)
            elif "warm" in kl:
                warm = max(warm, v)
            elif "cold" in kl:
                cold = max(cold, v)

    result["hotPeers"] = hot
    result["warmPeers"] = warm
    result["coldPeers"] = cold

    # If we got hot/warm/cold but mode was unknown, it's p2p
    if result["mode"] == "unknown" and (hot or warm or cold):
        result["mode"] = "p2p"

    # If mode still unknown but we have connected peers, assume p2p for modern nodes
    if result["mode"] == "unknown" and total > 0:
        result["mode"] = "p2p"

    # === Live peer discovery (same technique as gLiveView) ===
    import re

    node_port = CFG.get("nodePort", 0)
    node_pid = 0

    # Find cardano-node PID
    raw = run_cmd("pgrep -fo 'cardano-node.*run' 2>/dev/null", timeout=5)
    if raw:
        try:
            node_pid = int(raw.strip().split("\n")[0])
        except:
            pass
    if not node_pid:
        raw = run_cmd("pgrep -o cardano-node 2>/dev/null", timeout=5)
        if raw:
            try:
                node_pid = int(raw.strip().split("\n")[0])
            except:
                pass

    # Find listening port from process (gLiveView reads from env/config, we auto-detect)
    if node_pid and not node_port:
        # Check /proc/net/tcp for listening sockets owned by this PID
        raw = run_cmd(f"ss -tlnp 2>/dev/null | grep 'pid={node_pid},'", timeout=5)
        if raw:
            m = re.search(r':(\d+)\s', raw)
            if m:
                node_port = int(m.group(1))

    result["nodePort"] = node_port
    result["nodePid"] = node_pid

    def parse_ss_addr(s):
        """Parse address:port from ss output, handling IPv4 and IPv6."""
        if s.startswith("["):
            bracket = s.rfind("]")
            return s[1:bracket], int(s[bracket+2:])
        last_colon = s.rfind(":")
        return s[:last_colon], int(s[last_colon+1:])

    if node_pid:
        try:
            # gLiveView technique: ss -tnp state established, grep by PID
            raw_ss = run_cmd("ss -tnp state established 2>/dev/null | grep '%s,'" % node_pid, timeout=5)

            if raw_ss:
                # Resolve topology hostnames to IPs for matching
                import socket as sock_mod
                topo_addrs = set()
                topo_pairs = set()
                for p in result["peers"]:
                    addr = p["address"]
                    port = p["port"]
                    topo_addrs.add(addr)
                    topo_pairs.add((addr, port))
                    # Resolve DNS names to IPs
                    if not addr.replace(".", "").isdigit():
                        try:
                            resolved = sock_mod.getaddrinfo(addr, port, sock_mod.AF_UNSPEC, sock_mod.SOCK_STREAM)
                            for _, _, _, _, sockaddr in resolved:
                                topo_addrs.add(sockaddr[0])
                                topo_pairs.add((sockaddr[0], port))
                        except:
                            pass
                live_peers = []
                seen_ips = {}  # track IP for bidirectional detection

                for line in raw_ss.strip().split("\n"):
                    line = line.strip()
                    if not line:
                        continue

                    parts = line.split()
                    # ss output: Recv-Q Send-Q Local:Port Peer:Port Process
                    if len(parts) < 4:
                        continue

                    local = parts[2]  # 0=Recv-Q 1=Send-Q 2=Local 3=Peer 4=Process
                    remote = parts[3]

                    try:
                        local_addr, local_port = parse_ss_addr(local)
                        remote_addr, remote_port = parse_ss_addr(remote)
                    except:
                        continue

                    # Determine peer address
                    if node_port and local_port == node_port:
                        peer_addr, peer_port = remote_addr, remote_port
                    else:
                        peer_addr, peer_port = remote_addr, remote_port

                    # Direction logic:
                    # - If remote IP is in our topology (localRoots/publicRoots), we initiated → out
                    # - If local port = node port AND remote not in topology → they connected to us → in
                    # - Both directions for same IP → bidirectional
                    is_configured = (peer_addr in topo_addrs or
                                    (peer_addr, peer_port) in topo_pairs)

                    if local_port == node_port and not is_configured:
                        direction = "in"
                    elif is_configured:
                        direction = "out"
                    elif local_port != node_port:
                        direction = "out"
                    else:
                        direction = "in"

                    # Track for bidirectional detection
                    if peer_addr in seen_ips:
                        prev = seen_ips[peer_addr]
                        if prev["direction"] != direction:
                            prev["direction"] = "bi"
                        continue
                    else:
                        # Trustable in topology = our own relay (most reliable signal)
                        trustable_addrs = set()
                        for p in result["peers"]:
                            if p.get("trustable"):
                                trustable_addrs.add(p["address"])
                        is_trustable = peer_addr in trustable_addrs
                        # Relay = explicitly configured in relayAddresses OR trustable topology peer
                        is_relay = is_trustable or peer_addr in relay_addrs

                        peer_entry = {
                            "address": peer_addr,
                            "port": peer_port,
                            "source": "live",
                            "direction": direction,
                            "state": "connected",
                            "configured": is_configured,
                            "relay": is_relay or is_trustable,
                            "trustable": is_trustable,
                        }
                        seen_ips[peer_addr] = peer_entry
                        live_peers.append(peer_entry)

                # Get RTT for each peer using ss -ni (gLiveView technique)
                for peer in live_peers:
                    addr = peer["address"]
                    port = peer["port"]
                    rtt_raw = run_cmd(
                        'ss -ni "dst %s:%s" 2>/dev/null | tail -1' % (addr, port),
                        timeout=2
                    )
                    if rtt_raw:
                        rtt_match = re.search(r'rtt:(\d+\.?\d*)', rtt_raw)
                        if rtt_match:
                            peer["rtt"] = round(float(rtt_match.group(1)) / 1000, 3)  # ms → seconds

                if live_peers:
                    result["peers"] = live_peers
                    result["inbound"] = sum(1 for p in live_peers if p["direction"] == "in")
                    result["outbound"] = sum(1 for p in live_peers if p["direction"] == "out")
                    result["bidirectional"] = sum(1 for p in live_peers if p["direction"] == "bi")
        except Exception as e:
            result["debug"] = f"ss parse error: {str(e)}"
    else:
        result["debug"] = "Could not find cardano-node PID. Add nodePort to config."

    return result


def handle_versions():
    """Get versions of all tools and check for updates."""
    versions = {
        "geroNodeMonitor": VERSION,
        "cardanoNode": "",
        "cardanoCli": "",
        "cncli": "",
        "cloudflared": "",
    }

    # cardano-node version
    raw = run_cmd(f'{CFG.get("cardanoCliPath", "cardano-cli")} --version', timeout=5)
    if raw:
        # "cardano-cli 10.5.2 - linux-x86_64 - ghc-9.6" → "10.5.2"
        parts = raw.split()
        if len(parts) >= 2:
            versions["cardanoNode"] = parts[1]

    # cardano-cli version (same binary usually)
    versions["cardanoCli"] = versions["cardanoNode"]

    # cncli version
    raw = run_cmd(f'{CFG.get("cncliPath", "cncli")} --version', timeout=5)
    if raw:
        # "cncli v6.6.1 <hash> (target)" → "6.6.1"
        parts = raw.split()
        if len(parts) >= 2:
            versions["cncli"] = parts[1].lstrip("v")

    # cloudflared version
    raw = run_cmd("cloudflared --version", timeout=5)
    if raw:
        # "cloudflared version 2026.3.0 (checksum)" → "2026.3.0"
        parts = raw.split()
        for i, p in enumerate(parts):
            if p == "version" and i + 1 < len(parts):
                versions["cloudflared"] = parts[i + 1]
                break

    # Check latest versions from GitHub (best effort)
    latest = {}
    try:
        import urllib.request
        # cardano-node latest
        req = urllib.request.Request("https://api.github.com/repos/IntersectMBO/cardano-node/releases/latest", headers={"User-Agent": "gero-node-monitor"})
        data = json.loads(urllib.request.urlopen(req, timeout=5).read().decode())
        latest["cardanoNode"] = data.get("tag_name", "").lstrip("v")
    except:
        pass
    try:
        # cncli latest
        req = urllib.request.Request("https://api.github.com/repos/cardano-community/cncli/releases/latest", headers={"User-Agent": "gero-node-monitor"})
        data = json.loads(urllib.request.urlopen(req, timeout=5).read().decode())
        latest["cncli"] = data.get("tag_name", "").lstrip("v")
    except:
        pass

    # Semantic version comparison
    def parse_ver(v):
        try:
            return tuple(int(x) for x in v.split("."))
        except:
            return (0,)

    # Determine which need updates (only if latest is actually newer)
    updates = {}
    for key in ["cardanoNode", "cncli"]:
        cur = versions.get(key, "")
        lat = latest.get(key, "")
        if cur and lat and parse_ver(lat) > parse_ver(cur):
            updates[key] = {"current": cur, "latest": lat}

    return {
        "versions": versions,
        "latest": latest,
        "updates": updates,
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress default logging

    def send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.end_headers()

    def read_body(self):
        length = int(self.headers.get('Content-Length', 0))
        if length:
            return json.loads(self.rfile.read(length).decode())
        return {}

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # Auth check
        token = CFG.get("authToken", "")
        if token:
            auth = self.headers.get("Authorization", "")
            if auth != f"Bearer {token}":
                self.send_json({"error": "Unauthorized"}, 401)
                return

        try:
            if path == "/kes-rotate":
                body = self.read_body()
                self.send_json(handle_kes_rotate(
                    cold_key_hex=body.get("coldKeyHex"),
                    gpg_passphrase=body.get("gpgPassphrase"),
                ))
            else:
                self.send_json({"error": "Not found"}, 404)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

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

            elif path == "/peers":
                self.send_json(handle_peers())

            elif path == "/prom-debug":
                prom = get_prometheus_metrics()
                # Return all metric names grouped by keyword
                keywords = ["peer", "connection", "block", "fork", "tx", "density",
                           "delay", "propagat", "served", "late", "governor",
                           "duplex", "bidirectional", "warm", "hot", "cold", "disk"]
                filtered = {}
                for key, val in prom.items():
                    for kw in keywords:
                        if kw in key.lower():
                            filtered[key] = val
                            break
                self.send_json({"totalMetrics": len(prom), "filtered": filtered})

            elif path == "/versions":
                self.send_json(handle_versions())

            else:
                self.send_json({"error": "Not found"}, 404)

        except Exception as e:
            self.send_json({"error": str(e)}, 500)


def start_cloudflare_tunnel(port):
    """Start a Cloudflare quick tunnel and return the public URL."""
    import threading
    import re

    tunnel_url = None
    tunnel_ready = threading.Event()

    def run_tunnel():
        nonlocal tunnel_url
        try:
            proc = subprocess.Popen(
                ["cloudflared", "tunnel", "--url", f"http://localhost:{port}"],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
            )
            for line in proc.stdout:
                # cloudflared prints the URL in the output
                match = re.search(r'(https://[a-z0-9-]+\.trycloudflare\.com)', line)
                if match:
                    tunnel_url = match.group(1)
                    tunnel_ready.set()
            proc.wait()
        except FileNotFoundError:
            # Auto-install cloudflared
            print(f"\033[0;36m[gero-monitor]\033[0m cloudflared not found — installing...")
            try:
                install_result = subprocess.run(
                    "curl -sSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared",
                    shell=True, capture_output=True, text=True, timeout=60
                )
                if install_result.returncode == 0:
                    print(f"\033[0;32m[gero-monitor]\033[0m cloudflared installed successfully")
                    # Retry tunnel
                    run_tunnel()
                    return
                else:
                    print(f"\033[0;31m[gero-monitor]\033[0m Failed to install cloudflared: {install_result.stderr.strip()}")
            except Exception as ie:
                print(f"\033[0;31m[gero-monitor]\033[0m Failed to install cloudflared: {ie}")
            tunnel_ready.set()
        except Exception as e:
            print(f"\033[0;31m[gero-monitor]\033[0m Tunnel error: {e}")
            tunnel_ready.set()

    t = threading.Thread(target=run_tunnel, daemon=True)
    t.start()
    tunnel_ready.wait(timeout=30)
    return tunnel_url


def register_tunnel_url(pool_id, tunnel_url):
    """Register the tunnel URL with the Gero backend so the wallet can discover it."""
    try:
        import urllib.request
        data = json.dumps({"poolId": pool_id, "tunnelUrl": tunnel_url}).encode()
        req = urllib.request.Request(
            "https://api.gerowallet.io/api/spo/register-monitor",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=10)
        print(f"\033[0;32m[gero-monitor]\033[0m Registered with Gero backend")
    except Exception:
        pass  # Non-fatal — auto-discovery not available yet


def main():
    host = CFG.get("host", "127.0.0.1")  # Default to localhost (tunnel handles external access)
    port = CFG.get("port", 12799)

    print(f"\033[0;36m[gero-monitor]\033[0m Gero Node Monitor v{VERSION}")
    print(f"\033[0;36m[gero-monitor]\033[0m Pool ID: {CFG['poolId']}")
    print(f"\033[0;36m[gero-monitor]\033[0m Node socket: {CFG['cardanoNodeSocket']}")

    # Start Cloudflare tunnel automatically
    tunnel_url = None
    if CFG.get("tunnel", True):
        print(f"\033[0;36m[gero-monitor]\033[0m Starting Cloudflare tunnel...")
        tunnel_url = start_cloudflare_tunnel(port)
        if tunnel_url:
            msg = "Enter this URL in Gero Wallet → Pool Operator → Node Monitor"
            w = max(len(tunnel_url), len(msg)) + 4
            print(f"\033[0;32m[gero-monitor]\033[0m ╔{'═' * w}╗")
            print(f"\033[0;32m[gero-monitor]\033[0m ║  {tunnel_url:<{w-2}}║")
            print(f"\033[0;32m[gero-monitor]\033[0m ║  {msg:<{w-2}}║")
            print(f"\033[0;32m[gero-monitor]\033[0m ╚{'═' * w}╝")

            # Register with backend for auto-discovery
            register_tunnel_url(CFG["poolId"], tunnel_url)

            # Save tunnel URL to file for reference
            with open(os.path.join(CONFIG_DIR, "tunnel_url.txt"), "w") as f:
                f.write(tunnel_url)
        else:
            print(f"\033[1;33m[gero-monitor]\033[0m Tunnel not available — local access only on {host}:{port}")
    else:
        print(f"\033[0;36m[gero-monitor]\033[0m Tunnel disabled (set tunnel: true in config to enable)")

    print(f"\033[0;36m[gero-monitor]\033[0m Listening on {host}:{port}")

    server = HTTPServer((host, port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print(f"\n\033[0;36m[gero-monitor]\033[0m Shutting down...")
        server.shutdown()


def create_config():
    """Auto-detect paths and create initial config."""
    os.makedirs(CONFIG_DIR, exist_ok=True)
    os.makedirs(CACHE_DIR, exist_ok=True)

    # Auto-detect paths
    cnode_home = os.environ.get("CNODE_HOME", "/opt/cardano/cnode")
    node_socket = os.environ.get("CARDANO_NODE_SOCKET_PATH", f"{cnode_home}/sockets/node.socket")

    def find_bin(name):
        import shutil
        found = shutil.which(name)
        if found: return found
        for p in [f"/usr/local/bin/{name}", f"{os.path.expanduser('~')}/.local/bin/{name}", f"{os.path.expanduser('~')}/.cargo/bin/{name}"]:
            if os.path.exists(p): return p
        return name

    # Find pool directory (check for subdirectories)
    pool_dir = f"{cnode_home}/priv/pool"
    vrf_skey = ""
    pool_id = ""
    for entry in os.listdir(pool_dir) if os.path.isdir(pool_dir) else []:
        sub = os.path.join(pool_dir, entry)
        if os.path.isdir(sub) and os.path.exists(os.path.join(sub, "vrf.skey")):
            vrf_skey = os.path.join(sub, "vrf.skey")
            pool_id_file = os.path.join(sub, "pool.id-bech32")
            if os.path.exists(pool_id_file):
                pool_id = open(pool_id_file).read().strip()
            break
    if not vrf_skey and os.path.exists(f"{pool_dir}/vrf.skey"):
        vrf_skey = f"{pool_dir}/vrf.skey"
        pool_id_file = f"{pool_dir}/pool.id-bech32"
        if os.path.exists(pool_id_file):
            pool_id = open(pool_id_file).read().strip()

    config = {
        "port": 12799,
        "host": "0.0.0.0",
        "cardanoNodeSocket": node_socket,
        "cardanoCliPath": find_bin("cardano-cli"),
        "cncliPath": find_bin("cncli"),
        "vrfSkeyPath": vrf_skey,
        "poolId": pool_id,
        "genesisFile": f"{cnode_home}/files/shelley-genesis.json",
        "byronGenesisFile": f"{cnode_home}/files/byron-genesis.json",
        "network": "mainnet",
        "dbPath": f"{cnode_home}/guild-db/cncli/cncli.db",
        "topologyPath": f"{cnode_home}/files/topology.json",
        "prometheusPort": 12798,
        "allowedOrigins": ["*"],
        "authToken": "",
    }

    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2)

    print(f"\033[0;32m[gero-monitor]\033[0m Config created: {CONFIG_FILE}")
    print(f"\033[0;36m[gero-monitor]\033[0m Pool ID: {pool_id or 'NOT FOUND — edit config manually'}")
    print(f"\033[0;36m[gero-monitor]\033[0m VRF skey: {vrf_skey or 'NOT FOUND — edit config manually'}")
    print(f"\033[0;36m[gero-monitor]\033[0m Node socket: {node_socket}")
    print(f"\033[0;36m[gero-monitor]\033[0m Edit config if needed, then run: python3 {sys.argv[0]}")


if __name__ == "__main__":
    if "--config" in sys.argv:
        create_config()
    else:
        if not CFG:
            print(f"\033[0;31m[gero-monitor]\033[0m No config found. Run: python3 {sys.argv[0]} --config")
            sys.exit(1)
        main()
