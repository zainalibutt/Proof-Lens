// prooflens-api/src/clients.ts
import { S3Client } from "@aws-sdk/client-s3";
import { fromEnv } from "@aws-sdk/credential-provider-env";
import { createClient } from "@supabase/supabase-js";
import multer from "multer";
import { SUPABASE_URL, SUPABASE_SERVICE_KEY, AWS_REGION, S3_BUCKET, TSA_URL, TSA_CA_CERT_PATH } from "./config";

const missingBootVars: string[] = [];
if (!AWS_REGION) missingBootVars.push("AWS_REGION");
if (!S3_BUCKET) missingBootVars.push("S3_BUCKET");

if (missingBootVars.length) {
  console.error(`[boot] Missing env vars: ${missingBootVars.join(", ")}. Set them in Railway Variables (or local .env).`);
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("[boot] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Set them in Railway Variables (or local .env).");
  process.exit(1);
}
console.log("[boot] env OK  region:", AWS_REGION, "bucket:", S3_BUCKET);
console.log("[boot] TSA_URL:", TSA_URL ?? "(unset)", " CA:", TSA_CA_CERT_PATH ?? "(unset)");

export const s3 = new S3Client({
  region: AWS_REGION,
  credentials: fromEnv(), // uses AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from env
});

export const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!, {
  auth: { persistSession: false },
});

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10_485_760 }, // 10 MB
});
