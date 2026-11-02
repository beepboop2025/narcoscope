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
#
# Push race: the evidence-wire publisher pushes its own disjoint files to the
# same branch every 10 to 30 minutes, so the single non-forced push can be
# rejected. A rejected push is retried (MAX_PUSH_ATTEMPTS in total) only when
# the new origin tip still descends from the build base and left every
# GENERATED_PATHS entry untouched. The single data commit is then rebased onto
# that tip and the data:refresh validation gate (tsc + the full vitest suite)
# re-runs on the rebased tree before the next push. Every pushed tree has
# passed validation.
# =============================================================================
set -euo pipefail
umask 077

REPO="${NARCOSCOPE_REPO:-/opt/narcoscope}"
DEPLOY_KEY="${NARCOSCOPE_DEPLOY_KEY:-/root/.ssh/narcoscope_deploy}"
BRANCH="${NARCOSCOPE_BRANCH:-main}"
RUN_ROOT="${NARCOSCOPE_RUN_ROOT:-/var/tmp}"
STATE_DIR="${NARCOSCOPE_STATE_DIR:-/var/lib/narcoscope-collector}"
NARCOSCOPE_MARKET_STATE_DIR="${NARCOSCOPE_MARKET_STATE_DIR:-${STATE_DIR%/}/global-markets}"
export NARCOSCOPE_MARKET_STATE_DIR
export PYTHONDONTWRITEBYTECODE=1
LOCK_DIR="${NARCOSCOPE_LOCK_DIR:-/run/lock/narcoscope-collector}"
printf -v GIT_SSH_COMMAND 'ssh -i %q -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new' "$DEPLOY_KEY"
export GIT_SSH_COMMAND
GENERATED_PATHS=(
  "src/data"
  "public/data/narcoscope-palimpsest-v1.json"
  "public/data/narcoscope-palimpsest-corridors-v2.json"
  "public/data/narcoscope-palimpsest-bri-v1.json"
  "public/data/narcoscope-palimpsest-bri-v1.json.sha256"
  "public/data/global-arms-economy-v1.json"
  "public/data/global-drugs-v1.json"
  "public/data/global-market-catalog-v1.json"
  "public/news"
)
# Re-installed before re-validation when a rebase moves them.
DEPENDENCY_MANIFESTS=("package.json" "package-lock.json")
MAX_PUSH_ATTEMPTS=3

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

# The validation gate of `npm run data:refresh` (scripts/pipeline/run.mjs):
# `tsc --noEmit`, then the full vitest suite including the dataset-integrity
# tests. Used only for a tree that data:refresh itself did not validate.
revalidate() {
  npm run typecheck && npm test
}

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
[[ "$NARCOSCOPE_MARKET_STATE_DIR" = /* && "$NARCOSCOPE_MARKET_STATE_DIR" != "/" ]] || { log "FAIL: unsafe global-market state directory"; exit 1; }
[[ "$NARCOSCOPE_MARKET_STATE_DIR" != "$REPO" && "$NARCOSCOPE_MARKET_STATE_DIR" != "$REPO"/* ]] || { log "FAIL: global-market state must remain outside the service repository"; exit 1; }
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
# The exact commit data:refresh validates. A rejected push is retried only if
# origin has since moved without touching GENERATED_PATHS.
BUILD_BASE="$(git rev-parse HEAD)"
log "isolated run directory ready: $RUN_DIR"
log "building on origin/${BRANCH} at ${BUILD_BASE}"
log "global-market captures retained outside the checkout: $NARCOSCOPE_MARKET_STATE_DIR"

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

push_attempt=0
while true; do
  push_attempt=$((push_attempt + 1))
  log "push attempt ${push_attempt}/${MAX_PUSH_ATTEMPTS}: $(git rev-parse HEAD) on $(git rev-parse HEAD^)"
  if git push --quiet origin "HEAD:${BRANCH}"; then
    break
  fi
  log "push attempt ${push_attempt}/${MAX_PUSH_ATTEMPTS} was rejected; fetching origin/${BRANCH}"
  if ! git -C "$REPO" fetch --quiet origin "$BRANCH"; then
    log "FAIL: could not fetch origin/${BRANCH} after the rejected push; nothing pushed"
    exit 1
  fi
  upstream="$(git rev-parse --verify --quiet "origin/${BRANCH}^{commit}")" || {
    log "FAIL: origin/${BRANCH} is not resolvable after the rejected push; nothing pushed"
    exit 1
  }
  # A push can land even though the client saw an error. Never push twice.
  if git merge-base --is-ancestor HEAD "$upstream"; then
    log "origin/${BRANCH} at ${upstream} already contains this data commit; attempt ${push_attempt} landed"
    break
  fi
  if [[ "$push_attempt" -ge "$MAX_PUSH_ATTEMPTS" ]]; then
    log "FAIL: all ${MAX_PUSH_ATTEMPTS} push attempts were rejected; nothing pushed"
    exit 1
  fi
  if ! git merge-base --is-ancestor "$BUILD_BASE" "$upstream"; then
    log "FAIL: origin/${BRANCH} at ${upstream} no longer descends from build base ${BUILD_BASE}; nothing pushed"
    exit 1
  fi
  upstream_touches="$(git log --full-history --max-count=20 --format='%H %s' \
    "${BUILD_BASE}..${upstream}" -- "${GENERATED_PATHS[@]}")"
  if [[ -n "$upstream_touches" ]]; then
    log "FAIL: origin/${BRANCH} changed collector paths since build base ${BUILD_BASE}; nothing pushed"
    while IFS= read -r upstream_commit; do
      log "  upstream commit touching collector paths: ${upstream_commit}"
    done <<< "$upstream_touches"
    exit 1
  fi
  current_base="$(git rev-parse HEAD^)"
  if [[ "$upstream" == "$current_base" ]]; then
    log "origin/${BRANCH} has not moved, so this was not a race; retrying the validated commit unchanged"
    continue
  fi
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    log "FAIL: tracked changes outside the data commit would leak into re-validation; nothing pushed"
    exit 1
  fi

  validated_commit="$(git rev-parse HEAD)"
  log "origin/${BRANCH} advanced ${current_base}..${upstream} without touching collector paths; rebasing the data commit"
  if ! git -c user.name="narcoscope-collector" \
      -c user.email="collector@narcoscope.local" \
      rebase --quiet --onto "$upstream" "$current_base"; then
    git rebase --abort >/dev/null 2>&1 || true
    log "FAIL: could not rebase the data commit onto origin/${BRANCH}; nothing pushed"
    exit 1
  fi
  if [[ "$(git rev-parse HEAD^)" != "$upstream" ]] \
    || ! git diff --quiet "$validated_commit" HEAD -- "${GENERATED_PATHS[@]}"; then
    log "FAIL: the rebased commit does not carry exactly the validated data; nothing pushed"
    exit 1
  fi
  if ! git diff --quiet "$current_base" "$upstream" -- "${DEPENDENCY_MANIFESTS[@]}"; then
    log "dependency manifests changed upstream; reinstalling before re-validation"
    if ! npm ci --no-audit --no-fund --silent; then
      log "FAIL: npm ci failed on the rebased tree; nothing pushed"
      exit 1
    fi
  fi
  log "re-validating the rebased tree $(git rev-parse HEAD) (typecheck + full test suite, the data:refresh gate)"
  if ! revalidate; then
    log "FAIL: the rebased tree did not pass validation; nothing pushed"
    exit 1
  fi
  log "re-validation passed"
done
write_success_receipts "pushed" "$(git rev-parse HEAD)"
log "pushed refreshed data on attempt ${push_attempt}/${MAX_PUSH_ATTEMPTS}; Vercel will redeploy"
