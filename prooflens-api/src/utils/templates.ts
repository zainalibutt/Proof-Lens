// prooflens-api/src/utils/templates.ts

export const VERIFY_SH_TEMPLATE = `#!/usr/bin/env bash
set -euo pipefail

echo "== ProofLens offline verification =="

for f in capture.jpg capture.sha256.txt credential.json device_public_key.pem tsa_response.tsr tsa_ca.pem; do
  if [[ ! -f "$f" ]]; then echo "Missing $f"; exit 1; fi
done

expected_sha=$(tr -d "\r\n " < capture.sha256.txt)
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

if [[ "${'${'}actual_sha,,}" != "${'${'}expected_sha,,}" ]]; then
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

IFS=$'\n' read -r cap_id tsa_time <<<"$meta"

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
echo "capture_id: ${'${'}cap_id}"
echo "hash: ${'${'}actual_sha,,}"
echo "tsa_time: ${'${'}tsa_time}"
echo "key_fingerprint_sha256: $fingerprint"
`;

export const VERIFY_PS1_TEMPLATE = `# ProofLens offline verification (PowerShell)
$ErrorActionPreference = 'Stop'

# Some PowerShell setups treat native stderr as errors (NativeCommandError)
# which can break verification because OpenSSL prints harmless info to stderr.
try {
  if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
    $global:PSNativeCommandUseErrorActionPreference = $false
  }
} catch { }

Write-Host '== ProofLens offline verification =='

foreach ($f in @('capture.jpg','capture.sha256.txt','credential.json','device_public_key.pem','tsa_response.tsr','tsa_ca.pem')) {
  if (!(Test-Path $f)) { throw "Missing $f" }
}

$expected = (Get-Content capture.sha256.txt -Raw).Trim()
if ($expected -notmatch '^[0-9a-fA-F]{64}$') { throw 'Invalid expected SHA-256 in capture.sha256.txt' }

$actual = (Get-FileHash -Algorithm SHA256 -Path capture.jpg).Hash.ToLower()
if ($actual -ne $expected.ToLower()) {
  throw @"
FAIL: hash mismatch
 expected: $expected
 computed: $actual
"@
}
Write-Host "OK: hash matches ($actual)"

$cred = Get-Content credential.json -Raw | ConvertFrom-Json
if (-not $cred.signature_b64) { throw 'FAIL: credential.json.signature_b64 missing' }

# Write signature.bin
[IO.File]::WriteAllBytes('signature.bin', [Convert]::FromBase64String([string]$cred.signature_b64))

function HexToBytes([string]$hex) {
  $hex = $hex.Trim()
  if ($hex.Length % 2 -ne 0) { throw 'Invalid hex length' }
  $bytes = New-Object byte[] ($hex.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    $bytes[$i] = [Convert]::ToByte($hex.Substring($i*2, 2), 16)
  }
  return $bytes
}

[IO.File]::WriteAllBytes('sha256.bin', (HexToBytes $expected))

# Signature verify (Ed25519 over SHA-256 bytes)
$oldEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$null = & openssl pkeyutl -verify -pubin -inkey device_public_key.pem -sigfile signature.bin -rawin -in sha256.bin 2>$null
if ($LASTEXITCODE -ne 0) {
  $null = & openssl pkeyutl -verify -pubin -inkey device_public_key.pem -sigfile signature.bin -in sha256.bin 2>$null
}
$ErrorActionPreference = $oldEap
if ($LASTEXITCODE -ne 0) { throw 'FAIL: signature invalid' }
Write-Host 'OK: signature valid'

# TSA verify
Write-Host 'Verifying TSA timestamp…'
$oldEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
if (Test-Path 'tsa_query.tsq') {
  $null = & openssl ts -verify -in tsa_response.tsr -queryfile tsa_query.tsq -CAfile tsa_ca.pem 2>$null
} else {
  $null = & openssl ts -verify -in tsa_response.tsr -digest $expected -CAfile tsa_ca.pem 2>$null
}
$ErrorActionPreference = $oldEap
if ($LASTEXITCODE -ne 0) {
  # If the original request nonce is unknown, queryfile verification can fail.
  $oldEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $null = & openssl ts -verify -in tsa_response.tsr -digest $expected -CAfile tsa_ca.pem 2>$null
  $ErrorActionPreference = $oldEap
  if ($LASTEXITCODE -ne 0) { throw 'FAIL: TSA verification failed' }
}
Write-Host 'OK: TSA timestamp valid'

$tmpDer = 'device_public_key.der'
$oldEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$null = & openssl pkey -pubin -in device_public_key.pem -outform DER -out $tmpDer 2>$null
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $oldEap; throw 'FAIL: could not export public key DER' }
$dgstOut = (& openssl dgst -sha256 $tmpDer 2>$null)
$ErrorActionPreference = $oldEap
Remove-Item -Force $tmpDer -ErrorAction SilentlyContinue
$m = ([string]($dgstOut -join "\n")).ToLower() | Select-String -Pattern '[0-9a-f]{64}' | Select-Object -First 1
if (-not $m) { throw 'FAIL: could not compute key fingerprint' }
$fp = $m.Matches[0].Value

Write-Host ''
Write-Host 'VALID'
Write-Host ("capture_id: {0}" -f $cred.capture_id)
Write-Host ("hash: {0}" -f $actual)
Write-Host ("tsa_time: {0}" -f $cred.tsa_time)
Write-Host ("key_fingerprint_sha256: {0}" -f $fp)
`;

export const VERIFY_AUDIO_SH_TEMPLATE = `#!/usr/bin/env bash
set -euo pipefail

echo "== ProofLens offline verification (Audio) =="

for f in audio.m4a audio.sha256.txt credential.json device_public_key.pem tsa_response.tsr tsa_ca.pem; do
  if [[ ! -f "$f" ]]; then echo "Missing $f"; exit 1; fi
done

expected_sha=$(tr -d "\r\n " < audio.sha256.txt)
if [[ ! "$expected_sha" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "Invalid expected SHA-256 in audio.sha256.txt"; exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  actual_sha=$(sha256sum audio.m4a | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual_sha=$(shasum -a 256 audio.m4a | awk '{print $1}')
else
  actual_sha=$(openssl dgst -sha256 audio.m4a | awk '{print $2}')
fi

if [[ "${'${'}actual_sha,,}" != "${'${'}expected_sha,,}" ]]; then
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
sha = Path('audio.sha256.txt').read_text('utf-8').strip()
Path('sha256.bin').write_bytes(binascii.unhexlify(sha))

print(cred.get('audio_id','') or '')
print(cred.get('tsa_time','') or '')
PY
)
elif command -v node >/dev/null 2>&1; then
  meta=$(node - <<'NODE'
const fs = require('fs');
const cred = JSON.parse(fs.readFileSync('credential.json','utf8'));
if (!cred.signature_b64) process.exit(3);
fs.writeFileSync('signature.bin', Buffer.from(cred.signature_b64, 'base64'));
const sha = fs.readFileSync('audio.sha256.txt','utf8').trim();
fs.writeFileSync('sha256.bin', Buffer.from(sha, 'hex'));
console.log(cred.audio_id || '');
console.log(cred.tsa_time || '');
NODE
)
else
  echo "FAIL: need python3 or node to parse credential.json"; exit 3
fi

IFS=$'\n' read -r audio_id tsa_time <<<"$meta"

set +e
openssl pkeyutl -verify -pubin -inkey device_public_key.pem -sigfile signature.bin -rawin -in sha256.bin >/dev/null 2>&1
sig_ok=$?
if [[ $sig_ok -ne 0 ]]; then
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
  openssl ts -verify -in tsa_response.tsr -digest "$expected_sha" -CAfile tsa_ca.pem >/dev/null
fi

echo "OK: TSA timestamp valid"

fingerprint=$(openssl pkey -pubin -in device_public_key.pem -outform DER | openssl dgst -sha256 | awk '{print $2}')

echo ""
echo "VALID"
echo "audio_id: ${'${'}audio_id}"
echo "hash: ${'${'}actual_sha,,}"
echo "tsa_time: ${'${'}tsa_time}"
echo "key_fingerprint_sha256: $fingerprint"
`;

export const VERIFY_AUDIO_PS1_TEMPLATE = `# ProofLens offline verification (Audio, PowerShell)
$ErrorActionPreference = 'Stop'

try {
  if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
    $global:PSNativeCommandUseErrorActionPreference = $false
  }
} catch { }

Write-Host '== ProofLens offline verification (Audio) =='

foreach ($f in @('audio.m4a','audio.sha256.txt','credential.json','device_public_key.pem','tsa_response.tsr','tsa_ca.pem')) {
  if (!(Test-Path $f)) { throw "Missing $f" }
}

$expected = (Get-Content audio.sha256.txt -Raw).Trim()
if ($expected -notmatch '^[0-9a-fA-F]{64}$') { throw 'Invalid expected SHA-256 in audio.sha256.txt' }

$actual = (Get-FileHash -Algorithm SHA256 -Path audio.m4a).Hash.ToLower()
if ($actual -ne $expected.ToLower()) {
  throw @"
FAIL: hash mismatch
 expected: $expected
 computed: $actual
"@
}
Write-Host "OK: hash matches ($actual)"

$cred = Get-Content credential.json -Raw | ConvertFrom-Json
if (-not $cred.signature_b64) { throw 'FAIL: credential.json.signature_b64 missing' }

[IO.File]::WriteAllBytes('signature.bin', [Convert]::FromBase64String([string]$cred.signature_b64))

function HexToBytes([string]$hex) {
  $hex = $hex.Trim()
  if ($hex.Length % 2 -ne 0) { throw 'Invalid hex length' }
  $bytes = New-Object byte[] ($hex.Length / 2)
  for ($i = 0; $i -lt $bytes.Length; $i++) {
    $bytes[$i] = [Convert]::ToByte($hex.Substring($i*2, 2), 16)
  }
  return $bytes
}

[IO.File]::WriteAllBytes('sha256.bin', (HexToBytes $expected))

$oldEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$null = & openssl pkeyutl -verify -pubin -inkey device_public_key.pem -sigfile signature.bin -rawin -in sha256.bin 2>$null
if ($LASTEXITCODE -ne 0) {
  $null = & openssl pkeyutl -verify -pubin -inkey device_public_key.pem -sigfile signature.bin -in sha256.bin 2>$null
}
$ErrorActionPreference = $oldEap
if ($LASTEXITCODE -ne 0) { throw 'FAIL: signature invalid' }
Write-Host 'OK: signature valid'

Write-Host 'Verifying TSA timestamp…'
$oldEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
if (Test-Path 'tsa_query.tsq') {
  $null = & openssl ts -verify -in tsa_response.tsr -queryfile tsa_query.tsq -CAfile tsa_ca.pem 2>$null
} else {
  $null = & openssl ts -verify -in tsa_response.tsr -digest $expected -CAfile tsa_ca.pem 2>$null
}
$ErrorActionPreference = $oldEap
if ($LASTEXITCODE -ne 0) {
  $oldEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $null = & openssl ts -verify -in tsa_response.tsr -digest $expected -CAfile tsa_ca.pem 2>$null
  $ErrorActionPreference = $oldEap
  if ($LASTEXITCODE -ne 0) { throw 'FAIL: TSA verification failed' }
}
Write-Host 'OK: TSA timestamp valid'

$tmpDer = 'device_public_key.der'
$oldEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$null = & openssl pkey -pubin -in device_public_key.pem -outform DER -out $tmpDer 2>$null
if ($LASTEXITCODE -ne 0) { $ErrorActionPreference = $oldEap; throw 'FAIL: could not export public key DER' }
$dgstOut = (& openssl dgst -sha256 $tmpDer 2>$null)
$ErrorActionPreference = $oldEap
Remove-Item -Force $tmpDer -ErrorAction SilentlyContinue
$m = ([string]($dgstOut -join "\n")).ToLower() | Select-String -Pattern '[0-9a-f]{64}' | Select-Object -First 1
if (-not $m) { throw 'FAIL: could not compute key fingerprint' }
$fp = $m.Matches[0].Value

Write-Host ''
Write-Host 'VALID'
Write-Host ("audio_id: {0}" -f $cred.audio_id)
Write-Host ("hash: {0}" -f $actual)
Write-Host ("tsa_time: {0}" -f $cred.tsa_time)
Write-Host ("key_fingerprint_sha256: {0}" -f $fp)
`;
