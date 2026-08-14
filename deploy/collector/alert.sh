#!/usr/bin/env bash
# Records every collector failure locally and optionally posts the same bounded
# receipt to a configured HTTPS webhook. The webhook URL is read from a root-only
# systemd environment file and is never printed.
set -euo pipefail
umask 077

STATE_DIR="${NARCOSCOPE_STATE_DIR:-/var/lib/narcoscope-collector}"
WEBHOOK_URL="${NARCOSCOPE_ALERT_WEBHOOK_URL:-}"
MARKER="$STATE_DIR/last-failure.json"
STATUS="$STATE_DIR/status.json"

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
chmod 0700 "$STATE_DIR"

atomic_failure_receipt() {
  local target="$1"
  local schema="$2"
  local body="$3"
  local temp_marker
  temp_marker="$(mktemp "${STATE_DIR%/}/.${target##*/}.XXXXXX")"
  printf '{"schemaVersion":"%s","service":"narcoscope-collector.service",%s}\n' \
    "$schema" "$body" > "$temp_marker"
  chmod 0600 "$temp_marker"
  mv -f -- "$temp_marker" "$target"
}

FAILED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
atomic_failure_receipt "$MARKER" "narcoscope.collector.failure.v1" \
  "\"failedAt\":\"$FAILED_AT\",\"text\":\"NarcoScope collector failed at $FAILED_AT. Check the systemd journal.\""
atomic_failure_receipt "$STATUS" "narcoscope.collector.status.v1" \
  "\"status\":\"failed\",\"recordedAt\":\"$FAILED_AT\",\"failedAt\":\"$FAILED_AT\""

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
