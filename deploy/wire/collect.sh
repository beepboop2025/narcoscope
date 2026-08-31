#!/usr/bin/env bash
# Bounded NarcoScope live-wire capture plus optional semantic-change publisher.
# Publication uses a disposable worktree and a non-forced push; capture remains
# useful and enabled when the owner-gated publication lane is disabled.
set -euo pipefail
umask 077

REPO="${NARCOSCOPE_REPO:-/opt/narcoscope}"
STATE_DIR="${NARCOSCOPE_WIRE_STATE_DIR:-/var/lib/narcoscope-wire}"
LOCK_DIR="${NARCOSCOPE_WIRE_LOCK_DIR:-/run/lock/narcoscope-wire}"
PUBLISH="${NARCOSCOPE_WIRE_PUBLISH:-0}"
DEPLOY_KEY="${NARCOSCOPE_WIRE_DEPLOY_KEY:-/root/.ssh/narcoscope_deploy}"
BRANCH="${NARCOSCOPE_WIRE_BRANCH:-main}"
RUN_ROOT="${NARCOSCOPE_WIRE_RUN_ROOT:-/var/tmp}"
PUBLIC_DIR="${NARCOSCOPE_WIRE_PUBLIC_DIR:-/var/lib/narcoscope-wire-public}"
LATEST="$STATE_DIR/evidence-wire-v1.json"
HISTORY="$STATE_DIR/history"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

[[ -d "$REPO" ]] || { log "FAIL: repository directory does not exist: $REPO"; exit 1; }
[[ "$STATE_DIR" = /* && "$STATE_DIR" != "/" ]] || { log "FAIL: unsafe state directory"; exit 1; }
[[ "$LOCK_DIR" = /* && "$LOCK_DIR" != "/" ]] || { log "FAIL: unsafe lock directory"; exit 1; }
[[ "$PUBLIC_DIR" = /* && "$PUBLIC_DIR" != "/" ]] || { log "FAIL: unsafe public heartbeat directory"; exit 1; }
[[ "$PUBLISH" = "0" || "$PUBLISH" = "1" ]] || { log "FAIL: NARCOSCOPE_WIRE_PUBLISH must be 0 or 1"; exit 1; }

PUBLIC_DIR="$(node -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' "$PUBLIC_DIR")"
[[ "$PUBLIC_DIR" != "/" ]] || { log "FAIL: unsafe public heartbeat directory"; exit 1; }
PUBLIC_HEARTBEAT_DIR="$PUBLIC_DIR/narcoscope"
PUBLIC_HEARTBEAT="$PUBLIC_HEARTBEAT_DIR/wire-heartbeat-v1.json"

LOCK_HELD=0
RUN_BASE=""
RUN_DIR=""
WORKTREE_ADDED=0
PUBLIC_READY=0
PHASE="capture"

write_public_heartbeat() {
  local monitor_status="$1"
  local recorded_at artifact_meta item_count artifact_digest heartbeat_temp
  [[ "$monitor_status" = "ok" || "$monitor_status" = "failed" ]] || return 1
  recorded_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  item_count="null"
  artifact_digest=""
  if [[ -f "$LATEST" ]] && artifact_meta="$(node -e '
    const { createHash } = require("node:crypto")
    const { readFileSync } = require("node:fs")
    const raw = readFileSync(process.argv[1])
    const payload = JSON.parse(raw)
    if (payload.schema !== "narcoscope.evidence-wire.v1" || !Array.isArray(payload.items)) process.exit(2)
    process.stdout.write(String(payload.items.length) + "\t" + createHash("sha256").update(raw).digest("hex"))
  ' "$LATEST" 2>/dev/null)"; then
    IFS=$'\t' read -r item_count artifact_digest <<< "$artifact_meta"
  fi

  heartbeat_temp="$(mktemp "$PUBLIC_HEARTBEAT_DIR/.wire-heartbeat-v1.json.XXXXXX")"
  if [[ "$item_count" = "null" ]]; then
    printf '{"schema":"narcoscope.wire-heartbeat.v1","status":"%s","recordedAt":"%s","itemCount":null}\n' \
      "$monitor_status" "$recorded_at" > "$heartbeat_temp"
  else
    [[ "$item_count" =~ ^[0-9]+$ && "$artifact_digest" =~ ^[0-9a-f]{64}$ ]] || return 1
    printf '{"schema":"narcoscope.wire-heartbeat.v1","status":"%s","recordedAt":"%s","itemCount":%s,"artifactSha256":"%s"}\n' \
      "$monitor_status" "$recorded_at" "$item_count" "$artifact_digest" > "$heartbeat_temp"
  fi
  chmod 0644 "$heartbeat_temp"
  mv -f -- "$heartbeat_temp" "$PUBLIC_HEARTBEAT"
}

cleanup() {
  local result=$?
  trap - EXIT
  if [[ "$WORKTREE_ADDED" -eq 1 ]]; then
    if ! git -C "$REPO" worktree remove --force "$RUN_DIR"; then
      log "WARN: could not remove disposable worktree $RUN_DIR"
      [[ "$result" -ne 0 ]] || result=1
    fi
  fi
  if [[ -n "$RUN_BASE" && -d "$RUN_BASE" ]]; then
    if ! rmdir -- "$RUN_BASE" 2>/dev/null; then
      log "WARN: incomplete disposable directory remains at $RUN_BASE"
      [[ "$result" -ne 0 ]] || result=1
    fi
  fi
  if [[ "$LOCK_HELD" -eq 1 ]]; then
    rm -f -- "$LOCK_DIR/pid"
    rmdir -- "$LOCK_DIR" 2>/dev/null || result=1
  fi
  if [[ "$result" -ne 0 && -d "$STATE_DIR" ]]; then
    local failure_temp
    failure_temp="$(mktemp "${STATE_DIR%/}/status.json.XXXXXX")"
    printf '{"schema":"narcoscope.wire-status.v1","status":"failed","recordedAt":"%s","phase":"%s","exitCode":%s}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$PHASE" "$result" > "$failure_temp"
    chmod 0600 "$failure_temp"
    mv -f -- "$failure_temp" "$STATE_DIR/status.json"
  fi
  if [[ "$result" -ne 0 && "$PUBLIC_READY" -eq 1 ]]; then
    if ! write_public_heartbeat "failed"; then
      log "WARN: could not write the public failure heartbeat"
    fi
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ -L "$PUBLIC_DIR"
  || ( -e "$PUBLIC_DIR" && ! -d "$PUBLIC_DIR" )
  || ( -e "$PUBLIC_HEARTBEAT_DIR" && ( ! -d "$PUBLIC_HEARTBEAT_DIR" || -L "$PUBLIC_HEARTBEAT_DIR" ) ) ]]; then
  log "FAIL: public heartbeat path is not a regular directory"
  exit 1
fi
install -d -m 0755 -- "$PUBLIC_HEARTBEAT_DIR"

if ! mkdir -- "$LOCK_DIR" 2>/dev/null; then
  log "FAIL: another live-wire run holds $LOCK_DIR"
  exit 75
fi
LOCK_HELD=1
PUBLIC_READY=1
printf '%s\n' "$$" > "$LOCK_DIR/pid"

write_publication_receipt() {
  local outcome="$1"
  local revision="$2"
  local receipt_temp
  receipt_temp="$(mktemp "${STATE_DIR%/}/publication-status.json.XXXXXX")"
  printf '{"schema":"narcoscope.wire-publication.v1","status":"ok","recordedAt":"%s","outcome":"%s","revision":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$outcome" "$revision" > "$receipt_temp"
  chmod 0600 "$receipt_temp"
  mv -f -- "$receipt_temp" "$STATE_DIR/publication-status.json"
}

publish_if_changed() {
  if [[ "$PUBLISH" = "0" ]]; then
    log "publication disabled; retained capture in $LATEST"
    return
  fi

  PHASE="publication"
  command -v git >/dev/null || { log "FAIL: git is not installed"; return 1; }
  [[ -d "$RUN_ROOT" && -w "$RUN_ROOT" ]] || { log "FAIL: publication run root is not writable: $RUN_ROOT"; return 1; }
  [[ "$DEPLOY_KEY" = /* && "$DEPLOY_KEY" != "/" && -r "$DEPLOY_KEY" ]] || { log "FAIL: publication deploy key is not a readable absolute file"; return 1; }
  git check-ref-format "refs/heads/${BRANCH}" >/dev/null 2>&1 || { log "FAIL: invalid publication branch"; return 1; }

  printf -v GIT_SSH_COMMAND 'ssh -i %q -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes' "$DEPLOY_KEY"
  export GIT_SSH_COMMAND
  git -C "$REPO" fetch --quiet origin "$BRANCH"
  RUN_BASE="$(mktemp -d "${RUN_ROOT%/}/narcoscope-wire.XXXXXX")"
  RUN_DIR="$RUN_BASE/worktree"
  git -C "$REPO" worktree add --quiet --detach "$RUN_DIR" "origin/${BRANCH}"
  WORKTREE_ADDED=1

  local public_wire="$RUN_DIR/public/data/evidence-wire-v1.json"
  local semantic_result=10
  if [[ -f "$public_wire" ]]; then
    if node "$RUN_DIR/scripts/wire/collect.mjs" --output "$LATEST" --semantic-equal "$public_wire"; then
      write_publication_receipt "no_changes" "$(git -C "$RUN_DIR" rev-parse HEAD)"
      log "no semantic public-wire changes"
      return
    else
      semantic_result=$?
      if [[ "$semantic_result" -ne 10 ]]; then
        log "FAIL: semantic comparison failed"
        return "$semantic_result"
      fi
    fi
  fi

  install -m 0644 -- "$LATEST" "$public_wire"
  node "$RUN_DIR/scripts/wire/collect.mjs" --check --output "$public_wire"
  git -C "$RUN_DIR" add -- "public/data/evidence-wire-v1.json"
  if git -C "$RUN_DIR" diff --cached --quiet -- "public/data/evidence-wire-v1.json"; then
    write_publication_receipt "byte_only_noop" "$(git -C "$RUN_DIR" rev-parse HEAD)"
    log "semantic change produced no Git diff"
    return
  fi
  git -C "$RUN_DIR" \
    -c user.name="narcoscope-wire" \
    -c user.email="wire@narcoscope.local" \
    commit --quiet -m "data: publish evidence wire $(date -u +%Y-%m-%dT%H:%MZ)"
  git -C "$RUN_DIR" push --quiet origin "HEAD:${BRANCH}"
  write_publication_receipt "pushed" "$(git -C "$RUN_DIR" rev-parse HEAD)"
  log "pushed semantic wire change; deployment trigger accepted"
}

install -d -m 0700 -- "$STATE_DIR" "$HISTORY"
node "$REPO/scripts/wire/collect.mjs" --output "$LATEST"
node "$REPO/scripts/wire/collect.mjs" --check --output "$LATEST"

CAPTURED_AT="$(date -u +%Y%m%dT%H%M%SZ)"
DAY_DIR="$HISTORY/${CAPTURED_AT:0:4}/${CAPTURED_AT:4:2}/${CAPTURED_AT:6:2}"
install -d -m 0700 -- "$DAY_DIR"
gzip -9 -c -- "$LATEST" > "$DAY_DIR/${CAPTURED_AT}.json.gz"
sha256sum "$DAY_DIR/${CAPTURED_AT}.json.gz" > "$DAY_DIR/${CAPTURED_AT}.json.gz.sha256"
chmod 0600 "$DAY_DIR/${CAPTURED_AT}.json.gz" "$DAY_DIR/${CAPTURED_AT}.json.gz.sha256"

STATUS_TEMP="$(mktemp "${STATE_DIR%/}/status.json.XXXXXX")"
ITEM_COUNT="$(node -e "const f=require(process.argv[1]); process.stdout.write(String(f.items.length))" "$LATEST")"
WIRE_STATUS="$(node -e "const f=require(process.argv[1]); process.stdout.write(String(f.status))" "$LATEST")"
printf '{"schema":"narcoscope.wire-status.v1","status":"%s","recordedAt":"%s","itemCount":%s,"latest":"%s"}\n' \
  "$WIRE_STATUS" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$ITEM_COUNT" "$LATEST" > "$STATUS_TEMP"
chmod 0600 "$STATUS_TEMP"
mv -f -- "$STATUS_TEMP" "$STATE_DIR/status.json"
log "capture complete (status=$WIRE_STATUS items=$ITEM_COUNT)"
publish_if_changed
write_public_heartbeat "ok"
log "public monitor heartbeat updated"
