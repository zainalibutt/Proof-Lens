// prooflens-api/src/routes/bursts.ts
import { Router, Request, Response } from "express";
import { supabase } from "../clients";
import { getUserIdFromRequest } from "../services/device";
import { validate, burstPostSchema, burstPatchSchema, requireDeviceId } from "../utils/validation";
import { rateLimitWrite } from "../utils/rateLimit";

const router = Router();

const BURST_STATUSES = [
  "pending_capture",
  "pending_upload",
  "pending_anchor",
  "anchored",
  "partial",
  "failed",
] as const;
const BURST_STATUS_SET = new Set<string>(BURST_STATUSES);

// POST /bursts - Create a new burst
router.post("/bursts", rateLimitWrite, requireDeviceId, validate(burstPostSchema), async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const deviceId = req.headers["x-device-id"] as string;

    const { mode, trigger, frame_total } = req.body;

    const { data, error } = await supabase
      .from("bursts")
      .insert({
        user_id: userId,
        capture_device_id: deviceId,
        mode,
        trigger,
        frame_total,
        status: "pending_capture",
      })
      .select()
      .single();

    if (error) {
      console.error("[bursts] insert failed:", error);
      return res.status(500).json({ error: "burst_create_failed" });
    }

    return res.json(data);
  } catch (err: any) {
    console.error("[bursts] POST error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// GET /bursts - List bursts for authenticated user
router.get("/bursts", async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const status = req.query.status as string | undefined;
    const parsedLimit = Number.parseInt(String(req.query.limit ?? "50"), 10);
    const parsedOffset = Number.parseInt(String(req.query.offset ?? "0"), 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;
    const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;

    let query = supabase
      .from("bursts")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      const statuses = status
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      if (!statuses.length || statuses.some((s) => !BURST_STATUS_SET.has(s))) {
        return res.status(400).json({
          error: "bad_status",
          detail: `Allowed statuses: ${BURST_STATUSES.join(",")}`,
        });
      }

      query = query.in("status", statuses);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[bursts] select failed:", error);
      return res.status(500).json({ error: "burst_fetch_failed" });
    }

    return res.json({ bursts: data, nextOffset: offset + (data?.length || 0) });
  } catch (err: any) {
    console.error("[bursts] GET error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// GET /bursts/:id - Get single burst with frame details
router.get("/bursts/:id", async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const burstId = req.params.id;

    const { data: burst, error: burstErr } = await supabase
      .from("bursts")
      .select("*")
      .eq("id", burstId)
      .eq("user_id", userId)
      .single();

    if (burstErr || !burst) {
      return res.status(404).json({ error: "burst_not_found" });
    }

    // Fetch anchored frames
    const { data: credentials, error: credErr } = await supabase
      .from("credentials")
      .select("*")
      .eq("burst_id", burstId)
      .eq("user_id", userId)
      .order("frame_index", { ascending: true });

    // Fetch pending frames
    const { data: drafts, error: draftErr } = await supabase
      .from("drafts")
      .select("*")
      .eq("burst_id", burstId)
      .eq("user_id", userId);

    if (credErr || draftErr) {
      console.error("[bursts/:id] frame fetch failed:", credErr || draftErr);
    }

    return res.json({
      burst,
      frames: {
        anchored: credentials || [],
        pending: drafts || [],
      },
    });
  } catch (err: any) {
    console.error("[bursts/:id] GET error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// PATCH /bursts/:id - Update burst status
router.patch("/bursts/:id", rateLimitWrite, validate(burstPatchSchema), async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const burstId = req.params.id;
    const { status, cover_credential_id } = req.body;

    const updates: any = {};
    if (status) updates.status = status;
    if (cover_credential_id !== undefined) updates.cover_credential_id = cover_credential_id;

    const { data, error } = await supabase
      .from("bursts")
      .update(updates)
      .eq("id", burstId)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) {
      console.error("[bursts/:id] update failed:", error);
      return res.status(500).json({ error: "burst_update_failed" });
    }

    return res.json(data);
  } catch (err: any) {
    console.error("[bursts/:id] PATCH error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// DELETE /bursts/:id - Delete burst (only if no anchored credentials)
router.delete("/bursts/:id", async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const burstId = req.params.id;

    // Check burst exists and is owned by user
    const { data: burst, error: burstErr } = await supabase
      .from("bursts")
      .select("*")
      .eq("id", burstId)
      .eq("user_id", userId)
      .single();

    if (burstErr || !burst) {
      return res.status(404).json({ error: "burst_not_found" });
    }

    // Check for anchored credentials
    const { data: anchoredCreds, error: credCheckErr } = await supabase
      .from("credentials")
      .select("id")
      .eq("burst_id", burstId);

    if (credCheckErr) {
      console.error("[bursts/:id] credential check failed:", credCheckErr);
      return res.status(500).json({ error: "check_failed" });
    }

    if (anchoredCreds && anchoredCreds.length > 0) {
      return res.status(403).json({ 
        error: "cannot_delete_anchored_burst",
        message: "Burst has anchored credentials. Archive instead of deleting."
      });
    }

    // Delete all drafts for this burst
    const { error: draftDeleteErr } = await supabase
      .from("drafts")
      .delete()
      .eq("burst_id", burstId);

    if (draftDeleteErr) {
      console.error("[bursts/:id] draft deletion failed:", draftDeleteErr);
    }

    // Delete burst row
    const { error: deleteErr } = await supabase
      .from("bursts")
      .delete()
      .eq("id", burstId);

    if (deleteErr) {
      console.error("[bursts/:id] delete failed:", deleteErr);
      return res.status(500).json({ error: "burst_delete_failed" });
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error("[bursts/:id] DELETE error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

// POST /bursts/:id/finalize - Finalize burst status based on frames
router.post("/bursts/:id/finalize", async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const burstId = req.params.id;

    // Get burst
    const { data: burst, error: burstErr } = await supabase
      .from("bursts")
      .select("*")
      .eq("id", burstId)
      .eq("user_id", userId)
      .single();

    if (burstErr || !burst) {
      return res.status(404).json({ error: "burst_not_found" });
    }

    // Count anchored frames
    const { data: anchoredCreds, error: credErr } = await supabase
      .from("credentials")
      .select("id, frame_index, status")
      .eq("burst_id", burstId)
      .eq("status", "anchored");

    const anchoredCount = anchoredCreds?.length || 0;

    // Count pending drafts
    const { data: pendingDrafts, error: draftErr } = await supabase
      .from("drafts")
      .select("id")
      .eq("burst_id", burstId);

    if (credErr || draftErr) {
      console.error("[bursts/:id/finalize] frame count failed:", credErr || draftErr);
      return res.status(500).json({ error: "burst_frame_count_failed" });
    }

    const pendingCount = pendingDrafts?.length || 0;

    // Determine status
    let newStatus = burst.status;
    let coverCredentialId = burst.cover_credential_id;

    if (anchoredCount === burst.frame_total) {
      newStatus = "anchored";
      // Set cover to frame 0 if not set
      if (!coverCredentialId) {
        const frame0 = anchoredCreds?.find((c: any) => c.frame_index === 0);
        if (frame0) coverCredentialId = frame0.id;
      }
    } else if (anchoredCount > 0) {
      newStatus = "partial";
      // Set cover to first available frame
      if (!coverCredentialId && anchoredCreds && anchoredCreds.length > 0) {
        coverCredentialId = anchoredCreds[0].id;
      }
    } else if (pendingCount === 0 && anchoredCount === 0) {
      newStatus = "failed";
    }

    // Update burst
    const { data: updated, error: updateErr } = await supabase
      .from("bursts")
      .update({
        status: newStatus,
        cover_credential_id: coverCredentialId,
      })
      .eq("id", burstId)
      .select()
      .single();

    if (updateErr) {
      console.error("[bursts/:id/finalize] update failed:", updateErr);
      return res.status(500).json({ error: "finalize_failed" });
    }

    return res.json({
      burst: updated,
      counts: {
        anchored: anchoredCount,
        pending: pendingCount,
        total: burst.frame_total,
      },
    });
  } catch (err: any) {
    console.error("[bursts/:id/finalize] error:", err);
    return res.status(500).json({ error: "server_error" });
  }
});

export default router;
