#!/usr/bin/env bash
# =============================================================================
# NarcoScope 24/7 data collector
# =============================================================================
# Runs the open-data pipeline (fetch -> transform -> VALIDATE), and pushes the
# refreshed datasets only if they changed AND passed the test gate. Designed to
# run on the Hetzner box under a systemd timer.
#
# Safety: `npm run data:refresh` runs tsc + the full vitest suite (including the
# dataset-integrity tests) as a hard gate. If validation fails, the script exits
# non-zero and pushes NOTHING. The pipeline runs in a disposable detached
# worktree, so failed generated files never dirty or overwrite the service repo.
# =============================================================================
set -euo pipefail
umask 077

REPO="${NARCOSCOPE_REPO:-/opt/narcoscope}"
DEPLOY_KEY="${NARCOSCOPE_DEPLOY_KEY:-/root/.ssh/narcoscope_deploy}"
BRANCH="${NARCOSCOPE_BRANCH:-main}"
RUN_ROOT="${NARCOSCOPE_RUN_ROOT:-/var/tmp}"
STATE_DIR="${NARCOSCOPE_STATE_DIR:-/var/lib/narcoscope-collector}"
LOCK_DIR="${NARCOSCOPE_LOCK_DIR:-/run/lock/narcoscope-collector}"
printf -v GIT_SSH_COMMAND 'ssh -i %q -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' "$DEPLOY_KEY"
export GIT_SSH_COMMAND
GENERATED_PATHS=(
  "src/data"
  "public/data/narcoscope-palimpsest-v1.json"
  "public/data/narcoscope-palimpsest-corridors-v2.json"
  "public/data/narcoscope-palimpsest-bri-v1.json"
  "public/data/narcoscope-palimpsest-bri-v1.json.sha256"
  "public/news"
)

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

RUN_BASE=""
RUN_DIR=""
WORKTREE_ADDED=0
LOCK_HELD=0

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
    if ! rmdir -- "$LOCK_DIR" 2>/dev/null; then
      log "WARN: could not release collector lock $LOCK_DIR"
      [[ "$result" -ne 0 ]] || result=1
    fi
  fi
  exit "$result"
}

write_success_receipts() {
  local outcome="$1"
  local revision="$2"
  local completed_at success_temp status_temp
  completed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p -- "$STATE_DIR"
  chmod 0700 "$STATE_DIR"

  success_temp="$(mktemp "${STATE_DIR%/}/last-success.json.XXXXXX")"
  printf '{"schemaVersion":"narcoscope.collector.success.v1","service":"narcoscope-collector.service","completedAt":"%s","outcome":"%s","revision":"%s"}\n' \
    "$completed_at" "$outcome" "$revision" > "$success_temp"
  chmod 0600 "$success_temp"
  mv -f -- "$success_temp" "$STATE_DIR/last-success.json"

  status_temp="$(mktemp "${STATE_DIR%/}/status.json.XXXXXX")"
  printf '{"schemaVersion":"narcoscope.collector.status.v1","service":"narcoscope-collector.service","status":"ok","recordedAt":"%s","outcome":"%s","revision":"%s"}\n' \
    "$completed_at" "$outcome" "$revision" > "$status_temp"
  chmod 0600 "$status_temp"
  mv -f -- "$status_temp" "$STATE_DIR/status.json"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[[ -d "$REPO" ]] || { log "FAIL: repository directory does not exist: $REPO"; exit 1; }
[[ -d "$RUN_ROOT" && -w "$RUN_ROOT" ]] || { log "FAIL: run root is not a writable directory: $RUN_ROOT"; exit 1; }
[[ "$STATE_DIR" = /* && "$STATE_DIR" != "/" ]] || { log "FAIL: unsafe collector state directory"; exit 1; }
[[ "$LOCK_DIR" = /* && "$LOCK_DIR" != "/" ]] || { log "FAIL: unsafe collector lock directory"; exit 1; }
git check-ref-format "refs/heads/${BRANCH}" >/dev/null 2>&1 || { log "FAIL: invalid branch name"; exit 1; }

# systemd already serializes starts of this oneshot unit. This process lock also
# protects against a direct/manual invocation racing the timer. Its default is
# on the host runtime filesystem, so a SIGKILL fails closed until the lock is
# inspected and removed or the host reboots.
if ! mkdir -- "$LOCK_DIR" 2>/dev/null; then
  if [[ -d "$LOCK_DIR" ]]; then
    log "FAIL: another collector run holds $LOCK_DIR"
    exit 75
  fi
  log "FAIL: could not create collector lock $LOCK_DIR"
  exit 1
fi
LOCK_HELD=1
printf '%s\n' "$$" > "$LOCK_DIR/pid"

log "collector start (repo=$REPO branch=$BRANCH)"

# Build from the fetched remote ref in a detached worktree. The service checkout
# is only the Git object store and script source; its working tree is never reset
# or cleaned, including after a failed upstream refresh.
git -C "$REPO" fetch --quiet origin "$BRANCH"
RUN_BASE="$(mktemp -d "${RUN_ROOT%/}/narcoscope-collector.XXXXXX")"
RUN_DIR="$RUN_BASE/worktree"
git -C "$REPO" worktree add --quiet --detach "$RUN_DIR" "origin/${BRANCH}"
WORKTREE_ADDED=1
cd "$RUN_DIR"
log "isolated run directory ready: $RUN_DIR"

# Dependencies (fast no-op when the lockfile is unchanged).
npm ci --no-audit --no-fund --silent

# Fetch + transform + validate. Non-zero here aborts before any push.
if ! npm run data:refresh; then
  log "FAIL: data:refresh did not pass validation; nothing pushed"
  exit 1
fi

# Push only generated data and derived public artifacts, only if any changed.
# `git status` also sees newly generated, previously untracked files.
if [[ -z "$(git status --porcelain -- "${GENERATED_PATHS[@]}")" ]]; then
  log "no data changes"
  write_success_receipts "no_changes" "$(git rev-parse HEAD)"
  exit 0
fi

git add -- "${GENERATED_PATHS[@]}"
git -c user.name="narcoscope-collector" \
    -c user.email="collector@narcoscope.local" \
    commit --quiet -m "data: automated refresh $(date -u +%Y-%m-%dT%H:%MZ)

Regenerated by the Hetzner collector; passed tsc + the full test suite before push."
git push --quiet origin "HEAD:${BRANCH}"
write_success_receipts "pushed" "$(git rev-parse HEAD)"
log "pushed refreshed data; Vercel will redeploy"
