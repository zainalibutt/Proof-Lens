// prooflens-api/src/routes/shares.ts
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { supabase, upload } from "../clients";
import { getUserIdFromRequest } from "../services/device";
import { streamEvidenceBundleZip } from "../services/evidence";
import {
  verifySha256Signature,
  resolveCredentialPublicKeyB64,
  isTsaAnchoringValid,
  signEvidenceBundleToken,
  verifyEvidenceBundleToken,
  buildVerdict,
  buildVerificationTier,
} from "../utils/crypto";
import { hashToken, randomToken, shareBaseUrl } from "../utils/helpers";
import { getSignedGetUrl, buildTsrKey, s3ObjectExists } from "../utils/s3";
import { rateLimitShare, rateLimitWrite } from "../utils/rateLimit";
import { validate, shareCreateSchema } from "../utils/validation";

const router = Router();

type ShareCreateInput = {
  captureId: string;
  ttlHours?: number;
};

type ShareVerifyReason =
  | "INVALID_REQUEST"
  | "MISSING_FILE"
  | "MISSING_MEDIA_OBJECT"
  | "SHARE_LOOKUP_FAILED"
  | "SHARE_NOT_FOUND"
  | "CAPTURE_LOOKUP_FAILED"
  | "CAPTURE_NOT_FOUND"
  | "HASH_MISMATCH"
  | "SIGNATURE_INVALID"
  | "ANCHOR_INVALID"
  | "FILE_REQUIRED_FOR_FULL_VERIFICATION"
  | "VERIFY_ERROR";

function parseShareCreateInput(raw: unknown): ShareCreateInput | null {
  const body = (raw && typeof raw === "object") ? (raw as Record<string, unknown>) : {};
  const captureId =
    (typeof body.captureId === "string" && body.captureId.trim()) ||
    (typeof body.capture_id === "string" && body.capture_id.trim()) ||
    "";

  let ttlHours: unknown = body.ttlHours;
  if (ttlHours === undefined && body.expires_in_days !== undefined) {
    const days = Number(body.expires_in_days);
    ttlHours = Number.isFinite(days) ? days * 24 : body.expires_in_days;
  }

  const parsed = shareCreateSchema.safeParse({ captureId, ttlHours });
  return parsed.success ? parsed.data : null;
}

function verifyShareFail(res: Response, reason: ShareVerifyReason, extra: Record<string, unknown> = {}) {
  return res.json({ verified: false, reason, ...extra });
}

async function createShareForCapture(req: Request, res: Response, userId: string, input: ShareCreateInput) {
  const { captureId, ttlHours } = input;

  const { data: capture, error: capErr } = await supabase
    .from("credentials")
    .select("id, user_id, status, tsa_verified")
    .eq("id", captureId)
    .eq("user_id", userId)
    .maybeSingle();

  if (capErr) {
    console.error("[shares/create] capture lookup failed:", capErr.message);
    return res.status(500).json({ error: "capture_lookup_failed" });
  }
  if (!capture) return res.status(404).json({ error: "capture_not_found" });
  if (!(capture.tsa_verified === true || capture.status === "anchored")) {
    return res.status(409).json({ error: "capture_not_anchored", detail: "share_requires_anchored_capture" });
  }

  const ttl = Number.isFinite(ttlHours) ? Math.min(Math.max(Number(ttlHours), 1), 24 * 30) : 72;
  const expiresAt = new Date(Date.now() + ttl * 60 * 60 * 1000).toISOString();

  const token = randomToken();
  const tokenHash = hashToken(token);

  const { data: share, error: shareErr } = await supabase
    .from("verification_shares")
    .insert({
      user_id: userId,
      capture_id: captureId,
      token_hash: tokenHash,
      expires_at: expiresAt,
    })
    .select("id, expires_at")
    .single();

  if (shareErr) {
    console.error("[shares/create] insert failed:", shareErr.message);
    return res.status(500).json({ error: "share_create_failed" });
  }

  const base = shareBaseUrl();
  const shareUrl = `${base}/share?token=${encodeURIComponent(token)}&capture=${encodeURIComponent(captureId)}`;

  return res.json({
    shareUrl,
    expiresAt: share?.expires_at,
    captureId,
  });
}

// POST /shares/create (owner-only)
router.post("/shares/create", rateLimitWrite, validate(shareCreateSchema), async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const input = parseShareCreateInput(req.body);
    if (!input) return res.status(400).json({ error: "invalid_share_create_payload" });

    return await createShareForCapture(req, res, userId, input);
  } catch (err: any) {
    console.error("[shares/create] error:", err?.message || err);
    return res.status(500).json({ error: "share_create_failed" });
  }
});

// POST /verify/share (public)
router.post("/verify/share", rateLimitShare, upload.single("file"), async (req: Request & { file?: Express.Multer.File }, res) => {
  try {
    const { token, captureId } = req.body || {};
    if (!token || !captureId) return verifyShareFail(res, "INVALID_REQUEST");
    if (!req.file?.buffer) return verifyShareFail(res, "MISSING_FILE");

    const tokenHash = hashToken(String(token));

    const { data: share, error: shareErr } = await supabase
      .from("verification_shares")
      .select("id, user_id, capture_id, expires_at, revoked")
      .eq("token_hash", tokenHash)
      .eq("capture_id", captureId)
      .eq("revoked", false)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (shareErr) {
      console.error("[verify/share] share lookup failed:", shareErr.message);
      return verifyShareFail(res, "SHARE_LOOKUP_FAILED");
    }
    if (!share) return verifyShareFail(res, "SHARE_NOT_FOUND");

    const fileSha = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    const { data: capture, error: capErr } = await supabase
      .from("credentials")
      .select(
        "id, user_id, sha256, media_key, status, timestamp, tsa_time, signature_b64, public_key_b64, credential_json, tsa_token_base64, tsa_verified"
      )
      .eq("id", captureId)
      .eq("user_id", share.user_id)
      .maybeSingle();

    if (capErr) {
      console.error("[verify/share] capture lookup failed:", capErr.message);
      return verifyShareFail(res, "CAPTURE_LOOKUP_FAILED");
    }
    if (!capture) return verifyShareFail(res, "CAPTURE_NOT_FOUND");

    const mediaKey = capture.media_key ?? null;
    if (!mediaKey) {
      return verifyShareFail(res, "MISSING_MEDIA_OBJECT", { captureId: capture.id });
    }

    const mediaExists = await s3ObjectExists(mediaKey);
    if (!mediaExists) {
      return verifyShareFail(res, "MISSING_MEDIA_OBJECT", { captureId: capture.id });
    }

    if (capture.sha256 !== fileSha) {
      return verifyShareFail(res, "HASH_MISMATCH", {
        captureId,
        sha256: capture.sha256,
        signatureValid: false,
        anchorValid: false,
        timestampValid: false,
        verificationTier: "invalid",
      });
    }

    const signatureValid = verifySha256Signature({
      signatureB64: capture.signature_b64 ?? null,
      publicKeyB64: resolveCredentialPublicKeyB64(capture),
      sha256: capture.sha256,
    });

    const timestampValid = await isTsaAnchoringValid({
      sha256Hex: fileSha,
      tsaVerified: capture.tsa_verified,
      tsaTokenBase64: capture.tsa_token_base64,
    });

    // Share links are "VERIFIED" only if hash+signature+TSA are all valid.
    const verified = !!(signatureValid && timestampValid);

    const verdict = buildVerdict({
      hashMatch: true, // hash was compared above
      signatureValid: !!signatureValid,
      anchorValid: !!timestampValid,
    });
    const verificationTier = buildVerificationTier(verdict);

    let reason: ShareVerifyReason | null = null;
    if (!signatureValid) reason = "SIGNATURE_INVALID";
    else if (!timestampValid) reason = "ANCHOR_INVALID";

    const bundleToken = verified ? signEvidenceBundleToken({
      v: 1,
      captureId: capture.id,
      sha256: fileSha,
      shareTokenHash: tokenHash,
      exp: share.expires_at,
      nonce: crypto.randomBytes(12).toString("base64url"),
    }) : null;

    return res.json({
      verified,
      reason,
      captureId: capture.id,
      sha256: capture.sha256,
      status: capture.status,
      capturedAt: capture.timestamp,
      anchoredAt: capture.tsa_time,
      signatureValid,
      anchorValid: timestampValid,
      timestampValid,
      mediaExists,
      verificationTier,
      verdict,
      bundleToken,
    });
  } catch (err: any) {
    console.error("[verify/share] error:", err?.message || err);
    return verifyShareFail(res, "VERIFY_ERROR");
  }
});

// GET /shares/:captureId/evidence-bundle (public via share, verified-only)
router.get("/shares/:captureId/evidence-bundle", async (req: Request, res: Response) => {
  try {
    const captureId = String(req.params.captureId || "").trim();
    const bundle = String(req.query.bundle || "").trim();
    if (!captureId || !bundle) return res.status(400).json({ error: "missing_params" });

    const payload = verifyEvidenceBundleToken(bundle);
    if (!payload || payload.v !== 1) return res.status(401).json({ error: "invalid_bundle_token" });
    if (payload.captureId !== captureId) return res.status(401).json({ error: "bundle_capture_mismatch" });

    const expIso = String(payload.exp || "");
    const expMs = Date.parse(expIso);
    if (!expMs || Date.now() > expMs) return res.status(410).json({ error: "bundle_expired" });

    const shareTokenHash = String(payload.shareTokenHash || "");
    const sha256FromVerify = String(payload.sha256 || "");
    if (!/^[0-9a-f]{64}$/i.test(sha256FromVerify)) return res.status(401).json({ error: "invalid_sha256" });

    // Ensure the underlying share is still valid (same expiry/revocation rules)
    const { data: share, error: shareErr } = await supabase
      .from("verification_shares")
      .select("id, user_id, capture_id, expires_at, revoked")
      .eq("token_hash", shareTokenHash)
      .eq("capture_id", captureId)
      .eq("revoked", false)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (shareErr) {
      console.error("[share bundle] share lookup failed:", shareErr.message);
      return res.status(500).json({ error: "share_lookup_failed" });
    }
    if (!share) return res.status(404).json({ error: "share_not_found" });

    const ok = await streamEvidenceBundleZip({
      res,
      captureId,
      ownerUserId: share.user_id,
      expectedSha256: sha256FromVerify,
      expectedShaMismatchError: "bundle_sha256_mismatch",
      readmeTitle: "ProofLens Evidence Bundle (Share Link)",
      logPrefix: "share bundle",
      failureError: "share_bundle_failed",
    });
    if (!ok) return;
  } catch (err: any) {
    console.error("[share bundle] error:", err?.message || err);
    return res.status(500).json({ error: "share_bundle_failed" });
  }
});

// POST /shares - Canonical create verification share link
router.post("/shares", rateLimitWrite, async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const input = parseShareCreateInput(req.body);
    if (!input) return res.status(400).json({ error: "invalid_share_create_payload" });

    return await createShareForCapture(req, res, userId, input);
  } catch (err: any) {
    console.error("[shares] POST error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// GET /shares - List user's verification shares
router.get("/shares", async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const { data, error } = await supabase
      .from("verification_shares")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[shares] select failed:", error);
      return res.status(500).json({ error: "shares_fetch_failed" });
    }

    return res.json({ shares: data });
  } catch (err: any) {
    console.error("[shares] GET error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// PATCH /shares/:id/revoke - Revoke a share link
router.patch("/shares/:id/revoke", async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const shareId = req.params.id;

    const { data, error } = await supabase
      .from("verification_shares")
      .update({ revoked: true })
      .eq("id", shareId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      console.error("[shares/:id/revoke] update failed:", error);
      return res.status(500).json({ error: "revoke_failed" });
    }

    return res.json({ share: data });
  } catch (err: any) {
    console.error("[shares/:id/revoke] error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// GET /verify/share/:token - Public verification (NO AUTH)
router.get("/verify/share/:token", async (req: Request, res: Response) => {
  try {
    const token = req.params.token;

    if (!token) {
      return res.status(400).json({ error: "missing_token" });
    }

    // Call RPC function (uses anon role internally via service role)
    const { data, error } = await supabase.rpc("get_shared_credential", {
      p_token: token,
    });

    if (error) {
      console.error("[verify/share] RPC error:", error);
      return res.status(500).json({ error: "verification_failed" });
    }

    if (!data || data.length === 0) {
      return verifyShareFail(res, "SHARE_NOT_FOUND", {
        verificationScope: "metadata_only",
      });
    }

    const credential = data[0];
    const credentialId = credential?.id || credential?.credential_id || null;

    const mediaKey = credential.media_key || null;
    const mediaExists = mediaKey ? await s3ObjectExists(mediaKey) : false;
    const tsrKey = mediaKey ? buildTsrKey(mediaKey) : null;
    const tsrExists = tsrKey ? await s3ObjectExists(tsrKey) : false;

    // Generate signed media URLs only when objects exist.
    const mediaUrl = mediaKey && mediaExists ? await getSignedGetUrl(mediaKey, 3600) : null;
    const tsrUrl = tsrKey && tsrExists
      ? await getSignedGetUrl(tsrKey, 3600).catch(() => null)
      : null;

    // Verify signature (if available)
    const signatureValid = credential.signature_b64 && credential.public_key_b64
      ? verifySha256Signature({
          signatureB64: credential.signature_b64,
          publicKeyB64: credential.public_key_b64,
          sha256: credential.sha256,
        })
      : false;

    // Verify TSA (if available)
    const anchorValid = credential.tsa_verified === true
      ? true
      : await isTsaAnchoringValid({
          sha256Hex: credential.sha256,
          tsaVerified: credential.tsa_verified,
          tsaTokenBase64: credential.tsa_token_base64,
        });

    const metadataVerified = !!(signatureValid && anchorValid && mediaExists);
    const verdict = buildVerdict({
      hashMatch: false,
      signatureValid: !!signatureValid,
      anchorValid: !!anchorValid,
    });
    const verificationTier = buildVerificationTier(verdict);

    return res.json({
      verified: false,
      reason: "FILE_REQUIRED_FOR_FULL_VERIFICATION",
      verificationScope: "metadata_only",
      metadataVerified,
      verificationTier,
      credential: {
        id: credentialId,
        sha256: credential.sha256,
        capture_timestamp: credential.capture_timestamp,
        media_key: credential.media_key,
        thumbnail_key: credential.thumbnail_key,
        device_id: credential.device_id,
        capture_device_id: credential.capture_device_id,
        status: credential.status,
        tsa_time: credential.tsa_time,
        tsa_verified: credential.tsa_verified,
        frame_index: credential.frame_index,
        frame_total: credential.frame_total,
        gps: credential.gps,
        exif_json: credential.exif_json,
      },
      capture_id: credentialId,
      captureId: credentialId,
      mediaUrl,
      tsrUrl,
      mediaExists,
      tsrExists,
      signatureValid,
      anchorValid,
      verdict,
    });
  } catch (err: any) {
    console.error("[verify/share] error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
