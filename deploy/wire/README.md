# NarcoScope continuous evidence wire

This is the fast lane beside the daily statistical collector. It checks each
declared public source every ten minutes, performs one bounded GET with no
preflight and no retry, and writes a privacy-minimized metadata artifact plus a
compressed capture history under `/var/lib/narcoscope-wire`.

Capture is always local. Public publication is a separate, opt-in lane: it
compares the candidate with the artifact on the current remote branch while
ignoring heartbeat-only collection clocks. A new isolated commit is pushed only
when public items, legal stages, source states, rights, or nonvolatile receipt
details change. The push is never forced, so a concurrent main-branch advance
fails closed and is retried by the next timer run.

It does **not** turn headlines into atlas facts, copy article bodies, publish
Palimpsest-restricted items, infer countries from names, or join Seiche market
context to people. The browser/API contract displays source rights, failures,
legal stage and all available clocks.

The timer is intentionally light on the shared Hetzner host: 256 MB memory cap,
low CPU/I/O weights, six sources, 2 MB per-response ceiling, 15-second timeout,
and zero retries. A fetch failure preserves the previous publication-allowed
items, marks the source `aging` until its declared stale-after threshold, then
marks it `stale`; a source with no last-good receipt is `unavailable`.

Install after the reviewed release is present at `/opt/narcoscope`:

```bash
bash /opt/narcoscope/deploy/wire/install.sh
systemctl start narcoscope-wire.service
systemctl status narcoscope-wire.service --no-pager
cat /var/lib/narcoscope-wire/status.json
node /opt/narcoscope/scripts/wire/collect.mjs --check \
  --output /var/lib/narcoscope-wire/evidence-wire-v1.json
```

The installed unit defaults to `NARCOSCOPE_WIRE_PUBLISH=0`. After the exact
reviewed release is on `origin/main`, the repository remote uses SSH, the
existing write-enabled deploy key has been owner-authorized for this lane, and
that key's Git host is already pinned in `known_hosts`, enable change-only
publication with a root-only environment file:

```bash
install -d -m 0700 /etc/narcoscope
install -m 0600 /dev/null /etc/narcoscope/wire.env
# Add exactly these reviewed settings:
# NARCOSCOPE_WIRE_PUBLISH=1
# NARCOSCOPE_WIRE_DEPLOY_KEY=/root/.ssh/narcoscope_deploy
# NARCOSCOPE_WIRE_BRANCH=main

systemctl daemon-reload
systemctl start narcoscope-wire.service
cat /var/lib/narcoscope-wire/publication-status.json
git -C /opt/narcoscope ls-remote origin refs/heads/main
systemctl enable --now narcoscope-wire.timer
```

Do not create, copy, or broaden a deploy key merely to satisfy this gate. If the
key, host pin, reviewed release, or non-forced push is unavailable, leave
publication disabled; capture and history continue without pretending that the
public bundle is live.

The compressed snapshots are evidence history, not a public document store.
Back them up with the existing Hetzner backup lane and apply an explicit,
reviewed retention policy before storage pressure requires deletion.
