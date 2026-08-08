# Academic Demonstration Walkthrough

> This document preserves the assessment-oriented walkthrough written for the original
> university submission. It is retained for completeness; general readers should start
> with the [README](../README.md) and [VERIFICATION.md](VERIFICATION.md).

ProofLens originated as a university final-year project developed between January and
April 2026. This repository contains a sanitised public edition of the authentic
development history. Credentials, private development artefacts, personal information and
university administrative material were removed before publication.

The backend (Railway), database (Supabase), and dashboard (Vercel) are hosted. No
infrastructure setup is required to exercise the system.

The demonstration requires a **live capture**. Pre-inserted data would contradict the core
claim: the system exists to show that a specific device produced a specific file at a
specific time.

**Time:** ~2 minutes of active steps; allow 5–8 minutes on a first run for `npm install`.

## Requirements

- Node.js ≥ 18 (`node --version`)
- **Expo Go** on a smartphone — [App Store] · [Play Store]
- Phone and laptop on the same Wi-Fi (see [Network fallback](#network-fallback))
- OpenSSL on PATH (for RFC 3161 verification)

---

## Step 1 — Start the mobile app

PowerShell, from the repository root:

```powershell
cd mobile; npm install; Copy-Item .env.example .env; npx expo start --clear --lan
```

`.env.example` is pre-filled with the hosted API and Supabase values.

Scan the **terminal** QR code in Expo Go. If a browser opens with a different QR, ignore
it and use the terminal one.

On first launch: sign up, confirm, and log in. The app generates and registers a device
keypair for that account.

## Step 2 — Capture and upload

Take a photo from the Capture screen, then a recording from the Audio screen. Both follow
the same trust flow:

1. SHA-256 computed on-device
2. Ed25519 signature over the digest
3. Presigned upload target requested from the API
4. Media uploaded directly to S3
5. Credential metadata submitted; the API re-hashes the stored object and verifies

Both appear in their Recent/Queue views.

## Step 3 — Browse evidence

1. Open **https://proof-lens.vercel.app**
2. Sign in with the same account
3. Open **Evidence** and select the uploaded photo or audio
4. Review hash, signature, device key, timestamps, and status

## Step 4 — Verify in the dashboard

Use **Verify** to recompute SHA-256 against stored evidence and see the result in-app.
This is independent of the bundle download.

## Step 5 — Verify via share link

1. Click **Share** to mint a signed, time-limited link
2. Open it in a private/incognito window
3. Upload the original file when prompted

This demonstrates third-party verification without a dashboard login.

## Step 6 — Offline bundle verification

Click **Evidence Bundle** to download the ZIP, extract it, then from the bundle root:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\verify.ps1
```

macOS/Linux: `./verify.sh`

This performs hash, signature, and TSA checks entirely offline. See
[VERIFICATION.md](VERIFICATION.md) for what each check proves.

---

## What each action demonstrates

| Action | Demonstrates |
|---|---|
| **Verify** | In-app verification against stored evidence |
| **Evidence** | Full credential detail: hash, signature, key, timestamps, TSA status |
| **Share** | Public, time-limited third-party verification |
| **Evidence Bundle** | Portable offline verification via `verify.ps1` / `verify.sh` |

## Hosted endpoints

| Service | URL |
|---|---|
| Web dashboard | https://proof-lens.vercel.app |
| API | https://proof-lens-production.up.railway.app |

## Network fallback

If the phone cannot reach the laptop over LAN (common on university networks with client
isolation):

```bash
npx expo start --clear --tunnel
```

Accept the prompt to install `@expo/ngrok`. Tunnel mode routes the Expo dev connection via
Expo's relay; the hosted API and Supabase are unaffected.

## Local full-stack reproduction

Not required for assessment — the hosted system is the intended demonstration. Running
fully locally requires an independent Supabase project and S3 bucket; see the
[README](../README.md#local-setup) and `database/setup.md`.

TSA anchoring is optional: with `TSA_URL` unset, captures and verification remain
functional, and credentials persist in a submitted rather than anchored state.

---

## Scope note

The walkthrough demonstrates the cryptographic pipeline end to end. It does not establish
that captured content depicts something real — see
[../THREAT_MODEL.md](../THREAT_MODEL.md) for the trusted computing base and the full list
of limitations.

[App Store]: https://apps.apple.com/app/expo-go/id982107779
[Play Store]: https://play.google.com/store/apps/details?id=host.exp.exponent
