'use strict';

const crypto = require('crypto');
const nacl = require('tweetnacl');

let jsSha256 = null;
try {
  jsSha256 = require('js-sha256');
} catch {
  try {
    jsSha256 = require('../../mobile/node_modules/js-sha256');
  } catch {
    jsSha256 = null;
  }
}

function hexToUint8Array(hex) {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

function hexToBuffer(hex) {
  return Buffer.from(hex, 'hex');
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch\nexpected: ${expected}\nactual:   ${actual}`);
  }
}

function assertTrue(value, label) {
  if (!value) {
    throw new Error(`${label} expected true`);
  }
}

function assertFalse(value, label) {
  if (value) {
    throw new Error(`${label} expected false`);
  }
}

const ed25519Vectors = [
  {
    id: 'RFC8032-ED25519-1',
    seedHex: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
    publicKeyHex: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
    messageHex: '',
    signatureHex: 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
  },
  {
    id: 'RFC8032-ED25519-2',
    seedHex: '4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb',
    publicKeyHex: '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c',
    messageHex: '72',
    signatureHex: '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
  },
];

const sha256Vectors = [
  {
    id: 'SHA256-KAT-EMPTY',
    message: '',
    digestHex: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  },
  {
    id: 'SHA256-KAT-ABC',
    message: 'abc',
    digestHex: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  },
  {
    id: 'SHA256-KAT-LONG',
    message: 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
    digestHex: '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  },
  {
    id: 'SHA256-KAT-1M-A',
    message: 'a'.repeat(1000000),
    digestHex: 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
  },
];

function runEd25519Vectors() {
  console.log('SECTION A - RFC 8032 Ed25519 known-answer tests');

  for (const vector of ed25519Vectors) {
    const message = hexToUint8Array(vector.messageHex);
    const seed = hexToUint8Array(vector.seedHex);
    const keyPair = nacl.sign.keyPair.fromSeed(seed);
    const derivedPublicKeyHex = Buffer.from(keyPair.publicKey).toString('hex');
    const generatedSignatureHex = Buffer.from(nacl.sign.detached(message, keyPair.secretKey)).toString('hex');
    const publishedSignature = hexToUint8Array(vector.signatureHex);

    assertEqual(derivedPublicKeyHex, vector.publicKeyHex, `${vector.id} public key`);
    assertEqual(generatedSignatureHex, vector.signatureHex, `${vector.id} signature`);
    assertTrue(nacl.sign.detached.verify(message, publishedSignature, keyPair.publicKey), `${vector.id} verification`);

    const tamperedMessage = new Uint8Array(message.length > 0 ? message : new Uint8Array([0]));
    if (tamperedMessage.length > 0) tamperedMessage[0] ^= 0x01;
    assertFalse(nacl.sign.detached.verify(tamperedMessage, publishedSignature, keyPair.publicKey), `${vector.id} tampered message rejection`);

    console.log(`PASS ${vector.id}`);
  }
}

function runSha256Vectors() {
  console.log('SECTION B - SHA-256 known-answer tests');

  if (!jsSha256) {
    console.log('NOTE js-sha256 was not available in prooflens-api node_modules; this batch validates the published SHA-256 digests with Node crypto only. Cross-library agreement with the mobile library remains covered by T-CRYPTO-02.');
  }

  for (const vector of sha256Vectors) {
    const data = Buffer.from(vector.message, 'utf8');
    const nodeDigest = crypto.createHash('sha256').update(data).digest('hex');

    assertEqual(nodeDigest, vector.digestHex, `${vector.id} node digest`);
    if (jsSha256) {
      const jsDigest = jsSha256.sha256(data);
      assertEqual(jsDigest, vector.digestHex, `${vector.id} js-sha256 digest`);
    }
    console.log(`PASS ${vector.id}`);
  }
}

function signStructuredToken(secret, payload) {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sigB64 = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sigB64}`;
}

function verifyStructuredToken(secret, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return false;

  const [payloadB64, sigB64] = parts;
  const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  const actual = Buffer.from(sigB64);
  const expectedBuf = Buffer.from(expected);
  if (actual.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actual, expectedBuf);
}

function runTokenChecks() {
  console.log('SECTION C - Structured token negative controls');

  const secret = 'prooflens-v17-1-test-secret';
  const payload = {
    v: 1,
    captureId: 'example-capture-id',
    sha256: crypto.createHash('sha256').update('bundle-example', 'utf8').digest('hex'),
    exp: '2026-12-31T23:59:59.000Z',
  };

  const genuine = signStructuredToken(secret, payload);
  assertTrue(verifyStructuredToken(secret, genuine), 'genuine token');

  const [payloadB64, sigB64] = genuine.split('.');
  const tamperedPayload = `${payloadB64.slice(0, -1)}${payloadB64.endsWith('A') ? 'B' : 'A'}.${sigB64}`;
  assertFalse(verifyStructuredToken(secret, tamperedPayload), 'tampered payload token');

  const tamperedSig = `${payloadB64}.${sigB64.slice(0, -1)}${sigB64.endsWith('A') ? 'B' : 'A'}`;
  assertFalse(verifyStructuredToken(secret, tamperedSig), 'tampered signature token');

  assertFalse(verifyStructuredToken('wrong-secret', genuine), 'wrong secret token');
  assertFalse(verifyStructuredToken(secret, 'not-a-valid-token'), 'garbage token');

  console.log('PASS TOKEN-GENUINE');
  console.log('PASS TOKEN-TAMPERED-PAYLOAD');
  console.log('PASS TOKEN-TAMPERED-SIGNATURE');
  console.log('PASS TOKEN-WRONG-SECRET');
  console.log('PASS TOKEN-GARBAGE');
}

function main() {
  console.log('ProofLens v17.1 crypto assurance');
  console.log(`Node ${process.version}`);
  console.log(`Generated ${new Date().toISOString()}`);
  console.log('');

  runEd25519Vectors();
  console.log('');
  runSha256Vectors();
  console.log('');
  runTokenChecks();
  console.log('');
  console.log('RESULT: ALL CRYPTO ASSURANCE CHECKS PASSED');
}

try {
  main();
} catch (error) {
  console.error('RESULT: FAILURE');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}