# Contributing

ProofLens is primarily a personal portfolio and research project. It is published so the
engineering and its limitations can be examined, rather than to grow a contributor base.
Issues, questions, and corrections are genuinely welcome — especially on the cryptographic
reasoning.

## Most useful contributions

1. **Corrections to security claims.** If anything in [THREAT_MODEL.md](THREAT_MODEL.md)
   or the README overstates a guarantee, that is the highest-value issue you can file.
2. **Verification failures.** If `verify.sh` / `verify.ps1` fails on a bundle that should
   verify, please include your OpenSSL version and platform.
3. **Reproducibility problems** in local setup.

For suspected vulnerabilities, use the private channel in [SECURITY.md](SECURITY.md)
rather than a public issue.

## Development setup

Node.js 24.13.0 (see `.nvmrc`). OpenSSL on PATH is required for TSA flows.

```bash
cd prooflens-api && npm install && cp .env.example .env && npm run dev
cd web          && npm install && cp .env.example .env && npm run dev
cd mobile       && npm install && cp .env.example .env && npx expo start --clear --lan
```

Running against your own infrastructure also needs a Supabase project
(`database/schema_clean.sql`, see `database/setup.md`) and an S3 bucket scoped to
`database/iam_policy.json`.

## Tests

```bash
cd prooflens-api
node tests/test-crypto-01.js       # through test-crypto-04.js
node scripts/crypto-assurance.js   # end-to-end cryptographic assurance checks
```

Changes touching hashing, signing, TSA handling, or verification **must** keep the
crypto-assurance checks passing, and should state in the PR description which properties
were re-verified.

## Conventions

- TypeScript throughout; match the surrounding style rather than introducing new patterns.
- Commit messages follow `type: summary` (`feat`, `fix`, `refactor`, `docs`, `test`,
  `chore`, `style`).
- Never commit real credentials. `.env.example` files carry placeholders and the public
  Supabase `anon` key only.
- Do not modify files under `docs/captureevidencebundle/`. It is a genuine signed
  fixture; **any** byte change invalidates its signature and destroys its purpose.
- Never commit real capture media. Sample bundles must be deliberately staged captures
  with location services disabled and no identifiable people or surroundings.

## Scope boundaries

Changes that weaken or blur the stated guarantees will not be accepted. In particular,
documentation must not imply that ProofLens establishes that captured content depicts
something real, or that it defeats a compromised device or application build. Those limits
are intrinsic — see [THREAT_MODEL.md](THREAT_MODEL.md) §4.
