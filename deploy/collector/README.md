# NarcoScope 24/7 data collector (Hetzner)

Keeps the live site's data fresh by running the open-data pipeline on a schedule
and pushing validated changes, which trigger a Vercel redeploy.

## What it does, each run

1. Resets to current `origin/main`.
2. `npm ci` (no-op when the lockfile is unchanged).
3. `npm run data:refresh` — fetches every automatable public source (UNODC WDR
   annexes, World Bank GDP, CDC VSRR overdose, OFAC SDN, Statistics Canada
   wastewater), regenerates the bundled datasets **and the Overview summary**,
   then runs `tsc` + the full test suite as a **hard validation gate**.
4. If `src/data` changed *and* validation passed, commits and pushes to `main`.
   Otherwise pushes nothing.

Bad or malformed upstream data fails the test gate and is never pushed. The one
residual risk — a source silently changing format in a way that still passes the
integrity tests — is why the dataset-integrity tests are conservative; extend
them when adding a source.

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

## Operate

```bash
systemctl start narcoscope-collector.service          # run now
journalctl -u narcoscope-collector -f                 # watch
systemctl list-timers narcoscope-collector.timer      # when next
systemctl disable --now narcoscope-collector.timer    # stop 24/7 collection
```

Cadence is daily at 05:17 UTC (`.timer`); most sources are monthly/annual, OFAC
is continuous. Change `OnCalendar` in the timer to go more often.
