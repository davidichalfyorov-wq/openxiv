"""
Minimal SSH-over-paramiko helper for driving the Contabo VPS from this machine.

Usage:
    set OPENXIV_HOST=173.212.216.82
    set OPENXIV_USER=root
    set OPENXIV_PASSWORD=...     (or OPENXIV_KEYFILE for key auth)
    python ssh_run.py exec  -- "ls -la"
    python ssh_run.py exec  -- @bigscript.sh           # contents of file as input
    python ssh_run.py put   ./local.tar  /opt/remote.tar
    python ssh_run.py get   /etc/issue   ./issue.txt

Exits non-zero on failure. Stdout from remote prints to our stdout, stderr to stderr.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

try:
    import paramiko
except ImportError:
    sys.stderr.write("paramiko not installed (pip install paramiko)\n")
    sys.exit(2)


def _client() -> paramiko.SSHClient:
    host = os.environ.get("OPENXIV_HOST")
    user = os.environ.get("OPENXIV_USER", "root")
    if not host:
        sys.stderr.write("OPENXIV_HOST not set\n")
        sys.exit(2)
    password = os.environ.get("OPENXIV_PASSWORD")
    keyfile = os.environ.get("OPENXIV_KEYFILE")
    if not password and not keyfile:
        sys.stderr.write("OPENXIV_PASSWORD or OPENXIV_KEYFILE must be set\n")
        sys.exit(2)
    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kwargs: dict[str, object] = {
        "hostname": host,
        "username": user,
        "timeout": 30,
        "banner_timeout": 30,
        "auth_timeout": 30,
        "allow_agent": False,
        "look_for_keys": False,
    }
    if keyfile:
        key_path = Path(keyfile)
        first_line = key_path.read_text(encoding="utf-8", errors="ignore").splitlines()[0]
        if "RSA PRIVATE KEY" in first_line:
            kwargs["pkey"] = paramiko.RSAKey.from_private_key_file(str(key_path), password=password)
        elif "DSA PRIVATE KEY" in first_line:
            kwargs["pkey"] = paramiko.DSSKey.from_private_key_file(str(key_path), password=password)
        elif "EC PRIVATE KEY" in first_line:
            kwargs["pkey"] = paramiko.ECDSAKey.from_private_key_file(str(key_path), password=password)
        elif "OPENSSH PRIVATE KEY" in first_line:
            # Let Paramiko auto-detect modern OpenSSH keys.
            kwargs["key_filename"] = str(key_path)
        else:
            kwargs["key_filename"] = str(key_path)
    if password:
        kwargs["password"] = password
    cli.connect(**kwargs)
    return cli


def cmd_exec(args: list[str]) -> int:
    if not args:
        sys.stderr.write("usage: exec -- <command...>  or  exec -- @<scriptfile>\n")
        return 2
    if args[0] == "--":
        args = args[1:]
    if len(args) == 1 and args[0].startswith("@"):
        command = Path(args[0][1:]).read_text(encoding="utf-8")
    else:
        command = " ".join(args)
    with _client() as cli:
        stdin, stdout, stderr = cli.exec_command(command, get_pty=False, timeout=600)
        out_data = stdout.read().decode("utf-8", errors="replace")
        err_data = stderr.read().decode("utf-8", errors="replace")
        code = stdout.channel.recv_exit_status()
    sys.stdout.write(out_data)
    sys.stderr.write(err_data)
    return code


def cmd_put(args: list[str]) -> int:
    """Upload via base64 over exec_command. Avoids paramiko SFTP edge cases."""
    if len(args) < 2:
        sys.stderr.write("usage: put <local> <remote>\n")
        return 2
    import base64
    import shlex
    local, remote = args[0], args[1]
    data = Path(local).read_bytes()
    payload = base64.b64encode(data).decode("ascii")
    remote_q = shlex.quote(remote)
    # base64 -d on Linux. Stream payload to its stdin via SSH.
    cmd = f"set -e; mkdir -p -- $(dirname {remote_q}); base64 -d > {remote_q}"
    with _client() as cli:
        stdin, stdout, stderr = cli.exec_command(cmd, get_pty=False, timeout=300)
        stdin.write(payload)
        stdin.channel.shutdown_write()
        err_data = stderr.read().decode("utf-8", errors="replace")
        code = stdout.channel.recv_exit_status()
    if code != 0:
        sys.stderr.write(err_data)
        return code
    sys.stdout.write(f"uploaded {local} -> {remote} ({len(data)} bytes)\n")
    return 0


def cmd_get(args: list[str]) -> int:
    if len(args) < 2:
        sys.stderr.write("usage: get <remote> <local>\n")
        return 2
    remote, local = args[0], args[1]
    with _client() as cli:
        sftp = cli.open_sftp()
        sftp.get(remote, local)
        sftp.close()
    sys.stdout.write(f"downloaded {remote} -> {local}\n")
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        sys.stderr.write(__doc__ or "")
        return 2
    sub, rest = sys.argv[1], sys.argv[2:]
    if sub == "exec":
        return cmd_exec(rest)
    if sub == "put":
        return cmd_put(rest)
    if sub == "get":
        return cmd_get(rest)
    sys.stderr.write(f"unknown subcommand: {sub}\n")
    return 2


if __name__ == "__main__":
    sys.exit(main())
