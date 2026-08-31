#!/usr/bin/env bash
set -euo pipefail
REPO="${NARCOSCOPE_REPO:-/opt/narcoscope}"
ENABLE_TIMER="${NARCOSCOPE_WIRE_ENABLE_TIMER:-1}"
PUBLIC_DIR="${NARCOSCOPE_WIRE_PUBLIC_DIR:-/var/lib/narcoscope-wire-public}"

[[ "$ENABLE_TIMER" = "0" || "$ENABLE_TIMER" = "1" ]] || { echo "ERROR: NARCOSCOPE_WIRE_ENABLE_TIMER must be 0 or 1"; exit 1; }
[[ "$PUBLIC_DIR" = /* && "$PUBLIC_DIR" != "/" ]] || { echo "ERROR: unsafe public heartbeat directory"; exit 1; }
command -v node >/dev/null || { echo "ERROR: node is not installed"; exit 1; }
command -v gzip >/dev/null || { echo "ERROR: gzip is not installed"; exit 1; }
command -v sha256sum >/dev/null || { echo "ERROR: sha256sum is not installed"; exit 1; }
[[ -f "$REPO/scripts/wire/collect.mjs" ]] || { echo "ERROR: NarcoScope live-wire collector is missing"; exit 1; }

PUBLIC_DIR="$(node -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' "$PUBLIC_DIR")"
[[ "$PUBLIC_DIR" != "/" ]] || { echo "ERROR: unsafe public heartbeat directory"; exit 1; }
[[ ! -L "$PUBLIC_DIR" && ( ! -e "$PUBLIC_DIR" || -d "$PUBLIC_DIR" ) ]] || { echo "ERROR: public heartbeat root must be a regular directory"; exit 1; }
[[ ! -L "$PUBLIC_DIR/narcoscope" && ( ! -e "$PUBLIC_DIR/narcoscope" || -d "$PUBLIC_DIR/narcoscope" ) ]] || { echo "ERROR: public heartbeat path must be a regular directory"; exit 1; }
install -d -m 0755 -- "$PUBLIC_DIR/narcoscope"
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
