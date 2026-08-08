// prooflens-api/src/services/device.ts
import { NextFunction, Request, Response } from "express";
import { supabase } from "../clients";
import { getRequestIp, getRequestUa } from "../utils/helpers";

export function buildDeviceRegistrationMessage(params: {
  userId: string;
  deviceId: string;
  publicKeyB64: string;
  signedAt: string;
}): string {
  const { userId, deviceId, publicKeyB64, signedAt } = params;
  return `prooflens:device-register:v1:${userId}:${deviceId}:${publicKeyB64}:${signedAt}`;
}

export async function getRegisteredDevicePublicKeyB64(params: {
  userId: string;
  deviceId: string;
}): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("device_keys")
      .select("public_key_b64, revoked_at")
      .eq("user_id", params.userId)
      .eq("device_id", params.deviceId)
      .maybeSingle();

    if (error) {
      console.warn("[device_keys] lookup failed:", error.message);
      return null;
    }
    // Reject revoked keys
    if ((data as any)?.revoked_at) return null;
    return (data as any)?.public_key_b64 ?? null;
  } catch (e: any) {
    console.warn("[device_keys] lookup exception:", e?.message || e);
    return null;
  }
}

export async function auditDeviceKey(params: {
  userId: string | null;
  deviceId: string | null;
  publicKeyB64: string | null;
  action: string;
  reason?: string | null;
  req: Request;
}) {
  try {
    await supabase.from("device_key_audit").insert({
      user_id: params.userId,
      device_id: params.deviceId,
      public_key_b64: params.publicKeyB64,
      action: params.action,
      reason: params.reason ?? null,
      ip: getRequestIp(params.req),
      ua: getRequestUa(params.req),
    });
  } catch (err: any) {
    // best-effort only, but keep a trace for demo debugging.
    console.warn("[device_key_audit] insert failed:", err?.message || err);
  }
}

export async function auditUpload(params: {
  userId: string | null;
  deviceId: string | null;
  sha256: string | null;
  mediaKey: string | null;
  computedSha256?: string | null;
  signatureValid?: boolean | null;
  status: "accepted" | "rejected" | "error";
  reason?: string | null;
  req: Request;
}) {
  try {
    await supabase.from("upload_audit").insert({
      user_id: params.userId,
      device_id: params.deviceId,
      sha256: params.sha256,
      computed_sha256: params.computedSha256 ?? null,
      media_key: params.mediaKey,
      signature_valid: params.signatureValid ?? null,
      status: params.status,
      reason: params.reason ?? null,
      ip: getRequestIp(params.req),
      ua: getRequestUa(params.req),
    });
  } catch (err: any) {
    // best-effort only, but keep a trace for demo debugging.
    console.warn("[upload_audit] insert failed:", err?.message || err);
  }
}

export async function getUserIdFromRequest(req: Request): Promise<string | null> {
  if (req.authChecked) return req.authUserId || null;

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    req.authChecked = true;
    return null;
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    req.authChecked = true;
    if (error || !data?.user) return null;
    req.authUserId = data.user.id;
    return req.authUserId;
  } catch (err: any) {
    console.error("[getUserIdFromRequest] supabase auth error:", err?.message || err);
    req.authChecked = true;
    throw err;
  }
}

/** Resolve an optional bearer token before route-specific rate limiters. */
export async function attachAuthUser(req: Request, _res: Response, next: NextFunction) {
  try {
    await getUserIdFromRequest(req);
  } catch {
    // Protected routes turn this into an authentication failure. Public routes
    // must not become unavailable merely because a bad bearer token was sent.
  }
  next();
}
