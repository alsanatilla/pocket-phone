#!/usr/bin/python3
"""Provision private Unix users for the account hashes admitted by Pocket."""
import os
import pathlib
import pwd
import re
import subprocess

root = pathlib.Path('/workspace')
os.chown(root, 0, 0)
os.chmod(root, 0o711)
accounts = os.environ.get('SANDBOX_ACCOUNTS', '').split(',')
if not accounts or any(not re.fullmatch(r'p[0-9a-f]{24}', name) for name in accounts):
    raise SystemExit('SANDBOX_ACCOUNTS must contain account hashes')
for name in accounts:
    uid = 20000 + int(name[1:8], 16)
    try:
        existing = pwd.getpwuid(uid)
        if existing.pw_name != name:
            raise SystemExit('Sandbox account UID collision')
    except KeyError:
        subprocess.run(['useradd', '--uid', str(uid), '--no-create-home', '--home-dir', str(root / name), '--shell', '/bin/bash', '--groups', 'pip-sandbox', name], check=True)
        subprocess.run(['usermod', '-p', '*', name], check=True)
    home = root / name
    if home.is_symlink():
        raise SystemExit('Sandbox home must not be a symlink')
    home.mkdir(mode=0o700, exist_ok=True)
    os.chown(home, uid, pwd.getpwnam(name).pw_gid)
    os.chmod(home, 0o700)
