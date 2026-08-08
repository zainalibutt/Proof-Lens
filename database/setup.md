# ProofLens Database Setup

## 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New Project**.
3. Choose an organisation, enter a project name (e.g. `prooflens`), set a database password, and select a region.
4. Wait for the project to finish provisioning.

## 2. Open SQL Editor

1. In the Supabase dashboard, open the **SQL Editor** from the left sidebar.
2. Click **New query**.

## 3. Run Schema and Hardening Migration

1. Open `database/schema_clean.sql` from this repository.
2. Copy the **entire** file contents.
3. Paste into the SQL Editor query window.
4. Click **Run** (or press `Ctrl+Enter`).
5. The output should show `Success. No rows returned.` with no errors.
6. Open `database/migrations/001_lock_down_evidence_writes.sql` and run the entire file.
   This second step is mandatory: it establishes the server-only database boundary and is
   idempotent, so it is safe to re-run.
7. Optionally run `database/tests/cross_tenant_isolation_test.sql` as an administrative
   role. It uses synthetic fixtures and always rolls back.

## 4. Verification

After running the schema, confirm the following in the **Table Editor**:

| Table                 | Purpose                            |
|-----------------------|------------------------------------|
| `device_keys`         | Device → public key binding        |
| `device_key_audit`    | Device registration audit log      |
| `upload_audit`        | Credential upload audit log        |
| `bursts`              | Burst capture groups               |
| `credentials`         | Submitted image credentials        |
| `drafts`              | Image capture drafts (staging)     |
| `audio_records`       | Submitted audio evidence           |
| `audio_drafts`        | Audio capture drafts (staging)     |
| `verification_shares` | Image share links                  |
| `audio_shares`        | Audio share links                  |

All 10 tables should appear. The view `v_queue` will be visible under **Database → Views**.

## 5. Collect API Credentials

The backend and mobile app require two values from **Settings → API**:

- **Project URL** — e.g. `https://xxxx.supabase.co`
- **anon (public) key** — safe to embed in client apps
- **service_role key** — used by the backend only; never expose to clients

## 6. AWS S3 Setup

This policy allows the mobile client to upload media and the backend to retrieve and verify stored objects.

1. Create an S3 bucket for media storage.
2. Create an IAM user for this project.
3. Attach the policy in `database/iam_policy.json` (replace `YOUR_BUCKET_NAME`).
4. Generate an access key and secret for that IAM user.
5. Add these values to your app environment files:

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `S3_BUCKET`

## 7. Notes

- Provisioning consists of the schema followed by the mandatory hardening migration above.
- Row-level security is enabled and forced on every table. The backend uses the
  `service_role` key. The web/mobile clients use Supabase Auth only and have no direct
  privileges on application tables or views.
- `credentials` and `audio_records` are protected by immutability triggers — only TSA-related fields can be updated after insert. Deletes are blocked.
- `device_key_audit` and `upload_audit` are append-only (trigger-enforced).
- The `pgcrypto` extension is pre-installed on Supabase. The schema enables it explicitly as a safety measure.
