// prooflens-api/src/routes/credentials.ts
import { Router, Request, Response } from "express";
import { supabase } from "../clients";
import { getUserIdFromRequest, getRegisteredDevicePublicKeyB64, auditUpload } from "../services/device";
import { verifySha256Signature } from "../utils/crypto";
import { anchorWithTSA } from "../tsa";
import { TSA_URL } from "../config";
import { getSignedGetUrl, sha256OfS3ObjectKey, buildTsrKey, uploadTsaSidecar } from "../utils/s3";
import { validate, credentialPostSchema, credentialUploadSchema, requireDeviceId } from "../utils/validation";
import { rateLimitWrite } from "../utils/rateLimit";

type CredentialPayload = {
  credential?: {
    sha256: string;
    capture_device_id?: string | null;
    public_key: string; // base64
    timestamp?: string | number | null;
    gps?: unknown;
    exif?: unknown;
  };
  signatureB64?: string;
  media_key?: string;
};

const router = Router();

function normalizeOptionalTimestamp(raw: string | number | null | undefined): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const tsMs = typeof raw === "number" ? raw : Date.parse(String(raw));
  if (!Number.isFinite(tsMs)) return null;
  return new Date(tsMs).toISOString();
}

// GET /credentials  (list credentials for the signed-in user)
router.get("/credentials", async (req: Request, res: Response) => {
  try {
    const user_id = await getUserIdFromRequest(req);
    if (!user_id) return res.status(401).json({ error: "not_authenticated" });

    // optional filters: status & limit/offset
    const status = (req.query.status as string) || "submitted";
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);

    // only allow submitted/failed/anchored to avoid arbitrary input
    if (!["submitted", "failed", "anchored"].includes(status)) {
      return res.status(400).json({ error: "bad_status" });
    }

    let query = supabase
      .from("credentials")
      .select("*")
      .eq("user_id", user_id)
      .order("timestamp", { ascending: false })
      .range(offset, offset + limit - 1);

    // "submitted" filter includes both submitted and anchored credentials,
    // since anchored items are a subset of successfully submitted ones.
    if (status === "submitted") {
      query = query.in("status", ["submitted", "anchored"]);
    } else {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[credentials] select failed:", error.message);
      return res.status(500).json({ error: "supabase_select_failed", detail: error.message });
    }

    const items = data ?? [];

    const itemsWithUrls = await Promise.all(
      items.map(async (item: any) => {
        try {
          const mediaKey = item.media_key ?? null;
          const tsrKey = mediaKey ? buildTsrKey(mediaKey) : null;
          const media_url = mediaKey ? await getSignedGetUrl(mediaKey, 300) : null;
          const tsr_url = tsrKey && (item.tsa_token_base64 || item.tsa_verified) ? await getSignedGetUrl(tsrKey, 300) : null;
          return { ...item, media_url, tsr_url };
        } catch {
          return { ...item, media_url: null, tsr_url: null };
        }
      })
    );

    return res.json({ items: itemsWithUrls, nextOffset: offset + itemsWithUrls.length });
  } catch (e: any) {
    console.error("[credentials] GET error:", e?.message || e);
    return res.status(500).json({ error: "credentials_get_failed" });
  }
});


// POST /credentials
router.post(
  "/credentials",
  rateLimitWrite,
  requireDeviceId,
  validate(credentialPostSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: "not_authenticated" });

      const deviceId = (req.header("x-device-id") || "").toString();
      if (!deviceId) return res.status(400).json({ error: "missing_x_device_id" });

      const body = (req.body || {}) as CredentialPayload;
      const { credential, signatureB64, media_key } = body;
      if (!credential || !signatureB64 || !media_key) {
        return res.status(400).json({ error: "missing_fields" });
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

      // Verify S3 object hash matches claimed SHA-256
      let computedSha: string;
      try {
        computedSha = await sha256OfS3ObjectKey(media_key);
      } catch (e: any) {
        return res.status(502).json({ error: "s3_hash_verification_failed" });
      }
      if (computedSha !== credential.sha256) {
        return res.status(400).json({ error: "hash_mismatch", computedSha256: computedSha });
      }

      // Verify Ed25519 over SHA-256 bytes
      const ok = verifySha256Signature({
        signatureB64,
        publicKeyB64: credential.public_key,
        sha256: credential.sha256,
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

      const submitter_device_id = deviceId;

      // 1) Insert as 'submitted'
      const row = {
        user_id: userId,
        sha256: credential.sha256,
        device_id: captureDeviceId,
        public_key_b64: credential.public_key,
        signature_b64: signatureB64,
        media_key,
        timestamp: normalizedTimestamp,
        gps: credential.gps ?? null,
        exif: credential.exif ?? null,
        status: "submitted" as const,
        credential_json: {
          ...credential,
          timestamp: normalizedTimestamp,
          capture_device_id: captureDeviceId,
          submitter_device_id,
        },
      };

      const { data, error } = await supabase
        .from("credentials")
        .insert(row)
        .select("id, media_key, sha256")
        .single();

      if (error) {
        console.error("[credentials] insert failed:", error.message);
        return res
          .status(500)
          .json({ error: "supabase_insert_failed", detail: error.message });
      }

      const credId = data.id as string;
      await supabase
        .from("drafts")
        .delete()
        .eq("user_id", userId)
        .eq("sha256", row.sha256);

      // 2) TSA anchoring (best-effort)
      if (TSA_URL) {
        try {
          const { tokenBase64, genTime, policyOid, serial } = await anchorWithTSA(
            (data as any)?.sha256 ?? row.sha256
          );

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
            .eq("id", credId);

          await uploadTsaSidecar(row.media_key, tokenBase64);
        } catch (e: any) {
          console.warn("[tsa] anchoring failed:", e?.message || e);
        }
      }

      return res.json({ ok: true, id: credId });
    } catch (e: any) {
      console.error("[credentials] POST error:", e?.message || e);
      return res.status(500).json({ error: "credentials_post_failed" });
    }
  }
);

// POST /credentials/upload (draft-to-credential promotion)
router.post("/credentials/upload", rateLimitWrite, requireDeviceId, validate(credentialUploadSchema), async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const deviceId = req.headers["x-device-id"];
    const { sha256, signatureB64, publicKeyB64, credential_json, media_key } = req.body;

    if (!sha256 || !signatureB64) {
      await auditUpload({
        userId,
        deviceId: typeof deviceId === "string" ? deviceId : null,
        sha256: sha256 ?? null,
        mediaKey: media_key ?? null,
        status: "rejected",
        reason: "missing_fields",
        req,
      });
      return res.status(400).json({ error: "missing_fields" });
    }

    if (!deviceId || typeof deviceId !== "string") {
      await auditUpload({ userId, deviceId: null, sha256, mediaKey: media_key ?? null, status: "rejected", reason: "missing_x_device_id", req });
      return res.status(400).json({ error: "missing_x_device_id" });
    }

    if (!/^[0-9a-fA-F]{64}$/.test(String(sha256))) {
      await auditUpload({ userId, deviceId, sha256, mediaKey: media_key ?? null, status: "rejected", reason: "bad_sha256", req });
      return res.status(400).json({ error: "bad_sha256" });
    }

    const registeredKey = await getRegisteredDevicePublicKeyB64({ userId, deviceId });
    if (!registeredKey) {
      await auditUpload({ userId, deviceId, sha256, mediaKey: media_key ?? null, status: "rejected", reason: "device_not_registered", req });
      return res.status(403).json({ error: "device_not_registered" });
    }

    // If client sent a pubkey, it must match the registered key.
    if (publicKeyB64 && publicKeyB64 !== registeredKey) {
      await auditUpload({ userId, deviceId, sha256, mediaKey: media_key ?? null, status: "rejected", reason: "device_key_mismatch", req });
      return res.status(403).json({ error: "device_key_mismatch" });
    }

    // 1. Load draft
    const { data: draft, error: draftErr } = await supabase
      .from("drafts")
      .select("*")
      .eq("user_id", userId)
      .eq("sha256", sha256)
      .single();

    if (draftErr || !draft) {
      console.error("[credentials/upload] draft lookup failed:", draftErr?.message || draftErr);
      return res.status(404).json({ error: "draft_not_found" });
    }

    const resolvedMediaKey =
      media_key ??
      draft.media_key ??
      draft.credential_json?.media_key ??
      draft.credential_json?.mediaKey ??
      null;
    if (!resolvedMediaKey) {
      return res.status(400).json({ error: "media_key_missing" });
    }

    // 2. Enforce device lock: only the capturing device may upload
    if (draft.capture_device_id !== deviceId) {
      await auditUpload({ userId, deviceId, sha256, mediaKey: resolvedMediaKey, status: "rejected", reason: "capture_device_mismatch", req });
      return res.status(403).json({ error: "capture_device_mismatch" });
    }

    // If credential JSON claims a public key, it must match the registered key.
    const draftClaimedPub = draft.credential_json?.public_key ?? draft.credential_json?.public_key_b64 ?? null;
    const bodyClaimedPub = credential_json?.public_key ?? credential_json?.public_key_b64 ?? null;
    const claimedPub = bodyClaimedPub ?? draftClaimedPub;
    if (claimedPub && claimedPub !== registeredKey) {
      await auditUpload({ userId, deviceId, sha256, mediaKey: resolvedMediaKey, status: "rejected", reason: "credential_pubkey_mismatch", req });
      return res.status(403).json({ error: "credential_pubkey_mismatch" });
    }

    // Signature must verify against the *registered* device key
    const sigOk = verifySha256Signature({
      signatureB64,
      publicKeyB64: registeredKey,
      sha256,
    });
    if (!sigOk) {
      await auditUpload({ userId, deviceId, sha256, mediaKey: resolvedMediaKey, signatureValid: false, status: "rejected", reason: "invalid_signature", req });
      return res.status(400).json({ error: "invalid_signature" });
    }

    // Recompute hash from S3 bytes — MANDATORY, never skip on access errors
    let computedSha: string | null = null;
    try {
      computedSha = await sha256OfS3ObjectKey(resolvedMediaKey);
    } catch (e: any) {
      await auditUpload({ userId, deviceId, sha256, mediaKey: resolvedMediaKey, signatureValid: true, status: "rejected", reason: "s3_hash_failed", req });
      return res.status(502).json({ error: "s3_hash_verification_failed" });
    }
    if (computedSha !== sha256) {
      await auditUpload({ userId, deviceId, sha256, mediaKey: resolvedMediaKey, computedSha256: computedSha, signatureValid: true, status: "rejected", reason: "hash_mismatch", req });
      return res.status(400).json({ error: "hash_mismatch", computedSha256: computedSha });
    }


    // 3. Merge credential JSON (prefer body.credential_json, fall back to draft)
    const baseJson = credential_json || draft.credential_json || {};

    const finalJson = {
      ...baseJson,
      sha256: draft.sha256,
      media_key: resolvedMediaKey,
      capture_device_id: draft.capture_device_id,
      submitter_device_id: deviceId,
      public_key_b64: registeredKey,
      signature_b64: signatureB64,
    };

    const normalizedUploadTimestamp = normalizeOptionalTimestamp(
      finalJson.timestamp as string | number | null | undefined
    );

    if (finalJson.timestamp !== undefined && finalJson.timestamp !== null && finalJson.timestamp !== "") {
      if (!normalizedUploadTimestamp) {
        await auditUpload({ userId, deviceId, sha256, mediaKey: resolvedMediaKey, status: "rejected", reason: "timestamp_invalid", req });
        return res.status(400).json({ error: "timestamp_invalid" });
      }
      const tsMs = Date.parse(normalizedUploadTimestamp);
      if (tsMs > Date.now() + 10 * 60 * 1000) {
        await auditUpload({ userId, deviceId, sha256, mediaKey: resolvedMediaKey, status: "rejected", reason: "timestamp_future", req });
        return res.status(400).json({ error: "timestamp_future" });
      }
    }


    // 4. If already exists, return it and clean the draft
    const { data: existing } = await supabase
      .from("credentials")
      .select("*")
      .eq("user_id", userId)
      .eq("sha256", draft.sha256)
      .maybeSingle();

    if (existing) {
      await supabase.from("drafts").delete().eq("id", draft.id);
      return res.json({ ok: true, credential: existing, already: true });
    }

    // 5. Insert into credentials
    const row = {
      id: draft.id,
      user_id: userId,
      sha256: draft.sha256,
      device_id: draft.capture_device_id ?? finalJson.capture_device_id ?? null,
      public_key_b64: registeredKey,
      signature_b64: signatureB64,
      media_key: resolvedMediaKey,
      thumbnail_key: draft.thumbnail_key ?? null,
      timestamp: normalizedUploadTimestamp,
      gps: finalJson.gps ?? null,
      exif: finalJson.exif ?? null,
      status: "submitted" as const,
      capture_device_id: draft.capture_device_id ?? null,
      submitter_device_id: deviceId ?? null,
      credential_json: {
        ...finalJson,
        timestamp: normalizedUploadTimestamp,
      },
      burst_id: draft.burst_id ?? null,
      frame_index: finalJson.frame_index ?? null,
      frame_total: finalJson.frame_total ?? null,
    };

    const { data: inserted, error: insertErr } = await supabase
      .from("credentials")
      .insert(row)
      .select()
      .single();

    if (insertErr) {
      console.error("[credentials/upload] insert failed:", insertErr.message);
      await auditUpload({ userId, deviceId, sha256, mediaKey: resolvedMediaKey, computedSha256: sha256, signatureValid: true, status: "error", reason: "credentials_insert_failed", req });
      return res.status(500).json({ error: "credentials_insert_failed" });
    }

    // TSA anchoring (best effort)
    if (TSA_URL) {
      try {
        const { tokenBase64, genTime, policyOid, serial } = await anchorWithTSA(inserted.sha256);

        await supabase
          .from("credentials")
          .update({
            tsa_token_base64: tokenBase64,
            tsa_time: genTime,
            tsa_policy_oid: policyOid,
            tsa_serial: serial,
            tsa_verified: true,
            tsa_verified_at: new Date().toISOString(),
            status: "anchored",
          })
          .eq("id", inserted.id);

        await uploadTsaSidecar(row.media_key, tokenBase64);

        // Auto-finalize burst if this was part of a burst
        if (draft.burst_id) {
          try {
            const { data: burst } = await supabase
              .from("bursts")
              .select("frame_total")
              .eq("id", draft.burst_id)
              .single();

            const { data: anchoredFrames } = await supabase
              .from("credentials")
              .select("id, frame_index")
              .eq("burst_id", draft.burst_id)
              .eq("status", "anchored");

            if (burst && anchoredFrames && anchoredFrames.length === burst.frame_total) {
              const frame0 = anchoredFrames.find((f: any) => f.frame_index === 0);
              await supabase
                .from("bursts")
                .update({
                  status: "anchored",
                  cover_credential_id: frame0?.id || anchoredFrames[0]?.id,
                })
                .eq("id", draft.burst_id);
            } else if (anchoredFrames && anchoredFrames.length > 0) {
              await supabase
                .from("bursts")
                .update({
                  status: "partial",
                  cover_credential_id: anchoredFrames[0]?.id,
                })
                .eq("id", draft.burst_id);
            }
          } catch (burstErr) {
            console.warn("[burst-finalize] auto-finalize failed:", burstErr);
          }
        }
      } catch (e: any) {
        console.warn("[tsa] anchoring failed:", e?.message || e);
      }
    }

    // 6. Delete the draft
    const { error: deleteErr } = await supabase
      .from("drafts")
      .delete()
      .eq("id", draft.id);

    if (deleteErr) {
      console.error("[credentials/upload] delete draft failed:", deleteErr.message);
    }

    await auditUpload({ userId, deviceId, sha256, mediaKey: resolvedMediaKey, computedSha256: sha256, signatureValid: true, status: "accepted", req });
    return res.json({ ok: true, credential: inserted });
  } catch (err: any) {
    console.error("[credentials/upload] error:", err?.message || err);
    return res.status(500).json({ error: "credentials_upload_failed" });
  }
});

export default router;
