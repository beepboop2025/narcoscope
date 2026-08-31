# NarcoScope continuous evidence wire

This is the fast lane beside the daily statistical collector. It checks each
declared public source every ten minutes, performs one bounded GET with no
preflight and no retry, and writes a privacy-minimized metadata artifact plus a
compressed capture history under `/var/lib/narcoscope-wire`.

Every completed invocation also atomically replaces the public execution
heartbeat at
`/var/lib/narcoscope-wire-public/narcoscope/wire-heartbeat-v1.json`. Its closed
schema contains only the run status, completion clock, item count, and SHA-256
of the bound sanitized Hetzner capture. A failed invocation retains that
last-good capture count/digest when available and reports `status: failed`; it never
publishes private paths, source content, failure phases, exit codes, or history.
The heartbeat clock is operational evidence that the monitor ran. It does not
advance the wire artifact's generated clock or any source publication/retrieval
clock.

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
cat /var/lib/narcoscope-wire-public/narcoscope/wire-heartbeat-v1.json
node /opt/narcoscope/scripts/wire/collect.mjs --check \
  --output /var/lib/narcoscope-wire/evidence-wire-v1.json
```

## Public heartbeat bridge

The reviewed Caddy handler in `deploy/wire/Caddyfile.heartbeat` is imported
inside the existing `api.seiche.info` HTTPS site **before its terminal catch-all
`handle`**. It uses an exact-path `handle` in that same mutually exclusive
handler group; a top-level `route` is not equivalent because Caddy's directive
ordering can place it after the catch-all even when the import appears first in
the source text. The handler serves exactly one path for `GET`/`HEAD`, returns
405 for other methods on that path, and leaves every other Seiche API route
untouched. It requires no new DNS record or certificate. Do not import it until
the heartbeat exists and both the repository integration test and complete
active Caddyfile validation pass:

```bash
test -s /var/lib/narcoscope-wire-public/narcoscope/wire-heartbeat-v1.json
install -d -m 0755 /etc/caddy/snippets
install -m 0644 /opt/narcoscope/deploy/wire/Caddyfile.heartbeat \
  /etc/caddy/snippets/narcoscope-wire-heartbeat.caddy
# Add this import inside the existing api.seiche.info site block, before its
# catch-all handler:
# import /etc/caddy/snippets/narcoscope-wire-heartbeat.caddy
bash /opt/narcoscope/deploy/wire/caddy.test.sh
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl reload caddy
curl --fail --silent --show-error \
  https://api.seiche.info/narcoscope/wire-heartbeat-v1.json
curl --fail --silent --show-error --head \
  https://api.seiche.info/narcoscope/wire-heartbeat-v1.json
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  --request POST https://api.seiche.info/narcoscope/wire-heartbeat-v1.json)" = 405
```

Use the host's existing reviewed import layout if it differs from the example.
Do not create a second `api.seiche.info` site block, disturb its existing proxy
routes, or replace this handler with a directory server or wildcard proxy.

After the exact source revision reaches Railway, configure the NarcoScope
runtime with all three values and redeploy that source revision once:

```text
NARCOSCOPE_WIRE_HEARTBEAT_URL=https://api.seiche.info/narcoscope/wire-heartbeat-v1.json
NARCOSCOPE_WIRE_HEARTBEAT_ALLOWED_HOSTS=api.seiche.info
NARCOSCOPE_WIRE_HEARTBEAT_TIMEOUT_MS=1500
```

The runtime accepts HTTPS on port 443 only, requires the exact path and an
allowlisted DNS hostname, resolves and pins a public IPv4 address, follows no
redirects, caps the body at 8 KiB, and returns a sanitized same-origin copy at
`/monitor/wire-heartbeat-v1.json`. With the upstream variables unset or invalid,
that route safely returns HTTP 503 and a typed `unavailable` receipt. The static
wire remains last-good and visible; the UI reports monitor availability
separately. Subsequent heartbeat-only changes require no Git commit, image
build, or Railway deployment.

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

Repository verification:

```bash
bash -n deploy/wire/collect.sh deploy/wire/install.sh
shellcheck deploy/wire/collect.sh deploy/wire/install.sh
bash deploy/wire/collect.test.sh
bash deploy/wire/caddy.test.sh
# After importing the exact-path handle before the existing catch-all:
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```
