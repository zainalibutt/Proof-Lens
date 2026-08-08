#!/usr/bin/env bash
set -euo pipefail

echo "== ProofLens offline verification =="

for f in capture.jpg capture.sha256.txt credential.json device_public_key.pem tsa_response.tsr tsa_ca.pem; do
  if [[ ! -f "$f" ]]; then echo "Missing $f"; exit 1; fi
done

expected_sha=$(tr -d "
 " < capture.sha256.txt)
if [[ ! "$expected_sha" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "Invalid expected SHA-256 in capture.sha256.txt"; exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  actual_sha=$(sha256sum capture.jpg | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual_sha=$(shasum -a 256 capture.jpg | awk '{print $1}')
else
  actual_sha=$(openssl dgst -sha256 capture.jpg | awk '{print $2}')
fi

if [[ "${actual_sha,,}" != "${expected_sha,,}" ]]; then
  echo "FAIL: hash mismatch";
  echo " expected: $expected_sha";
  echo " computed: $actual_sha";
  exit 2
fi

echo "OK: hash matches ($actual_sha)"

meta=""
if command -v python3 >/dev/null 2>&1; then
  meta=$(python3 - <<'PY'
import json, base64, binascii
from pathlib import Path

cred = json.loads(Path('credential.json').read_text('utf-8'))
sig = cred.get('signature_b64') or ''
if not sig:
  raise SystemExit(3)

Path('signature.bin').write_bytes(base64.b64decode(sig))
sha = Path('capture.sha256.txt').read_text('utf-8').strip()
Path('sha256.bin').write_bytes(binascii.unhexlify(sha))

print(cred.get('capture_id','') or '')
print(cred.get('tsa_time','') or '')
PY
)
elif command -v node >/dev/null 2>&1; then
  meta=$(node - <<'NODE'
const fs = require('fs');
const cred = JSON.parse(fs.readFileSync('credential.json','utf8'));
if (!cred.signature_b64) process.exit(3);
fs.writeFileSync('signature.bin', Buffer.from(cred.signature_b64, 'base64'));
const sha = fs.readFileSync('capture.sha256.txt','utf8').trim();
fs.writeFileSync('sha256.bin', Buffer.from(sha, 'hex'));
console.log(cred.capture_id || '');
console.log(cred.tsa_time || '');
NODE
)
else
  echo "FAIL: need python3 or node to parse credential.json"; exit 3
fi

cap_id=$(printf "%s" "$meta" | sed -n "1p")
tsa_time=$(printf "%s" "$meta" | sed -n "2p")

set +e
openssl pkeyutl -verify -pubin -inkey device_public_key.pem -sigfile signature.bin -rawin -in sha256.bin >/dev/null 2>&1
sig_ok=$?
if [[ $sig_ok -ne 0 ]]; then
  # fallback for some OpenSSL builds
  openssl pkeyutl -verify -pubin -inkey device_public_key.pem -sigfile signature.bin -in sha256.bin >/dev/null 2>&1
  sig_ok=$?
fi
set -e

if [[ $sig_ok -ne 0 ]]; then
  echo "FAIL: signature invalid"; exit 4
fi

echo "OK: signature valid"

echo "Verifying TSA timestamp..."
set +e
if [[ -f tsa_query.tsq ]]; then
  openssl ts -verify -in tsa_response.tsr -queryfile tsa_query.tsq -CAfile tsa_ca.pem >/dev/null 2>&1
  tsa_ok=$?
else
  openssl ts -verify -in tsa_response.tsr -digest "$expected_sha" -CAfile tsa_ca.pem >/dev/null 2>&1
  tsa_ok=$?
fi
set -e

if [[ $tsa_ok -ne 0 ]]; then
  # If the original request nonce is unknown, queryfile verification can fail.
  openssl ts -verify -in tsa_response.tsr -digest "$expected_sha" -CAfile tsa_ca.pem >/dev/null
fi

echo "OK: TSA timestamp valid"

fingerprint=$(openssl pkey -pubin -in device_public_key.pem -outform DER | openssl dgst -sha256 | awk '{print $2}')

echo ""
echo "VALID"
echo "capture_id: ${cap_id}"
echo "hash: ${actual_sha,,}"
echo "tsa_time: ${tsa_time}"
echo "key_fingerprint_sha256: $fingerprint"
