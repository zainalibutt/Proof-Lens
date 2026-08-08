# ProofLens

[![CI](https://github.com/zainalibutt/Proof-Lens/actions/workflows/ci.yml/badge.svg)](https://github.com/zainalibutt/Proof-Lens/actions/workflows/ci.yml)

An academic tamper-evidence and media-provenance prototype. A capture taken in the mobile
app is hashed (SHA-256), signed with a device-held Ed25519 key, re-hashed independently by
the server from object storage, and anchored to an RFC 3161 timestamp authority. A third
party can then verify — offline, using only OpenSSL — that a specific byte sequence was
signed by a specific registered key and existed no later than a specific time.

> **Status: academic prototype.** Built as a final-year university project. It is not
> production-ready, not forensically validated, and not suitable for legal or evidentiary
> use. See [Hardening status and remaining limitations](#hardening-status-and-remaining-limitations) and
> [THREAT_MODEL.md](THREAT_MODEL.md).

![ProofLens system architecture](docs/diagrams/sysarch.png)

---

## How it works

```
Capture ─► Hash ─► Sign ─► Upload ─► Re-hash ─► Timestamp ─► Verify
```

| Step | Where | What happens |
|---|---|---|
| **Capture** | Mobile | Photo or audio recorded in-app |
| **Hash** | Mobile | SHA-256 computed on-device over the file bytes |
| **Sign** | Mobile | Ed25519 detached signature over the 32-byte digest |
| **Upload** | Mobile → S3 | Direct upload via a short-lived presigned POST URL |
| **Re-hash** | API | Server re-fetches the object from S3 and streams a fresh SHA-256 |
| **Timestamp** | API → TSA | Digest submitted to an RFC 3161 authority; DER response stored as a sidecar |
| **Verify** | Web / offline | Signature, hash and timestamp checked in-dashboard or offline from a bundle |

The re-hash step is the load-bearing one: a device that misreports its file's hash fails
server-side verification, because the server hashes what actually landed in S3 rather than
trusting the client's claim.

---

## Engineering highlights

- **Independent server-side re-hash.** The API streams the uploaded object back out of S3
  and recomputes SHA-256 before persisting a credential. Client-reported hashes are never
  taken on trust.
- **No AWS credentials in the mobile client.** The device receives a short-lived presigned
  POST target rather than long-lived keys.
- **Offline-verifiable evidence bundles.** A bundle ships the media, digest, detached
  signature, device public key, TSA query/response and CA chain, plus `verify.sh` /
  `verify.ps1` that check all three properties using only OpenSSL.
- **RFC 3161 anchoring with deterministic query reconstruction.** Queries are built with
  `-no_nonce`, so the query can be rebuilt from the digest alone at verification time.
- **Server-only database boundary, FORCE RLS, immutability triggers and audit logs.**
  Browser roles have no application-table privileges; matching synthetic two-tenant tests
  exercise the database-enforced share ownership constraints.
- **Time-limited, revocable share links**, HMAC-signed with an expiry and token hash.
- **Graceful degradation.** Without a configured TSA, capture and verification still work;
  credentials persist in a submitted rather than anchored state.

---

## What ProofLens establishes

- **SHA-256 proves byte-level integrity.** One changed bit breaks the digest.
- **Ed25519 proves that the corresponding registered application key signed the digest.**
- **RFC 3161 proves that a digest existed no later than the TSA timestamp.**
- Verification is **reproducible offline** using standard OpenSSL, without depending on
  this project's servers.

## What it does not establish

- **Client-reported capture time is not equivalent to independently anchored TSA time.**
  Only the TSA timestamp is externally attestable.
- **Expo SecureStore is protected application storage, not remote hardware attestation.**
- **ProofLens does not prove that the depicted scene is objectively real.** It binds bytes
  to a key and a time; it says nothing about whether those bytes depict reality.
- **It does not defeat compromised operating systems, malicious builds, screen recapture,
  or synthetic content introduced before signing.**
- **The backend service role and implementation are part of the trusted computing base.**
- It makes **no claim** to forensic-grade capture, legal admissibility, hardware identity,
  trusted capture time, or production readiness.

### Trusted computing base

Verifying a downloaded bundle requires trusting only OpenSSL, the TSA's CA chain, and the
mathematics of SHA-256 and Ed25519. **Everything upstream of the signature does not share
that property**: establishing that a credential reflects a genuine capture requires
trusting the mobile build, the device OS, and the backend. Full analysis in
[THREAT_MODEL.md](THREAT_MODEL.md).

---

## Hardening status and remaining limitations

The public-release pass fixed the implementation-level issues found during review. This
does not turn the academic prototype into a production or forensic system; the intrinsic
research limitations below still apply.

| Area | Status |
|---|---|
| **S3 object keys** | **Fixed.** Keys are server-generated under a per-user namespace (`users/{id}/…`) with 128 bits of entropy. A client-supplied key is honoured only if it already sits in that user's namespace (the legitimate retry case); anything else is discarded. The presigned POST policy additionally pins `starts-with $key` to the namespace and enforces a size range. Covered by regression tests. |
| **HMAC separation** | **Fixed.** `EVIDENCE_BUNDLE_HMAC_SECRET` is now required, must be ≥32 characters, and must not equal the Supabase service key. There is no fallback — token signing fails closed. Covered by regression tests. |
| **Client log endpoint** | **Fixed.** `/client-log` removed entirely. |
| **Log redaction** | **Fixed.** Access logs record the path only; query strings are replaced with `?<redacted>` so share and bundle tokens cannot reach logs. Covered by a regression test. |
| **Rate-limit identity** | **Fixed.** No longer reads `x-forwarded-for` or `x-user-id` directly. IP comes from Express with `trust proxy` bounded to one hop; per-user limits key off an authenticated subject only. |
| **Security headers / CORS** | **Fixed.** Helmet added with a restrictive CSP, `frame-ancestors: none` and `no-referrer`. `CORS_ORIGIN=*` is now refused at startup. |
| **IAM policy** | **Tightened.** Template scoped to `users/*` and `s3:PutObjectAcl` dropped. |
| **Direct database access** | **Fixed and deployed.** The web/mobile clients use Supabase Auth only. `anon` and `authenticated` hold no privileges on any of the ten application tables or `v_queue`; all data access passes through the API's server-side client. FORCE RLS remains enabled as defence in depth. |
| **`v_queue` view** | **Fixed and deployed.** `security_invoker = on`; browser roles cannot select it. |
| **Cross-tenant shares** | **Fixed and tested.** Composite foreign keys bind `(capture_id, user_id)` and `(audio_id, user_id)` to the corresponding owner's record. Synthetic negative tests prove cross-owner inserts fail while same-owner inserts succeed. |
| **Share URL origin** | **Fixed.** Generated links use the configured `SHARE_BASE_URL`; an attacker-controlled request `Origin` is ignored. |
| **Audit metadata** | **Fixed.** Audit IPs use Express's bounded proxy trust rather than raw forwarding headers, and stored user-agent strings are capped. |

The migration is reviewable at
`database/migrations/001_lock_down_evidence_writes.sql`; its regression test is
`database/tests/cross_tenant_isolation_test.sql`. It was applied transactionally to the
running prototype on 8 August 2026. All 139 image credentials, 20 audio records and their
90 share rows were preserved.

Remaining research limitations: evaluation involved one author and two iOS devices; there
was no hostile load test, independent security audit, hardware-backed remote attestation,
multi-author study, or forensic/legal validation. Timestamping depends on a single TSA.
Location/EXIF collection also creates privacy and erasure-policy questions that a real
deployment would need to resolve.

---

## Technology

| Layer | Stack |
|---|---|
| Mobile | Expo SDK 57, React Native, TypeScript, `expo-secure-store`, TweetNaCl (Ed25519) |
| API | Node.js, Express, TypeScript, AWS SDK v3, OpenSSL (RFC 3161) |
| Web | React, Vite, TypeScript, React Router |
| Data | Supabase / PostgreSQL |
| Storage | AWS S3 |
| Hosting | Railway (API), Vercel (web), Supabase (database) |

## Repository layout

```
database/          Postgres schema, setup guide, S3 IAM policy template
mobile/            Expo app — capture, hashing, signing, offline queue, upload
prooflens-api/     Express API — device registration, verification, TSA, shares, bundles
web/               React dashboard — evidence browser, verification, share portal
docs/              Architecture, verification guide, diagrams, sample evidence bundle
```

## Local setup

Node.js 24.13.0 (see `.nvmrc`); OpenSSL on PATH for TSA flows.

```bash
cd prooflens-api && npm install && cp .env.example .env && npm run dev
cd web           && npm install && cp .env.example .env && npm run dev
cd mobile        && npm install && cp .env.example .env && npx expo start --clear --lan
```

Every `.env.example` contains **placeholders only**. You must supply your own Supabase
project, S3 bucket and IAM user (see `database/setup.md` and `database/iam_policy.json`).

Further reading: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ·
[docs/VERIFICATION.md](docs/VERIFICATION.md) · [THREAT_MODEL.md](THREAT_MODEL.md) ·
[SECURITY.md](SECURITY.md)

---

## Sample evidence bundle

`docs/captureevidencebundle/` is a genuine bundle produced by the running system. Verify it
yourself with no setup:

```bash
cd docs/captureevidencebundle && ./verify.sh
```

The image is a deliberately featureless test capture (a plain ceiling). It contains no
people, no location data, and no identifying surroundings. Its EXIF is retained because the
signature covers the exact file bytes — altering the file would invalidate the very
signature the bundle exists to demonstrate. The retained EXIF discloses a device model
string and a randomly generated device UUID.

An audio sample bundle was previously included and has been **removed**: its credential
carried precise GPS coordinates and the recording was not a staged test. It should not have
been published, and no redacted version is offered, because editing a signed file would
invalidate its signature.

---

## Academic project disclosure

ProofLens originated as a university final-year project developed between January and
April 2026. This public repository starts from one reviewed, sanitised source snapshot —
not the private development object graph. Authentic development chronology and the honest
investigation trail are retained in [docs/PROJECT_TIMELINE.md](docs/PROJECT_TIMELINE.md)
without republishing private artefacts.

Assessment walkthrough: [docs/ACADEMIC_DEMO.md](docs/ACADEMIC_DEMO.md) ·
Development chronology: [docs/PROJECT_TIMELINE.md](docs/PROJECT_TIMELINE.md)

---

## Licence

Released under the [MIT Licence](LICENSE).
