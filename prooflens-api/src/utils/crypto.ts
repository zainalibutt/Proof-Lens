// prooflens-api/src/utils/crypto.ts
import crypto from "crypto";
import * as nacl from "tweetnacl";
import { SUPABASE_SERVICE_KEY } from "../config";
import { buildTsqForSha256, verifyAndExtract } from "../tsa";
import { wrapBase64Lines } from "./helpers";

/**
 * Secret used to sign evidence-bundle and share tokens.
 *
 * This MUST be independent of the Supabase service key. Reusing the service key
 * would mean a token-signing oracle and a database superuser credential share
 * the same secret, so compromise of one compromises the other. There is
 * deliberately no fallback: if the secret is absent or too weak, token
 * signing/verification fails closed rather than silently degrading.
 */
const MIN_HMAC_SECRET_LENGTH = 32;

export function getEvidenceBundleTokenSecret(): string {
  const secret = process.env.EVIDENCE_BUNDLE_HMAC_SECRET || "";
  if (secret.length < MIN_HMAC_SECRET_LENGTH) {
    throw new Error(
      "EVIDENCE_BUNDLE_HMAC_SECRET is missing or shorter than " +
        MIN_HMAC_SECRET_LENGTH +
        " characters. It must be set to an independent random value and must not reuse the Supabase service key."
    );
  }
  if (SUPABASE_SERVICE_KEY && secret === SUPABASE_SERVICE_KEY) {
    throw new Error(
      "EVIDENCE_BUNDLE_HMAC_SECRET must not be the same value as SUPABASE_SERVICE_KEY."
    );
  }
  return secret;
}

type BaseBundleTokenPayload = {
  v: number;
  sha256: string;
  shareTokenHash: string;
  exp: string;
  nonce: string;
};

export type EvidenceBundleTokenPayload = BaseBundleTokenPayload & {
  captureId: string;
  kind?: undefined;
};

export type AudioShareTokenPayload = BaseBundleTokenPayload & {
  audioId: string;
  kind: "audio-share";
};

export type AudioBundleTokenPayload = BaseBundleTokenPayload & {
  audioId: string;
  kind: "audio-bundle";
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isBasePayload(value: Record<string, unknown>): value is BaseBundleTokenPayload & Record<string, unknown> {
  return (
    typeof value.v === "number" &&
    /^[0-9a-f]{64}$/i.test(String(value.sha256 || "")) &&
    /^[0-9a-f]{64}$/i.test(String(value.shareTokenHash || "")) &&
    isIsoDateString(value.exp) &&
    typeof value.nonce === "string" &&
    value.nonce.length >= 8
  );
}

function parseEvidenceBundlePayload(value: unknown): EvidenceBundleTokenPayload | null {
  if (!isObjectRecord(value) || !isBasePayload(value)) return null;
  if (typeof value.captureId !== "string" || !value.captureId.trim()) return null;
  if (typeof value.kind !== "undefined") return null;
  return {
    v: value.v,
    captureId: value.captureId,
    sha256: value.sha256,
    shareTokenHash: value.shareTokenHash,
    exp: value.exp,
    nonce: value.nonce,
  };
}

function parseAudioSharePayload(value: unknown): AudioShareTokenPayload | null {
  if (!isObjectRecord(value) || !isBasePayload(value)) return null;
  if (value.kind !== "audio-share") return null;
  if (typeof value.audioId !== "string" || !value.audioId.trim()) return null;
  return {
    v: value.v,
    audioId: value.audioId,
    sha256: value.sha256,
    shareTokenHash: value.shareTokenHash,
    exp: value.exp,
    nonce: value.nonce,
    kind: "audio-share",
  };
}

function parseAudioBundlePayload(value: unknown): AudioBundleTokenPayload | null {
  if (!isObjectRecord(value) || !isBasePayload(value)) return null;
  if (value.kind !== "audio-bundle") return null;
  if (typeof value.audioId !== "string" || !value.audioId.trim()) return null;
  return {
    v: value.v,
    audioId: value.audioId,
    sha256: value.sha256,
    shareTokenHash: value.shareTokenHash,
    exp: value.exp,
    nonce: value.nonce,
    kind: "audio-bundle",
  };
}

function signStructuredToken(payload: Record<string, unknown>): string {
  const secret = getEvidenceBundleTokenSecret();
  if (!secret) throw new Error("missing_bundle_token_secret");

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sigB64 = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sigB64}`;
}

function decodeVerifiedPayload(token: string): unknown | null {
  const secret = getEvidenceBundleTokenSecret();
  if (!secret) return null;

  const parts = String(token || "").split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expected = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  try {
    const a = Buffer.from(sigB64);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!crypto.timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const json = Buffer.from(payloadB64, "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export function signEvidenceBundleToken(payload: EvidenceBundleTokenPayload): string {
  const parsedPayload = parseEvidenceBundlePayload(payload);
  if (!parsedPayload) throw new Error("invalid_bundle_token_payload");
  return signStructuredToken(parsedPayload);
}

export function verifyEvidenceBundleToken(token: string): EvidenceBundleTokenPayload | null {
  return parseEvidenceBundlePayload(decodeVerifiedPayload(token));
}

export function signAudioShareToken(payload: Omit<AudioShareTokenPayload, "kind">): string {
  const parsedPayload = parseAudioSharePayload({ ...payload, kind: "audio-share" });
  if (!parsedPayload) throw new Error("invalid_audio_share_token_payload");
  return signStructuredToken(parsedPayload);
}

export function verifyAudioShareToken(token: string): AudioShareTokenPayload | null {
  return parseAudioSharePayload(decodeVerifiedPayload(token));
}

export function signAudioBundleToken(payload: Omit<AudioBundleTokenPayload, "kind">): string {
  const parsedPayload = parseAudioBundlePayload({ ...payload, kind: "audio-bundle" });
  if (!parsedPayload) throw new Error("invalid_audio_bundle_token_payload");
  return signStructuredToken(parsedPayload);
}

export function verifyAudioBundleToken(token: string): AudioBundleTokenPayload | null {
  return parseAudioBundlePayload(decodeVerifiedPayload(token));
}

export function verifySha256Signature(params: {
  signatureB64?: string | null;
  publicKeyB64?: string | null;
  sha256?: string | null;
}): boolean {
  const { signatureB64, publicKeyB64, sha256 } = params;
  if (!signatureB64 || !publicKeyB64 || !sha256) return false;
  if (!/^[a-f0-9]{64}$/i.test(sha256)) return false;
  try {
    const sig = Buffer.from(signatureB64, "base64");
    const pub = Buffer.from(publicKeyB64, "base64");
    const shaBytes = Buffer.from(sha256, "hex");
    return nacl.sign.detached.verify(shaBytes, sig, pub);
  } catch {
    return false;
  }
}

export function verifyEd25519Utf8(params: {
  message: string;
  signatureB64: string;
  publicKeyB64: string;
}): boolean {
  try {
    const msg = Buffer.from(params.message, "utf8");
    const sig = Buffer.from(params.signatureB64, "base64");
    const pub = Buffer.from(params.publicKeyB64, "base64");
    return nacl.sign.detached.verify(msg, sig, pub);
  } catch {
    return false;
  }
}

export function ed25519PublicKeyPemFromRawB64(publicKeyB64: string): string {
  const raw = Buffer.from(publicKeyB64, "base64");
  if (raw.length !== 32) throw new Error("invalid_ed25519_public_key");

  // SubjectPublicKeyInfo wrapper for Ed25519 (OID 1.3.101.112)
  // DER prefix: 302a300506032b6570032100 + 32 raw bytes
  const derPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const der = Buffer.concat([derPrefix, raw]);
  const b64 = der.toString("base64");

  return `-----BEGIN PUBLIC KEY-----\n${wrapBase64Lines(b64)}\n-----END PUBLIC KEY-----\n`;
}

type CredentialPublicKeyRow = {
  public_key_b64?: string | null;
  credential_json?: {
    public_key?: string | null;
    public_key_b64?: string | null;
  } | null;
} | null | undefined;

export function resolveCredentialPublicKeyB64(row: CredentialPublicKeyRow): string | null {
  return (
    row?.public_key_b64 ||
    row?.credential_json?.public_key ||
    row?.credential_json?.public_key_b64 ||
    null
  );
}

export async function isTsaAnchoringValid(params: {
  sha256Hex: string;
  tsaVerified?: boolean | null;
  tsaTokenBase64?: string | null;
}): Promise<boolean> {
  if (params.tsaVerified === true) return true;
  try {
    if (!params.tsaTokenBase64) return false;
    const tsq = await buildTsqForSha256(params.sha256Hex);
    const tsr = Buffer.from(params.tsaTokenBase64, "base64");
    await verifyAndExtract(tsq, tsr);
    return true;
  } catch {
    return false;
  }
}

// Structured verification verdict
export type VerificationVerdict = {
  integrity: boolean;    // SHA-256 of uploaded file matches credential
  authenticity: boolean; // Ed25519 signature valid against registered key
  temporality: boolean;  // RFC 3161 TSA anchor verified
  overall: "invalid" | "partial" | "strong";
};

export type VerificationTier = "invalid" | "integrity" | "authentic" | "anchored";

export function buildVerdict(params: {
  hashMatch: boolean;
  signatureValid: boolean;
  anchorValid: boolean;
}): VerificationVerdict {
  const { hashMatch, signatureValid, anchorValid } = params;
  const integrity = hashMatch;
  const authenticity = signatureValid;
  const temporality = anchorValid;

  let overall: VerificationVerdict["overall"] = "invalid";
  if (integrity && authenticity && temporality) {
    overall = "strong";
  } else if (integrity && authenticity) {
    overall = "partial";
  }

  return { integrity, authenticity, temporality, overall };
}

export function buildVerificationTier(verdict: VerificationVerdict): VerificationTier {
  if (verdict.integrity && verdict.authenticity && verdict.temporality) return "anchored";
  if (verdict.integrity && verdict.authenticity) return "authentic";
  if (verdict.integrity) return "integrity";
  return "invalid";
}
