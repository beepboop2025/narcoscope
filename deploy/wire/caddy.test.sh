#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNIPPET="$SCRIPT_DIR/Caddyfile.heartbeat"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/narcoscope-caddy-heartbeat.XXXXXX")"
CADDY_PID=""

cleanup() {
  if [[ -n "$CADDY_PID" ]] && kill -0 "$CADDY_PID" 2>/dev/null; then
    kill "$CADDY_PID" 2>/dev/null || true
    wait "$CADDY_PID" 2>/dev/null || true
  fi
  find "$TEST_ROOT" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT

command -v caddy >/dev/null || {
  echo "ERROR: caddy is required for the heartbeat route integration test" >&2
  exit 1
}
command -v curl >/dev/null || {
  echo "ERROR: curl is required for the heartbeat route integration test" >&2
  exit 1
}

PUBLIC_ROOT="$TEST_ROOT/public"
HEARTBEAT_DIR="$PUBLIC_ROOT/narcoscope"
CONFIG="$TEST_ROOT/Caddyfile"
LOG="$TEST_ROOT/caddy.log"
VALIDATE_LOG="$TEST_ROOT/caddy-validate.log"
PORT="${NARCOSCOPE_CADDY_TEST_PORT:-$((20000 + RANDOM % 30000))}"
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( PORT < 1024 || PORT > 65535 )); then
  echo "ERROR: NARCOSCOPE_CADDY_TEST_PORT must be an unprivileged TCP port" >&2
  exit 1
fi
BASE_URL="http://127.0.0.1:$PORT"
mkdir -p "$HEARTBEAT_DIR"
printf '%s\n' \
  '{"schema":"narcoscope.wire-heartbeat.v1","status":"ok","recordedAt":"2026-08-31T14:00:00Z","itemCount":7}' \
  > "$HEARTBEAT_DIR/wire-heartbeat-v1.json"

{
  printf '%s\n' '{'
  printf '%s\n' '  admin off'
  printf '%s\n' '  auto_https off'
  printf '%s\n' '}'
  printf 'http://127.0.0.1:%s {\n' "$PORT"
  printf '  import "%s"\n' "$SNIPPET"
  printf '%s\n' '  handle {'
  printf '%s\n' '    header X-Narcoscope-Test-Catch-All "true"'
  printf '%s\n' '    respond "existing catch-all" 418'
  printf '%s\n' '  }'
  printf '%s\n' '}'
} > "$CONFIG"

if ! NARCOSCOPE_WIRE_PUBLIC_DIR="$PUBLIC_ROOT" \
  caddy validate --config "$CONFIG" --adapter caddyfile \
    >"$VALIDATE_LOG" 2>&1; then
  echo "ERROR: caddy rejected the heartbeat integration configuration" >&2
  sed -n '1,160p' "$VALIDATE_LOG" >&2
  exit 1
fi
NARCOSCOPE_WIRE_PUBLIC_DIR="$PUBLIC_ROOT" \
  caddy run --config "$CONFIG" --adapter caddyfile >"$LOG" 2>&1 &
CADDY_PID=$!

ready=0
for _ in {1..50}; do
  if ! kill -0 "$CADDY_PID" 2>/dev/null; then
    echo "ERROR: caddy exited before the integration test became ready" >&2
    sed -n '1,160p' "$LOG" >&2
    exit 1
  fi
  if [[ "$(curl --silent --max-time 1 --output /dev/null --write-out '%{http_code}' \
    "$BASE_URL/readiness-probe" || true)" == "418" ]]; then
    ready=1
    break
  fi
  sleep 0.1
done
if [[ "$ready" != "1" ]]; then
  echo "ERROR: caddy did not become ready" >&2
  sed -n '1,160p' "$LOG" >&2
  exit 1
fi

assert_status() {
  local expected="$1"
  local method="$2"
  local path="$3"
  local output="$4"
  local headers="$5"
  local actual
  local -a curl_method

  if [[ "$method" == "HEAD" ]]; then
    curl_method=(--head)
  else
    curl_method=(--request "$method")
  fi
  actual="$(curl --silent --show-error --max-time 5 "${curl_method[@]}" \
    --dump-header "$headers" --output "$output" --write-out '%{http_code}' \
    "$BASE_URL$path")"
  if [[ "$actual" != "$expected" ]]; then
    echo "ERROR: $method $path returned $actual, expected $expected" >&2
    sed -n '1,160p' "$headers" >&2
    sed -n '1,160p' "$output" >&2
    exit 1
  fi
}

assert_header() {
  local headers="$1"
  local expected="$2"
  if ! tr -d '\r' < "$headers" | grep -Fxiq -- "$expected"; then
    echo "ERROR: response is missing header: $expected" >&2
    sed -n '1,160p' "$headers" >&2
    exit 1
  fi
}

GET_BODY="$TEST_ROOT/get.body"
GET_HEADERS="$TEST_ROOT/get.headers"
assert_status 200 GET /narcoscope/wire-heartbeat-v1.json "$GET_BODY" "$GET_HEADERS"
assert_header "$GET_HEADERS" 'Cache-Control: no-store'
assert_header "$GET_HEADERS" 'Content-Type: application/json'
node - "$GET_BODY" <<'JS'
const { readFileSync } = require('node:fs')
const heartbeat = JSON.parse(readFileSync(process.argv[2], 'utf8'))
if (heartbeat.schema !== 'narcoscope.wire-heartbeat.v1' || heartbeat.status !== 'ok') process.exit(1)
JS

HEAD_HEADERS="$TEST_ROOT/head.headers"
assert_status 200 HEAD /narcoscope/wire-heartbeat-v1.json /dev/null "$HEAD_HEADERS"
assert_header "$HEAD_HEADERS" 'Cache-Control: no-store'

POST_BODY="$TEST_ROOT/post.body"
POST_HEADERS="$TEST_ROOT/post.headers"
assert_status 405 POST /narcoscope/wire-heartbeat-v1.json "$POST_BODY" "$POST_HEADERS"
assert_header "$POST_HEADERS" 'Allow: GET, HEAD'
assert_header "$POST_HEADERS" 'Cache-Control: no-store'

CATCH_ALL_BODY="$TEST_ROOT/catch-all.body"
CATCH_ALL_HEADERS="$TEST_ROOT/catch-all.headers"
assert_status 418 GET /existing-api-route "$CATCH_ALL_BODY" "$CATCH_ALL_HEADERS"
assert_header "$CATCH_ALL_HEADERS" 'X-Narcoscope-Test-Catch-All: true'

ADJACENT_BODY="$TEST_ROOT/adjacent.body"
ADJACENT_HEADERS="$TEST_ROOT/adjacent.headers"
assert_status 418 GET /narcoscope/wire-heartbeat-v1.json/extra "$ADJACENT_BODY" "$ADJACENT_HEADERS"
assert_header "$ADJACENT_HEADERS" 'X-Narcoscope-Test-Catch-All: true'

echo "NarcoScope Caddy heartbeat route integration tests passed"
