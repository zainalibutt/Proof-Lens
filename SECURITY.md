# Security Policy

## Status of this project

ProofLens is a **portfolio and research project**, not a production security product. It
is not operated as a service with availability or response guarantees. Please read
[THREAT_MODEL.md](THREAT_MODEL.md) before relying on any property of this system — several
important limits are intrinsic to the design rather than fixable bugs.

## Reporting a vulnerability

Report suspected vulnerabilities privately via **GitHub Security Advisories**
("Report a vulnerability" under the Security tab).

Please do **not** open a public issue for a suspected vulnerability.

Useful details: affected component (mobile / API / web / database), reproduction steps,
observed versus expected behaviour, and impact. Proof-of-concept code is welcome.

This is a personal project maintained in spare time. Expect a best-effort response of a
few days, and no formal SLA.

## Scope

**In scope**

- Signature or hash verification that can be bypassed
- Row-level security bypass, or cross-tenant data access
- Share-token forgery, replay, or expiry bypass
- Presigned upload URL scope escalation
- Evidence-bundle token forgery
- Defeating the server-side re-hash check
- Circumventing evidence immutability triggers

**Out of scope** — documented limitations, not vulnerabilities (see
[THREAT_MODEL.md](THREAT_MODEL.md) §4):

- Signing synthetic, edited, or AI-generated content captured through the app
- Screen recapture / photographing a screen ("analogue hole")
- Key extraction from a rooted, jailbroken, or otherwise compromised device
- Attacks requiring a modified application build
- Device clock manipulation affecting `captured_at` (only `tsa_time` is attestable)
- Presence of the Supabase `anon` key in client code — public by design; clients use it for
  Auth and the browser roles have no application-table privileges
- EXIF metadata retained in the sample evidence bundle — required for signature validity

## Handling of credentials in this repository

No live secrets should exist anywhere in this repository or its history.

- `.env.example` files contain placeholders and the public `anon` key only.
- The `service_role` key, AWS credentials, and HMAC secrets are runtime environment
  configuration and are never committed.
- The public repository was recreated from a reviewed source snapshot. Private development
  history and pull-request refs were not copied into the new repository.
- An AWS key pair found in a private development artefact was reported deactivated by the
  owner; neither the key nor that artefact is present in the public snapshot.

If you believe you have found a live credential in this repository, please report it
through the private channel above rather than opening an issue.

## Verification without trusting this project

Evidence bundles are designed to be verified offline using only OpenSSL and the TSA CA
chain — no dependency on this project's servers, database, or continued existence. See
[docs/VERIFICATION.md](docs/VERIFICATION.md).


## What has and has not been verified

**Verified**

- No AWS, Supabase `service_role`, or database credentials appear in any reachable ref
  (Gitleaks full-history scan plus an independent blob-level scan across all refs).
- The sample capture bundle contains no location data, no people, and no identifying
  surroundings.
- `.env.example` files contain placeholders only; no live project identifiers.
- The deployed database has no application table/view privileges for `anon` or
  `authenticated`, no client data policies, and no client access to the legacy share RPC.
- Synthetic two-tenant tests reject cross-owner image and audio shares at composite foreign
  keys and accept the corresponding same-owner cases. The test transaction rolls back.

**Not independently verified / residual**

- **Credential rotation at the provider.** An AWS key pair that previously appeared in a
  development artefact was reported deactivated by the repository owner. This has not been
  independently confirmed against AWS.
- **Third-party assurance.** There has been no independent code audit, penetration test,
  hardware-attestation review, or forensic/legal validation.
- **Provider account controls.** Supabase's advisor currently reports leaked-password
  protection disabled and limited MFA options. These are deployment-account controls, not
  properties supplied by this source repository.
- **Mobile toolchain advisories.** The app is on current Expo SDK 57 and passes Expo Doctor,
  lint and TypeScript checks. `npm audit` still reports upstream Metro/React Native tooling
  advisories for which the current compatible dependency set offers no non-breaking fix.

See the README's hardening table and [THREAT_MODEL.md](THREAT_MODEL.md) for the guarantees
that remain outside the scope of this research prototype.
