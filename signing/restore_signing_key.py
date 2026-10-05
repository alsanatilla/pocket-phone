#!/usr/bin/env python3
"""Restore the encrypted Pocket release keystore without printing its contents."""
import argparse
import base64
import getpass
import hashlib
import json
import os
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


def restore(document, password):
    header = document["header"]
    if header["version"] != 1 or header["cipher"] != "AES-256-GCM":
        raise ValueError("Unsupported signing backup format.")
    if header["kdf"] != "PBKDF2-HMAC-SHA256" or header["iterations"] != 600000:
        raise ValueError("Unsupported signing backup key derivation.")
    salt = base64.b64decode(header["salt"], validate=True)
    nonce = base64.b64decode(header["nonce"], validate=True)
    if len(salt) != 32 or len(nonce) != 12:
        raise ValueError("Invalid signing backup parameters.")
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=600000).derive(password)
    aad = json.dumps(header, sort_keys=True, separators=(",", ":")).encode()
    payload = AESGCM(key).decrypt(nonce, base64.b64decode(document["ciphertext"], validate=True), aad)
    if hashlib.sha256(payload).hexdigest() != header["keystore_sha256"]:
        raise ValueError("The restored keystore does not match the backup.")
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("--password-file", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    password = args.password_file.read_bytes().rstrip(b"\r\n") if args.password_file else getpass.getpass("Signing password: ").encode()
    try:
        payload = restore(json.loads(args.backup.read_text()), password)
    except InvalidTag:
        parser.exit(1, "Wrong password or modified backup. No key was written.\n")
    args.output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    # Never replace an existing key; create the restored file with owner-only access.
    fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(payload)
    print("Restored the password-protected PKCS#12 keystore:", args.output)


if __name__ == "__main__":
    main()
