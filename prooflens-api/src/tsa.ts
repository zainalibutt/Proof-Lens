// prooflens-api/src/tsa.ts
import { spawn } from "child_process";
import { tmpdir } from "os";
import { mkdtemp, writeFile, rm } from "fs/promises";
import path from "path";

function getEnv() {
  const {
    TSA_URL,
    TSA_CA_CERT_PATH,
    OPENSSL_BIN = "openssl",
    TSA_BEARER,
    TSA_BASIC,
  } = process.env as Record<string, string | undefined>;
  return { TSA_URL, TSA_CA_CERT_PATH, OPENSSL_BIN, TSA_BEARER, TSA_BASIC };
}

function runOpenSSL(args: string[], stdin?: Buffer): Promise<Buffer> {
  const { OPENSSL_BIN } = getEnv();
  return new Promise((resolve, reject) => {
    const cp = spawn(OPENSSL_BIN!, args);
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    if (stdin) cp.stdin.write(stdin);
    cp.stdin.end();
    cp.stdout.on("data", d => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    cp.stderr.on("data", d => errChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    cp.on("error", reject);
    cp.on("close", code => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`openssl ${args.join(" ")} exited ${code}: ${Buffer.concat(errChunks).toString()}`));
    });
  });
}

export async function buildTsqForSha256(sha256Hex: string): Promise<Buffer> {
  if (!/^[0-9a-fA-F]{64}$/.test(sha256Hex)) throw new Error("Invalid sha256 hex");
  // Use -no_nonce so query reconstruction is deterministic from the digest alone.
  const out = await runOpenSSL(["ts", "-query", "-digest", sha256Hex, "-sha256", "-cert", "-no_nonce"]);
  return out; // DER-encoded timestamp query
}

export async function requestTsa(tsqDer: Buffer): Promise<Buffer> {
  const { TSA_URL, TSA_BEARER, TSA_BASIC } = getEnv();
  if (!TSA_URL) throw new Error("TSA_URL not set");
  const headers: Record<string, string> = {
    "Content-Type": "application/timestamp-query",
    "Accept": "application/timestamp-reply",
  };
  if (TSA_BEARER) headers["Authorization"] = `Bearer ${TSA_BEARER}`;
  if (TSA_BASIC) headers["Authorization"] = `Basic ${Buffer.from(TSA_BASIC).toString("base64")}`;

  const res = await fetch(TSA_URL, { method: "POST", headers, body: tsqDer as any });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`[tsa] TSA replied ${res.status} ${res.statusText}: ${text.slice(0, 400)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function verifyAndExtract(tsqDer: Buffer, tsrDer: Buffer): Promise<{
  genTime: string; policyOid?: string; serial?: string;
}> {
  const { TSA_CA_CERT_PATH } = getEnv();
  const tmp = await mkdtemp(path.join(tmpdir(), "tsa-"));
  const tsqPath = path.join(tmp, "req.tsq");
  const tsrPath = path.join(tmp, "resp.tsr");
  const caPath = TSA_CA_CERT_PATH ? path.resolve(process.cwd(), TSA_CA_CERT_PATH) : undefined;

  try {
    await writeFile(tsqPath, tsqDer);
    await writeFile(tsrPath, tsrDer);

    // Verify signature/chain
    const verifyArgs = ["ts", "-verify", "-in", tsrPath, "-queryfile", tsqPath];
    if (caPath) verifyArgs.push("-CAfile", caPath);
    await runOpenSSL(verifyArgs);

    // Get human-readable text
    const textBuf = await runOpenSSL(["ts", "-reply", "-in", tsrPath, "-text"]);
    const text = textBuf.toString();

    // Extract fields (be tolerant of formats)
    const policyMatch = text.match(/Policy OID:\s*([^\s]+)/i);
    const serialMatch = text.match(/Serial number:\s*([^\s]+)/i);

    // 1) ISO-like: 2025-10-20 15:58:05 UTC
    let time = text.match(/Time stamp:\s*([0-9]{4}-[0-9]{2}-[0-9]{2}\s+[0-9]{2}:[0-9]{2}:[0-9]{2})\s+(UTC|GMT)/i)?.[1];
    let tz  = text.match(/Time stamp:\s*[^\n]*\s+(UTC|GMT)/i)?.[1];

    // 2) RFC2822-like: Oct 20 15:58:05 2025 GMT
    if (!time) {
      const m = text.match(/Time stamp:\s*([A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(UTC|GMT)/i);
      if (m) {
        time = m[1]; tz = m[2];
      }
    }

    if (!time) {
      // Log a short preview to help debugging if it ever happens again
      throw new Error(`[tsa] Could not parse genTime from TSR text`);
    }

    // Build an ISO string safely. If format is 'Oct 20 15:58:05 2025' add ' UTC'
    const iso = new Date(`${time} ${tz || "UTC"}`).toISOString();

    return {
      genTime: iso,
      policyOid: policyMatch?.[1],
      serial: serialMatch?.[1],
    };
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}


export async function anchorWithTSA(sha256Hex: string): Promise<{
  tokenBase64: string; genTime: string; policyOid?: string; serial?: string;
}> {
  const tsq = await buildTsqForSha256(sha256Hex);
  const tsr = await requestTsa(tsq);
  const { genTime, policyOid, serial } = await verifyAndExtract(tsq, tsr);
  return { tokenBase64: tsr.toString("base64"), genTime, policyOid, serial };
}

// Retry TSA anchoring for records that initially failed.
export async function retryTSAAnchoring(supabase: any, uploadTsaSidecar: (key: string, b64: string) => Promise<void>): Promise<{
  credentials: { attempted: number; anchored: number };
  audioRecords: { attempted: number; anchored: number };
}> {
  const MAX_RETRY = 50;
  const result = {
    credentials: { attempted: 0, anchored: 0 },
    audioRecords: { attempted: 0, anchored: 0 },
  };

  // Retry un-anchored credentials
  const { data: creds } = await supabase
    .from("credentials")
    .select("id, sha256, media_key")
    .is("tsa_token_base64", null)
    .eq("status", "submitted")
    .limit(MAX_RETRY);

  for (const c of creds ?? []) {
    result.credentials.attempted++;
    try {
      const { tokenBase64, genTime, policyOid, serial } = await anchorWithTSA(c.sha256);
      await supabase
        .from("credentials")
        .update({
          tsa_token_base64: tokenBase64,
          tsa_time: genTime,
          tsa_policy_oid: policyOid,
          tsa_serial: serial,
          status: "anchored",
          tsa_verified: true,
          tsa_verified_at: new Date().toISOString(),
        })
        .eq("id", c.id);
      if (c.media_key) await uploadTsaSidecar(c.media_key, tokenBase64);
      result.credentials.anchored++;
    } catch (e: any) {
      console.warn(`[tsa-retry] credential ${c.id} failed:`, e?.message || e);
    }
  }

  // Retry un-anchored audio records
  const { data: audios } = await supabase
    .from("audio_records")
    .select("id, sha256, s3_key")
    .is("tsa_token_base64", null)
    .eq("tsa_status", "submitted")
    .limit(MAX_RETRY);

  for (const a of audios ?? []) {
    result.audioRecords.attempted++;
    try {
      const { tokenBase64, genTime } = await anchorWithTSA(a.sha256);
      await supabase
        .from("audio_records")
        .update({
          tsa_status: "anchored",
          tsa_token_base64: tokenBase64,
          anchor_timestamp: genTime,
        })
        .eq("id", a.id);
      if (a.s3_key) await uploadTsaSidecar(a.s3_key, tokenBase64);
      result.audioRecords.anchored++;
    } catch (e: any) {
      console.warn(`[tsa-retry] audio ${a.id} failed:`, e?.message || e);
    }
  }

  return result;
}
