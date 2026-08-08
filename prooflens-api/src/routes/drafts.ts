// prooflens-api/src/routes/drafts.ts
import { Router, Request, Response, NextFunction } from "express";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { supabase, s3 } from "../clients";
import { getUserIdFromRequest, getRegisteredDevicePublicKeyB64 } from "../services/device";
import { buildTsrKey } from "../utils/s3";
import { S3_BUCKET } from "../config";
import { draftPostSchema, requireDeviceId } from "../utils/validation";
import { rateLimitWrite } from "../utils/rateLimit";

const router = Router();

function validateDraftPostWithLogging(req: Request, res: Response, next: NextFunction) {
  const parsed = draftPostSchema.safeParse(req.body);
  if (!parsed.success) {
    console.warn("[drafts] validation_error", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    const firstIssue = parsed.error.issues[0];
    const detail = firstIssue
      ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
      : "validation_failed";
    return res.status(400).json({ error: "validation_error", detail });
  }
  req.body = parsed.data;
  next();
}

// POST /drafts (cloud mirror of local pending)
router.post("/drafts", rateLimitWrite, requireDeviceId, validateDraftPostWithLogging, async (req: Request, res: Response) => {
  try {
    const user_id = await getUserIdFromRequest(req);
    if (!user_id) return res.status(401).json({ error: "not_authenticated" });

    const deviceId = (req.headers["x-device-id"] as string) || "";
    if (!deviceId) return res.status(400).json({ error: "missing_x_device_id" });

    const { credential, sha256, media_key, thumbnail_key, burst_id } = req.body || {};
    if (!credential || !sha256) {
      console.warn("[drafts] missing_fields");
      return res.status(400).json({ error: "missing_fields" });
    }

    const capture_device_id: string | null =
      credential.device_id ?? credential.capture_device_id ?? null;

    if (!capture_device_id || capture_device_id !== deviceId) {
      console.warn("[drafts] capture_device_mismatch");
      return res.status(403).json({ error: "capture_device_mismatch" });
    }

    const registeredKey = await getRegisteredDevicePublicKeyB64({ userId: user_id, deviceId });
    if (!registeredKey) {
      console.warn("[drafts] device_not_registered");
      return res.status(403).json({ error: "device_not_registered" });
    }

    const claimedPub = credential?.public_key ?? credential?.public_key_b64 ?? null;
    if (claimedPub && claimedPub !== registeredKey) {
      console.warn("[drafts] device_key_mismatch");
      return res.status(403).json({ error: "device_key_mismatch" });
    }

    const submitter_device_id = deviceId || null;

    // Upsert by (user_id, sha256) so re-captures don't duplicate

    const mediaKey =
      media_key ??
      credential.media_key ??
      credential.mediaKey ??
      null;

    const thumbKey =
      thumbnail_key ??
      credential.thumbnail_key ??
      credential.thumbnailKey ??
      null;

    const { data, error } = await supabase
      .from("drafts")
      .upsert(
        {
          user_id,
          sha256,
          credential_json: credential,
          capture_device_id,
          submitter_device_id,
          media_key: mediaKey,
          thumbnail_key: thumbKey,
          burst_id: burst_id || null,
        },
        { onConflict: "user_id,sha256", ignoreDuplicates: false }
      )
      .select("id, created_at, sha256, media_key, thumbnail_key, capture_device_id, submitter_device_id, burst_id, credential_json")
      .single();


    if (error) {
      console.error("[drafts] upsert failed:", error.message);
      return res
        .status(500)
        .json({ error: "supabase_upsert_failed", detail: error.message });
    }

    let finalMediaKey = data.media_key ?? null;
    if (!finalMediaKey && data.id) {
      const created = data.created_at ? new Date(data.created_at) : new Date();
      const yyyy = created.getUTCFullYear();
      const mm = String(created.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(created.getUTCDate()).padStart(2, "0");
      const base = `captures/${yyyy}/${mm}/${dd}`;
      const burstId = data.burst_id ?? data.credential_json?.burst_id ?? null;
      finalMediaKey = burstId
        ? `${base}/${burstId}/${data.id}/${data.id}.jpg`
        : `${base}/${data.id}/${data.id}.jpg`;
      await supabase
        .from("drafts")
        .update({ media_key: finalMediaKey })
        .eq("id", data.id);
    }

    const locked = !!(capture_device_id && submitter_device_id && capture_device_id !== submitter_device_id);

    // RemoteDraft shape expected by the app
    return res.json({
      created_at: data.created_at,
      sha256: data.sha256,
      media_key: finalMediaKey,
      capture_device_id: data.capture_device_id,
      submitter_device_id: data.submitter_device_id,
      locked,
    });
  } catch (e: any) {
    console.error("[drafts] POST error:", e?.message || String(e));
    return res.status(500).json({ error: "drafts_post_failed", detail: e?.message || String(e) });
  }
});


// GET /drafts/pending (list drafts for the signed-in user)
router.get("/drafts/pending", async (req: Request, res: Response) => {
  try {
    let userId: string | null = null;
    try {
      userId = await getUserIdFromRequest(req);
    } catch (authErr: any) {
      console.error("[/drafts/pending] auth error:", authErr?.message || authErr);
      return res.status(401).json({ error: "authentication_failed" });
    }

    if (!userId) {
      return res.status(401).json({ error: "not_authenticated" });
    }



    const { data, error } = await supabase
      .from("drafts")
      .select("id, sha256, media_key, capture_device_id, submitter_device_id, credential_json, created_at, status")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[drafts/pending] db error:", error.message);
      return res.status(500).json({ error: "drafts_fetch_failed" });
    }

    const items = (data ?? []).map((row: any) => ({
      id: row.id,
      user_id: userId,
      sha256: row.sha256,
      media_key: row.media_key ?? null,
      credential_json: row.credential_json,
      capture_device_id: row.capture_device_id,
      submitter_device_id: row.submitter_device_id,
      created_at: row.created_at,
      status: row.status,
      has_media_blob: !!row.media_key,
      thumbnail_key: null,
    }));

    return res.json(items);
  } catch (err: any) {
    console.error("[drafts/pending] error:", err?.message || err);
    return res.status(500).json({ error: "drafts_fetch_failed" });
  }
});


// DELETE /drafts/:sha256 - Delete a pending draft
router.delete("/drafts/:sha256", async (req: Request, res: Response) => {
  try {
    let userId: string | null = null;
    try {
      userId = await getUserIdFromRequest(req);
    } catch (authErr: any) {
      console.error("[/drafts/:sha256 DELETE] auth error:", authErr?.message || authErr);
      return res.status(401).json({ error: "authentication_failed" });
    }

    if (!userId) {
      return res.status(401).json({ error: "not_authenticated" });
    }

    const { sha256 } = req.params;
    if (!sha256) {
      return res.status(400).json({ error: "missing_sha256" });
    }

    // 1. Fetch the draft to ensure it exists and belongs to user
    const { data: draft, error: fetchErr } = await supabase
      .from("drafts")
      .select("*")
      .eq("user_id", userId)
      .eq("sha256", sha256)
      .maybeSingle();

    if (fetchErr) {
      console.error("[drafts/:sha256] fetch failed:", fetchErr.message);
      return res.status(500).json({ error: "fetch_failed" });
    }

    if (!draft) {
      return res.status(404).json({ error: "draft_not_found" });
    }

    // 2. Delete S3 objects
    const mediaKey = draft.media_key;
    const tsrKey = mediaKey ? buildTsrKey(mediaKey) : null;

    try {
      if (mediaKey) {
        await s3.send(new DeleteObjectCommand({
          Bucket: S3_BUCKET,
          Key: mediaKey,
        }));
      }

      if (tsrKey) {
        try {
          await s3.send(new DeleteObjectCommand({
            Bucket: S3_BUCKET,
            Key: tsrKey,
          }));
        } catch (tsrErr) {
          console.warn(`[delete] TSR not found or error: ${tsrKey}`, tsrErr);
        }
      }
    } catch (s3Err: any) {
      console.error("[drafts/:sha256] S3 delete failed:", s3Err?.message || s3Err);
      // Continue with database deletion even if S3 fails
    }

    // 3. Delete from database
    const { error: deleteErr } = await supabase
      .from("drafts")
      .delete()
      .eq("id", draft.id);

    if (deleteErr) {
      console.error("[drafts/:sha256] delete failed:", deleteErr.message);
      return res.status(500).json({ error: "delete_failed" });
    }

    // 4. Log audit entry
    const deviceId = req.headers["x-device-id"] as string;
    await supabase.from("upload_audit").insert({
      user_id: userId,
      device_id: deviceId || null,
      sha256: sha256,
      media_key: mediaKey || null,
      computed_sha256: null,
      status: "accepted",
      reason: "user_deleted_pending_draft",
      ip: req.ip || null,
      ua: req.headers["user-agent"] || null,
    });

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[drafts/:sha256] DELETE error:", err?.message || err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
