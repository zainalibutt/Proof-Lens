ProofLens Evidence Bundle

Capture ID: baf3a498-c930-4b3f-a827-4a924f8c985b
Generated: 2026-04-14T11:19:04.524Z

Offline verification steps:
1) Hash check: recompute SHA-256 of capture.jpg and compare to capture.sha256.txt
2) Signature check: verify credential.json.signature_b64 over the SHA-256 BYTES (32 bytes) using device_public_key.pem
3) TSA verification:
   Preferred: openssl ts -verify -in tsa_response.tsr -queryfile tsa_query.tsq -CAfile tsa_ca.pem
   Fallback (nonce-safe): openssl ts -verify -in tsa_response.tsr -digest <sha256hex> -CAfile tsa_ca.pem

Quick start:
- macOS/Linux: ./verify.sh
- Windows (PowerShell): .\verify.ps1

Notes:
- This bundle is designed to be self-contained for offline storage.
- The only external dependency is OpenSSL for TSA and signature verification.
