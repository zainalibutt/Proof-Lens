// prooflens-api/src/routes/devices.ts
import { Router, Request, Response } from "express";
import { supabase } from "../clients";
import { getUserIdFromRequest, auditDeviceKey, buildDeviceRegistrationMessage } from "../services/device";
import { verifyEd25519Utf8 } from "../utils/crypto";
import { DeviceRegisterBody } from "../types";
import { validate, deviceRegisterSchema, requireDeviceId } from "../utils/validation";
import { rateLimitWrite } from "../utils/rateLimit";

const router = Router();

// POST /devices/register (one-time device key registration)
router.post(
  "/devices/register",
  rateLimitWrite,
  requireDeviceId,
  validate(deviceRegisterSchema),
  async (req: Request, res: Response) => {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const deviceId = (req.header("x-device-id") || "").toString();
    if (!deviceId) return res.status(400).json({ error: "missing_x_device_id" });

    const body = (req.body || {}) as DeviceRegisterBody;
    const publicKeyB64 = (body.publicKeyB64 || "").toString();
    const signatureB64 = (body.signatureB64 || "").toString();
    const signedAt = (body.signedAt || "").toString();

    if (!publicKeyB64 || !signatureB64 || !signedAt) {
      return res.status(400).json({ error: "missing_fields" });
    }

    await auditDeviceKey({
      userId,
      deviceId,
      publicKeyB64,
      action: "register_attempt",
      req,
    });

    const signedAtMs = Date.parse(signedAt);
    if (!Number.isFinite(signedAtMs)) {
      await auditDeviceKey({ userId, deviceId, publicKeyB64, action: "register_reject", reason: "bad_signedAt", req });
      return res.status(400).json({ error: "bad_signedAt" });
    }

    const skewMs = Math.abs(Date.now() - signedAtMs);
    if (skewMs > 10 * 60 * 1000) {
      await auditDeviceKey({ userId, deviceId, publicKeyB64, action: "register_reject", reason: "signedAt_skew", req });
      return res.status(400).json({ error: "signedAt_skew" });
    }

    const message = buildDeviceRegistrationMessage({ userId, deviceId, publicKeyB64, signedAt });
    const proofOk = verifyEd25519Utf8({ message, signatureB64, publicKeyB64 });
    if (!proofOk) {
      await auditDeviceKey({ userId, deviceId, publicKeyB64, action: "register_reject", reason: "invalid_proof", req });
      return res.status(400).json({ error: "invalid_proof" });
    }

    // Enforce one-time mapping: do not allow updates.
    const { data: existing, error: existingErr } = await supabase
      .from("device_keys")
      .select("public_key_b64, created_at")
      .eq("user_id", userId)
      .eq("device_id", deviceId)
      .maybeSingle();

    if (existingErr) {
      console.error("[/devices/register] lookup failed:", existingErr.message);
      await auditDeviceKey({ userId, deviceId, publicKeyB64, action: "register_reject", reason: "db_lookup_failed", req });
      return res.status(500).json({ error: "device_register_failed" });
    }

    if ((existing as any)?.public_key_b64) {
      if ((existing as any).public_key_b64 === publicKeyB64) {
        await auditDeviceKey({ userId, deviceId, publicKeyB64, action: "register_exists", req });
        return res.json({ ok: true, already: true, created_at: (existing as any).created_at ?? null });
      }
      await auditDeviceKey({ userId, deviceId, publicKeyB64, action: "register_reject", reason: "device_already_registered", req });
      return res.status(409).json({ error: "device_already_registered" });
    }

    const { error: insErr } = await supabase.from("device_keys").insert({
      user_id: userId,
      device_id: deviceId,
      public_key_b64: publicKeyB64,
    });
    if (insErr) {
      console.error("[/devices/register] insert failed:", insErr.message);
      await auditDeviceKey({ userId, deviceId, publicKeyB64, action: "register_reject", reason: "db_insert_failed", req });
      return res.status(500).json({ error: "device_register_failed" });
    }

    await auditDeviceKey({ userId, deviceId, publicKeyB64, action: "register_success", req });
    return res.json({ ok: true, already: false });
  }
);

// POST /devices/revoke (revoke a device key)
router.post(
  "/devices/revoke",
  rateLimitWrite,
  requireDeviceId,
  async (req: Request, res: Response) => {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const deviceId = (req.header("x-device-id") || "").toString();
    if (!deviceId) return res.status(400).json({ error: "missing_x_device_id" });

    await auditDeviceKey({ userId, deviceId, publicKeyB64: null, action: "revoke_attempt", req });

    const { data: existing, error: existingErr } = await supabase
      .from("device_keys")
      .select("id, public_key_b64, revoked_at")
      .eq("user_id", userId)
      .eq("device_id", deviceId)
      .maybeSingle();

    if (existingErr) {
      console.error("[/devices/revoke] lookup failed:", existingErr.message);
      return res.status(500).json({ error: "device_revoke_failed" });
    }
    if (!existing) {
      return res.status(404).json({ error: "device_not_found" });
    }
    if ((existing as any).revoked_at) {
      return res.json({ ok: true, already_revoked: true });
    }

    const { error: updateErr } = await supabase
      .from("device_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", (existing as any).id);

    if (updateErr) {
      console.error("[/devices/revoke] update failed:", updateErr.message);
      await auditDeviceKey({ userId, deviceId, publicKeyB64: (existing as any).public_key_b64, action: "revoke_reject", reason: "db_update_failed", req });
      return res.status(500).json({ error: "device_revoke_failed" });
    }

    await auditDeviceKey({ userId, deviceId, publicKeyB64: (existing as any).public_key_b64, action: "revoke_success", req });
    return res.json({ ok: true });
  }
);

export default router;
