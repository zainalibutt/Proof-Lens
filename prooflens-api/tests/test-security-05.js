/**
 * test-security-05.js — regression tests for the hardening applied in the
 * public-release pass.
 *
 * Covers, without needing a database:
 *   A. S3 object-key namespace enforcement (cross-tenant overwrite prevention)
 *   B. Evidence-bundle HMAC secret separation (fail closed)
 *   C. Access-log query-string redaction
 *   D. Proxy/header trust boundaries
 *   E. Share URL origin pinning
 *
 * Cross-tenant database isolation is exercised separately by
 * database/tests/cross_tenant_isolation_test.sql against Postgres, using two
 * synthetic users inside a transaction that rolls back.
 */

const assert = require("assert");
const path = require("path");

let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    pass++;
  } catch (e) {
    console.log(`FAIL ${name}: ${e.message}`);
    fail++;
  }
}

// Compiled output is used so the tests exercise what actually ships.
const helpers = require(path.join(__dirname, "..", "dist", "utils", "helpers.js"));

console.log("SECTION A - S3 object-key namespace enforcement\n");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

check("KEY-PREFIX-SHAPE", () => {
  assert.strictEqual(helpers.userKeyPrefix(USER_A), `users/${USER_A}/`);
});

check("KEY-GENERATED-IS-IN-OWN-NAMESPACE", () => {
  const key = helpers.makeUserScopedKey(USER_A, "jpg");
  assert.ok(key.startsWith(`users/${USER_A}/`), "generated key must be user-scoped");
  assert.ok(key.endsWith(".jpg"));
});

check("KEY-GENERATED-IS-UNPREDICTABLE", () => {
  const a = helpers.makeUserScopedKey(USER_A, "jpg");
  const b = helpers.makeUserScopedKey(USER_A, "jpg");
  assert.notStrictEqual(a, b, "two generated keys must not collide");
});

check("KEY-OWN-NAMESPACE-ACCEPTED", () => {
  const key = helpers.makeUserScopedKey(USER_A, "jpg");
  assert.strictEqual(helpers.isKeyWithinUserNamespace(key, USER_A), true);
});

check("KEY-CROSS-TENANT-REJECTED", () => {
  // The core case: user A must not be able to obtain a presigned POST for a
  // key inside user B's namespace.
  const victimKey = helpers.makeUserScopedKey(USER_B, "jpg");
  assert.strictEqual(
    helpers.isKeyWithinUserNamespace(victimKey, USER_A),
    false,
    "a key in another user's namespace must be rejected"
  );
});

check("KEY-TRAVERSAL-REJECTED", () => {
  const traversals = [
    `users/${USER_A}/../${USER_B}/captures/x.jpg`,
    `users/${USER_A}//captures/x.jpg`,
    `/users/${USER_A}/captures/x.jpg`,
    `users/${USER_B}/captures/x.jpg`,
  ];
  for (const t of traversals) {
    assert.strictEqual(
      helpers.isKeyWithinUserNamespace(t, USER_A),
      false,
      `must reject: ${t}`
    );
  }
});

check("KEY-LEGACY-UNSCOPED-REJECTED", () => {
  // Pre-hardening keys lived at captures/... with no user namespace. They must
  // no longer be accepted as client input.
  assert.strictEqual(
    helpers.isKeyWithinUserNamespace("captures/2026/04/14/abc/abc.jpg", USER_A),
    false
  );
});

check("KEY-EMPTY-AND-OVERSIZE-REJECTED", () => {
  assert.strictEqual(helpers.isKeyWithinUserNamespace("", USER_A), false);
  const huge = `users/${USER_A}/` + "a".repeat(2000);
  assert.strictEqual(helpers.isKeyWithinUserNamespace(huge, USER_A), false);
});

console.log("\nSECTION B - Evidence-bundle HMAC secret separation\n");

const crypto = require(path.join(__dirname, "..", "dist", "utils", "crypto.js"));

function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

check("HMAC-MISSING-FAILS-CLOSED", () => {
  withEnv({ EVIDENCE_BUNDLE_HMAC_SECRET: undefined }, () => {
    assert.throws(
      () => crypto.getEvidenceBundleTokenSecret(),
      /missing or shorter/i,
      "an absent secret must throw rather than fall back"
    );
  });
});

check("HMAC-SHORT-SECRET-REJECTED", () => {
  withEnv({ EVIDENCE_BUNDLE_HMAC_SECRET: "tooshort" }, () => {
    assert.throws(() => crypto.getEvidenceBundleTokenSecret(), /shorter/i);
  });
});

check("HMAC-STRONG-SECRET-ACCEPTED", () => {
  const secret = "x".repeat(48);
  withEnv({ EVIDENCE_BUNDLE_HMAC_SECRET: secret }, () => {
    assert.strictEqual(crypto.getEvidenceBundleTokenSecret(), secret);
  });
});

console.log("\nSECTION C - Access-log redaction\n");

check("LOG-QUERYSTRING-REDACTED", () => {
  // Mirrors the morgan "safepath" token in server.ts: a share token in the
  // query string must never reach the log line.
  const safepath = (url) => {
    const q = url.indexOf("?");
    return q === -1 ? url : url.slice(0, q) + "?<redacted>";
  };
  const withToken = "/shares/resolve?token=SUPERSECRETVALUE&x=1";
  const logged = safepath(withToken);
  assert.ok(!logged.includes("SUPERSECRETVALUE"), "token must not appear in logs");
  assert.strictEqual(logged, "/shares/resolve?<redacted>");
  assert.strictEqual(safepath("/health"), "/health");
});

console.log("\nSECTION D - Proxy/header trust boundaries\n");

check("AUDIT-IP-IGNORES-RAW-FORWARDED-HEADER", () => {
  const req = {
    ip: "203.0.113.10",
    socket: { remoteAddress: "10.0.0.4" },
    headers: { "x-forwarded-for": "198.51.100.99" },
  };
  assert.strictEqual(helpers.getRequestIp(req), "203.0.113.10");
});

check("AUDIT-USER-AGENT-IS-BOUNDED", () => {
  const req = { headers: { "user-agent": "x".repeat(2000) } };
  assert.strictEqual(helpers.getRequestUa(req).length, 512);
});

console.log("\nSECTION E - Share URL origin pinning\n");

check("SHARE-BASE-USES-CONFIGURED-ORIGIN", () => {
  withEnv({ SHARE_BASE_URL: "https://proof-lens.vercel.app/" }, () => {
    assert.strictEqual(helpers.shareBaseUrl(), "https://proof-lens.vercel.app");
  });
});

check("SHARE-BASE-REFUSES-UNSAFE-SCHEME", () => {
  withEnv({ SHARE_BASE_URL: "javascript:alert(1)" }, () => {
    assert.throws(() => helpers.shareBaseUrl(), /http or https/i);
  });
});

console.log(`\nRESULT: ${fail === 0 ? "ALL SECURITY REGRESSION CHECKS PASSED" : fail + " CHECK(S) FAILED"}`);
process.exit(fail === 0 ? 0 : 1);
