#!/usr/bin/env bash
# ============================================================================
# Gero Node Monitor — Quick Install Script
# ============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║       Gero Node Monitor v1.0.0        ║"
echo "  ║   Cardano SPO Monitoring Agent        ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"

# Check prerequisites
echo "Checking prerequisites..."

for cmd in jq socat curl; do
  if ! command -v $cmd &>/dev/null; then
    echo -e "${RED}Missing: ${cmd}${NC}"
    echo "Install with: sudo apt install ${cmd}"
    exit 1
  fi
done

if ! command -v cardano-cli &>/dev/null; then
  echo -e "${RED}cardano-cli not found${NC}"
  exit 1
fi

echo -e "${GREEN}Prerequisites OK${NC}"

# Download
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="${HOME}/.gero-node-monitor"

echo "Installing to ${INSTALL_DIR}..."

SCRIPT_URL="https://raw.githubusercontent.com/Gero-Labs/gero-node-monitor/main/gero-node-monitor.sh"
SERVICE_URL="https://raw.githubusercontent.com/Gero-Labs/gero-node-monitor/main/gero-node-monitor.service"

sudo curl -sSL "$SCRIPT_URL" -o "${INSTALL_DIR}/gero-node-monitor.sh"
sudo chmod +x "${INSTALL_DIR}/gero-node-monitor.sh"

echo -e "${GREEN}Installed gero-node-monitor.sh${NC}"

# Create config
echo ""
echo "Creating configuration..."
"${INSTALL_DIR}/gero-node-monitor.sh" --config

# Install systemd service
echo ""
read -p "Install as systemd service? (y/N) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
  sudo curl -sSL "$SERVICE_URL" -o /etc/systemd/system/gero-node-monitor.service

  # Update service file with current user
  sudo sed -i "s/User=cardano/User=$(whoami)/" /etc/systemd/system/gero-node-monitor.service
  sudo sed -i "s/Group=cardano/Group=$(id -gn)/" /etc/systemd/system/gero-node-monitor.service

  sudo systemctl daemon-reload
  sudo systemctl enable gero-node-monitor

  echo -e "${GREEN}Systemd service installed${NC}"
  echo ""
  echo "Start with:  sudo systemctl start gero-node-monitor"
  echo "Logs:        journalctl -u gero-node-monitor -f"
else
  echo ""
  echo "Start manually:  gero-node-monitor.sh --start"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "Edit config:  ${GREEN}${CONFIG_DIR}/config.json${NC}"
echo -e "Default port: ${GREEN}12798${NC}"
echo ""
echo "In Gero Wallet → Pool Operator → Node Monitor:"
echo -e "  Enter URL:  ${GREEN}http://your-node-ip:12798${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
