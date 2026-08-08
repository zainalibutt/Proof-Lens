// prooflens-api/src/utils/s3.ts
import crypto from "crypto";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "../clients";
import { S3_BUCKET, TSA_UPLOAD_SIDECAR } from "../config";

export async function getSignedGetUrl(key: string, expiresIn = 120): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: S3_BUCKET!, Key: key }),
    { expiresIn }
  );
}

export async function s3ObjectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET!, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function sha256OfS3ObjectKey(key: string): Promise<string> {
  const resp = await s3.send(
    new GetObjectCommand({
      Bucket: S3_BUCKET!,
      Key: key,
    })
  );

  const body: any = (resp as any).Body;
  if (!body || typeof body.on !== "function") {
    throw new Error("s3_body_unreadable");
  }

  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    body.on("data", (chunk: any) => hash.update(chunk));
    body.on("end", () => resolve());
    body.on("error", (err: any) => reject(err));
  });
  return hash.digest("hex");
}

export function isS3AccessDenied(err: any): boolean {
  const code = err?.name || err?.Code || err?.code;
  const message = String(err?.message || "");
  return code === "AccessDenied" || message.includes("AccessDenied") || message.includes("not authorized");
}

export async function getS3ObjectBytes(key: string): Promise<Buffer> {
  const resp = await s3.send(
    new GetObjectCommand({
      Bucket: S3_BUCKET!,
      Key: key,
    })
  );

  const body: any = (resp as any).Body;
  if (!body || typeof body.on !== "function") {
    throw new Error("s3_body_unreadable");
  }

  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    body.on("data", (chunk: any) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    body.on("end", () => resolve());
    body.on("error", (err: any) => reject(err));
  });

  return Buffer.concat(chunks);
}

export function buildTsrKey(mediaKey: string): string {
  const replaced = mediaKey.replace(/\.[^/.]+$/, ".tsr");
  return replaced === mediaKey ? `${mediaKey}.tsr` : replaced;
}

export function expandS3KeyCandidates(input: string | null | undefined): string[] {
  const raw = String(input || "").trim();
  if (!raw) return [];

  const keys = new Set<string>();
  const add = (value: string | null | undefined) => {
    const normalized = String(value || "").trim().replace(/^\/+/, "");
    if (normalized) keys.add(normalized);
  };

  add(raw);

  try {
    add(decodeURIComponent(raw));
  } catch {
    // ignore malformed URI encoding
  }

  if (raw.startsWith("s3://")) {
    const withoutScheme = raw.slice(5);
    const slash = withoutScheme.indexOf("/");
    if (slash >= 0) {
      const bucket = withoutScheme.slice(0, slash);
      const keyPart = withoutScheme.slice(slash + 1);
      add(keyPart);
      if (S3_BUCKET && bucket === S3_BUCKET) add(keyPart);
    }
  }

  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const pathKey = url.pathname.replace(/^\/+/, "");
      add(pathKey);
      try {
        add(decodeURIComponent(pathKey));
      } catch {
        // ignore malformed URI encoding
      }
    } catch {
      // ignore invalid URL
    }
  }

  if (S3_BUCKET) {
    const bucketPrefix = `${S3_BUCKET}/`;
    if (raw.startsWith(bucketPrefix)) add(raw.slice(bucketPrefix.length));
  }

  return Array.from(keys);
}

export async function uploadTsaSidecar(mediaKey: string, tokenBase64: string) {
  if (TSA_UPLOAD_SIDECAR !== "true") {
    console.log("[s3] TSA sidecar upload skipped (TSA_UPLOAD_SIDECAR != true)");
    return;
  }
  if (!S3_BUCKET) return;
  const tsrKey = buildTsrKey(mediaKey);
  const body = Buffer.from(tokenBase64, "base64");
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: tsrKey,
      Body: body,
      ContentType: "application/timestamp-reply",
    })
  );

}
