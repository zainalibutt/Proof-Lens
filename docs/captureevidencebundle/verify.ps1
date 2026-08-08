# ProofLens offline verification (PowerShell)
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
$m = ([string]($dgstOut -join "
")).ToLower() | Select-String -Pattern '[0-9a-f]{64}' | Select-Object -First 1
if (-not $m) { throw 'FAIL: could not compute key fingerprint' }
$fp = $m.Matches[0].Value

Write-Host ''
Write-Host 'VALID'
Write-Host ("capture_id: {0}" -f $cred.capture_id)
Write-Host ("hash: {0}" -f $actual)
Write-Host ("tsa_time: {0}" -f $cred.tsa_time)
Write-Host ("key_fingerprint_sha256: {0}" -f $fp)
