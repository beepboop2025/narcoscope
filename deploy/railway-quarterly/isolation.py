"""Credential isolation helpers shared with the proven Railway collector design."""

import ctypes
import hashlib
import json
import os
from pathlib import Path
import resource
import stat
import subprocess
import time

CONTROLLER = Path(__file__).resolve().parent
COLLECTOR_UID = 65532
MAX_FILE_BYTES = 32 * 1024 * 1024

def event(kind, **fields):
    print(json.dumps({"event": kind, **fields}, sort_keys=True), flush=True)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_regular(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        metadata = os.fstat(fd)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1:
            raise ValueError(f"unsafe output type: {path.name}")
        if metadata.st_size > MAX_FILE_BYTES:
            raise ValueError(f"oversized output: {path.name}")
        with os.fdopen(fd, "rb", closefd=False) as handle:
            content = handle.read(MAX_FILE_BYTES + 1)
        if len(content) > MAX_FILE_BYTES:
            raise ValueError(f"oversized output: {path.name}")
        return content
    finally:
        os.close(fd)


def git(mirror, env, *args, data=None):
    command = ["git", "-c", "core.hooksPath=/dev/null", "-c", "protocol.file.allow=never"]
    if mirror is not None:
        command += ["--git-dir", str(mirror)]
    return subprocess.check_output(command + list(args), input=data, env=env,
                                   stdin=None, timeout=300)


def publisher_environment(root, private_key):
    root.chmod(0o700)
    key = root / "publisher-key"
    key.write_text(private_key.rstrip() + "\n")
    key.chmod(0o600)
    home = root / "home"
    home.mkdir(mode=0o700)
    return {
        "PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(home),
        "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": (
            f"ssh -i {key} -o IdentitiesOnly=yes -o BatchMode=yes "
            "-o StrictHostKeyChecking=yes -o PasswordAuthentication=no "
            f"-o UserKnownHostsFile={CONTROLLER / 'github-known-hosts'}"
        ),
        "GIT_AUTHOR_NAME": "liquilens-data-bot",
        "GIT_AUTHOR_EMAIL": "data-bot@users.noreply.github.com",
        "GIT_COMMITTER_NAME": "liquilens-data-bot",
        "GIT_COMMITTER_EMAIL": "data-bot@users.noreply.github.com",
    }


def drop_privileges():
    # no_new_privs prevents setuid/file-capability programs restoring privilege.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "PR_SET_NO_NEW_PRIVS")
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_FILE_BYTES, MAX_FILE_BYTES))
    os.setgroups([])
    os.setgid(COLLECTOR_UID)
    os.setuid(COLLECTOR_UID)
    os.umask(0o022)


def stop_collectors():
    """Quiesce even orphaned UID-owned children before reading their output."""
    for _ in range(40):
        subprocess.run(["pkill", "-KILL", "-u", str(COLLECTOR_UID)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        found = subprocess.run(["pgrep", "-u", str(COLLECTOR_UID)],
                               stdout=subprocess.DEVNULL, check=False)
        if found.returncode == 1:
            return
        time.sleep(0.25)
    raise RuntimeError("collector processes did not quiesce")
