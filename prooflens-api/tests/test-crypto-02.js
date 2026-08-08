const crypto  = require('crypto');
const jsSha256 = require('js-sha256');
const Buffer  = require('buffer').Buffer;

console.log('T-CRYPTO-02: SHA-256 consistency mobile vs server\n');

const testCases = [
  { desc: 'Short ASCII string',    data: Buffer.from('ProofLens test 2026') },
  { desc: 'Empty buffer',          data: Buffer.alloc(0) },
  { desc: '32 random bytes',       data: Buffer.from('a'.repeat(32)) },
  { desc: '10000 zero bytes',      data: Buffer.alloc(10000, 0) },
];

let allPassed = true;
testCases.forEach(tc => {
  const nodeHash = crypto.createHash('sha256').update(tc.data).digest('hex');
  const jsHash   = jsSha256.sha256(tc.data);
  const pass     = nodeHash === jsHash;
  if (!pass) allPassed = false;
  console.log((pass ? 'PASS' : 'FAIL') + ' - ' + tc.desc);
  if (!pass) {
    console.log('  Node:   ' + nodeHash);
    console.log('  js-sha: ' + jsHash);
  }
});

console.log('\nOverall: ' + (allPassed ? 'ALL PASS - libraries consistent' : 'FAIL - CRITICAL INCONSISTENCY'));
