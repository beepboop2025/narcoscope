"""Tests of the publication boundary and actual Linux credential separation."""

from datetime import datetime, timezone
import json
import io
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

import refresh
import isolation


class BoundaryTests(unittest.TestCase):
    def native_environment(self):
        return {"QUARTERLY_EXECUTION_PROVIDER":"hetzner","QUARTERLY_EXECUTION_ID":"a"*32,
                "QUARTERLY_HOST_ID":"b"*64,"QUARTERLY_CONTROLLER_IMAGE":"sha256:"+"c"*64}

    def test_native_identity_never_invents_a_railway_deployment(self):
        execution=refresh.execution_identity(self.native_environment())
        self.assertEqual(execution["provider"],"hetzner")
        self.assertNotIn("Railway-Deployment:",refresh.provenance(execution))
        self.assertNotIn("deployment",refresh.execution_fields(execution))
        self.assertIn("Controller-Image: sha256:"+"c"*64,refresh.provenance(execution))
        self.assertEqual(refresh.execution_identity({}),{"provider":"local","id":"local"})
        legacy=refresh.execution_identity({"RAILWAY_DEPLOYMENT_ID":"existing-provider-deployment"})
        self.assertEqual(refresh.execution_fields(legacy)["deployment"],"existing-provider-deployment")

    def test_native_identity_rejects_mixed_missing_or_malformed_metadata(self):
        for key,value in (("RAILWAY_DEPLOYMENT_ID","old"),("RAILWAY_PROJECT_ID","old"),
                          ("QUARTERLY_EXECUTION_ID","invented"),("QUARTERLY_HOST_ID","short"),
                          ("QUARTERLY_CONTROLLER_IMAGE","mutable:tag"),("QUARTERLY_EXECUTION_PROVIDER","other")):
            with self.subTest(key=key),self.assertRaises(ValueError):
                refresh.execution_identity({**self.native_environment(),key:value})
        for key in self.native_environment():
            value=self.native_environment();value.pop(key)
            with self.subTest(missing=key),self.assertRaises(ValueError):refresh.execution_identity(value)

    def test_native_pending_quarter_preserves_existing_review_without_collection(self):
        environment={**self.native_environment(),"QUARTERLY_APPLY":"1",
                     "GITHUB_TOKEN":"synthetic","GITHUB_DEPLOY_KEY":"synthetic"}
        pending={"number":74,"head":{"sha":"d"*40}}
        output=io.StringIO()
        with patch.dict(os.environ,environment,clear=True),patch.object(refresh.os,"geteuid",return_value=0),\
             patch.object(refresh.resource,"setrlimit"),patch.object(refresh,"verify_controller",return_value="e"*40),\
             patch.object(refresh.GitHub,"pending",return_value=pending) as lookup,\
             patch.object(refresh,"prepare_market_state") as state,patch.object(refresh,"run_step") as collect,\
             patch.object(refresh,"propose") as propose,redirect_stdout(output):
            self.assertEqual(refresh.main(),0)
        self.assertTrue(lookup.call_args.args[0].startswith("data-refresh/railway-"))
        state.assert_not_called();collect.assert_not_called();propose.assert_not_called()
        receipt=json.loads(output.getvalue())
        self.assertEqual(receipt["event"],"HETZNER_QUARTERLY_PENDING_REVIEW")
        self.assertEqual(receipt["pull_request"],74);self.assertNotIn("deployment",receipt)

    def test_native_execution_requires_a_real_volume_before_pipeline(self):
        with patch.dict(os.environ,self.native_environment(),clear=True),patch.object(refresh.os,"geteuid",return_value=0),\
             patch.object(refresh.resource,"setrlimit"),patch.object(refresh,"verify_controller",return_value="e"*40),\
             patch.object(refresh,"prepare_market_state",side_effect=RuntimeError("fixture stop")) as state,\
             patch.object(refresh,"run_step") as collect:
            with self.assertRaisesRegex(RuntimeError,"fixture stop"):refresh.main()
        state.assert_called_once_with(require_mount=True);collect.assert_not_called()

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
                     "public/data/evidence-wire-v1.json", "public/news/evil.sh",
                     "data-private/withheld/src/data/prices.ts",
                     "data-private/withheld/src/data/seizures.json"]:
            self.assertFalse(refresh.allowed_output(name), name)

    def test_tracked_private_scratch_is_rejected_before_checkout(self):
        for path in ("data-private/file.json", "data-private/withheld/src/data/prices.ts"):
            with self.subTest(path=path),tempfile.TemporaryDirectory() as directory:
                entry=b"100644 blob "+b"a"*40+b"\t"+path.encode()+b"\0"
                with patch.object(refresh,"git",return_value=entry) as git:
                    with self.assertRaisesRegex(ValueError,"Unsafe source object"):
                        refresh.checkout(None,{},"b"*40,Path(directory))
                self.assertEqual(git.call_count,1)
                self.assertEqual(list(Path(directory).iterdir()),[])

    def test_global_market_allowlist_is_exact(self):
        for name in ["global-arms-economy-v1.json", "global-drugs-v1.json", "global-market-catalog-v1.json"]:
            self.assertTrue(refresh.allowed_output("public/data/" + name))
        for name in ["public/data/global-drugs-v2.json", "public/data/global-drugs-v1.json.tmp",
                     "public/data/manifest.json", "public/data/raw/fixture.zip"]:
            self.assertFalse(refresh.allowed_output(name))

    def test_live_market_cache_requires_a_volume_and_rejects_unsafe_paths(self):
        for directory in ["relative/cache", "/", "/data/../controller"]:
            with self.subTest(directory=directory), self.assertRaisesRegex(ValueError, "Unsafe"):
                refresh.prepare_market_state(directory)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            state = root / "retained"
            with patch.object(Path, "is_mount", return_value=False):
                with self.assertRaisesRegex(ValueError, "mounted durable volume"):
                    refresh.prepare_market_state(str(state), require_mount=True)
            with patch.object(refresh.os, "chown") as chown:
                prepared = refresh.prepare_market_state(str(state))
                self.assertEqual(prepared, state)
                chown.assert_called_once_with(state, refresh.COLLECTOR_UID, refresh.COLLECTOR_UID)
                self.assertEqual(state.stat().st_mode & 0o777, 0o700)
            link = root / "link"
            link.symlink_to(state)
            with self.assertRaisesRegex(ValueError, "symbolic link"):
                refresh.prepare_market_state(str(link))

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


@unittest.skipUnless(os.geteuid() == 0 and Path("/proc").is_dir(), "Linux root private-scratch test")
class LinuxPrivateScratchTests(unittest.TestCase):
    def test_current_withheld_paths_are_writable_but_never_proposable(self):
        # Exact path contract from lib/withheld-originals.mjs at current source
        # 9df320b7e1d20204f5128219153aa061e7ec1cff. No real WDR values are used.
        names=("src/data/prices.ts","src/data/priceSeries.json",
               "src/data/seizures.json","src/data/overview.json")
        contents={name:b"{}" for name in names}
        contents.update({"package.json":b"{}","public/news/feed.xml":b"<feed/>"})
        blobs={str(i)*40:body for i,body in enumerate(contents.values(),1)}
        tree=b"".join(b"100644 blob "+(str(i)*40).encode()+b"\t"+name.encode()+b"\0"
                      for i,name in enumerate(contents,1))
        def git(mirror,env,*args):
            if args[0]=="ls-tree":return tree
            self.assertEqual(args[:2],("cat-file","blob"));return blobs[args[2]]
        with tempfile.TemporaryDirectory(prefix="quarterly-private-scratch-test-") as directory:
            root=Path(directory);root.chmod(0o755);work=root/"repo";work.mkdir(mode=0o755)
            with patch.object(refresh,"git",side_effect=git):
                baseline=refresh.checkout(None,{},"b"*40,work)
            private=work/"data-private";info=private.stat()
            self.assertEqual((info.st_uid,info.st_gid,info.st_mode&0o777),(65532,65532,0o700))
            writer="""import os,sys
from pathlib import Path
root=Path(sys.argv[1]);assert os.getuid()==65532
for name in sys.argv[2:]:
 target=root/'data-private/withheld'/name
 target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
 fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as stream:stream.write(b'WITHHELD_SYNTHETIC_MUST_NOT_PUBLISH')
 (root/name).write_bytes(b'{"projected":true}')
try:(root/'package.json').write_bytes(b'changed')
except PermissionError:pass
else:raise AssertionError('protected source writable')
print('PRIVATE_SCRATCH_WRITER_PASS')
"""
            # No run_step/stop_collectors: only this bounded child is touched,
            # so the fixture is safe on a host that also runs other UID65532 jobs.
            result=subprocess.run([sys.executable,"-c",writer,str(work),*names],
                env={"PATH":"/usr/bin:/bin","HOME":"/nonexistent","LANG":"C.UTF-8"},
                stdin=subprocess.DEVNULL,close_fds=True,preexec_fn=isolation.drop_privileges,
                capture_output=True,text=True,timeout=10)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(result.stdout.strip(),"PRIVATE_SCRATCH_WRITER_PASS")
            for name in names:
                target=private/"withheld"/name;info=target.stat()
                self.assertEqual((info.st_uid,info.st_gid,info.st_mode&0o777),(65532,65532,0o600))
                self.assertFalse(refresh.allowed_output("data-private/withheld/"+name))
            changed=refresh.validate_outputs(work,baseline)
            self.assertEqual(set(changed),set(names))
            self.assertTrue(all(not name.startswith("data-private/") and
                b"WITHHELD_SYNTHETIC_MUST_NOT_PUBLISH" not in body for name,body in changed.items()))
            self.assertEqual((work/"package.json").read_bytes(),b"{}")


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
            locked.chmod(0o644)
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
            probe.write_text("import os,subprocess,shutil\nfrom pathlib import Path\n"
                + "for name in " + repr([str(private_root / "publisher-key"),
                    f"/proc/{os.getpid()}/environ", "/proc/1/environ"]) + ":\n"
                + " try: Path(name).read_bytes()\n except PermissionError: pass\n else: raise AssertionError(name)\n"
                + "for name in " + repr([str(locked), str(refresh.CONTROLLER / "refresh.py")]) + ":\n"
                + " try: Path(name).write_text('injected')\n except PermissionError: pass\n else: raise AssertionError(name)\n"
                + f"try: os.read({fd},32)\nexcept OSError: pass\nelse: raise AssertionError('inherited FD')\n"
                + "assert not ({'GITHUB_TOKEN','GITHUB_DEPLOY_KEY','GIT_SSH_COMMAND','RAILWAY_TOKEN','OPENAI_API_KEY','ANTHROPIC_API_KEY','GEMINI_API_KEY'} & set(os.environ))\n"
                + "assert os.environ['PYTHONDONTWRITEBYTECODE']=='1'\n"
                + "Path('allowed.json').write_text('{\"safe\":true}')\n"
                + "copy=Path(os.environ['TMPDIR'])/'fixture-copy'; shutil.copy2('source.js',copy); copy.write_text('candidate-owned fixture')\n"
                + "try: Path('public/openapi.json').unlink()\nexcept PermissionError: pass\nelse: raise AssertionError('sticky parent lost protected contract')\n"
                + "Path('public/.news.stage-test').mkdir()\nPath('public/news').rename('public/.news.backup-test')\nPath('public/.news.stage-test').rename('public/news')\nPath('public/.news.backup-test').rmdir()\n"
                + "subprocess.Popen(['sleep','90'], start_new_session=True)\n"
                + "print('QUARTERLY_CREDENTIAL_ISOLATION_PASS', flush=True)\n")
            try:
                with patch.dict(os.environ,{"GITHUB_TOKEN":"parent-token-fixture","OPENAI_API_KEY":"not-a-real-key",
                                            "ANTHROPIC_API_KEY":"not-a-real-key","GEMINI_API_KEY":"not-a-real-key"}):
                    refresh.run_step(work, public_root / "scratch", ["python3", "probe.py"], 15)
            finally:
                os.close(fd)
            self.assertEqual(json.loads(output.read_text()), {"safe": True})
            self.assertEqual(locked.read_text(), "immutable")
            self.assertEqual(subprocess.run(["pgrep", "-u", str(isolation.COLLECTOR_UID)],
                stdout=subprocess.DEVNULL).returncode, 1)


if __name__ == "__main__":
    unittest.main()
