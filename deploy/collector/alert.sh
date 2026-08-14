#!/usr/bin/env bash
# Records every collector failure locally and optionally posts the same bounded
# receipt to a configured HTTPS webhook. The webhook URL is read from a root-only
# systemd environment file and is never printed.
set -euo pipefail

STATE_DIR="${NARCOSCOPE_STATE_DIR:-/var/lib/narcoscope-collector}"
WEBHOOK_URL="${NARCOSCOPE_ALERT_WEBHOOK_URL:-}"
MARKER="$STATE_DIR/last-failure.json"

log_error() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
  if command -v logger >/dev/null 2>&1; then
    logger -p daemon.err -t narcoscope-collector -- "$*" || true
  fi
}

[[ "$STATE_DIR" = /* && "$STATE_DIR" != "/" ]] || {
  log_error "refusing unsafe collector alert state directory"
  exit 1
}
mkdir -p -- "$STATE_DIR"
TEMP_MARKER="$(mktemp "${STATE_DIR%/}/last-failure.json.XXXXXX")"
cleanup() { rm -f -- "$TEMP_MARKER"; }
trap cleanup EXIT

FAILED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
printf '{"schemaVersion":"narcoscope.collector.failure.v1","service":"narcoscope-collector.service","failedAt":"%s","text":"NarcoScope collector failed at %s. Check the systemd journal."}\n' \
  "$FAILED_AT" "$FAILED_AT" > "$TEMP_MARKER"
chmod 0600 "$TEMP_MARKER"
mv -f -- "$TEMP_MARKER" "$MARKER"
trap - EXIT

log_error "collector failure recorded at $MARKER"

if [[ -z "$WEBHOOK_URL" ]]; then
  log_error "no NARCOSCOPE_ALERT_WEBHOOK_URL is configured; local failure receipt only"
  exit 0
fi

if [[ "$WEBHOOK_URL" != https://* ]]; then
  log_error "refusing collector alert webhook because it is not HTTPS"
  exit 2
fi

if ! command -v curl >/dev/null 2>&1; then
  log_error "cannot deliver collector alert because curl is unavailable"
  exit 3
fi

if ! curl --fail --silent \
  --proto '=https' \
  --tlsv1.2 \
  --connect-timeout 5 \
  --max-time 15 \
  --retry 2 \
  --header 'Content-Type: application/json' \
  --data-binary "@$MARKER" \
  "$WEBHOOK_URL" >/dev/null; then
  log_error "collector alert webhook delivery failed"
  exit 4
fi

log_error "collector alert webhook delivered"
