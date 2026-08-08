// src/config.ts
import path from "path";
import * as dotenv from "dotenv";

// Load prooflens-api/.env (we are in src/, so go up one)
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

export const SUPABASE_URL = process.env.SUPABASE_URL || "";
export const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

export const AWS_REGION = process.env.AWS_REGION || "eu-north-1";
export const S3_BUCKET = process.env.S3_BUCKET || "";

export const TSA_URL = process.env.TSA_URL || "";
export const TSA_UPLOAD_SIDECAR = process.env.TSA_UPLOAD_SIDECAR || "false";
export const TSA_CA_CERT_PATH = process.env.TSA_CA_CERT_PATH || "";

