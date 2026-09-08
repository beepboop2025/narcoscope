"""Tests of the publication boundary and actual Linux credential separation."""

from datetime import datetime, timezone
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

import refresh
import isolation


class BoundaryTests(unittest.TestCase):
    def test_authenticated_redirect_never_reaches_target(self):
        received = []

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                received.append(self.path)
                self.send_response(302)
                self.send_header("Location", "/credential-target")
                self.end_headers()

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/start",
                                             headers={"Authorization": "Bearer fixture"})
            with self.assertRaises(urllib.error.HTTPError) as raised:
                urllib.request.build_opener(refresh.NoRedirect()).open(request, timeout=3)
            raised.exception.close()
            self.assertEqual(received, ["/start"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_controller_manifest_rejects_changed_program(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            files = {name: refresh.digest(b"trusted") for name in refresh.CONTROLLER_FILES}
            for name in files:
                (root / name).write_bytes(b"trusted")
            (root / "manifest.json").write_text(json.dumps({"schema": 1,
                "repository": refresh.REPOSITORY, "source_commit": "a" * 40, "files": files}))
            with patch.object(refresh, "CONTROLLER", root):
                self.assertEqual(refresh.verify_controller(), "a" * 40)
                (root / "isolation.py").write_bytes(b"modified")
                with self.assertRaisesRegex(ValueError, "differ"):
                    refresh.verify_controller()

    def test_empty_ref_lease_rejects_concurrent_branch_creation(self):
        # Real Git regression: an ordinary push could fast-forward this other
        # writer's branch. The reviewed empty-ref condition must reject it.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote = root / "origin.git"
            local = root / "writer.git"
            env = {**os.environ, "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
                   "GIT_AUTHOR_NAME": "fixture", "GIT_COMMITTER_NAME": "fixture",
                   "GIT_AUTHOR_EMAIL": "fixture@example.invalid", "GIT_COMMITTER_EMAIL": "fixture@example.invalid"}

            def git(*args, data=None):
                return subprocess.check_output(["git", *args], input=data, env=env,
                                               stderr=subprocess.DEVNULL).decode().strip()

            git("init", "--bare", str(remote))
            git("init", "--bare", str(local))
            tree = git("--git-dir", str(local), "mktree", data=b"")
            first = git("--git-dir", str(local), "commit-tree", tree, data=b"first\n")
            second = git("--git-dir", str(local), "commit-tree", tree, "-p", first, data=b"second\n")
            ref = "refs/heads/data-refresh/railway-2026-q3"
            git("--git-dir", str(local), "push", str(remote), f"{first}:{ref}")
            with self.assertRaises(subprocess.CalledProcessError):
                git("--git-dir", str(local), "push", f"--force-with-lease={ref}:",
                    str(remote), f"{second}:{ref}")
            self.assertEqual(git("--git-dir", str(remote), "rev-parse", ref), first)

    def test_only_legacy_data_outputs_are_proposable(self):
        for name in ["src/data/prices.ts", "public/news/feed.xml", *refresh.PUBLIC_FILES]:
            self.assertTrue(refresh.allowed_output(name), name)
        for name in [".github/workflows/pwn.yml", "src/data/../../package.json",
                     "src/data/.git/config.json", "public/product-card.json", "src/main.tsx",
                     "public/data/evidence-wire-v1.json", "public/news/evil.sh"]:
            self.assertFalse(refresh.allowed_output(name), name)

    def test_quarter_is_stable_and_main_is_never_a_destination(self):
        self.assertEqual(refresh.quarter_branch(datetime(2026, 9, 8, tzinfo=timezone.utc)),
                         "data-refresh/railway-2026-q3")
        with patch.object(refresh, "git") as git:
            with self.assertRaisesRegex(ValueError, "review branch"):
                refresh.propose(Path("mirror"), {}, "a" * 40, {}, "main", None, "test", True)
            git.assert_not_called()

    def test_moved_main_cannot_create_or_push_proposal(self):
        with patch.object(refresh, "git", return_value=b"b" * 40 + b"\trefs/heads/main\n") as git:
            with self.assertRaisesRegex(ValueError, "advanced"):
                refresh.propose(Path("mirror"), {}, "a" * 40, {"src/data/x.json": b"{}"},
                                "data-refresh/railway-2026-q3", None, "test", True)
            self.assertEqual(git.call_count, 1)

    def test_links_and_unauthorized_modified_code_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = root / "package.json"
            path.write_bytes(b"{}")
            baseline = {"package.json": refresh.digest(b"{}")}
            path.write_bytes(b'{"scripts":{"preinstall":"injected"}}')
            with self.assertRaisesRegex(ValueError, "Unapproved"):
                refresh.validate_outputs(root, baseline)
            path.unlink()
            target = root / "target"
            target.write_text("{}")
            path.symlink_to(target)
            with self.assertRaises(OSError):
                refresh.read_regular(path)
            path.unlink()
            os.link(target, path)
            with self.assertRaises(ValueError):
                refresh.read_regular(path)

    def test_api_cannot_target_another_repository(self):
        with self.assertRaises(ValueError):
            refresh.GitHub("fixture").request("/repos/beepboop2025/LiquiLens/pulls")

    def test_existing_proposal_must_match_owned_repository(self):
        api = refresh.GitHub("fixture")
        pull = {"head": {"ref": "data-refresh/railway-2026-q3", "repo": {"full_name": "attacker/narcoscope"}},
                "base": {"ref": "main", "repo": {"full_name": refresh.REPOSITORY}}}
        with patch.object(api, "request", side_effect=[{"login": "beepboop2025"}, [pull]]):
            with self.assertRaisesRegex(ValueError, "mismatch"):
                api.pending("data-refresh/railway-2026-q3")


@unittest.skipUnless(os.geteuid() == 0 and Path("/proc").is_dir(), "Linux root image test")
class LinuxIsolationTests(unittest.TestCase):
    def test_candidate_has_no_publisher_secrets_or_writable_controller(self):
        with tempfile.TemporaryDirectory() as private, tempfile.TemporaryDirectory() as public:
            private_root, public_root = Path(private), Path(public)
            isolation.publisher_environment(private_root, "private-key-fixture")
            public_root.chmod(0o755)
            work = public_root / "repo"
            work.mkdir()
            locked = work / "source.js"
            locked.write_text("immutable")
            locked.chmod(0o444)
            output = work / "allowed.json"
            output.write_text("{}")
            os.chown(output, isolation.COLLECTOR_UID, isolation.COLLECTOR_UID)
            public_data = work / "public"
            public_data.mkdir(mode=0o1777)
            public_data.chmod(0o1777)
            protected = public_data / "openapi.json"
            protected.write_text("immutable")
            protected.chmod(0o444)
            news = public_data / "news"
            news.mkdir()
            os.chown(news, isolation.COLLECTOR_UID, isolation.COLLECTOR_UID)
            fd = os.open(private_root / "publisher-key", os.O_RDONLY)
            os.set_inheritable(fd, True)
            probe = work / "probe.py"
            probe.write_text("import os,subprocess\nfrom pathlib import Path\n"
                + "for name in " + repr([str(private_root / "publisher-key"),
                    f"/proc/{os.getpid()}/environ", "/proc/1/environ"]) + ":\n"
                + " try: Path(name).read_bytes()\n except PermissionError: pass\n else: raise AssertionError(name)\n"
                + "for name in " + repr([str(locked), str(refresh.CONTROLLER / "refresh.py")]) + ":\n"
                + " try: Path(name).write_text('injected')\n except PermissionError: pass\n else: raise AssertionError(name)\n"
                + f"try: os.read({fd},32)\nexcept OSError: pass\nelse: raise AssertionError('inherited FD')\n"
                + "assert not ({'GITHUB_TOKEN','GITHUB_DEPLOY_KEY','GIT_SSH_COMMAND','RAILWAY_TOKEN'} & set(os.environ))\n"
                + "Path('allowed.json').write_text('{\"safe\":true}')\n"
                + "try: Path('public/openapi.json').unlink()\nexcept PermissionError: pass\nelse: raise AssertionError('sticky parent lost protected contract')\n"
                + "Path('public/.news.stage-test').mkdir()\nPath('public/news').rename('public/.news.backup-test')\nPath('public/.news.stage-test').rename('public/news')\nPath('public/.news.backup-test').rmdir()\n"
                + "subprocess.Popen(['sleep','90'], start_new_session=True)\n"
                + "print('QUARTERLY_CREDENTIAL_ISOLATION_PASS', flush=True)\n")
            os.environ["GITHUB_TOKEN"] = "parent-token-fixture"
            try:
                refresh.run_step(work, public_root / "scratch", ["python3", "probe.py"], 15)
            finally:
                os.environ.pop("GITHUB_TOKEN", None)
                os.close(fd)
            self.assertEqual(json.loads(output.read_text()), {"safe": True})
            self.assertEqual(locked.read_text(), "immutable")
            self.assertEqual(subprocess.run(["pgrep", "-u", str(isolation.COLLECTOR_UID)],
                stdout=subprocess.DEVNULL).returncode, 1)


if __name__ == "__main__":
    unittest.main()
