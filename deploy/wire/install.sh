#!/usr/bin/env bash
set -euo pipefail
REPO="${NARCOSCOPE_REPO:-/opt/narcoscope}"
ENABLE_TIMER="${NARCOSCOPE_WIRE_ENABLE_TIMER:-1}"

[[ "$ENABLE_TIMER" = "0" || "$ENABLE_TIMER" = "1" ]] || { echo "ERROR: NARCOSCOPE_WIRE_ENABLE_TIMER must be 0 or 1"; exit 1; }
command -v node >/dev/null || { echo "ERROR: node is not installed"; exit 1; }
command -v gzip >/dev/null || { echo "ERROR: gzip is not installed"; exit 1; }
command -v sha256sum >/dev/null || { echo "ERROR: sha256sum is not installed"; exit 1; }
[[ -f "$REPO/scripts/wire/collect.mjs" ]] || { echo "ERROR: NarcoScope live-wire collector is missing"; exit 1; }

install -m 0644 "$REPO/deploy/wire/narcoscope-wire.service" /etc/systemd/system/
install -m 0644 "$REPO/deploy/wire/narcoscope-wire.timer" /etc/systemd/system/
systemctl daemon-reload
if [[ "$ENABLE_TIMER" = "1" ]]; then
  systemctl enable --now narcoscope-wire.timer
  systemctl list-timers narcoscope-wire.timer --no-pager | head -2
else
  systemctl disable --now narcoscope-wire.timer >/dev/null 2>&1 || true
  echo "Installed with timer disabled for a controlled first run."
fi
