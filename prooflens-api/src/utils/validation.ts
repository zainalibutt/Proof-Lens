// Zod schemas for write endpoints.
import { z } from "zod";
import { Request, Response, NextFunction } from "express";

// Reusable atoms
const sha256Hex = z.string().regex(/^[0-9a-fA-F]{64}$/, "invalid_sha256");
const base64Str = z.string().min(1, "required");
const mediaKey  = z.string().min(1, "missing_media_key");
const gpsSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  acc_m: z.number().nullable().optional(),
  time: z.string().optional(),
}).passthrough();
const exifSchema = z.record(z.string(), z.unknown());

// POST /credentials
export const credentialPostSchema = z.object({
  credential: z.object({
    sha256: sha256Hex,
    capture_device_id: z.string().nullable().optional(),
    public_key: base64Str,
    timestamp: z.union([z.string(), z.number()]).nullable().optional(),
    gps: gpsSchema.optional(),
    exif: exifSchema.optional(),
  }),
  signatureB64: base64Str,
  media_key: mediaKey,
});

// POST /credentials/upload
export const credentialUploadSchema = z.object({
  sha256: sha256Hex,
  signatureB64: base64Str,
  publicKeyB64: base64Str.optional(),
  credential_json: z.record(z.string(), z.unknown()).optional(),
  media_key: mediaKey.optional(),
});

// POST /media/presign
export const mediaPresignSchema = z.object({
  ext: z.string().regex(/^[a-z0-9]{1,8}$/i).optional().default("jpg"),
  contentType: z.string().optional(),
  sha256: sha256Hex.optional(),
  media_key: z.string().optional(),
});

// POST /devices/register
export const deviceRegisterSchema = z.object({
  publicKeyB64: base64Str,
  signatureB64: base64Str,
  signedAt: z.string().min(1),
});

// POST /audio/records
export const audioRecordSchema = z.object({
  credential: z.object({
    type: z.literal("audio").optional(),
    sha256: sha256Hex,
    capture_device_id: z.string().nullable().optional(),
    public_key: base64Str,
    timestamp: z.union([z.string(), z.number()]).nullable().optional(),
    gps: gpsSchema.optional(),
    duration_ms: z.number().nullable().optional(),
    title: z.string().nullable().optional(),
    audio_id: z.string().nullable().optional(),
  }),
  signatureB64: base64Str,
  media_key: mediaKey,
  title: z.string().optional(),
  duration_ms: z.number().nullable().optional(),
  sha256: sha256Hex.optional(),
});

// POST /audio/shares/create
export const audioShareCreateSchema = z.object({
  audioId: z.string().min(1, "missing_audio_id"),
  ttlHours: z.number().optional(),
});

// POST /shares/create
export const shareCreateSchema = z.object({
  captureId: z.string().min(1, "missing_capture_id"),
  ttlHours: z.number().optional(),
});

// POST /shares
export const sharePostSchema = z.object({
  capture_id: z.string().min(1, "missing_capture_id"),
  expires_in_days: z.number().positive().optional(),
});

// POST /drafts
export const draftPostSchema = z.object({
  credential: z.record(z.string(), z.unknown()),
  sha256: sha256Hex,
  media_key: z.string().optional(),
  thumbnail_key: z.string().optional(),
  burst_id: z.string().optional(),
});

// POST /audio/drafts
export const audioDraftPostSchema = z.object({
  credential: z.record(z.string(), z.unknown()),
  sha256: sha256Hex,
  media_key: z.string().optional(),
  duration_ms: z.number().nullable().optional(),
});

// POST /bursts
export const burstPostSchema = z.object({
  mode: z.enum(["single", "burst"]),
  trigger: z.enum(["manual", "motion"]),
  frame_total: z.number().int().min(1).max(100),
});

// PATCH /bursts/:id
export const burstPatchSchema = z.object({
  status: z.enum(["pending_capture", "pending_upload", "pending_anchor", "anchored", "partial", "failed"]).optional(),
  cover_credential_id: z.string().optional(),
}).refine((d) => d.status || d.cover_credential_id, {
  message: "no_updates",
});

// POST /verify/share
export const verifyShareSchema = z.object({
  token: z.string().min(1),
  captureId: z.string().min(1),
});

// POST /audio/verify/share
export const audioVerifyShareSchema = z.object({
  token: z.string().min(1),
  audioId: z.string().min(1),
});

// Express middleware factory
export function validate(schema: z.ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const message = firstIssue
        ? `${firstIssue.path.join(".")}: ${firstIssue.message}`
        : "validation_failed";
      return res.status(400).json({ error: "validation_error", detail: message });
    }
    // Replace body with parsed (coerced/defaulted) values
    req.body = result.data;
    next();
  };
}

// Header validation helper - validates x-device-id header
export function requireDeviceId(req: Request, res: Response, next: NextFunction) {
  const id = req.header("x-device-id");
  if (!id || typeof id !== "string" || id.trim().length === 0) {
    return res.status(400).json({ error: "missing_x_device_id" });
  }
  if (id.length > 128) {
    return res.status(400).json({ error: "invalid_x_device_id" });
  }
  next();
}
