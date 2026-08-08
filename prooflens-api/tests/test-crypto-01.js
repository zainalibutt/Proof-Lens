const nacl   = require('tweetnacl');
const Buffer = require('buffer').Buffer;

console.log('T-CRYPTO-01: Ed25519 sign/verify round-trip\n');

// Generate a test keypair
const keypair = nacl.sign.keyPair();

// Simulate a SHA-256 hash (32 bytes = 64 hex chars worth of data)
const fakeHash = Buffer.from('a'.repeat(64), 'hex');

// Sign the hash
const signature = nacl.sign.detached(fakeHash, keypair.secretKey);

// TEST 1: Verify genuine signature passes
const validResult = nacl.sign.detached.verify(
  fakeHash,
  signature,
  keypair.publicKey
);
console.log('TEST 1 - Genuine signature accepted: ' + (validResult === true ? 'PASS' : 'FAIL'));

// TEST 2: Verify tampered hash is rejected
const tamperedHash = Buffer.from(fakeHash);
tamperedHash[0] ^= 0x01; // flip one bit
const tamperedResult = nacl.sign.detached.verify(
  tamperedHash,
  signature,
  keypair.publicKey
);
console.log('TEST 2 - Tampered hash rejected:    ' + (tamperedResult === false ? 'PASS' : 'FAIL'));

// TEST 3: Verify wrong key is rejected
const wrongKeypair = nacl.sign.keyPair();
const wrongKeyResult = nacl.sign.detached.verify(
  fakeHash,
  signature,
  wrongKeypair.publicKey
);
console.log('TEST 3 - Wrong public key rejected: ' + (wrongKeyResult === false ? 'PASS' : 'FAIL'));

// TEST 4: Verify corrupted signature is rejected
const corruptedSig = Buffer.from(signature);
corruptedSig[0] ^= 0x01;
const corruptedSigResult = nacl.sign.detached.verify(
  fakeHash,
  corruptedSig,
  keypair.publicKey
);
console.log('TEST 4 - Corrupted signature rejected: ' + (corruptedSigResult === false ? 'PASS' : 'FAIL'));
