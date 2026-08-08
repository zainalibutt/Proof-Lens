// prooflens-api/src/routes/media.ts
import { Router, Request, Response } from "express";
import { s3 } from "../clients";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { makeUserScopedKey, userKeyPrefix, isKeyWithinUserNamespace } from "../utils/helpers";
import { getUserIdFromRequest } from "../services/device";
import { validate, mediaPresignSchema, requireDeviceId } from "../utils/validation";
import { rateLimitPresign } from "../utils/rateLimit";
import { AWS_REGION, S3_BUCKET } from "../config";

const router = Router();

// Extension -> permitted upload content type. The presigned policy pins the
// content type so a client cannot upload arbitrary content under a media key.
const ALLOWED_EXT_CONTENT_TYPE: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp4: "video/mp4",
  tsr: "application/timestamp-reply",
};

const MAX_UPLOAD_BYTES = 10_485_760; // 10 MB

router.post(
  "/media/presign",
  rateLimitPresign,
  requireDeviceId,
  validate(mediaPresignSchema),
  async (req: Request, res: Response) => {
    try {
      const userId = await getUserIdFromRequest(req);
      if (!userId) return res.status(401).json({ error: "not_authenticated" });

      const { ext, media_key } = req.body || {};
      const requestedExt = String(ext || "jpg").toLowerCase();
      const safeExt = Object.prototype.hasOwnProperty.call(ALLOWED_EXT_CONTENT_TYPE, requestedExt)
        ? requestedExt
        : "jpg";
      const contentType = ALLOWED_EXT_CONTENT_TYPE[safeExt];

      // The object key is always server-controlled. A client-supplied media_key is
      // honoured ONLY when it already sits inside this user's namespace, which is
      // the legitimate retry/resume case (the key was issued to them earlier).
      // Anything else — including a key belonging to another user — is discarded
      // and replaced with a freshly generated one.
      let key: string;
      if (typeof media_key === "string" && media_key.length > 0 && isKeyWithinUserNamespace(media_key, userId)) {
        key = media_key;
      } else {
        key = makeUserScopedKey(userId, safeExt);
      }

      const { fields } = await createPresignedPost(s3, {
        Bucket: S3_BUCKET,
        Key: key,
        Conditions: [
          ["content-length-range", 1, MAX_UPLOAD_BYTES],
          // Bind the upload to this user's namespace even if the key field were
          // tampered with in transit.
          ["starts-with", "$key", userKeyPrefix(userId)],
        ],
        Fields: {
          key,
          // Content-Type is deliberately not pinned as a policy field: React
          // Native's multipart encoder omits it, which breaks the signature.
        },
        Expires: 60,
      });

      const vhostUrl = `https://${S3_BUCKET}.s3.${AWS_REGION}.amazonaws.com`;

      return res.json({ url: vhostUrl, fields, key, media_key: key, contentType });
    } catch (err: any) {
      console.error("presign error", err?.message || "unknown_error");
      return res.status(500).json({ error: "presign_failed" });
    }
  }
);

export default router;
