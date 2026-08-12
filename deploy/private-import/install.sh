#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run as root: bash /opt/narcoscope/deploy/private-import/install.sh" >&2
  exit 77
fi

repo=/opt/narcoscope
command -v node >/dev/null || { echo "ERROR: node is not installed" >&2; exit 1; }
[[ -d "$repo/.git" ]] || { echo "ERROR: NarcoScope is not cloned at $repo" >&2; exit 1; }

getent group intelligence-review >/dev/null 2>&1 || groupadd --system intelligence-review
getent group narcoscope-analyst >/dev/null 2>&1 || groupadd --system narcoscope-analyst
if ! getent passwd narcoscope-analyst >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/narcoscope-analyst \
    --shell /usr/sbin/nologin --gid narcoscope-analyst \
    --groups intelligence-review narcoscope-analyst
else
  usermod --append --groups intelligence-review narcoscope-analyst
fi

install -d -o narcoscope-analyst -g narcoscope-analyst -m 0700 \
  /var/lib/narcoscope-analyst /var/lib/narcoscope-analyst/scamshield
if getent passwd scamshield >/dev/null 2>&1; then
  install -d -o scamshield -g intelligence-review -m 2750 \
    /var/lib/scamshield/handoffs/narcoscope
fi

install -o root -g root -m 0644 \
  "$repo/deploy/private-import/narcoscope-scamshield-import.service" \
  /etc/systemd/system/narcoscope-scamshield-import.service
install -o root -g root -m 0644 \
  "$repo/deploy/private-import/narcoscope-scamshield-import.timer" \
  /etc/systemd/system/narcoscope-scamshield-import.timer
systemctl daemon-reload
systemctl enable --now narcoscope-scamshield-import.timer

input=/var/lib/scamshield/handoffs/narcoscope/scamshield-monitoring-summary.json
if [[ -f "$input" ]]; then
  systemctl start narcoscope-scamshield-import.service
  result="$(systemctl show narcoscope-scamshield-import.service --property=Result --value)"
  [[ "$result" == "success" ]] || {
    echo "Initial ScamShield import did not complete successfully: $result" >&2
    exit 1
  }
  echo "Initial ScamShield private import completed successfully."
else
  echo "Timer enabled; waiting for ScamShield to create the private handoff."
fi
