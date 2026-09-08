"""Seal controller files from a verified Git commit into a new build directory."""

import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

FILES = ("Dockerfile", "refresh.py", "isolation.py", "test_refresh.py", "github-known-hosts")
PREFIX = "deploy/railway-quarterly/"


def assemble(repository, source, destination, signers):
    if not re.fullmatch(r"[a-f0-9]{40}", source):
        raise ValueError("An exact signed source commit is required")
    subprocess.run(["git", "-C", str(repository), "-c", "gpg.format=ssh", "-c",
                    "gpg.ssh.allowedSignersFile=" + str(signers), "verify-commit", source], check=True)
    destination.mkdir(mode=0o700)
    manifest = {"schema": 1, "repository": "beepboop2025/narcoscope", "source_commit": source, "files": {}}
    for name in FILES:
        tree = subprocess.check_output(["git", "-C", str(repository), "ls-tree", source, PREFIX + name], text=True)
        if not re.fullmatch(r"100644 blob [a-f0-9]{40}\t" + re.escape(PREFIX + name) + r"\n", tree):
            raise ValueError("Controller source is not a regular non-executable Git blob")
        data = subprocess.check_output(["git", "-C", str(repository), "show", source + ":" + PREFIX + name])
        (destination / name).write_bytes(data)
        manifest["files"][name] = hashlib.sha256(data).hexdigest()
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    assemble(Path(sys.argv[1]).resolve(), sys.argv[2], Path(sys.argv[3]).resolve(),
             Path(sys.argv[4]).resolve())
