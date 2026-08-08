// prooflens-api/src/routes/audio.ts
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { supabase, upload } from "../clients";
import { getUserIdFromRequest, getRegisteredDevicePublicKeyB64 } from "../services/device";
import { streamAudioEvidenceBundleZip } from "../services/evidence";
import { anchorWithTSA } from "../tsa";
import {
  verifySha256Signature,
  resolveCredentialPublicKeyB64,
  isTsaAnchoringValid,
  signAudioBundleToken,
  verifyAudioBundleToken,
  buildVerdict,
  buildVerificationTier,
} from "../utils/crypto";
import { hashToken, randomToken, shareBaseUrl } from "../utils/helpers";
import { getSignedGetUrl, s3ObjectExists, getS3ObjectBytes, buildTsrKey, expandS3KeyCandidates, uploadTsaSidecar, sha256OfS3ObjectKey } from "../utils/s3";
import { rateLimitShare, rateLimitWrite } from "../utils/rateLimit";
import { TSA_URL } from "../config";
import { validate, audioRecordSchema, audioShareCreateSchema, audioDraftPostSchema, requireDeviceId } from "../utils/validation";

type AudioRecordPayload = {
  credential?: {
    type?: string;
    sha256: string;
    capture_device_id?: string | null;
    public_key: string;
    timestamp?: string | number | null;
    gps?: unknown;
    duration_ms?: number | null;
    title?: string | null;
    audio_id?: string | null;
  };
  signatureB64?: string;
  media_key?: string;
  title?: string;
  duration_ms?: number | null;
  sha256?: string;
};

const router = Router();

function normalizeOptionalTimestamp(raw: string | number | null | undefined): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const tsMs = typeof raw === "number" ? raw : Date.parse(String(raw));
  if (!Number.isFinite(tsMs)) return null;
  return new Date(tsMs).toISOString();
}

type AudioShareVerifyReason =
  | "INVALID_REQUEST"
  | "MISSING_FILE"
  | "MISSING_MEDIA_OBJECT"
  | "SHARE_LOOKUP_FAILED"
  | "SHARE_NOT_FOUND"
  | "AUDIO_LOOKUP_FAILED"
  | "AUDIO_NOT_FOUND"
  | "HASH_MISMATCH"
  | "SIGNATURE_INVALID"
  | "ANCHOR_INVALID"
  | "FILE_REQUIRED_FOR_FULL_VERIFICATION"
  | "VERIFY_ERROR";

function audioVerifyFail(res: Response, reason: AudioShareVerifyReason, extra: Record<string, unknown> = {}) {
  return res.json({ verified: false, reason, ...extra });
}

// POST /audio/records (upload audio credential + metadata)
router.post("/audio/records", rateLimitWrite, requireDeviceId, validate(audioRecordSchema), async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const deviceId = (req.header("x-device-id") || "").toString();
    if (!deviceId) return res.status(400).json({ error: "missing_x_device_id" });

    const body = (req.body || {}) as AudioRecordPayload;
    const { credential, signatureB64, media_key, title, duration_ms, sha256 } = body;

    if (!credential || !signatureB64 || !media_key) {
      return res.status(400).json({ error: "missing_fields" });
    }

    if (credential.type && credential.type !== "audio") {
      return res.status(400).json({ error: "invalid_type" });
    }

    const captureDeviceId = credential.capture_device_id ?? null;
    if (!captureDeviceId || captureDeviceId !== deviceId) {
      return res.status(403).json({ error: "capture_device_mismatch" });
    }

    const registeredKey = await getRegisteredDevicePublicKeyB64({ userId, deviceId });
    if (!registeredKey) {
      return res.status(403).json({ error: "device_not_registered" });
    }
    if (credential.public_key !== registeredKey) {
      return res.status(403).json({ error: "device_key_mismatch" });
    }

    const claimedSha = (credential.sha256 || sha256 || "").toString();
    if (!/^[0-9a-fA-F]{64}$/.test(claimedSha)) {
      return res.status(400).json({ error: "bad_sha256" });
    }

    if (!(await s3ObjectExists(media_key))) {
      return res.status(409).json({ error: "audio_media_not_found" });
    }

    // Verify S3 object hash matches claimed SHA-256
    let computedSha: string;
    try {
      computedSha = await sha256OfS3ObjectKey(media_key);
    } catch (e: any) {
      return res.status(502).json({ error: "s3_hash_verification_failed" });
    }
    if (computedSha !== claimedSha) {
      return res.status(400).json({ error: "hash_mismatch", computedSha256: computedSha });
    }

    const ok = verifySha256Signature({
      signatureB64,
      publicKeyB64: credential.public_key,
      sha256: claimedSha,
    });
    if (!ok) return res.status(400).json({ error: "invalid_signature" });

    // Timestamp plausibility: reject malformed timestamps and future skew >10 min.
    const normalizedTimestamp = normalizeOptionalTimestamp(credential.timestamp);
    if (credential.timestamp !== undefined && credential.timestamp !== null && credential.timestamp !== "") {
      if (!normalizedTimestamp) {
        return res.status(400).json({ error: "timestamp_invalid" });
      }
      const tsMs = Date.parse(normalizedTimestamp);
      if (tsMs > Date.now() + 10 * 60 * 1000) {
        return res.status(400).json({ error: "timestamp_future" });
      }
    }

    const audioId = (credential.audio_id || "").toString() || crypto.randomUUID();
    const createdAt = normalizedTimestamp ?? new Date().toISOString();

    const insertRow = {
      id: audioId,
      user_id: userId,
      title: title || credential.title || `Audio ${audioId.slice(0, 6)}`,
      duration: duration_ms ?? credential.duration_ms ?? null,
      sha256: claimedSha,
      signature: signatureB64,
      public_key_b64: credential.public_key ?? null,
      credential_json: {
        ...credential,
        timestamp: normalizedTimestamp,
      },
      device_id: captureDeviceId,
      gps: credential.gps ?? null,
      s3_key: media_key,
      tsa_status: "submitted",
      tsa_token_base64: null,
      anchor_timestamp: null,
      created_at: createdAt,
    };

    const { data: created, error: insErr } = await supabase
      .from("audio_records")
      .insert(insertRow)
      .select()
      .maybeSingle();

    if (insErr && (insErr as any)?.code === "23505") {
      const { data: existing, error: existingErr } = await supabase
        .from("audio_records")
        .select("id, user_id, title, duration, sha256, signature, device_id, gps, s3_key, tsa_status, tsa_token_base64, anchor_timestamp, created_at")
        .eq("id", audioId)
        .eq("user_id", userId)
        .maybeSingle();

      if (existingErr) {
        console.error("[/audio/records] existing lookup failed:", existingErr.message);
      }
      if (existing) {
        return res.json(existing);
      }
    }

    if (insErr) {
      console.error("[/audio/records] insert failed:", insErr.message);
      return res.status(500).json({ error: "audio_record_insert_failed" });
    }

    let createdRecord = created;
    if (!createdRecord) {
      const { data: fetched, error: fetchErr } = await supabase
        .from("audio_records")
        .select("id, user_id, title, duration, sha256, signature, device_id, gps, s3_key, tsa_status, tsa_token_base64, anchor_timestamp, created_at")
        .eq("id", audioId)
        .eq("user_id", userId)
        .maybeSingle();

      if (fetchErr) {
        console.warn("[/audio/records] post-insert fetch failed:", fetchErr.message);
      }
      createdRecord = fetched ?? null;
    }

    if (TSA_URL) {
      try {
        const { tokenBase64, genTime } = await anchorWithTSA(claimedSha);

        await supabase
          .from("audio_records")
          .update({
            tsa_status: "anchored",
            tsa_token_base64: tokenBase64,
            anchor_timestamp: genTime,
          })
          .eq("id", audioId);

        await uploadTsaSidecar(media_key, tokenBase64);
      } catch (e: any) {
        console.warn("[audio tsa] anchoring failed:", e?.message || e);
      }
    }

    // Delete matching audio_draft after successful record creation
    try {
      await supabase
        .from("audio_drafts")
        .delete()
        .eq("user_id", userId)
        .eq("sha256", claimedSha);
    } catch (draftDelErr: any) {
      console.warn("[audio/records] audio_draft cleanup failed:", draftDelErr?.message || draftDelErr);
    }

    return res.json(createdRecord ?? {
      id: audioId,
      user_id: userId,
      title: insertRow.title,
      duration: insertRow.duration,
      sha256: insertRow.sha256,
      signature: insertRow.signature,
      device_id: insertRow.device_id,
      gps: insertRow.gps,
      s3_key: insertRow.s3_key,
      tsa_status: insertRow.tsa_status,
      tsa_token_base64: insertRow.tsa_token_base64,
      anchor_timestamp: insertRow.anchor_timestamp,
      created_at: insertRow.created_at,
    });
  } catch (e: any) {
    console.error("[/audio/records] error:", e?.message || e);
    return res.status(500).json({ error: "audio_record_failed" });
  }
});

// GET /audio/records (list audio for signed-in user)
router.get("/audio/records", async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const { data, error } = await supabase
      .from("audio_records")
      .select("id, user_id, title, duration, sha256, signature, device_id, gps, s3_key, tsa_status, tsa_token_base64, anchor_timestamp, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[/audio/records] select failed:", error.message);
      return res.status(500).json({ error: "audio_records_fetch_failed" });
    }

    const items = data ?? [];
    const itemsWithUrls = await Promise.all(
      items.map(async (rec: any) => {
        const mediaKey = rec.s3_key ?? null;
        const tsrKey = mediaKey ? buildTsrKey(mediaKey) : null;
        const media_url = mediaKey ? await getSignedGetUrl(mediaKey, 300) : null;
        const tsr_url = tsrKey && (rec.tsa_token_base64 || rec.tsa_status === "anchored")
          ? await getSignedGetUrl(tsrKey, 300)
          : null;
        return {
          ...rec,
          media_url,
          tsr_url,
          duration_ms: rec.duration ?? null,
        };
      })
    );

    return res.json({ items: itemsWithUrls });
  } catch (e: any) {
    console.error("[/audio/records] error:", e?.message || e);
    return res.status(500).json({ error: "audio_records_fetch_failed" });
  }
});

// GET /audio/:audioId/evidence-bundle (owner-only)
router.get("/audio/:audioId/evidence-bundle", async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const audioId = String(req.params.audioId || "").trim();
    if (!audioId) return res.status(400).json({ error: "missing_audio_id" });

    const ok = await streamAudioEvidenceBundleZip({
      res,
      audioId,
      ownerUserId: userId,
      readmeTitle: "ProofLens Audio Evidence Bundle",
      logPrefix: "audio-bundle",
      failureError: "audio_bundle_failed",
    });
    if (!ok) return;
  } catch (e: any) {
    console.error("[audio bundle] error:", e?.message || e);
    return res.status(500).json({ error: "audio_bundle_failed" });
  }
});

// POST /audio/shares/create (owner-only)
router.post("/audio/shares/create", rateLimitWrite, validate(audioShareCreateSchema), async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const { audioId, ttlHours } = req.body || {};
    if (!audioId) return res.status(400).json({ error: "missing_audio_id" });

    const { data: rec, error: recErr } = await supabase
      .from("audio_records")
      .select("id, user_id, tsa_status")
      .eq("id", audioId)
      .eq("user_id", userId)
      .maybeSingle();

    if (recErr) {
      console.error("[audio shares/create] lookup failed:", recErr.message);
      return res.status(500).json({ error: "audio_lookup_failed" });
    }
    if (!rec) return res.status(404).json({ error: "audio_not_found" });
    if (rec.tsa_status !== "anchored") {
      return res.status(409).json({ error: "audio_not_anchored", detail: "share_requires_anchored_audio" });
    }

    const ttl = Number.isFinite(ttlHours) ? Math.min(Math.max(Number(ttlHours), 1), 24 * 30) : 72;
    const expiresAt = new Date(Date.now() + ttl * 60 * 60 * 1000).toISOString();

    const token = randomToken();
    const tokenHash = hashToken(token);

    const { data: share, error: shareErr } = await supabase
      .from("audio_shares")
      .insert({
        user_id: userId,
        audio_id: audioId,
        token_hash: tokenHash,
        expires_at: expiresAt,
      })
      .select("id, expires_at")
      .single();

    if (shareErr) {
      console.error("[audio shares/create] insert failed:", shareErr.message);
      return res.status(500).json({ error: "audio_share_create_failed" });
    }

    const base = shareBaseUrl();
    const shareUrl = `${base}/audio-share?token=${encodeURIComponent(token)}&audio=${encodeURIComponent(audioId)}`;

    return res.json({ shareUrl, expiresAt: share?.expires_at });
  } catch (e: any) {
    console.error("[audio shares/create] error:", e?.message || e);
    return res.status(500).json({ error: "audio_share_create_failed" });
  }
});

// POST /audio/verify/share (public, with file)
router.post("/audio/verify/share", rateLimitShare, upload.single("file"), async (req: Request & { file?: Express.Multer.File }, res) => {
  try {
    const { token, audioId } = req.body || {};
    if (!token || !audioId) return audioVerifyFail(res, "INVALID_REQUEST");
    if (!req.file?.buffer) return audioVerifyFail(res, "MISSING_FILE");

    const tokenHash = hashToken(String(token));

    const { data: share, error: shareErr } = await supabase
      .from("audio_shares")
      .select("id, user_id, audio_id, expires_at, revoked")
      .eq("token_hash", tokenHash)
      .eq("audio_id", String(audioId))
      .eq("revoked", false)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (shareErr) {
      console.error("[audio verify/share] share lookup failed:", shareErr.message);
      return audioVerifyFail(res, "SHARE_LOOKUP_FAILED");
    }
    if (!share) return audioVerifyFail(res, "SHARE_NOT_FOUND");

    const { data: rec, error: recErr } = await supabase
      .from("audio_records")
      .select("id, user_id, title, duration, sha256, signature, public_key_b64, credential_json, device_id, gps, s3_key, tsa_status, anchor_timestamp, created_at")
      .eq("id", String(audioId))
      .maybeSingle();

    if (recErr) {
      console.error("[audio verify/share] lookup failed:", recErr.message);
      return audioVerifyFail(res, "AUDIO_LOOKUP_FAILED");
    }
    if (!rec) return audioVerifyFail(res, "AUDIO_NOT_FOUND");

    const record = rec as {
      id: string;
      user_id: string;
      sha256: string;
      signature: string | null;
      public_key_b64: string | null;
      credential_json: unknown;
      device_id: string;
      s3_key: string | null;
      tsa_status: string | null;
      anchor_timestamp: string | null;
      created_at: string | null;
    };

    const fileSha = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    const storedSha = String(record.sha256 || "");
    if (!storedSha || fileSha.toLowerCase() !== storedSha.toLowerCase()) {
      return audioVerifyFail(res, "HASH_MISMATCH", {
        audioId: record.id,
        sha256: storedSha || fileSha,
        signatureValid: false,
        anchorValid: false,
        timestampValid: false,
        verificationTier: "invalid",
      });
    }

    const audioKey = record.s3_key;
    const mediaExists = audioKey ? await s3ObjectExists(audioKey) : false;
    if (!mediaExists) {
      return audioVerifyFail(res, "MISSING_MEDIA_OBJECT", {
        audioId: record.id,
      });
    }

    const tsrKey = audioKey ? buildTsrKey(audioKey) : null;
    const tsrExists = tsrKey ? await s3ObjectExists(tsrKey) : false;

    const storedCredentialJson = record.credential_json ?? null;
    const storedPublicKeyB64 = resolveCredentialPublicKeyB64({
      public_key_b64: record.public_key_b64 ?? null,
      credential_json: storedCredentialJson,
    });
    const registeredPublicKeyB64 = storedPublicKeyB64 || (await getRegisteredDevicePublicKeyB64({
      userId: record.user_id,
      deviceId: record.device_id,
    }));

    const signatureValid = verifySha256Signature({
      signatureB64: record.signature ?? null,
      publicKeyB64: registeredPublicKeyB64,
      sha256: record.sha256,
    });

    let tsrB64: string | null = null;
    if (tsrKey && tsrExists) {
      try {
        const tsrBytes = await getS3ObjectBytes(tsrKey);
        tsrB64 = tsrBytes.toString("base64");
      } catch {}
    }

    const timestampValid = await isTsaAnchoringValid({
      sha256Hex: fileSha,
      tsaVerified: record.tsa_status === "anchored",
      tsaTokenBase64: tsrB64,
    });

    const verified = !!(signatureValid && timestampValid);
    const bundleToken = verified
      ? signAudioBundleToken({
          v: 1,
          audioId: record.id,
          sha256: fileSha,
          shareTokenHash: tokenHash,
          exp: share.expires_at,
          nonce: crypto.randomBytes(12).toString("base64url"),
        })
      : null;

    const media_url = audioKey && mediaExists ? await getSignedGetUrl(audioKey, 120) : null;
    const tsr_url = tsrKey && tsrExists ? await getSignedGetUrl(tsrKey, 120) : null;

    const verdict = buildVerdict({
      hashMatch: true, // hash was compared above
      signatureValid: !!signatureValid,
      anchorValid: !!timestampValid,
    });
    const verificationTier = buildVerificationTier(verdict);

    let reason: AudioShareVerifyReason | null = null;
    if (!signatureValid) reason = "SIGNATURE_INVALID";
    else if (!timestampValid) reason = "ANCHOR_INVALID";

    return res.json({
      verified,
      reason,
      audio: record,
      audioId: record.id,
      mediaUrl: media_url,
      tsrUrl: tsr_url,
      signatureValid,
      anchorValid: timestampValid,
      timestampValid,
      verificationTier,
      verdict,
      bundleToken,
      sha256: fileSha,
      mediaExists,
      tsrExists,
    });
  } catch (e: any) {
    console.error("[audio verify/share] error:", e?.message || e);
    return audioVerifyFail(res, "VERIFY_ERROR");
  }
});

// GET /audio/verify/share (public)
router.get("/audio/verify/share", async (req: Request, res: Response) => {
  try {
    const token = String(req.query.token || req.query.share || "").trim();
    const audioId = String(req.query.audio || "").trim();
    if (!token || !audioId) return audioVerifyFail(res, "INVALID_REQUEST");

    const tokenHash = hashToken(token);

    const { data: share, error: shareErr } = await supabase
      .from("audio_shares")
      .select("id, user_id, audio_id, expires_at, revoked")
      .eq("token_hash", tokenHash)
      .eq("audio_id", audioId)
      .eq("revoked", false)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (shareErr) {
      console.error("[audio verify/share] share lookup failed:", shareErr.message);
      return audioVerifyFail(res, "SHARE_LOOKUP_FAILED");
    }
    if (!share) return audioVerifyFail(res, "SHARE_NOT_FOUND");

    const { data: rec, error: recErr } = await supabase
      .from("audio_records")
      .select("id, user_id, title, duration, sha256, signature, public_key_b64, credential_json, device_id, gps, s3_key, tsa_status, anchor_timestamp, created_at")
      .eq("id", audioId)
      .maybeSingle();

    if (recErr) {
      console.error("[audio verify/share] lookup failed:", recErr.message);
      return audioVerifyFail(res, "AUDIO_LOOKUP_FAILED");
    }
    if (!rec) return audioVerifyFail(res, "AUDIO_NOT_FOUND");

    const record = rec as {
      id: string;
      user_id: string;
      sha256: string;
      signature: string | null;
      public_key_b64: string | null;
      credential_json: unknown;
      device_id: string;
      s3_key: string | null;
      tsa_status: string | null;
      anchor_timestamp: string | null;
      created_at: string | null;
    };

    const audioKey = record.s3_key;
    const mediaExists = audioKey ? await s3ObjectExists(audioKey) : false;
    const tsrKey = audioKey ? buildTsrKey(audioKey) : null;
    const tsrExists = tsrKey ? await s3ObjectExists(tsrKey) : false;

    const storedCredentialJson = record.credential_json ?? null;
    const storedPublicKeyB64 = resolveCredentialPublicKeyB64({
      public_key_b64: record.public_key_b64 ?? null,
      credential_json: storedCredentialJson,
    });
    const registeredPublicKeyB64 = storedPublicKeyB64 || (await getRegisteredDevicePublicKeyB64({
      userId: record.user_id,
      deviceId: record.device_id,
    }));

    const signatureValid = verifySha256Signature({
      signatureB64: record.signature ?? null,
      publicKeyB64: registeredPublicKeyB64,
      sha256: record.sha256,
    });

    let tsrB64: string | null = null;
    if (tsrKey && tsrExists) {
      try {
        const tsrBytes = await getS3ObjectBytes(tsrKey);
        tsrB64 = tsrBytes.toString("base64");
      } catch {}
    }

    const timestampValid = await isTsaAnchoringValid({
      sha256Hex: record.sha256,
      tsaVerified: record.tsa_status === "anchored",
      tsaTokenBase64: tsrB64,
    });

    const media_url = audioKey && mediaExists ? await getSignedGetUrl(audioKey, 120) : null;
    const tsr_url = tsrKey && tsrExists ? await getSignedGetUrl(tsrKey, 120) : null;

    const metadataVerified = !!(signatureValid && timestampValid && mediaExists);
    const verdict = buildVerdict({
      hashMatch: false,
      signatureValid: !!signatureValid,
      anchorValid: !!timestampValid,
    });
    const verificationTier = buildVerificationTier(verdict);

    return res.json({
      verified: false,
      reason: "FILE_REQUIRED_FOR_FULL_VERIFICATION",
      verificationScope: "metadata_only",
      metadataVerified,
      audio: record,
      audioId: record.id,
      mediaUrl: media_url,
      tsrUrl: tsr_url,
      signatureValid,
      anchorValid: timestampValid,
      timestampValid,
      mediaExists,
      tsrExists,
      verificationTier,
      verdict,
    });
  } catch (e: any) {
    console.error("[audio verify/share] error:", e?.message || e);
    return audioVerifyFail(res, "VERIFY_ERROR");
  }
});

// GET /audio/shares/:audioId/evidence-bundle (public)
router.get("/audio/shares/:audioId/evidence-bundle", async (req: Request, res: Response) => {
  try {
    const audioId = String(req.params.audioId || "").trim();
    const bundle = String(req.query.bundle || "").trim();
    if (!audioId || !bundle) return res.status(400).json({ error: "missing_params" });

    const payload = verifyAudioBundleToken(bundle);
    if (!payload || payload.v !== 1 || payload.audioId !== audioId) {
      return res.status(401).json({ error: "invalid_bundle_token" });
    }

    const expIso = String(payload.exp || "");
    const expMs = Date.parse(expIso);
    if (!expMs || Date.now() > expMs) return res.status(410).json({ error: "bundle_expired" });

    const sha256FromVerify = String(payload.sha256 || "");
    if (!/^[0-9a-f]{64}$/i.test(sha256FromVerify)) {
      return res.status(401).json({ error: "invalid_sha256" });
    }

    // Ensure the underlying audio share is still valid (revocation check)
    const shareTokenHash = String(payload.shareTokenHash || "");
    if (shareTokenHash) {
      const { data: share } = await supabase
        .from("audio_shares")
        .select("id")
        .eq("token_hash", shareTokenHash)
        .eq("audio_id", audioId)
        .eq("revoked", false)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (!share) return res.status(404).json({ error: "share_not_found" });
    }

    const { data: rec, error: recErr } = await supabase
      .from("audio_records")
      .select("id, user_id")
      .eq("id", audioId)
      .maybeSingle();

    if (recErr) {
      console.error("[audio share bundle] lookup failed:", recErr.message);
      return res.status(500).json({ error: "audio_lookup_failed" });
    }
    if (!rec) return res.status(404).json({ error: "audio_not_found" });

    const ok = await streamAudioEvidenceBundleZip({
      res,
      audioId,
      ownerUserId: (rec as any).user_id,
      expectedSha256: sha256FromVerify,
      expectedShaMismatchError: "bundle_sha256_mismatch",
      readmeTitle: "ProofLens Audio Evidence Bundle (Share Link)",
      logPrefix: "audio share bundle",
      failureError: "audio_bundle_failed",
    });
    if (!ok) return;
  } catch (e: any) {
    console.error("[audio share bundle] error:", e?.message || e);
    return res.status(500).json({ error: "audio_bundle_failed" });
  }
});

// PATCH /audio/shares/:id/revoke (owner-only)
router.patch("/audio/shares/:id/revoke", async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const shareId = req.params.id;

    const { data, error } = await supabase
      .from("audio_shares")
      .update({ revoked: true })
      .eq("id", shareId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      console.error("[audio shares/:id/revoke] update failed:", error);
      return res.status(500).json({ error: "revoke_failed" });
    }

    return res.json({ share: data });
  } catch (e: any) {
    console.error("[audio shares/:id/revoke] error:", e?.message || e);
    return res.status(500).json({ error: "revoke_failed" });
  }
});

// POST /audio/drafts (cloud mirror of local pending audio)
router.post("/audio/drafts", rateLimitWrite, requireDeviceId, validate(audioDraftPostSchema), async (req: Request, res: Response) => {
  try {
    const user_id = await getUserIdFromRequest(req);
    if (!user_id) return res.status(401).json({ error: "not_authenticated" });

    const deviceId = (req.headers["x-device-id"] as string) || "";
    if (!deviceId) return res.status(400).json({ error: "missing_x_device_id" });

    const { credential, sha256, media_key, duration_ms } = req.body || {};
    if (!credential || !sha256) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const capture_device_id: string | null =
      credential.capture_device_id ?? credential.device_id ?? null;

    if (!capture_device_id || capture_device_id !== deviceId) {
      return res.status(403).json({ error: "capture_device_mismatch" });
    }

    const registeredKey = await getRegisteredDevicePublicKeyB64({ userId: user_id, deviceId });
    if (!registeredKey) {
      return res.status(403).json({ error: "device_not_registered" });
    }

    const claimedPub = credential?.public_key ?? null;
    if (claimedPub && claimedPub !== registeredKey) {
      return res.status(403).json({ error: "device_key_mismatch" });
    }

    const mediaKey = media_key ?? credential.media_key ?? null;

    const { data, error } = await supabase
      .from("audio_drafts")
      .upsert(
        {
          user_id,
          sha256,
          credential_json: credential,
          capture_device_id,
          media_key: mediaKey,
          duration_ms: duration_ms ?? credential.duration_ms ?? null,
        },
        { onConflict: "user_id,sha256", ignoreDuplicates: false }
      )
      .select("id, created_at, sha256, media_key, capture_device_id, duration_ms, credential_json")
      .single();

    if (error) {
      console.error("[audio/drafts] upsert failed:", error.message);
      return res.status(500).json({ error: "supabase_upsert_failed", detail: error.message });
    }

    // Backfill media_key if missing
    let finalMediaKey = data.media_key ?? null;
    if (!finalMediaKey && data.id) {
      const created = data.created_at ? new Date(data.created_at) : new Date();
      const yyyy = created.getUTCFullYear();
      const mm = String(created.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(created.getUTCDate()).padStart(2, "0");
      finalMediaKey = `audio/${yyyy}/${mm}/${dd}/${data.id}/${data.id}.m4a`;
      await supabase.from("audio_drafts").update({ media_key: finalMediaKey }).eq("id", data.id);
    }

    return res.json({
      id: data.id,
      created_at: data.created_at,
      sha256: data.sha256,
      media_key: finalMediaKey,
      capture_device_id: data.capture_device_id,
      duration_ms: data.duration_ms,
      credential_json: data.credential_json,
    });
  } catch (e: any) {
    console.error("[audio/drafts] POST error:", e?.message || String(e));
    return res.status(500).json({ error: "audio_drafts_post_failed", detail: e?.message || String(e) });
  }
});

// GET /audio/drafts/pending (list audio drafts for signed-in user)
router.get("/audio/drafts/pending", async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const { data, error } = await supabase
      .from("audio_drafts")
      .select("id, sha256, media_key, capture_device_id, duration_ms, credential_json, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[audio/drafts/pending] db error:", error);
      return res.status(500).json({ error: error.message });
    }

    const items = (data ?? []).map((row: any) => ({
      id: row.id,
      user_id: userId,
      sha256: row.sha256,
      media_key: row.media_key ?? null,
      credential_json: row.credential_json,
      capture_device_id: row.capture_device_id,
      duration_ms: row.duration_ms ?? null,
      created_at: row.created_at,
    }));

    return res.json(items);
  } catch (err: any) {
    console.error("[audio/drafts/pending] error:", err?.message || err);
    return res.status(500).json({ error: "audio_drafts_fetch_failed" });
  }
});

// DELETE /audio/drafts/:sha256
router.delete("/audio/drafts/:sha256", async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const { sha256 } = req.params;
    if (!sha256) return res.status(400).json({ error: "missing_sha256" });

    const { data: draft, error: fetchErr } = await supabase
      .from("audio_drafts")
      .select("id, media_key")
      .eq("user_id", userId)
      .eq("sha256", sha256)
      .maybeSingle();

    if (fetchErr) {
      console.error("[audio/drafts DELETE] fetch error:", fetchErr.message);
      return res.status(500).json({ error: "fetch_failed" });
    }
    if (!draft) return res.status(404).json({ error: "draft_not_found" });

    const { error: delErr } = await supabase
      .from("audio_drafts")
      .delete()
      .eq("id", draft.id)
      .eq("user_id", userId);

    if (delErr) {
      console.error("[audio/drafts DELETE] delete error:", delErr.message);
      return res.status(500).json({ error: "delete_failed" });
    }

    return res.json({ deleted: true, sha256 });
  } catch (e: any) {
    console.error("[audio/drafts DELETE] error:", e?.message || e);
    return res.status(500).json({ error: "audio_draft_delete_failed" });
  }
});

export default router;
