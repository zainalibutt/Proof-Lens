// prooflens-api/src/routes/verify.ts
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { supabase, upload } from "../clients";
import { getUserIdFromRequest } from "../services/device";
import { verifySha256Signature, resolveCredentialPublicKeyB64, isTsaAnchoringValid, buildVerdict, buildVerificationTier } from "../utils/crypto";
import { getSignedGetUrl, s3ObjectExists, buildTsrKey } from "../utils/s3";

const router = Router();

// POST /verify/upload (upload-and-verify)
router.post("/verify/upload", upload.single("file"), async (req: Request & { file?: Express.Multer.File }, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    if (!req.file?.buffer) {
      return res.status(400).json({ error: "missing_file" });
    }

    const sha256 = crypto.createHash("sha256").update(req.file.buffer).digest("hex");

    const { data, error } = await supabase
      .from("credentials")
      .select(
        "id, sha256, media_key, timestamp, status, capture_device_id, submitter_device_id, tsa_time, tsa_policy_oid, tsa_serial, tsa_verified, tsa_verified_at, credential_json, signature_b64, public_key_b64, tsa_token_base64"
      )
      .eq("sha256", sha256)
      .eq("user_id", userId)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[verify/upload] supabase error:", error.message);
      return res.status(500).json({ error: "supabase_select_failed", detail: error.message });
    }

    if (!data) {
      return res.json({
        found: false,
        verified: false,
        reason: "NOT_FOUND",
        verificationTier: "invalid",
        sha256,
      });
    }

    const mediaKey = data.media_key ?? null;
    const tsrKey = mediaKey ? buildTsrKey(mediaKey) : null;

    const mediaExists = mediaKey ? await s3ObjectExists(mediaKey) : false;
    const tsrExists = tsrKey ? await s3ObjectExists(tsrKey) : false;

    const signatureValid = verifySha256Signature({
      signatureB64: data.signature_b64 ?? null,
      publicKeyB64: resolveCredentialPublicKeyB64(data),
      sha256,
    });

    const anchorValid = await isTsaAnchoringValid({
      sha256Hex: sha256,
      tsaVerified: data.tsa_verified,
      tsaTokenBase64: data.tsa_token_base64,
    });

    const mediaUrl = mediaKey && mediaExists ? await getSignedGetUrl(mediaKey, 120) : null;
    const tsrUrl = tsrKey && tsrExists ? await getSignedGetUrl(tsrKey, 120) : null;

    const verdict = buildVerdict({
      hashMatch: true, // already matched via DB lookup by sha256
      signatureValid,
      anchorValid,
    });
    const verificationTier = buildVerificationTier(verdict);
    const verified = verificationTier === "anchored";
    const reason = verified ? null : (signatureValid ? "ANCHOR_INVALID" : "SIGNATURE_INVALID");

    return res.json({
      found: true,
      verified,
      reason,
      verificationTier,
      sha256,
      credential: data,
      mediaUrl,
      tsrUrl,
      mediaExists,
      signatureValid,
      anchorValid,
      verdict,
    });
  } catch (err: any) {
    console.error("[verify/upload] error:", err?.message || err);
    return res.status(500).json({ error: "verify_upload_failed" });
  }
});

export default router;
