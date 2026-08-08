// prooflens-api/src/routes/captures.ts
import { Router, Request, Response } from "express";
import { getUserIdFromRequest } from "../services/device";
import { streamEvidenceBundleZip } from "../services/evidence";

const router = Router();

// GET /captures/:captureId/evidence-bundle (owner-only)
router.get("/captures/:captureId/evidence-bundle", async (req: Request, res: Response) => {
  try {
    const userId = await getUserIdFromRequest(req);
    if (!userId) return res.status(401).json({ error: "not_authenticated" });

    const captureId = String(req.params.captureId || "").trim();
    if (!captureId) return res.status(400).json({ error: "missing_capture_id" });
    const ok = await streamEvidenceBundleZip({
      res,
      captureId,
      ownerUserId: userId,
      readmeTitle: "ProofLens Evidence Bundle",
      readmeExtraLines: [
        "Notes:",
        "- This bundle is designed to be self-contained for offline storage.",
        "- The only external dependency is OpenSSL for TSA and signature verification.",
        "",
      ],
      logPrefix: "evidence-bundle",
      failureError: "evidence_bundle_failed",
    });
    if (!ok) return;
  } catch (err: any) {
    console.error("[evidence-bundle] error:", err?.message || err);
    return res.status(500).json({ error: "evidence_bundle_failed" });
  }
});

export default router;
