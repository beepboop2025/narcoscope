# Quarterly data proposals

This trusted Railway controller runs the existing Node 20 `npm ci` and
`scripts/pipeline/run.mjs` fetch, transform, TypeScript and dataset-integrity
validation path. It proposes only the data paths previously allowed by
`.github/workflows/data-refresh.yml`. It neither writes main nor publishes data.

Deploy only reviewed signed contents of this directory, disconnected from source
autodeployment, with one replica, restart policy NEVER, no public endpoint and a
durable volume mounted at `/data`. The quarterly schedule is
`0 6 1 1,4,7,10 *` (UTC). A manual dry run needs
no credentials; `QUARTERLY_APPLY=1` additionally requires `GITHUB_DEPLOY_KEY` for
this repository and the owner's existing `GITHUB_TOKEN` for draft PR creation.
Both credentials stay in the root controller. The candidate gets a clean
environment, closed inherited descriptors, UID/GID 65532 and no_new_privs.
Authenticated API redirects are rejected. `assemble.py` verifies the exact
commit against an explicitly supplied trusted SSH allowed-signers file and
materializes only fixed Git blobs. The image and runtime verify its source and
per-file manifest before executing the controller.

Source code remains root-owned. Only data outputs and disposable dependency/raw
directories are writable. All candidate processes are killed before the
controller rejects links, changed code, removed files and outputs outside the
reviewed paths, then constructs a Git tree directly from the accepted bytes.
The current main must still match the tested source before any push.

Proposals use `data-refresh/railway-YYYY-qN`. An existing open proposal is left for
review; an empty expected-ref lease permits only atomic creation of a missing
branch. The controller never replaces an existing branch, merges a PR, or
modifies repository permissions. A branch left without a PR after an API
failure is an explicit recovery condition. A source, parser or data-validation
failure produces no proposal. Manual and API-key source classes remain excluded
by the existing pipeline. Native CI and Registry publication keep their separate
gates; this job cannot claim publication rights or release authority.

The global-market collectors retain private source bytes and receipts under
`/data/narcoscope-global-markets`; `NARCOSCOPE_MARKET_STATE_DIR` can override the
path, but a deployed controller requires it to be on a mounted volume. The root
controller creates this dedicated directory with mode 0700 and assigns it to
the unprivileged collector UID/GID 65532. The candidate receives the path, never
publisher credentials. The cache must stay separate from controller source,
credentials and disposable candidate checkouts. Only the two global-market
datasets and their catalog are added to the exact generated-file allowlist;
raw captures and refresh receipts cannot enter a proposal.

The shared coordinator checks a seven-day acquisition interval and a one-day
retry interval. This does not make a quarterly schedule run weekly: the daily
Hetzner collector applies the weekly limit on each daily run, while this
controller refreshes when its own quarterly or manual invocation is eligible.
Network failures retain a valid, explicitly dated old snapshot and write a
private failed-acquisition receipt. Parser, hash and validation failures still
prevent a proposal. Offline replay preserves original clocks.

To activate changes to this controller, assemble a new image from the reviewed
signed commit using `assemble.py` and the existing trusted signers file, run the
image's Linux isolation tests, attach the `/data` volume, and deploy that exact
assembly. Updating ordinary application source alone does not update the pinned
controller. The image already supplies Python 3 and Node for these collectors.
