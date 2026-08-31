#!/usr/bin/env bash
set -euo pipefail

COLLECTOR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/collect.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/narcoscope-wire-heartbeat.XXXXXX")"
cleanup() {
  find "$TEST_ROOT" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT

REPO="$TEST_ROOT/repo"
STATE_DIR="$TEST_ROOT/state"
LOCK_DIR="$TEST_ROOT/run/lock"
PUBLIC_DIR="$TEST_ROOT/public"
RUN_ROOT="$TEST_ROOT/run-root"
mkdir -p "$REPO/scripts/wire" "$(dirname "$LOCK_DIR")" "$RUN_ROOT"

cat > "$REPO/scripts/wire/collect.mjs" <<'JS'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const outputIndex = process.argv.indexOf('--output')
const output = process.argv[outputIndex + 1]
if (process.env.WIRE_FIXTURE_FAIL === '1') process.exit(42)
if (process.argv.includes('--check')) {
  const payload = JSON.parse(readFileSync(output, 'utf8'))
  if (payload.schema !== 'narcoscope.evidence-wire.v1' || !Array.isArray(payload.items)) process.exit(2)
  process.exit(0)
}
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify({
  schema: 'narcoscope.evidence-wire.v1',
  generatedAt: '2026-08-31T10:00:00Z',
  status: 'partial',
  window: { start: null, end: null },
  items: [{ id: 'one' }, { id: 'two' }],
  sources: [],
  caveats: [],
})}\n`)
JS

run_collector() {
  env \
    NARCOSCOPE_REPO="$REPO" \
    NARCOSCOPE_WIRE_STATE_DIR="$STATE_DIR" \
    NARCOSCOPE_WIRE_LOCK_DIR="$LOCK_DIR" \
    NARCOSCOPE_WIRE_PUBLIC_DIR="$PUBLIC_DIR" \
    NARCOSCOPE_WIRE_RUN_ROOT="$RUN_ROOT" \
    NARCOSCOPE_WIRE_PUBLISH=0 \
    "$@" \
    bash "$COLLECTOR"
}

run_collector
HEARTBEAT="$PUBLIC_DIR/narcoscope/wire-heartbeat-v1.json"
node - "$HEARTBEAT" "$STATE_DIR/evidence-wire-v1.json" "$STATE_DIR" <<'JS'
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const [heartbeatPath, artifactPath, privateStatePath] = process.argv.slice(2)
const heartbeatRaw = readFileSync(heartbeatPath, 'utf8')
const heartbeat = JSON.parse(heartbeatRaw)
const artifactRaw = readFileSync(artifactPath)
const expectedKeys = ['artifactSha256', 'itemCount', 'recordedAt', 'schema', 'status']
if (JSON.stringify(Object.keys(heartbeat).sort()) !== JSON.stringify(expectedKeys)) process.exit(10)
if (heartbeat.schema !== 'narcoscope.wire-heartbeat.v1' || heartbeat.status !== 'ok' || heartbeat.itemCount !== 2) process.exit(11)
if (heartbeat.artifactSha256 !== createHash('sha256').update(artifactRaw).digest('hex')) process.exit(12)
if (heartbeatRaw.includes(privateStatePath) || heartbeatRaw.includes('latest') || heartbeatRaw.includes('phase') || heartbeatRaw.includes('exitCode')) process.exit(13)
JS

HEARTBEAT_BEFORE_LOCK="$(node -e 'const { createHash } = require("node:crypto"); const { readFileSync } = require("node:fs"); process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"))' "$HEARTBEAT")"
mkdir "$LOCK_DIR"
if run_collector; then
  echo "ERROR: the lock-contention fixture unexpectedly succeeded" >&2
  exit 14
fi
HEARTBEAT_AFTER_LOCK="$(node -e 'const { createHash } = require("node:crypto"); const { readFileSync } = require("node:fs"); process.stdout.write(createHash("sha256").update(readFileSync(process.argv[1])).digest("hex"))' "$HEARTBEAT")"
if [[ "$HEARTBEAT_BEFORE_LOCK" != "$HEARTBEAT_AFTER_LOCK" ]]; then
  echo "ERROR: lock contention overwrote the prior public heartbeat" >&2
  exit 15
fi
rmdir "$LOCK_DIR"

if run_collector WIRE_FIXTURE_FAIL=1; then
  echo "ERROR: the fixture failure unexpectedly succeeded" >&2
  exit 20
fi
node - "$HEARTBEAT" "$STATE_DIR/evidence-wire-v1.json" <<'JS'
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const heartbeat = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const artifactRaw = readFileSync(process.argv[3])
if (heartbeat.status !== 'failed' || heartbeat.itemCount !== 2) process.exit(21)
if (heartbeat.artifactSha256 !== createHash('sha256').update(artifactRaw).digest('hex')) process.exit(22)
JS

if find "$PUBLIC_DIR" -name '.wire-heartbeat-v1.json.*' -print -quit | grep -q .; then
  echo "ERROR: an atomic heartbeat staging file was left behind" >&2
  exit 23
fi

if env NARCOSCOPE_REPO="$REPO" NARCOSCOPE_WIRE_PUBLIC_DIR=/ bash "$COLLECTOR" >/dev/null 2>&1; then
  echo "ERROR: an unsafe public heartbeat root was accepted" >&2
  exit 24
fi

SYMLINK_PUBLIC="$TEST_ROOT/symlink-public"
mkdir -p "$SYMLINK_PUBLIC" "$TEST_ROOT/symlink-target"
ln -s "$TEST_ROOT/symlink-target" "$SYMLINK_PUBLIC/narcoscope"
if env \
  NARCOSCOPE_REPO="$REPO" \
  NARCOSCOPE_WIRE_STATE_DIR="$STATE_DIR" \
  NARCOSCOPE_WIRE_LOCK_DIR="$LOCK_DIR" \
  NARCOSCOPE_WIRE_PUBLIC_DIR="$SYMLINK_PUBLIC" \
  NARCOSCOPE_WIRE_PUBLISH=0 \
  bash "$COLLECTOR" >/dev/null 2>&1; then
  echo "ERROR: a symlinked public heartbeat path was accepted" >&2
  exit 25
fi

echo "NarcoScope public heartbeat collector tests passed"
