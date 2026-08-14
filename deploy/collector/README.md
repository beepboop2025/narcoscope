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
is included.

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
cat /var/lib/narcoscope-collector/last-failure.json   # local failure receipt
systemctl disable --now narcoscope-collector.timer    # stop 24/7 collection
```

If an older collector has already left `/opt/narcoscope` dirty, disable the
timer and archive the entire checkout plus `git status` and a binary diff before
recovery. Do not run the older script again: its startup reset discards the
failed generated state. Install this version only from a clean checkout after
the archived copy has been hashed and retained. For a controlled first run, use
`NARCOSCOPE_ENABLE_TIMER=0 bash deploy/collector/install.sh`, start the service
once manually, inspect the journal and remote diff, then enable the timer.

Cadence is daily at 05:17 UTC (`.timer`); most sources are monthly/annual, OFAC
is continuous. Change `OnCalendar` in the timer to go more often.
