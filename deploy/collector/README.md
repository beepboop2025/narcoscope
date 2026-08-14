# NarcoScope 24/7 data collector (Hetzner)

Keeps the live site's data fresh by running the open-data pipeline on a schedule
and pushing validated changes, which trigger a Vercel redeploy.

## Production topology

```text
narcoscope.com ──► Vercel project `narcoscope.io` ──► static app + newsroom
                         ▲
                         │ deploy on validated main push
                         │
Hetzner `ubuntu-8gb-fsn1-2` ──► GitHub main
        daily collector only · Palimpsest.info project
```

The public domain does **not** point at the collector. The collector has no web
service and needs no inbound port other than SSH; it fetches public datasets,
validates the full repository, and pushes only an accepted refresh. This keeps a
bad upstream file away from both Git and production.

Current production is already on Hetzner: `narcoscope-collector.timer` is enabled
and active on `ubuntu-8gb-fsn1-2` in the **Palimpsest.info** project. Its accepted
state lives in Git and the public site remains stateless. Split NarcoScope into a
dedicated project/server only when it gains a database, analyst-only data, or a
resource-isolation requirement; the present collector does not justify a second
billable server.

## What it does, each run

1. Fetches current `origin/main` and creates a detached worktree under
   `/var/tmp`. The service checkout is never reset or cleaned.
2. `npm ci` inside that worktree, reusing npm's download cache where possible.
3. `npm run data:refresh` fetches every automatable public source (UNODC WDR
   annexes, World Bank GDP, CDC VSRR overdose, OFAC SDN, Statistics Canada
   wastewater), regenerates the bundled datasets **and the Overview summary**,
   then runs `tsc` plus the full test suite as a **hard validation gate**.
4. If `src/data` or its derived public Palimpsest artifact changed *and*
   validation passed, commits them together and pushes to `main`. Otherwise
   pushes nothing.
5. Removes the detached worktree on success, validation failure, or termination.

Bad or malformed upstream data fails the test gate and is never pushed. The one
residual risk is a source silently changing format in a way that still passes the
integrity tests, which is why the dataset-integrity tests are conservative; extend
them when adding a source.

A failed run triggers `narcoscope-collector-alert.service`. It atomically writes
`/var/lib/narcoscope-collector/last-failure.json` even when no external alert
destination is configured. If a root-only environment file supplies an HTTPS
webhook, the same bounded receipt is posted there. It contains only the service
name, failure time, and a prompt to check the journal. No dataset or credential
is included. `last-failure.json` is intentionally historical and is not cleared.
Monitor `/var/lib/narcoscope-collector/status.json` for current health instead.
Every accepted run atomically changes that receipt to `status: "ok"` and writes
`last-success.json`; a failed run changes it to `status: "failed"`.

The systemd oneshot unit serializes timer and manual service starts. The script
also holds an atomic runtime lock, so a direct shell invocation cannot race the
unit. A colliding run exits with status 75 before fetching or generating data.
The final Git push is non-forced, so it is rejected if `origin/main` advances
after the collector fetches it. If a process is killed without running its exit
trap, `/run/lock/narcoscope-collector` remains as a fail-closed lock. Confirm no
collector process is alive before removing it; `/run` is cleared on reboot.

## One-time provisioning (as root on the box)

```bash
# 1. Node (LTS) via nodesource, plus unzip (StatCan converter needs it)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs unzip

# 2. Clone
git clone https://github.com/beepboop2025/narcoscope.git /opt/narcoscope

# 3. Deploy key (write access) — generate on the box, add the .pub to the repo:
ssh-keygen -t ed25519 -N '' -f /root/.ssh/narcoscope_deploy -C narcoscope-collector
cat /root/.ssh/narcoscope_deploy.pub
#   → add at github.com/beepboop2025/narcoscope → Settings → Deploy keys
#     ("Allow write access" ON), or via: gh repo deploy-key add ... (from a
#     machine with gh auth). Point the clone's remote at SSH:
git -C /opt/narcoscope remote set-url origin git@github.com:beepboop2025/narcoscope.git

# 4. Install the timer
bash /opt/narcoscope/deploy/collector/install.sh
```

### Optional external failure alert

The local failure receipt and journal alert work without configuration. To add
an external webhook, create `/etc/narcoscope/collector-alert.env` as root:

```bash
install -d -m 0700 /etc/narcoscope
install -m 0600 /dev/null /etc/narcoscope/collector-alert.env
# Add one line with the real destination. Do not commit it:
# NARCOSCOPE_ALERT_WEBHOOK_URL=https://alerts.example.invalid/private-path
```

The alert helper rejects non-HTTPS destinations, bounds connection and total
time, and never prints the configured URL.

## Operate

```bash
systemctl start narcoscope-collector.service          # run now
journalctl -u narcoscope-collector -f                 # watch
systemctl list-timers narcoscope-collector.timer      # when next
systemctl status narcoscope-collector-alert.service   # last alert delivery
cat /var/lib/narcoscope-collector/status.json         # current health receipt
cat /var/lib/narcoscope-collector/last-failure.json   # historical failure
cat /var/lib/narcoscope-collector/last-success.json   # last resolution
systemctl disable --now narcoscope-collector.timer    # stop 24/7 collection
```

### Recover a dirty service checkout

Do not pull, reset, clean, or install in place when an older collector has left
`/opt/narcoscope` dirty. The following procedure preserves the entire failed
checkout, including untracked files, and binds replacement code to one reviewed
commit already present on `origin/main`.

First set `NARCOSCOPE_APPROVED_SHA` to the full 40-character reviewed main SHA.
Run as root on the collector host:

```bash
set -euo pipefail
NARCOSCOPE_APPROVED_SHA='<full reviewed origin/main SHA>'
[[ "$NARCOSCOPE_APPROVED_SHA" =~ ^[0-9a-f]{40}$ ]]

systemctl disable --now narcoscope-collector.timer
systemctl stop narcoscope-collector.service
! systemctl is-active --quiet narcoscope-collector.service

NARCOSCOPE_RECOVERY_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NARCOSCOPE_EVIDENCE_DIR="/var/backups/narcoscope/${NARCOSCOPE_RECOVERY_STAMP}"
NARCOSCOPE_CANDIDATE="/opt/narcoscope.candidate-${NARCOSCOPE_RECOVERY_STAMP}"
NARCOSCOPE_RETAINED="/opt/narcoscope.failed-${NARCOSCOPE_RECOVERY_STAMP}"
install -d -m 0700 "$NARCOSCOPE_EVIDENCE_DIR"

git -C /opt/narcoscope status --porcelain=v1 -uall \
  > "$NARCOSCOPE_EVIDENCE_DIR/status.txt"
git -C /opt/narcoscope diff --binary HEAD \
  > "$NARCOSCOPE_EVIDENCE_DIR/tracked.patch"
git -C /opt/narcoscope rev-parse HEAD \
  > "$NARCOSCOPE_EVIDENCE_DIR/original-head.txt"
tar --acls --xattrs -C /opt -cpf \
  "$NARCOSCOPE_EVIDENCE_DIR/checkout.tar" narcoscope
sha256sum "$NARCOSCOPE_EVIDENCE_DIR/checkout.tar" \
  > "$NARCOSCOPE_EVIDENCE_DIR/checkout.tar.sha256"

git clone git@github.com:beepboop2025/narcoscope.git "$NARCOSCOPE_CANDIDATE"
test "$(git -C "$NARCOSCOPE_CANDIDATE" rev-parse origin/main)" = "$NARCOSCOPE_APPROVED_SHA"
git -C "$NARCOSCOPE_CANDIDATE" checkout --detach "$NARCOSCOPE_APPROVED_SHA"
test "$(git -C "$NARCOSCOPE_CANDIDATE" rev-parse HEAD)" = "$NARCOSCOPE_APPROVED_SHA"
test -z "$(git -C "$NARCOSCOPE_CANDIDATE" status --porcelain=v1 -uall)"
npm --prefix "$NARCOSCOPE_CANDIDATE" ci --no-audit --no-fund
npm --prefix "$NARCOSCOPE_CANDIDATE" test -- --reporter=default
npm --prefix "$NARCOSCOPE_CANDIDATE" run build

mv -- /opt/narcoscope "$NARCOSCOPE_RETAINED"
if ! mv -- "$NARCOSCOPE_CANDIDATE" /opt/narcoscope; then
  mv -- "$NARCOSCOPE_RETAINED" /opt/narcoscope
  exit 1
fi
NARCOSCOPE_ENABLE_TIMER=0 bash /opt/narcoscope/deploy/collector/install.sh
test "$(git -C /opt/narcoscope ls-remote origin refs/heads/main | cut -f1)" \
  = "$NARCOSCOPE_APPROVED_SHA"
systemctl start narcoscope-collector.service
journalctl -u narcoscope-collector.service --since today --no-pager
cat /var/lib/narcoscope-collector/status.json
git -C /opt/narcoscope ls-remote origin refs/heads/main
systemctl enable --now narcoscope-collector.timer
```

Do not remove the retained checkout or hashed archive until the recovered run,
its exact remote commit, and the resulting deployment have been reviewed. If
the controlled run fails, leave the timer disabled and inspect the current
status receipt and journal. This sequence never overlays code onto the dirty
checkout and never assumes its branch can fast-forward safely.

Cadence is daily at 05:17 UTC (`.timer`); most sources are monthly/annual, OFAC
is continuous. Change `OnCalendar` in the timer to go more often.
