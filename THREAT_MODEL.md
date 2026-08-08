# ProofLens — Threat Model

This document states precisely what ProofLens proves, what it does not, and who must be
trusted for each claim. It is deliberately conservative: a provenance system that
overstates its guarantees is worse than one that states none.

---

## 1. What the cryptography actually establishes

| Primitive | Claim it supports | Claim it does **not** support |
|---|---|---|
| **SHA-256** | Byte-level integrity. A digest match means the file is bit-identical to the one that was hashed. | That the bytes are authentic, meaningful, or depict anything real. |
| **Ed25519** | That the corresponding registered application key produced a detached signature over that digest. | That a *particular human*, device, or hardware element signed it. Possession of the key is what is proven. |
| **RFC 3161 TSA** | That the digest existed no later than the timestamp asserted by the authority. | That the capture *occurred* at that time. Only an upper bound is established. |

A signature is computed over the **32-byte digest**, not the file body
(`nacl.sign.detached` over `Buffer.from(sha256, "hex")`). Verification therefore requires
both the digest and the file to check the full chain.

---

## 2. Trusted computing base

Trust requirements differ sharply between the two verification contexts.

### 2.1 Offline bundle verification — minimal TCB

Verifying a downloaded evidence bundle requires trusting only:

- OpenSSL (or any correct RFC 3161 / Ed25519 implementation)
- The TSA's CA certificate chain
- The correctness of SHA-256 and Ed25519

It does **not** require trusting the ProofLens backend, the ProofLens database, this
project's continued existence, or the network. This is the strongest property the system
has: bundles remain independently checkable indefinitely.

### 2.2 Establishing that a credential reflects a genuine capture — large TCB

This requires trusting, in full:

- **The mobile application build** — that the shipped binary hashes the file it actually
  captured, and signs only that digest.
- **The device operating system** — that the camera/microphone pipeline is not
  intercepted, and that `expo-secure-store` protects the private key as documented.
- **The backend service implementation** — the API holds the `service_role` key, performs
  the authoritative S3 re-hash, decides what is persisted, and mediates TSA anchoring.
- **AWS S3** — that the object returned to the API for re-hashing is the object the client
  uploaded.
- **The TSA** — that it does not backdate or forward-date responses.

> **Superseded claim.** Earlier documentation described verification as working "without
> requiring trust in either the device or the server alone." That phrasing was wrong and
> has been removed. It is accurate only for §2.1. For §2.2, the device build, the device
> OS, and the backend are all inside the trusted computing base.

---

## 3. Attacks the design does address

| Threat | Mitigation |
|---|---|
| Client lies about its file's hash | API re-fetches the object from S3 and streams an independent SHA-256. The client's claim is never authoritative. |
| Media substituted after upload | Any substitution changes the digest; signature and stored credential both fail. |
| Credential forged by a non-registered key | Signature is checked against the public key registered to that authenticated user–device pair. |
| Stolen AWS credentials from the mobile app | The app holds none. It receives only a short-lived, scoped presigned POST target. |
| Cross-tenant data access | Browser roles hold no application-table/view privileges; all data access passes through the authenticated API. Composite foreign keys enforce share/record owner equality. Synthetic two-tenant database tests exercise both rejection and acceptance cases. |
| Retroactive edit of stored evidence | Immutability triggers on evidence tables; append-only audit log. |
| Share link abuse | HMAC-signed, time-limited, individually revocable, bound to a token hash. |
| Backdating a capture | RFC 3161 anchoring provides an externally attestable upper bound independent of the device clock. |

---

## 4. Attacks the design does **not** address

Stated plainly, because each is a real limit:

1. **Compromised operating system.** A rooted or jailbroken device, or a malicious OS-level
   camera shim, can feed arbitrary bytes into the capture path. ProofLens will hash and
   sign those bytes faithfully.
2. **Malicious or modified application build.** A tampered build can sign any digest it
   likes with the device key. Nothing in the system attests which binary produced a
   signature.
3. **Screen recapture / analogue hole.** Photographing an existing image or replaying audio
   into the microphone produces a genuine capture of fake content. The cryptography is
   satisfied; the semantics are not.
4. **Synthetic content introduced before signing.** AI-generated or edited media captured
   through the app is signed exactly like any other. **ProofLens does not prove that the
   depicted scene is objectively real.**
5. **Compromised backend.** An attacker with the `service_role` key or code execution in
   the API can persist fabricated credentials, since the API is the component that decides
   what verification outcome to record.
6. **Key extraction from a compromised device.** `expo-secure-store` is protected
   application storage backed by Keychain/Keystore. It is **not** remote hardware
   attestation and does not survive a fully compromised device.
7. **Malicious TSA.** A dishonest or compromised timestamp authority can issue inaccurate
   times. Trust is delegated, not eliminated.
8. **Client-reported capture time.** The `captured_at` field is device-asserted and is
   **not** equivalent to the anchored TSA time. Treat only `tsa_time` as attestable.

---

## 5. Residual risks and unremediated weaknesses

### 5.0 Public-release implementation hardening

The review closed the concrete implementation gaps found in the original prototype:
server-generated user-scoped S3 keys, an independent HMAC secret, query-string redaction,
bounded proxy trust, verified per-user rate limits, pinned share-link origin, server-only
database privileges, `security_invoker` on `v_queue`, and composite share-owner foreign
keys. Both code-level regression checks and transactional two-tenant database tests now
cover these boundaries.

These controls reduce implementation risk; they do not reduce the trusted computing base
or change the intrinsic limitations in §4.

### 5.1 Residual risks accepted in this edition

- **The public sample bundle retains original EXIF** (including a device-model tag and a
  random device UUID). Stripping metadata alters the file bytes and invalidates the
  signature the bundle exists to demonstrate. The retained image is a deliberately
  featureless test capture — no people, no location, no identifying surroundings.
- **An audio sample bundle was previously published with precise GPS coordinates in its
  credential and has been removed.** A signed file cannot be redacted without invalidating
  its signature, so it was withdrawn rather than edited. This is recorded here because it
  demonstrates the failure mode: signing metadata-bearing media publishes that metadata.
- **The Supabase `anon` key is present in client configuration.** This is public by design.
  The clients use Supabase Auth; `anon` and `authenticated` have no privileges on the ten
  application tables, the queue view, or the server-only share RPC.
- **TSA anchoring is optional.** With `TSA_URL` unset, credentials persist in a submitted
  rather than anchored state, and no independent time bound exists for those records.

---

## 6. Appropriate and inappropriate uses

**Reasonable:** demonstrating chain-of-custody tooling; integrity checking for
self-captured material; research into provenance workflows; establishing that a file has
not changed since a known point in time.

**Not reasonable without substantial additional controls:** legal evidence, journalistic
verification of third-party material, insurance claims adjudication, or any context where
an adversary controls the capture device. Those settings require hardware-backed
attestation, verified boot, and an audited capture pipeline — none of which this system
provides.

---

## 7. Reporting

Security issues: see [SECURITY.md](SECURITY.md). Please do not open public issues for
suspected vulnerabilities.
