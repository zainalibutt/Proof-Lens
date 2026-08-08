// prooflens-api/src/routes/health.ts
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { getUserIdFromRequest } from "../services/device";
import { retryTSAAnchoring } from "../tsa";
import { supabase } from "../clients";
import { uploadTsaSidecar } from "../utils/s3";

const router = Router();
const ADMIN_TSA_RETRY_SECRET = (process.env.ADMIN_TSA_RETRY_SECRET || "").trim();
const ADMIN_TSA_RETRY_USER_IDS = new Set(
  (process.env.ADMIN_TSA_RETRY_USER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

function timingSafeEqualStr(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, "utf8");
    const bBuf = Buffer.from(b, "utf8");
    if (aBuf.length !== bBuf.length) return false;
    return crypto.timingSafeEqual(aBuf, bBuf);
  } catch {
    return false;
  }
}

function hasValidAdminSecret(req: Request): boolean {
  if (!ADMIN_TSA_RETRY_SECRET) return false;
  const provided = String(req.header("x-admin-secret") || "").trim();
  if (!provided) return false;
  return timingSafeEqualStr(provided, ADMIN_TSA_RETRY_SECRET);
}

function isTsaRetryAuthorized(req: Request, userId: string): boolean {
  if (ADMIN_TSA_RETRY_USER_IDS.has(userId)) return true;
  return hasValidAdminSecret(req);
}

router.get("/health", (_req: Request, res: Response) =>
  res.json({ ok: true, ts: new Date().toISOString() })
);

// Liveness and dependency readiness are deliberately separate.
router.get("/ready", async (_req: Request, res: Response) => {
  try {
    const { error } = await supabase.from("credentials").select("id").limit(1);
    if (error) return res.status(503).json({ ok: false, dependency: "database" });
    return res.json({ ok: true });
  } catch {
    return res.status(503).json({ ok: false, dependency: "database" });
  }
});

router.get("/health/auth", async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ ok: false, error: "not_authenticated" });
    return res.json({ ok: true, userId });
  } catch (e: any) {
    return res.status(401).json({ ok: false, error: "authentication_failed", detail: e?.message || String(e) });
  }
});

// POST /admin/tsa-retry  (authenticated, retries un-anchored records)
router.post("/admin/tsa-retry", async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    if (!ADMIN_TSA_RETRY_SECRET && ADMIN_TSA_RETRY_USER_IDS.size === 0) {
      return res.status(403).json({ error: "admin_policy_not_configured" });
    }
    if (!isTsaRetryAuthorized(req, userId)) {
      return res.status(403).json({ error: "forbidden_admin_only" });
    }

    const result = await retryTSAAnchoring(supabase, uploadTsaSidecar);
    return res.json({ ok: true, ...result });
  } catch (e: any) {
    console.error("[admin/tsa-retry] error:", e?.message || e);
    return res.status(500).json({ error: "tsa_retry_failed" });
  }
});


export default router;
