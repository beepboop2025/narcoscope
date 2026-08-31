#!/usr/bin/env bash
set -euo pipefail
REPO="${NARCOSCOPE_REPO:-/opt/narcoscope}"
ENABLE_TIMER="${NARCOSCOPE_WIRE_ENABLE_TIMER:-1}"
PUBLIC_DIR="${NARCOSCOPE_WIRE_PUBLIC_DIR:-/var/lib/narcoscope-wire-public}"
TIMER_UNIT="narcoscope-wire.timer"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

timer_value_is_finite() {
  local normalized
  normalized="$(printf '%s' "$1" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
  case "$normalized" in
    ""|-|0|0us|infinity|infinite|n/a|never) return 1 ;;
    *) return 0 ;;
  esac
}

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
  # `enable --now` does not restart an already-active timer after its unit file
  # changes. Re-start it explicitly so OnActiveSec is armed on every install.
  systemctl enable "$TIMER_UNIT"
  systemctl restart "$TIMER_UNIT"

  systemctl is-enabled --quiet "$TIMER_UNIT" \
    || die "$TIMER_UNIT was not enabled after installation"

  ACTIVE_STATE="$(systemctl show "$TIMER_UNIT" --property=ActiveState --value)"
  SUB_STATE="$(systemctl show "$TIMER_UNIT" --property=SubState --value)"
  NEXT_REALTIME="$(systemctl show "$TIMER_UNIT" --property=NextElapseUSecRealtime --value)"
  NEXT_MONOTONIC="$(systemctl show "$TIMER_UNIT" --property=NextElapseUSecMonotonic --value)"

  [[ "$ACTIVE_STATE" = "active" && "$SUB_STATE" = "waiting" ]] \
    || die "$TIMER_UNIT is not armed (active=$ACTIVE_STATE sub=$SUB_STATE)"
  if ! timer_value_is_finite "$NEXT_REALTIME" \
    && ! timer_value_is_finite "$NEXT_MONOTONIC"; then
    die "$TIMER_UNIT has no finite next trigger (realtime=$NEXT_REALTIME monotonic=$NEXT_MONOTONIC)"
  fi

  systemctl list-timers "$TIMER_UNIT" --no-pager --no-legend
else
  systemctl disable --now "$TIMER_UNIT" >/dev/null 2>&1 || true
  echo "Installed with timer disabled for a controlled first run."
fi
