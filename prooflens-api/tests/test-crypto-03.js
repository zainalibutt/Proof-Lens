const crypto = require('crypto');

console.log('T-CRYPTO-03: HMAC-SHA256 bundle token validation\n');

const secret = 'test-hmac-secret-key-for-evaluation';

// Simulate token generation (mirrors crypto.ts signStructuredToken logic)
function generateToken(payload) {
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig  = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  return b64 + '.' + sig;
}

// Simulate token verification (mirrors crypto.ts decodeVerifiedPayload logic)
function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [b64, sig] = parts;
  const expected = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(sig),
      Buffer.from(expected)
    );
  } catch {
    return false; // length mismatch = invalid
  }
}

const payload = { captureId: 'abc-123', shareId: 'def-456', ts: 1700000000 };
const token   = generateToken(payload);

// TEST 1: Genuine token verifies
console.log('TEST 1 - Genuine token accepted: ' + (verifyToken(token) === true  ? 'PASS' : 'FAIL'));

// TEST 2: Tampered payload rejected
// Find a character in the payload portion that differs from our replacement char.
const flipIdx = 2; // always a payload char
const flipChar = token[flipIdx] === 'Z' ? 'Y' : 'Z'; // guaranteed to differ
const tampered = token.slice(0, flipIdx) + flipChar + token.slice(flipIdx + 1);
console.log('TEST 2 - Tampered token rejected: ' + (verifyToken(tampered) === false ? 'PASS' : 'FAIL'));

// TEST 3: Wrong secret rejected
function verifyWithWrongSecret(token) {
  const [b64, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', 'wrong-secret').update(b64).digest('base64url');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch { return false; }
}
console.log('TEST 3 - Wrong secret rejected:  ' + (verifyWithWrongSecret(token) === false ? 'PASS' : 'FAIL'));

// TEST 4: Completely garbage token rejected
console.log('TEST 4 - Garbage token rejected: ' + (verifyToken('notavalidtoken') === false ? 'PASS' : 'FAIL'));
