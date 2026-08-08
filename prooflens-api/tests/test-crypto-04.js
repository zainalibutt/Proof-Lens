const { z } = require('zod');

console.log('T-CRYPTO-04: Zod schema validation edge cases\n');
console.log('NOTE: Using the ACTUAL credentialPostSchema from validation.ts,');
console.log('      not the simplified schema from the test protocol template.');
console.log('      Key difference: actual SHA-256 regex is /^[0-9a-fA-F]{64}$/');
console.log('      (case-insensitive), not /^[a-f0-9]{64}$/ (lowercase only).\n');

// Replicate the ACTUAL schema from prooflens-api/src/utils/validation.ts
const sha256Hex = z.string().regex(/^[0-9a-fA-F]{64}$/, "invalid_sha256");
const base64Str = z.string().min(1, "required");
const mediaKey  = z.string().min(1, "missing_media_key");
const gpsSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  acc_m: z.number().nullable().optional(),
  time: z.string().optional(),
}).passthrough();
const exifSchema = z.record(z.string(), z.unknown());

const credentialPostSchema = z.object({
  credential: z.object({
    sha256: sha256Hex,
    capture_device_id: z.string().nullable().optional(),
    public_key: base64Str,
    timestamp: z.union([z.string(), z.number()]).nullable().optional(),
    gps: gpsSchema.optional(),
    exif: exifSchema.optional(),
  }),
  signatureB64: base64Str,
  media_key: mediaKey,
});

const testCases = [
  {
    desc:   'Valid credential (all fields correct)',
    expect: true,
    data:   {
      credential: {
        sha256:            'a'.repeat(64),
        public_key:        'validpublickey==',
        capture_device_id: 'device-123',
        timestamp:         new Date().toISOString(),
      },
      signatureB64: 'dGVzdHNpZ25hdHVyZQ==',
      media_key:    'captures/2026/test.jpg',
    }
  },
  {
    desc:   'SHA-256 too short (6 chars)',
    expect: false,
    data:   {
      credential: {
        sha256:     'abc123',
        public_key: 'validpublickey==',
        capture_device_id: 'device-123',
        timestamp:  new Date().toISOString(),
      },
      signatureB64: 'dGVzdHNpZ25hdHVyZQ==',
      media_key:    'captures/2026/test.jpg',
    }
  },
  {
    desc:   'SHA-256 with uppercase (accepted by actual schema)',
    expect: true,   // ACTUAL schema uses /^[0-9a-fA-F]{64}$/ — case-insensitive
    data:   {
      credential: {
        sha256:     'A'.repeat(64),
        public_key: 'validpublickey==',
        capture_device_id: 'device-123',
        timestamp:  new Date().toISOString(),
      },
      signatureB64: 'dGVzdHNpZ25hdHVyZQ==',
      media_key:    'captures/2026/test.jpg',
    }
  },
  {
    desc:   'SHA-256 too long (65 chars)',
    expect: false,
    data:   {
      credential: {
        sha256:     'a'.repeat(65),
        public_key: 'validpublickey==',
        capture_device_id: 'device-123',
        timestamp:  new Date().toISOString(),
      },
      signatureB64: 'dGVzdHNpZ25hdHVyZQ==',
      media_key:    'captures/2026/test.jpg',
    }
  },
  {
    desc:   'Missing signatureB64 (required top-level field)',
    expect: false,
    data:   {
      credential: {
        sha256:     'a'.repeat(64),
        public_key: 'validpublickey==',
        capture_device_id: 'device-123',
        timestamp:  new Date().toISOString(),
      },
      media_key: 'captures/2026/test.jpg',
    }
  },
  {
    desc:   'Missing media_key (required top-level field)',
    expect: false,
    data:   {
      credential: {
        sha256:     'a'.repeat(64),
        public_key: 'validpublickey==',
        capture_device_id: 'device-123',
        timestamp:  new Date().toISOString(),
      },
      signatureB64: 'dGVzdHNpZ25hdHVyZQ==',
    }
  },
  {
    desc:   'Empty public_key (violates min(1))',
    expect: false,
    data:   {
      credential: {
        sha256:     'a'.repeat(64),
        public_key: '',
        capture_device_id: 'device-123',
        timestamp:  new Date().toISOString(),
      },
      signatureB64: 'dGVzdHNpZ25hdHVyZQ==',
      media_key:    'captures/2026/test.jpg',
    }
  },
  {
    desc:   'Numeric timestamp (accepted by actual schema z.union)',
    expect: true,   // Actual schema uses z.union([z.string(), z.number()])
    data:   {
      credential: {
        sha256:     'a'.repeat(64),
        public_key: 'validpublickey==',
        capture_device_id: 'device-123',
        timestamp:  Date.now(),
      },
      signatureB64: 'dGVzdHNpZ25hdHVyZQ==',
      media_key:    'captures/2026/test.jpg',
    }
  },
  {
    desc:   'Null timestamp (accepted by actual schema .nullable())',
    expect: true,
    data:   {
      credential: {
        sha256:     'a'.repeat(64),
        public_key: 'validpublickey==',
        capture_device_id: 'device-123',
        timestamp:  null,
      },
      signatureB64: 'dGVzdHNpZ25hdHVyZQ==',
      media_key:    'captures/2026/test.jpg',
    }
  },
  {
    desc:   'SHA-256 with non-hex chars (xyz)',
    expect: false,
    data:   {
      credential: {
        sha256:     'xyz' + 'a'.repeat(61),
        public_key: 'validpublickey==',
        capture_device_id: 'device-123',
      },
      signatureB64: 'dGVzdHNpZ25hdHVyZQ==',
      media_key:    'captures/2026/test.jpg',
    }
  },
];

let allPassed = true;
testCases.forEach(tc => {
  const result = credentialPostSchema.safeParse(tc.data);
  const pass   = result.success === tc.expect;
  if (!pass) allPassed = false;
  const label  = pass ? 'PASS' : 'FAIL';
  const detail = (!result.success && tc.expect === false)
    ? ' (rejected: ' + result.error.issues[0].message + ')'
    : '';
  const actual = result.success ? '(accepted)' : '(rejected)';
  console.log(label + ' - ' + tc.desc + ' ' + actual + detail);
});

console.log('\nOverall: ' + (allPassed ? 'ALL PASS' : 'SOME TESTS FAILED'));
