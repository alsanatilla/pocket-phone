# Pocket Phone signing-key backup

`pocket-phone-signing-key.enc.json` contains the existing password-protected PKCS#12 release keystore inside an additional AES-256-GCM encrypted envelope. PBKDF2-HMAC-SHA256 derives the envelope key from the existing signing password using a random 32-byte salt and 600,000 iterations. The header is authenticated along with the ciphertext.

This repository is public. The signing password and the unencrypted keystore are **not stored here**. Keep the existing signing password separately; this backup cannot be restored without it.

Release certificate SHA-256: `883592cb9d2dbcb5817e28b3bb7df39d81f340d3ae2eca07134181fcf6d3e059`.

Package: `org.textphone.launcher`. Restoring this key keeps update compatibility with the signed Pocket releases, including 0.5.14.

## Restore

Use Python 3 with `cryptography` installed (`python -m pip install cryptography`). Download this directory from the `release-files` branch. Restore into a private directory outside the source checkout:

```sh
python restore_signing_key.py pocket-phone-signing-key.enc.json \
  --password-file /private/signing-password \
  --output /private/pocket-phone.p12
```

Omit `--password-file` to type the existing password without echo. The script refuses to overwrite an existing output file and writes the restored keystore with owner-only permissions. Use the same password for the restored PKCS#12 file.

For GitHub Actions signing, store the restored keystore as base64 in an Actions secret named `POCKET_SIGNING_KEY_B64`, and its password in `POCKET_SIGNING_PASSWORD`. The connection used to create this backup cannot access the repository Secrets API (HTTP 403), so no Actions secrets were configured. This backup alone does not enable unattended signing in GitHub Actions.
