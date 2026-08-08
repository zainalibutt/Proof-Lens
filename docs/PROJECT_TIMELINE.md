# Project Timeline

Development chronology derived directly from the commit history in this repository. All
dates are genuine author dates; no commits were backdated, reordered, or fabricated.

**Span:** 29 January 2026 → 25 April 2026 · **58 commits**

| Month | Commits |
|---|---|
| January 2026 | 10 |
| February 2026 | 6 |
| March 2026 | 17 |
| April 2026 | 25 |

---

## January 2026 — Core trust pipeline

The cryptographic foundation landed almost immediately, and its shape did not
substantially change afterwards.

- Baseline project and S3 upload path
- Web dashboard with Supabase authentication and API client
- Verification share links for third-party review, with a supporting SQL schema
- Device provenance hardening; `sha256` → `id` identifier rename across the pipeline
- Capture evidence bundle ZIP export and download endpoint
- API server module restructure (+334 / −569)

## February 2026 — Platform breadth

Fewer commits, larger scope: the month the system stopped being photo-only.

- Web layout and mobile recents screen restructure
- Capture deletion from the mobile queue
- Burst capture support across API and web (+2,225 lines)
- AWS S3 object pathing fix
- Full audio capture branch landed on the main setup

## March 2026 — Interface, structure, and hardening

The heaviest refactoring period.

- Drag-and-drop upload and date-grouped frames
- Web UI decomposed into reusable components (`EvidencePanel`, `StatusBadge`,
  `VerificationDropZone`, and others)
- Vercel deployment configuration; hosted-deployment API client fixes
- Stylesheets split into modular `tokens` / `reset` / `responsive` / `utilities`
- Database schema consolidated; redundant code removed
- Guided tutorials, API diagnostics, responsive breakpoints
- API verification, auth, validation, and mobile retry hardening
- QR-based mobile device pairing

## April 2026 — Anchoring, assurance, and documentation

- Dashboard split into routed page components
- **RFC 3161 TSA anchoring** added (`prooflens-api/src/tsa.ts`)
- Draft handling and expanded API validation
- Database schema relocated into a dedicated `database/` directory
- Mobile configuration moved to environment variables; `.env.example` files added
- Cryptographic verification utilities hardened (`utils/crypto.ts` +136)
- API route typing and build configuration tightened
- **Cryptographic assurance test suite** (`tests/test-crypto-01..04.js`) and
  `scripts/crypto-assurance.js`
- Architecture and credential-pipeline diagrams regenerated

---

## Observations

- **The security model was established early and held.** Hash → sign → re-hash → anchor
  was in place within the first weeks; later work extended reach (audio, bursts, sharing)
  and hardened validation rather than revising the core design.
- **The server-side re-hash was foundational, not retrofitted.** It predates most feature
  work — the system never trusted client-reported hashes.
- **TSA anchoring came last** among the cryptographic properties, which is why the design
  degrades gracefully without it: captures and verification remain functional, simply
  without an independent time bound.
- **Testing concentrated at the end.** The assurance suite arrived in April, after the
  functionality it validates. On a longer project this would ideally have been continuous.

---

## Note on this repository's history

The commit history is authentic and unedited in date, author, and order. Two changes were
made before publication:

1. **File removal.** Credentials, private development artefacts, personal information, and
   university administrative material were purged from all reachable commits. Four commits
   that contained *only* such material became empty and were pruned (62 → 58).
2. **Commit message rewriting.** 41 informal commit messages were replaced with neutral,
   accurate descriptions derived from each commit's actual diff. 17 already-accurate
   messages were left unchanged. No message claims work its commit did not contain.

Everything else — dates, authorship, sequence, and code content — is as originally
committed.
