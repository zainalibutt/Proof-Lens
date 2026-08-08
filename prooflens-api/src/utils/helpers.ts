// prooflens-api/src/utils/helpers.ts
import crypto from "crypto";
import { Request } from "express";

export function makeDatedKey(ext: string, base?: string) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8);
  if (base) {
    // For single captures: captures/yyyy/mm/dd/{id}/{id}.ext
    return `captures/${yyyy}/${mm}/${dd}/${base}/${base}.${ext}`;
  }
  const name = `${Date.now()}-${rand}`;
  // For single captures: captures/yyyy/mm/dd/{id}/{id}.ext
  return `captures/${yyyy}/${mm}/${dd}/${name}/${name}.${ext}`;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function shareBaseUrl(): string {
  const configured = String(process.env.SHARE_BASE_URL || "").trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SHARE_BASE_URL is required in production");
    }
    return "http://localhost:5173";
  }

  const parsed = new URL(configured);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("SHARE_BASE_URL must use http or https");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("SHARE_BASE_URL must not include credentials, a query, or a fragment");
  }

  return parsed.href.replace(/\/$/, "");
}

export function formatUtcCompact(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

export function wrapBase64Lines(b64: string, width = 64): string {
  const chunks = b64.match(new RegExp(`.{1,${width}}`, "g"));
  return chunks ? chunks.join("\n") : b64;
}

export function getRequestIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function getRequestUa(req: Request): string {
  return String(req.headers["user-agent"] || "").slice(0, 512);
}

/**
 * Object-key namespace for a user. All uploads for a user live beneath this
 * prefix so that a presigned POST can be constrained to it.
 */
export function userKeyPrefix(userId: string): string {
  return `users/${userId}/`;
}

/** True when key sits inside the given user's namespace and contains no traversal. */
export function isKeyWithinUserNamespace(key: string, userId: string): boolean {
  if (typeof key !== "string" || key.length === 0 || key.length > 1024) return false;
  if (key.includes("..") || key.includes("//") || key.startsWith("/")) return false;
  if (!/^[A-Za-z0-9!_.*'()/-]+$/.test(key)) return false;
  return key.startsWith(userKeyPrefix(userId));
}

/** Server-generated, user-namespaced, non-guessable object key. */
export function makeUserScopedKey(userId: string, ext: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const rand = cryptoRandomId();
  const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
  return `${userKeyPrefix(userId)}captures/${yyyy}/${mm}/${dd}/${rand}/${rand}.${safeExt}`;
}

function cryptoRandomId(): string {
  // 128 bits of entropy, so keys are not guessable or enumerable.
  return require("crypto").randomBytes(16).toString("hex");
}
