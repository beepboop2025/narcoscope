#!/usr/bin/env bash
# Hermetic push-race tests for deploy/collector/collect.sh.
#
# Each case builds a temporary bare origin, a service clone and a fake npm on
# PATH; nothing touches the network. Competing writers push straight to the
# temporary origin while the fake `npm run data:refresh` (or `npm test`) runs,
# which is exactly the window between the collector's fetch and its push.
#
#   bash deploy/collector/collect.test.sh              # every case
#   bash deploy/collector/collect.test.sh wire_race    # named cases only
set -euo pipefail

COLLECTOR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/collect.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/narcoscope-collector-race.XXXXXX")"
cleanup() {
  find "$TEST_ROOT" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT

# Isolate every git call (fixtures, fakes and the collector under test) from
# the caller's repository, system and global configuration.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR GIT_ALTERNATE_OBJECT_DIRECTORIES
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_GLOBAL="$TEST_ROOT/gitconfig"
cat > "$GIT_CONFIG_GLOBAL" <<'CONFIG'
[user]
	name = Collector Race Fixture
	email = collector-race-fixture@example.invalid
[init]
	defaultBranch = main
[commit]
	gpgsign = false
[advice]
	detachedHead = false
CONFIG
REAL_GIT="$(command -v git)"
BIN="$TEST_ROOT/bin"
mkdir -p "$BIN"

# Fake npm: records each call with the commit it ran on, plays the pipeline,
# and injects the case's competing pushes and validation failures.
cat > "$BIN/npm" <<'NPM'
#!/usr/bin/env bash
set -euo pipefail
head="$("$REAL_GIT" rev-parse HEAD)"
parent="$("$REAL_GIT" rev-parse --verify --quiet HEAD^ || echo none)"
printf '%s|%s|%s\n' "$*" "$head" "$parent" >> "$FAKE_NPM_LOG"
case "${1:-}" in
  ci) exit 0 ;;
  run)
    case "${2:-}" in
      data:refresh)
        printf '{"version":"collected"}\n' > src/data/sample.json
        printf '{"refreshed":true}\n' > public/data/global-drugs-v1.json
        if [[ -n "${FAKE_RACE_PATH:-}" ]]; then "$FAKE_BIN/compete" "$FAKE_RACE_PATH"; fi
        exit 0
        ;;
      typecheck)
        if [[ "${FAKE_FAIL_STEP:-}" == typecheck ]]; then exit 2; fi
        exit 0
        ;;
    esac
    ;;
  test)
    if [[ "${FAKE_RACE_ON_TEST:-0}" == 1 ]]; then "$FAKE_BIN/compete" "$FAKE_WIRE_FILE"; fi
    if [[ "${FAKE_FAIL_STEP:-}" == test ]]; then exit 1; fi
    exit 0
    ;;
esac
exit 64
NPM

# Competing writer: one commit changing $1 on origin main, pushed like the
# wire publisher would. FAKE_RACE_MODE=rewrite force-pushes a rewritten root.
cat > "$BIN/compete" <<'COMPETE'
#!/usr/bin/env bash
set -euo pipefail
count=$(( $(cat "$FAKE_STATE/compete-count" 2>/dev/null || echo 0) + 1 ))
echo "$count" > "$FAKE_STATE/compete-count"
clone="$FAKE_STATE/compete-$count"
"$REAL_GIT" clone --quiet "$FAKE_ORIGIN" "$clone"
mkdir -p "$clone/$(dirname "$1")"
printf '{"competing":%s}\n' "$count" > "$clone/$1"
"$REAL_GIT" -C "$clone" add -- "$1"
if [[ "${FAKE_RACE_MODE:-}" == rewrite ]]; then
  "$REAL_GIT" -C "$clone" commit --quiet --amend -m "fixture: rewritten history $count"
  "$REAL_GIT" -C "$clone" push --quiet --force origin HEAD:main
else
  "$REAL_GIT" -C "$clone" -c user.name=narcoscope-wire -c user.email=wire@narcoscope.local \
    commit --quiet -m "data: competing write $count to $1"
  "$REAL_GIT" -C "$clone" push --quiet origin HEAD:main
fi
COMPETE

# Pass-through git that can fail the collector's first push: "transient"
# rejects without pushing; "lost-ack" pushes, then reports failure anyway.
cat > "$BIN/git" <<'GIT'
#!/usr/bin/env bash
if [[ "${1:-}" == push && -n "${FAKE_PUSH_FAULT:-}" && ! -e "$FAKE_STATE/push-fault-fired" ]]; then
  : > "$FAKE_STATE/push-fault-fired"
  if [[ "$FAKE_PUSH_FAULT" == lost-ack ]]; then "$REAL_GIT" "$@" || true; fi
  echo "fatal: simulated push failure ($FAKE_PUSH_FAULT)" >&2
  exit 128
fi
exec "$REAL_GIT" "$@"
GIT
chmod 0755 "$BIN/npm" "$BIN/compete" "$BIN/git"

WIRE_FILE="public/data/evidence-wire-v1.json"
SEED_FILES=(
  "src/data/sample.json"
  "public/data/narcoscope-palimpsest-v1.json"
  "public/data/narcoscope-palimpsest-corridors-v2.json"
  "public/data/narcoscope-palimpsest-bri-v1.json"
  "public/data/narcoscope-palimpsest-bri-v1.json.sha256"
  "public/data/global-arms-economy-v1.json"
  "public/data/global-drugs-v1.json"
  "public/data/global-market-catalog-v1.json"
  "public/news/index.json"
  "$WIRE_FILE"
  "package.json"
  "package-lock.json"
)
NPM_CI="ci --no-audit --no-fund --silent"
COLLECTOR_ID="narcoscope-collector <collector@narcoscope.local>"

setup_case() {
  CASE="$1"
  CASE_DIR="$TEST_ROOT/$CASE"
  ORIGIN="$CASE_DIR/origin.git"
  SERVICE="$CASE_DIR/service"
  RUN_ROOT="$CASE_DIR/runs"
  STATE_DIR="$CASE_DIR/state"
  LOCK_DIR="$CASE_DIR/collector.lock"
  FAKE_STATE="$CASE_DIR/fake"
  NPM_LOG="$FAKE_STATE/npm.log"
  OUTPUT="$CASE_DIR/collector.log"
  local seed="$CASE_DIR/seed" path
  mkdir -p "$RUN_ROOT" "$FAKE_STATE"
  : > "$NPM_LOG"
  "$REAL_GIT" init --quiet --bare "$ORIGIN"
  "$REAL_GIT" init --quiet "$seed"
  for path in "${SEED_FILES[@]}"; do
    mkdir -p "$seed/$(dirname "$path")"
    printf '{"fixture":"%s"}\n' "$path" > "$seed/$path"
  done
  "$REAL_GIT" -C "$seed" add -A
  "$REAL_GIT" -C "$seed" commit --quiet -m "fixture: seed"
  "$REAL_GIT" -C "$seed" push --quiet "$ORIGIN" HEAD:refs/heads/main
  "$REAL_GIT" clone --quiet "$ORIGIN" "$SERVICE"
  SEED_COMMIT="$(origin rev-parse main)"
}

# Runs the collector under test; extra NAME=VALUE arguments reach the fakes.
run_collector() {
  COLLECTOR_STATUS=0
  env \
    PATH="$BIN:$PATH" \
    REAL_GIT="$REAL_GIT" \
    FAKE_BIN="$BIN" \
    FAKE_STATE="$FAKE_STATE" \
    FAKE_ORIGIN="$ORIGIN" \
    FAKE_NPM_LOG="$NPM_LOG" \
    FAKE_WIRE_FILE="$WIRE_FILE" \
    NARCOSCOPE_REPO="$SERVICE" \
    NARCOSCOPE_DEPLOY_KEY="$CASE_DIR/unused-deploy-key" \
    NARCOSCOPE_BRANCH=main \
    NARCOSCOPE_RUN_ROOT="$RUN_ROOT" \
    NARCOSCOPE_STATE_DIR="$STATE_DIR" \
    NARCOSCOPE_MARKET_STATE_DIR="$STATE_DIR/global-markets" \
    NARCOSCOPE_LOCK_DIR="$LOCK_DIR" \
    "$@" \
    "$BASH" "$COLLECTOR" > "$OUTPUT" 2>&1 || COLLECTOR_STATUS=$?
}

fail() {
  {
    echo "FAIL [$CASE]: $*"
    echo "--- collector output ---"
    cat "$OUTPUT" 2>/dev/null || true
    echo "--- npm calls (command|HEAD|HEAD^) ---"
    cat "$NPM_LOG" 2>/dev/null || true
  } >&2
  exit 1
}

origin() { "$REAL_GIT" --git-dir="$ORIGIN" "$@"; }
subject_of() { origin log -1 --format=%s "$1"; }

expect_status() {
  [[ "$COLLECTOR_STATUS" -eq "$1" ]] || fail "exit status $COLLECTOR_STATUS, expected $1"
}
expect_output() {
  grep -Fq -- "$1" "$OUTPUT" || fail "collector output lacks: $1"
}
expect_no_output() {
  ! grep -Fq -- "$1" "$OUTPUT" || fail "collector output unexpectedly contains: $1"
}
expect_npm_calls() {
  local expected actual
  expected="$(printf '%s\n' "$@")"
  actual="$(cut -d'|' -f1 "$NPM_LOG")"
  [[ "$actual" == "$expected" ]] || fail "npm calls were [${actual//$'\n'/, }], expected [${expected//$'\n'/, }]"
}
# Asserts that every call of npm command $1 ran on tree $2 whose parent is $3.
expect_npm_ran_on() {
  local line
  line="$(grep -F -- "$1|" "$NPM_LOG")" || fail "npm $1 never ran"
  [[ "$line" == "$1|$2|$3" ]] || fail "npm $1 ran on [${line//$'\n'/, }], expected HEAD $2 on $3"
}
expect_history() {
  local expected actual
  expected="$(printf '%s\n' "$@")"
  actual="$(origin log --format=%s main)"
  [[ "$actual" == "$expected" ]] || fail "origin main history is [${actual//$'\n'/, }], expected [${expected//$'\n'/, }]"
}
expect_origin_file() {
  [[ "$(origin show "main:$1")" == "$2" ]] || fail "origin main:$1 is not $2"
}
expect_only_main_on_origin() {
  [[ "$(origin for-each-ref --format='%(refname)')" == "refs/heads/main" ]] || fail "unexpected refs on origin"
}
expect_receipt() {
  local receipt="$STATE_DIR/status.json"
  [[ -f "$receipt" ]] || fail "no status receipt"
  grep -Fq '"status":"ok"' "$receipt" || fail "status receipt is not ok"
  grep -Fq '"outcome":"pushed"' "$receipt" || fail "status receipt outcome is not pushed"
  grep -Fq "\"revision\":\"$1\"" "$receipt" || fail "status receipt revision is not $1"
}
expect_no_receipt() {
  [[ ! -e "$STATE_DIR/status.json" && ! -e "$STATE_DIR/last-success.json" ]] || fail "a success receipt was written"
}
expect_clean_teardown() {
  [[ "$("$REAL_GIT" -C "$SERVICE" worktree list --porcelain | grep -c '^worktree ')" -eq 1 ]] \
    || fail "the disposable worktree is still registered"
  [[ -z "$(ls -A "$RUN_ROOT")" ]] || fail "the run root was not emptied"
  [[ ! -e "$LOCK_DIR" ]] || fail "the collector lock was not released"
  [[ -z "$("$REAL_GIT" -C "$SERVICE" status --porcelain)" ]] || fail "the service checkout was dirtied"
}
expect_collector_tip() {
  local tip
  tip="$(origin rev-parse main)"
  [[ "$(subject_of main)" == "data: automated refresh "* ]] || fail "the collector commit is not the origin tip"
  [[ "$(origin log -1 --format='%an <%ae>|%cn <%ce>' main)" == "$COLLECTOR_ID|$COLLECTOR_ID" ]] \
    || fail "the pushed commit lost the collector author or committer identity"
  [[ "$(origin diff --name-only main^ main | tr '\n' ' ')" == "public/data/global-drugs-v1.json src/data/sample.json " ]] \
    || fail "the collector commit changed more than its generated data"
  expect_origin_file src/data/sample.json '{"version":"collected"}'
  expect_receipt "$tip"
}

# (a) A wire push between fetch and push: rebase, re-validate, push again.
case_wire_race() {
  setup_case wire_race
  run_collector FAKE_RACE_PATH="$WIRE_FILE"
  expect_status 0
  local wire tip
  wire="$(origin rev-parse main^)"
  tip="$(origin rev-parse main)"
  expect_history "$(subject_of main)" "data: competing write 1 to $WIRE_FILE" "fixture: seed"
  expect_collector_tip
  expect_origin_file "$WIRE_FILE" '{"competing":1}'
  expect_npm_calls "$NPM_CI" "run data:refresh" "run typecheck" "test"
  expect_npm_ran_on "run typecheck" "$tip" "$wire"
  expect_npm_ran_on "test" "$tip" "$wire"
  expect_output "push attempt 1/3"
  expect_output "push attempt 1/3 was rejected"
  expect_output "advanced $SEED_COMMIT..$wire without touching collector paths; rebasing the data commit"
  expect_output "re-validation passed"
  expect_output "push attempt 2/3: $tip on $wire"
  expect_output "pushed refreshed data on attempt 2/3"
  expect_only_main_on_origin
  expect_clean_teardown
}

# (b) A competing commit touching a collector path the run did not change:
# the rebase would be clean, but the collector must refuse and push nothing.
case_collector_path_race() {
  setup_case collector_path_race
  run_collector FAKE_RACE_PATH=public/news/index.json
  expect_status 1
  local competing
  competing="$(origin rev-parse main)"
  expect_history "data: competing write 1 to public/news/index.json" "fixture: seed"
  expect_origin_file src/data/sample.json '{"fixture":"src/data/sample.json"}'
  expect_npm_calls "$NPM_CI" "run data:refresh"
  expect_output "changed collector paths since build base $SEED_COMMIT; nothing pushed"
  expect_output "upstream commit touching collector paths: $competing data: competing write 1 to public/news/index.json"
  expect_no_output "rebasing the data commit"
  expect_no_output "push attempt 2/3"
  expect_no_receipt
  expect_only_main_on_origin
  expect_clean_teardown
}

# (c) Re-validation of the rebased tree fails: nothing is pushed.
case_revalidation_fails() {
  local step
  for step in test typecheck; do
    setup_case "revalidation_fails_$step"
    run_collector FAKE_RACE_PATH="$WIRE_FILE" FAKE_FAIL_STEP="$step"
    expect_status 1
    expect_history "data: competing write 1 to $WIRE_FILE" "fixture: seed"
    expect_origin_file src/data/sample.json '{"fixture":"src/data/sample.json"}'
    if [[ "$step" == test ]]; then
      expect_npm_calls "$NPM_CI" "run data:refresh" "run typecheck" "test"
    else
      expect_npm_calls "$NPM_CI" "run data:refresh" "run typecheck"
    fi
    expect_output "rebasing the data commit"
    expect_output "the rebased tree did not pass validation; nothing pushed"
    expect_no_output "push attempt 2/3"
    expect_no_receipt
    expect_only_main_on_origin
    expect_clean_teardown
  done
}

# (d) A writer that wins every race: three logged attempts, then give up.
case_push_cap() {
  setup_case push_cap
  run_collector FAKE_RACE_PATH="$WIRE_FILE" FAKE_RACE_ON_TEST=1
  expect_status 1
  expect_history \
    "data: competing write 3 to $WIRE_FILE" \
    "data: competing write 2 to $WIRE_FILE" \
    "data: competing write 1 to $WIRE_FILE" \
    "fixture: seed"
  expect_npm_calls "$NPM_CI" "run data:refresh" "run typecheck" "test" "run typecheck" "test"
  expect_output "push attempt 1/3 was rejected"
  expect_output "push attempt 2/3 was rejected"
  expect_output "push attempt 3/3 was rejected"
  expect_output "all 3 push attempts were rejected; nothing pushed"
  expect_no_output "push attempt 4/3"
  expect_no_receipt
  expect_clean_teardown
}

# (e) A dependency change lands mid-run: reinstall, then re-validate.
case_lockfile_race() {
  setup_case lockfile_race
  run_collector FAKE_RACE_PATH=package-lock.json
  expect_status 0
  local lock tip
  lock="$(origin rev-parse main^)"
  tip="$(origin rev-parse main)"
  expect_history "$(subject_of main)" "data: competing write 1 to package-lock.json" "fixture: seed"
  expect_collector_tip
  expect_npm_calls "$NPM_CI" "run data:refresh" "$NPM_CI" "run typecheck" "test"
  [[ "$(sed -n 3p "$NPM_LOG")" == "$NPM_CI|$tip|$lock" ]] || fail "dependencies were not reinstalled on the rebased tree"
  expect_output "dependency manifests changed upstream; reinstalling before re-validation"
  expect_clean_teardown
}

# (f) No race: the first push lands and nothing is validated twice.
case_no_race() {
  setup_case no_race
  run_collector
  expect_status 0
  expect_history "$(subject_of main)" "fixture: seed"
  expect_collector_tip
  expect_npm_calls "$NPM_CI" "run data:refresh"
  expect_output "pushed refreshed data on attempt 1/3"
  expect_no_output "was rejected"
  expect_clean_teardown
}

# (g) The push landed but the client saw an error: never push twice.
case_lost_ack() {
  setup_case lost_ack
  run_collector FAKE_PUSH_FAULT=lost-ack
  expect_status 0
  expect_history "$(subject_of main)" "fixture: seed"
  expect_collector_tip
  expect_npm_calls "$NPM_CI" "run data:refresh"
  expect_output "already contains this data commit; attempt 1 landed"
  expect_no_output "push attempt 2/3"
  expect_clean_teardown
}

# (h) A rejection without any upstream movement: retry the same commit.
case_transient_rejection() {
  setup_case transient_rejection
  run_collector FAKE_PUSH_FAULT=transient
  expect_status 0
  expect_history "$(subject_of main)" "fixture: seed"
  expect_collector_tip
  expect_npm_calls "$NPM_CI" "run data:refresh"
  expect_output "has not moved, so this was not a race; retrying the validated commit unchanged"
  expect_output "pushed refreshed data on attempt 2/3"
  expect_no_output "rebasing the data commit"
  expect_clean_teardown
}

# (i) origin/main was rewritten so it no longer contains the build base.
case_rewritten_history() {
  setup_case rewritten_history
  run_collector FAKE_RACE_PATH="$WIRE_FILE" FAKE_RACE_MODE=rewrite
  expect_status 1
  expect_history "fixture: rewritten history 1"
  expect_npm_calls "$NPM_CI" "run data:refresh"
  expect_output "no longer descends from build base $SEED_COMMIT; nothing pushed"
  expect_no_receipt
  expect_clean_teardown
}

ALL_CASES=(
  wire_race
  collector_path_race
  revalidation_fails
  push_cap
  lockfile_race
  no_race
  lost_ack
  transient_rejection
  rewritten_history
)
if [[ "$#" -gt 0 ]]; then
  SELECTED=("$@")
else
  SELECTED=("${ALL_CASES[@]}")
fi
for name in "${SELECTED[@]}"; do
  declare -F "case_$name" >/dev/null || { echo "unknown case: $name" >&2; exit 2; }
  "case_$name"
  echo "ok - $name"
done

echo "NarcoScope collector push-race tests passed"
