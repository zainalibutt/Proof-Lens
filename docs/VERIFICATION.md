# Verification Guide

How to independently verify a ProofLens evidence bundle, what each check proves, and what
it does not.

One sample bundle ships with this repository and can be verified immediately, with no
account, no setup, and no dependency on this project's servers:

```bash
cd docs/captureevidencebundle && ./verify.sh
```

> An audio sample bundle was previously included and has been removed: its credential
> carried precise GPS coordinates. A signed file cannot be redacted without invalidating
> its signature, so it was withdrawn rather than edited.

Windows:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\verify.ps1
```

Only OpenSSL is required (plus `python3` or `node` to parse `credential.json`).

---

## Bundle contents

| File | Purpose |
|---|---|
| `capture.jpg` | The media itself |
| `capture.sha256.txt` | Expected SHA-256, hex |
| `credential.json` | Capture id, digest, base64 signature, device id, public key, capture time, TSA time/serial/policy |
| `device_public_key.pem` | Registered Ed25519 public key |
| `signature.bin` | Detached signature, raw bytes |
| `sha256.bin` | The 32 raw digest bytes that were signed |
| `tsa_query.tsq` | DER RFC 3161 timestamp query |
| `tsa_response.tsr` | DER RFC 3161 timestamp response |
| `tsa_ca.pem` | TSA CA chain |
| `verify.sh` / `verify.ps1` | Automated verification |

---

## The three checks

### 1. Integrity — SHA-256

```bash
sha256sum capture.jpg          # compare against capture.sha256.txt
```

**Proves:** the file is bit-identical to the one hashed at capture time.
**Does not prove:** anything about the content's authenticity or meaning.

### 2. Authenticity — Ed25519

```bash
openssl pkeyutl -verify -pubin -inkey device_public_key.pem \
  -sigfile signature.bin -rawin -in sha256.bin
```

Note the signature is over the **32 raw digest bytes** (`sha256.bin`), not the media file.

**Proves:** the registered application key produced this signature over this digest.
**Does not prove:** which person, device, or hardware element performed the signing — only
that the key was used.

### 3. Time — RFC 3161

```bash
openssl ts -verify -in tsa_response.tsr -queryfile tsa_query.tsq -CAfile tsa_ca.pem
# nonce-safe fallback:
openssl ts -verify -in tsa_response.tsr -digest <sha256hex> -CAfile tsa_ca.pem
```

Queries are generated with `-no_nonce`, so the query is reconstructable from the digest
alone — the fallback works even without `tsa_query.tsq`.

**Proves:** the digest existed no later than the TSA's asserted time.
**Does not prove:** that the capture occurred at that moment. This is an **upper bound**.

> `credential.json` carries both `captured_at` (device-reported) and `tsa_time`
> (independently anchored). **Only `tsa_time` is externally attestable.** Client-reported
> capture time is not equivalent to anchored TSA time.

---

## Reading the output

```
OK: hash matches (9255caa1...)
OK: signature valid
OK: TSA timestamp valid

VALID
capture_id: baf3a498-c930-4b3f-a827-4a924f8c985b
hash: 9255caa1...
tsa_time: 2026-04-14T11:18:30+00:00
key_fingerprint_sha256: <sha256 of the DER public key>
```

Exit codes: `2` hash mismatch, `3` credential unparseable, `4` signature invalid.

`key_fingerprint_sha256` lets you confirm that separate bundles were signed by the same
device key without consulting any server.

---

## What a VALID result means — and what it doesn't

A `VALID` result establishes exactly this:

> These bytes are unchanged since hashing; the registered key signed that digest; and the
> digest existed no later than the TSA time.

It does **not** establish that the image or audio depicts something real, that it was
captured by a particular person, that the device was uncompromised, or that the content
was not synthetic before it was signed. A photograph of a screen, or AI-generated media
captured through the app, verifies exactly as cleanly as any other capture.

See [../THREAT_MODEL.md](../THREAT_MODEL.md) §4 for the full list of limits.

---

## Why bundles must not be edited

Every byte matters. Re-encoding, stripping EXIF, or normalising line endings changes the
digest and invalidates the signature. The sample bundles therefore retain their original
metadata — including a device-model EXIF tag — because removing it would break the
verification the bundles exist to demonstrate.

---

## Verification without the bundle

The dashboard offers in-app verification (recomputes the digest against stored evidence)
and time-limited public share links (third-party verification without an account). Both
depend on the hosted service. **Bundle verification is the only path with no dependency on
this project remaining online**, which is why it is the recommended method.
