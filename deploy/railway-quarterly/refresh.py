"""Propose validated quarterly data changes without publishing to main."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import resource
import signal
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request

from isolation import (COLLECTOR_UID, CONTROLLER, digest, drop_privileges, event,
                       git, publisher_environment, read_regular, stop_collectors)

REPOSITORY = "beepboop2025/narcoscope"
REMOTE = "https://github.com/" + REPOSITORY + ".git"
MAX_TREE_BYTES = 512 * 1024 * 1024
DISPOSABLE = {"node_modules", "data-raw"}
CONTROLLER_FILES = ("Dockerfile", "refresh.py", "isolation.py", "test_refresh.py", "github-known-hosts")
PUBLIC_FILES = {
    "public/data/narcoscope-palimpsest-v1.json",
    "public/data/narcoscope-palimpsest-corridors-v2.json",
    "public/data/narcoscope-palimpsest-bri-v1.json",
    "public/data/narcoscope-palimpsest-bri-v1.json.sha256",
    "public/data/global-arms-economy-v1.json",
    "public/data/global-drugs-v1.json",
    "public/data/global-market-catalog-v1.json",
}


def prepare_market_state(directory=None, require_mount=False):
    """A dedicated, non-secret cache persists beyond candidate checkout removal."""
    state = Path(directory or os.getenv("NARCOSCOPE_MARKET_STATE_DIR", "/data/narcoscope-global-markets"))
    if not state.is_absolute() or state == Path("/") or ".." in state.parts:
        raise ValueError("Unsafe global-market state directory")
    if any(parent.is_symlink() for parent in (state, *state.parents)):
        raise ValueError("Global-market state path contains a symbolic link")
    resolved = state.resolve()
    if resolved == CONTROLLER or CONTROLLER in resolved.parents:
        raise ValueError("Global-market state must remain outside the controller")
    if require_mount and not any(parent != Path("/") and parent.is_mount()
                                 for parent in (state, *state.parents)):
        raise ValueError("Global-market state requires a mounted durable volume")
    state.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    state.mkdir(exist_ok=True, mode=0o700)
    if not state.is_dir():
        raise ValueError("Global-market state is not a directory")
    os.chown(state, COLLECTOR_UID, COLLECTOR_UID)
    state.chmod(0o700)
    return state


def controller_digest():
    return digest(b"".join(name.encode() + b"\0" + (CONTROLLER / name).read_bytes()
                           for name in CONTROLLER_FILES))


def verify_controller():
    manifest = json.loads(read_regular(CONTROLLER / "manifest.json"))
    if (manifest.get("schema") != 1 or manifest.get("repository") != REPOSITORY or
            not re.fullmatch(r"[a-f0-9]{40}", manifest.get("source_commit", "")) or
            set(manifest.get("files", {})) != set(CONTROLLER_FILES)):
        raise ValueError("Invalid controller manifest")
    for name, expected in manifest["files"].items():
        if digest(read_regular(CONTROLLER / name)) != expected:
            raise ValueError("Controller bytes differ from signed assembly")
    return manifest["source_commit"]


def allowed_output(name):
    # The legacy workflow's data paths, restricted to ordinary visible files.
    return name in PUBLIC_FILES or re.fullmatch(
        r"(?:src/data|public/news)/[a-zA-Z0-9][a-zA-Z0-9._/-]*\.(?:json|ts|html|xml|csv)", name
    ) is not None and all(part not in {".", ".."} and not part.startswith(".")
                         for part in Path(name).parts)


def quarter_branch(now):
    return f"data-refresh/railway-{now.year}-q{(now.month - 1) // 3 + 1}"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        raise urllib.error.HTTPError(request.full_url, code, "Authenticated redirects refused", headers, fp)


class GitHub:
    def __init__(self, token):
        self.token = token

    def request(self, path, method="GET", body=None):
        if path != "/user" and not path.startswith("/repos/" + REPOSITORY + "/"):
            raise ValueError("API request is outside the fixed repository")
        request = urllib.request.Request("https://api.github.com" + path, method=method,
            data=None if body is None else json.dumps(body).encode(), headers={
                "Authorization": "Bearer " + self.token,
                "Accept": "application/vnd.github+json", "Content-Type": "application/json",
                "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "narcoscope-quarterly-railway"})
        try:
            with urllib.request.build_opener(NoRedirect()).open(request, timeout=30) as response:
                raw = response.read(2 * 1024 * 1024 + 1)
        except urllib.error.HTTPError as error:
            error.close()
            raise RuntimeError(f"GitHub {method} {path}: HTTP {error.code}") from None
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError("GitHub response exceeds limit")
        return json.loads(raw) if raw else None

    def pending(self, branch):
        if self.request("/user")["login"] != "beepboop2025":
            raise ValueError("Unexpected GitHub owner credential")
        query = urllib.parse.urlencode({"state": "open", "base": "main",
                                        "head": "beepboop2025:" + branch, "per_page": 100})
        pulls = self.request("/repos/" + REPOSITORY + "/pulls?" + query)
        if not isinstance(pulls, list) or len(pulls) > 1:
            raise ValueError("Ambiguous quarterly proposal")
        for pull in pulls:
            if (pull["head"]["ref"] != branch or pull["base"]["ref"] != "main" or
                    pull["head"]["repo"]["full_name"] != REPOSITORY or
                    pull["base"]["repo"]["full_name"] != REPOSITORY):
                raise ValueError("Quarterly proposal repository mismatch")
        return pulls[0] if pulls else None


def checkout(mirror, env, source, work):
    baseline, total = {}, 0
    entries = git(mirror, env, "ls-tree", "-rz", "--full-tree", source).split(b"\0")
    for entry in entries:
        if not entry:
            continue
        header, raw = entry.split(b"\t", 1)
        mode, kind, blob = header.decode().split()
        name = raw.decode("utf-8")
        relative = Path(name)
        if (relative.is_absolute() or any(p in {"..", ".git"} for p in relative.parts) or
                relative.parts[0] in DISPOSABLE or mode not in {"100644", "100755"} or kind != "blob"):
            raise ValueError("Unsafe source object")
        content = git(mirror, env, "cat-file", "blob", blob)
        total += len(content)
        if total > MAX_TREE_BYTES:
            raise ValueError("Source tree exceeds limit")
        path = work / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        # Ownership protects source from the candidate. Ordinary Git modes let
        # tests copy a fixture and then mutate their own copy (Node preserves
        # mode bits during fs.cp); 0444 would make those copies unwritable too.
        path.chmod(0o755 if mode == "100755" else 0o644)
        baseline[name] = digest(content)
        if allowed_output(name):
            os.chown(path, COLLECTOR_UID, COLLECTOR_UID)
            path.chmod(0o644)
            path.parent.chmod(0o1777)
    for name in DISPOSABLE:
        path = work / name
        path.mkdir(mode=0o755)
        os.chown(path, COLLECTOR_UID, COLLECTOR_UID)
    # The newsroom swaps its complete directory atomically. A root-owned sticky
    # parent permits its staging directory while protecting all other public
    # contracts; only the reviewed news directory belongs to the writer.
    (work / "public").chmod(0o1777)
    os.chown(work / "public/news", COLLECTOR_UID, COLLECTOR_UID)
    return baseline


def run_step(work, scratch, args, timeout, market_state=None):
    scratch.mkdir(mode=0o700)
    os.chown(scratch, COLLECTOR_UID, COLLECTOR_UID)
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(scratch), "TMPDIR": str(scratch),
           "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
           "GIT_TERMINAL_PROMPT": "0", "NODE_OPTIONS": "--max-old-space-size=3072",
           "PYTHONDONTWRITEBYTECODE": "1"}
    if market_state is not None:
        if not market_state.is_absolute() or market_state == work or work in market_state.parents:
            raise ValueError("Private market state cannot be a disposable candidate path")
        env["NARCOSCOPE_MARKET_STATE_DIR"] = str(market_state)
    process = subprocess.Popen(args, cwd=work, env=env, stdin=subprocess.DEVNULL,
        close_fds=True, preexec_fn=drop_privileges, start_new_session=True)
    try:
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            raise RuntimeError("Quarterly step exceeded deadline") from None
        if code:
            raise RuntimeError(f"Quarterly step failed with exit {code}")
    finally:
        stop_collectors()


def validate_outputs(work, baseline):
    seen, changed, total = set(), {}, 0
    for directory, dirs, files in os.walk(work, followlinks=False):
        base = Path(directory)
        if base == work:
            dirs[:] = [name for name in dirs if name not in DISPOSABLE]
        for name in dirs:
            if (base / name).is_symlink():
                raise ValueError("Symbolic output directory")
        for leaf in files:
            path = base / leaf
            name = path.relative_to(work).as_posix()
            content = read_regular(path)
            total += len(content)
            if total > MAX_TREE_BYTES:
                raise ValueError("Output tree exceeds limit")
            seen.add(name)
            if digest(content) != baseline.get(name):
                if not allowed_output(name):
                    raise ValueError("Unapproved changed output: " + name)
                if name.endswith(".json"):
                    def nonfinite(value):
                        raise ValueError("Nonfinite output JSON")
                    if not isinstance(json.loads(content, parse_constant=nonfinite), (dict, list)):
                        raise ValueError("Invalid output JSON envelope")
                changed[name] = content
    if not set(baseline).issubset(seen):
        raise ValueError("Source files were removed")
    return changed


def propose(mirror, env, source, changed, branch, api, deployment, apply):
    if not re.fullmatch(r"data-refresh/railway-[0-9]{4}-q[1-4]", branch):
        raise ValueError("Only the quarterly review branch is permitted")
    current = git(mirror, env, "ls-remote", "origin", "refs/heads/main").decode().split()[0]
    if current != source:
        raise ValueError("Main advanced; refresh and validate again")
    if not changed:
        event("RAILWAY_QUARTERLY_UNCHANGED", source=source, deployment=deployment)
        return None
    index_env = {**env, "GIT_INDEX_FILE": str(mirror.parent / "proposal-index")}
    git(mirror, index_env, "read-tree", source)
    for name, content in sorted(changed.items()):
        if not allowed_output(name):
            raise ValueError("Unapproved proposal path")
        blob = git(mirror, env, "hash-object", "-w", "--stdin", data=content).decode().strip()
        git(mirror, index_env, "update-index", "--add", "--cacheinfo", f"100644,{blob},{name}")
    tree = git(mirror, index_env, "write-tree").decode().strip()
    message = ("data: propose quarterly open-source refresh\n\n"
               f"Collection-Source: {source}\nRailway-Deployment: {deployment}\n"
               f"Quarterly-Controller: {controller_digest()}\n")
    commit = git(mirror, env, "commit-tree", tree, "-p", source, data=message.encode()).decode().strip()
    paths = git(mirror, env, "diff-tree", "--no-commit-id", "--name-only", "-r", commit).decode().splitlines()
    if set(paths) != set(changed):
        raise ValueError("Proposal differs from validated bytes")
    event("quarterly_proposal", source=source, commit=commit, branch=branch, paths=paths, apply=apply)
    if not apply:
        return commit
    if git(mirror, env, "ls-remote", "origin", "refs/heads/" + branch).strip():
        raise ValueError("Quarterly branch already exists; refusing to replace it")
    if git(mirror, env, "ls-remote", "origin", "refs/heads/main").decode().split()[0] != source:
        raise ValueError("Main advanced immediately before proposal push")
    # An empty expected ref is an atomic create-only condition. Even a branch
    # created after ls-remote cannot be overwritten or fast-forwarded here.
    git(mirror, env, "push", f"--force-with-lease=refs/heads/{branch}:",
        "git@github.com:" + REPOSITORY + ".git", f"{commit}:refs/heads/{branch}")
    body = (f"Quarterly proposal generated from `{source}` by the isolated Railway controller.\n\n"
            "The existing open-data fetch, transform, TypeScript and dataset-integrity tests passed. "
            "Review the data and source changes before merging; this job does not publish or merge.\n\n"
            f"Controller: `{controller_digest()}`\nDeployment: `{deployment}`\n")
    pull = api.request("/repos/" + REPOSITORY + "/pulls", "POST", {
        "title": "Automated quarterly data refresh", "head": branch, "base": "main",
        "body": body, "draft": True, "maintainer_can_modify": False})
    if pull["head"]["sha"] != commit or pull["base"]["repo"]["full_name"] != REPOSITORY:
        raise ValueError("Created proposal identity mismatch")
    event("RAILWAY_QUARTERLY_PROPOSAL_PASS", source=source, commit=commit,
          pull_request=pull["number"], deployment=deployment)
    return commit


def main():
    if os.geteuid() != 0:
        raise RuntimeError("Controller requires root; candidate runs as separate UID")
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    controller_source = verify_controller()
    apply = os.getenv("QUARTERLY_APPLY") == "1"
    token = os.environ.pop("GITHUB_TOKEN", "")
    key = os.environ.pop("GITHUB_DEPLOY_KEY", "")
    deployment = os.getenv("RAILWAY_DEPLOYMENT_ID", "local")
    branch = quarter_branch(datetime.now(timezone.utc))
    api = GitHub(token) if apply else None
    if apply:
        if not key or not token:
            raise ValueError("Proposal credentials are missing")
        pending = api.pending(branch)
        if pending:
            event("RAILWAY_QUARTERLY_PENDING_REVIEW", pull_request=pending["number"],
                  source=pending["head"]["sha"], deployment=deployment)
            return 0
    market_state = prepare_market_state(require_mount=deployment != "local")
    with tempfile.TemporaryDirectory(prefix="quarterly-private-") as private, \
            tempfile.TemporaryDirectory(prefix="quarterly-candidate-") as public:
        private_root, public_root = Path(private), Path(public)
        public_root.chmod(0o755)
        env = publisher_environment(private_root, key) if apply else {
            "PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(private_root),
            "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0"}
        env.update(GIT_AUTHOR_NAME="narcoscope-data-bot", GIT_COMMITTER_NAME="narcoscope-data-bot",
                   GIT_AUTHOR_EMAIL="data-bot@users.noreply.github.com",
                   GIT_COMMITTER_EMAIL="data-bot@users.noreply.github.com")
        del key, token
        mirror = private_root / "repository.git"
        git(None, env, "clone", "--bare", "--single-branch", "--depth=1", "--branch", "main", REMOTE, str(mirror))
        source = git(mirror, env, "rev-parse", "refs/heads/main").decode().strip()
        if not re.fullmatch(r"[a-f0-9]{40}", source):
            raise ValueError("Invalid main identity")
        work = public_root / "repo"
        work.mkdir(mode=0o755)
        baseline = checkout(mirror, env, source, work)
        event("quarterly_start", source=source, deployment=deployment,
              controller=controller_digest(), controller_source=controller_source)
        run_step(work, public_root / "npm", ["npm", "ci"], 300)
        run_step(work, public_root / "pipeline", ["node", "scripts/pipeline/run.mjs"], 1500,
                 market_state=market_state)
        changed = validate_outputs(work, baseline)
        commit = propose(mirror, env, source, changed, branch, api, deployment, apply)
        if not apply:
            event("RAILWAY_QUARTERLY_DRY_RUN_PASS", source=source, commit=commit,
                  changed_files=len(changed), deployment=deployment, controller=controller_digest())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
