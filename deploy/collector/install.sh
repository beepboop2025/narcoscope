#!/usr/bin/env bash
# =============================================================================
# Idempotent installer for the NarcoScope collector on the Hetzner box.
# Run as root ON the box: bash /opt/narcoscope/deploy/collector/install.sh
# Prereqs (one-time, see README): Node installed, repo cloned at /opt/narcoscope,
# a write-enabled deploy key at /root/.ssh/narcoscope_deploy.
# =============================================================================
set -euo pipefail
REPO=/opt/narcoscope
ENABLE_TIMER="${NARCOSCOPE_ENABLE_TIMER:-1}"

if [[ "$ENABLE_TIMER" != "0" && "$ENABLE_TIMER" != "1" ]]; then
  echo "ERROR: NARCOSCOPE_ENABLE_TIMER must be 0 or 1"
  exit 1
fi

command -v node >/dev/null || { echo "ERROR: node not installed — see deploy/collector/README.md"; exit 1; }
# unzip is needed by the StatCan wastewater converter; ensure it is present.
command -v unzip >/dev/null || { echo "· installing unzip"; apt-get install -y unzip >/dev/null; }
[ -d "$REPO/.git" ] || { echo "ERROR: repo not cloned at $REPO"; exit 1; }
[ -f /root/.ssh/narcoscope_deploy ] || { echo "ERROR: deploy key missing at /root/.ssh/narcoscope_deploy"; exit 1; }

install -m 0644 "$REPO/deploy/collector/narcoscope-collector.service" /etc/systemd/system/
install -m 0644 "$REPO/deploy/collector/narcoscope-collector.timer"   /etc/systemd/system/
install -m 0644 "$REPO/deploy/collector/narcoscope-collector-alert.service" /etc/systemd/system/
systemctl daemon-reload
if [[ "$ENABLE_TIMER" == "1" ]]; then
  systemctl enable --now narcoscope-collector.timer
  echo "✔ installed and enabled. Next run:"
  systemctl list-timers narcoscope-collector.timer --no-pager | head -2
elif [[ "$ENABLE_TIMER" == "0" ]]; then
  systemctl disable --now narcoscope-collector.timer >/dev/null 2>&1 || true
  echo "✔ installed with the timer disabled for a controlled recovery run."
fi
echo "Run once now:   systemctl start narcoscope-collector.service && journalctl -u narcoscope-collector -f"
