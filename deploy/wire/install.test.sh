#!/usr/bin/env bash
set -euo pipefail

WIRE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$WIRE_DIR/../.." && pwd)"
INSTALLER="$WIRE_DIR/install.sh"
TIMER_FILE="$WIRE_DIR/narcoscope-wire.timer"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/narcoscope-wire-install.XXXXXX")"

cleanup() {
  find "$TEST_ROOT" -depth -delete 2>/dev/null || true
}
trap cleanup EXIT

MOCK_BIN="$TEST_ROOT/bin"
SYSTEMCTL_LOG="$TEST_ROOT/systemctl.log"
INSTALL_LOG="$TEST_ROOT/install.log"
mkdir -p "$MOCK_BIN"

cat > "$MOCK_BIN/install" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf 'install' >> "$MOCK_INSTALL_LOG"
printf ' %s' "$@" >> "$MOCK_INSTALL_LOG"
printf '\n' >> "$MOCK_INSTALL_LOG"
SH

cat > "$MOCK_BIN/systemctl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
command_name="${1:-}"
shift || true
printf '%s' "$command_name" >> "$MOCK_SYSTEMCTL_LOG"
printf ' %s' "$@" >> "$MOCK_SYSTEMCTL_LOG"
printf '\n' >> "$MOCK_SYSTEMCTL_LOG"

case "$command_name" in
  daemon-reload|enable|restart|disable)
    exit 0
    ;;
  is-enabled)
    [[ "${MOCK_TIMER_ENABLED:-1}" = "1" ]]
    ;;
  show)
    property=""
    for argument in "$@"; do
      case "$argument" in
        --property=*) property="${argument#--property=}" ;;
      esac
    done
    case "$property" in
      ActiveState) printf '%s\n' "${MOCK_ACTIVE_STATE:-active}" ;;
      SubState) printf '%s\n' "${MOCK_SUB_STATE:-waiting}" ;;
      NextElapseUSecRealtime) printf '%s\n' "${MOCK_NEXT_REALTIME:-}" ;;
      NextElapseUSecMonotonic) printf '%s\n' "${MOCK_NEXT_MONOTONIC:-2min 59s}" ;;
      *) echo "unexpected systemctl show property: $property" >&2; exit 90 ;;
    esac
    ;;
  list-timers)
    printf 'finite 3min - - narcoscope-wire.timer narcoscope-wire.service\n'
    printf 'mock timer output line 2\n'
    printf 'mock timer output line 3\n'
    printf 'mock timer output tail\n'
    ;;
  *)
    echo "unexpected systemctl command: $command_name" >&2
    exit 91
    ;;
esac
SH
chmod 0755 "$MOCK_BIN/install" "$MOCK_BIN/systemctl"

run_installer() {
  env \
    PATH="$MOCK_BIN:$PATH" \
    MOCK_INSTALL_LOG="$INSTALL_LOG" \
    MOCK_SYSTEMCTL_LOG="$SYSTEMCTL_LOG" \
    NARCOSCOPE_REPO="$REPO" \
    NARCOSCOPE_WIRE_PUBLIC_DIR="$TEST_ROOT/public" \
    "$@" \
    bash "$INSTALLER"
}

grep -Fxq 'OnActiveSec=3min' "$TIMER_FILE"
grep -Fxq 'OnUnitActiveSec=10min' "$TIMER_FILE"
if grep -Eq '^OnBootSec=' "$TIMER_FILE"; then
  echo "ERROR: the wire timer still uses the already-elapsed host boot clock" >&2
  exit 10
fi

: > "$SYSTEMCTL_LOG"
: > "$INSTALL_LOG"
if ! run_installer \
  MOCK_ACTIVE_STATE=active \
  MOCK_SUB_STATE=waiting \
  MOCK_NEXT_REALTIME= \
  MOCK_NEXT_MONOTONIC='2min 59s' \
  NARCOSCOPE_WIRE_ENABLE_TIMER=1 > "$TEST_ROOT/waiting.out"; then
  echo "ERROR: armed timer installation failed under pipefail" >&2
  exit 11
fi

ENABLE_LINE="$(grep -nFx 'enable narcoscope-wire.timer' "$SYSTEMCTL_LOG" | cut -d: -f1)"
RESTART_LINE="$(grep -nFx 'restart narcoscope-wire.timer' "$SYSTEMCTL_LOG" | cut -d: -f1)"
SHOW_LINE="$(grep -n 'show narcoscope-wire.timer --property=ActiveState --value' "$SYSTEMCTL_LOG" | cut -d: -f1)"
[[ -n "$ENABLE_LINE" && -n "$RESTART_LINE" && -n "$SHOW_LINE" ]]
[[ "$ENABLE_LINE" -lt "$RESTART_LINE" && "$RESTART_LINE" -lt "$SHOW_LINE" ]]
grep -Fxq 'list-timers narcoscope-wire.timer --no-pager --no-legend' "$SYSTEMCTL_LOG"
grep -Fxq 'mock timer output tail' "$TEST_ROOT/waiting.out"

: > "$SYSTEMCTL_LOG"
if run_installer \
  MOCK_ACTIVE_STATE=active \
  MOCK_SUB_STATE=elapsed \
  MOCK_NEXT_REALTIME= \
  MOCK_NEXT_MONOTONIC=infinity \
  NARCOSCOPE_WIRE_ENABLE_TIMER=1 \
  > "$TEST_ROOT/elapsed.out" 2> "$TEST_ROOT/elapsed.err"; then
  echo "ERROR: enabled active(elapsed) timer was accepted" >&2
  exit 20
fi
grep -Fq 'is not armed (active=active sub=elapsed)' "$TEST_ROOT/elapsed.err"
grep -Fxq 'restart narcoscope-wire.timer' "$SYSTEMCTL_LOG"

: > "$SYSTEMCTL_LOG"
if run_installer \
  MOCK_ACTIVE_STATE=active \
  MOCK_SUB_STATE=waiting \
  MOCK_NEXT_REALTIME= \
  MOCK_NEXT_MONOTONIC=infinity \
  NARCOSCOPE_WIRE_ENABLE_TIMER=1 \
  > "$TEST_ROOT/infinite.out" 2> "$TEST_ROOT/infinite.err"; then
  echo "ERROR: enabled waiting timer with no finite trigger was accepted" >&2
  exit 30
fi
grep -Fq 'has no finite next trigger' "$TEST_ROOT/infinite.err"

: > "$SYSTEMCTL_LOG"
run_installer \
  MOCK_ACTIVE_STATE=active \
  MOCK_SUB_STATE=elapsed \
  MOCK_NEXT_MONOTONIC=infinity \
  NARCOSCOPE_WIRE_ENABLE_TIMER=0 > "$TEST_ROOT/disabled.out"
grep -Fxq 'disable --now narcoscope-wire.timer' "$SYSTEMCTL_LOG"
if grep -Eq '^(restart|show|is-enabled) ' "$SYSTEMCTL_LOG"; then
  echo "ERROR: controlled disabled install tried to arm or validate the timer" >&2
  exit 40
fi
grep -Fq 'Installed with timer disabled for a controlled first run.' "$TEST_ROOT/disabled.out"

echo "NarcoScope wire timer install tests passed"
