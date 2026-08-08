// prooflens-api/src/services/evidence.ts
import path from "path";
import crypto from "crypto";
import archiver from "archiver";
import { Response } from "express";
import { readFile as fsReadFile } from "fs/promises";
import { supabase } from "../clients";
import { TSA_CA_CERT_PATH } from "../config";
import { buildTsqForSha256 } from "../tsa";
import { getRegisteredDevicePublicKeyB64 } from "./device";
import { ed25519PublicKeyPemFromRawB64, resolveCredentialPublicKeyB64 } from "../utils/crypto";
import { getS3ObjectBytes, buildTsrKey, expandS3KeyCandidates } from "../utils/s3";
import { formatUtcCompact } from "../utils/helpers";
import {
  VERIFY_SH_TEMPLATE,
  VERIFY_PS1_TEMPLATE,
  VERIFY_AUDIO_SH_TEMPLATE,
  VERIFY_AUDIO_PS1_TEMPLATE,
} from "../utils/templates";

function pickValidEd25519B64(...candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const raw = Buffer.from(String(candidate), "base64");
      if (raw.length === 32) return String(candidate);
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function loadTsaCaPem(): Promise<Buffer> {
  const candidates = [
    TSA_CA_CERT_PATH ? path.resolve(process.cwd(), TSA_CA_CERT_PATH) : null,
    path.resolve(process.cwd(), "certs", "tsa-ca.pem"),
    path.resolve(__dirname, "..", "certs", "tsa-ca.pem"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      return await fsReadFile(p);
    } catch {
      // try next
    }
  }
  throw new Error("tsa_ca_cert_not_found");
}

export async function streamEvidenceBundleZip(params: {
  res: Response;
  captureId: string;
  ownerUserId: string;
  expectedSha256?: string;
  expectedShaMismatchError?: string;
  readmeTitle: string;
  readmeExtraLines?: string[];
  logPrefix: string;
  failureError: string;
}): Promise<boolean> {
  const {
    res,
    captureId,
    ownerUserId,
    expectedSha256,
    expectedShaMismatchError,
    readmeTitle,
    readmeExtraLines,
    logPrefix,
    failureError,
  } = params;

  try {
    const { data: cred, error: credErr } = await supabase
      .from("credentials")
      .select(
        "id, user_id, sha256, media_key, timestamp, capture_device_id, signature_b64, public_key_b64, credential_json, tsa_time, tsa_policy_oid, tsa_serial, tsa_token_base64"
      )
      .eq("id", captureId)
      .eq("user_id", ownerUserId)
      .maybeSingle();

    if (credErr) {
      console.error(`[${logPrefix}] credential lookup failed:`, credErr.message);
      res.status(500).json({ error: "supabase_select_failed" });
      return false;
    }
    if (!cred) {
      res.status(404).json({ error: "capture_not_found" });
      return false;
    }

    const mediaKey = (cred as any).media_key as string | null;
    const captureDeviceId = (cred as any).capture_device_id as string | null;
    const storedSha256 = (cred as any).sha256 as string | null;
    const signatureB64 = ((cred as any).signature_b64 as string | null) ?? null;

    if (!mediaKey) {
      res.status(409).json({ error: "missing_media_key" });
      return false;
    }
    if (!captureDeviceId) {
      res.status(409).json({ error: "missing_capture_device_id" });
      return false;
    }
    if (!storedSha256 || !/^[0-9a-f]{64}$/i.test(String(storedSha256))) {
      res.status(409).json({ error: "missing_or_invalid_sha256" });
      return false;
    }
    if (expectedSha256 && String(storedSha256).toLowerCase() !== String(expectedSha256).toLowerCase()) {
      res.status(401).json({ error: expectedShaMismatchError || "bundle_sha256_mismatch" });
      return false;
    }

    const storedCredentialJson = (cred as any).credential_json ?? null;
    const storedPublicKeyB64 = resolveCredentialPublicKeyB64({
      public_key_b64: (cred as any).public_key_b64 ?? null,
      credential_json: storedCredentialJson,
    });

    const registeredPublicKeyB64 = await getRegisteredDevicePublicKeyB64({
      userId: ownerUserId,
      deviceId: captureDeviceId,
    });

    const effectivePublicKeyB64 = pickValidEd25519B64(storedPublicKeyB64, registeredPublicKeyB64);
    if (!effectivePublicKeyB64) {
      res.status(409).json({ error: "device_public_key_not_found" });
      return false;
    }

    const jpgBytes = await getS3ObjectBytes(mediaKey);
    const recomputedSha256 = crypto.createHash("sha256").update(jpgBytes).digest("hex");
    if (recomputedSha256.toLowerCase() !== String(storedSha256).toLowerCase()) {
      res.status(409).json({ error: "sha256_mismatch", stored: storedSha256, computed: recomputedSha256 });
      return false;
    }

    const tsaTokenB64 = ((cred as any).tsa_token_base64 as string | null) ?? null;
    if (!tsaTokenB64) {
      res.status(409).json({ error: "missing_tsa_token" });
      return false;
    }

    const tsrBytes = Buffer.from(tsaTokenB64, "base64");
    if (!tsrBytes.length) {
      res.status(409).json({ error: "invalid_tsa_token" });
      return false;
    }

    let tsqBytes: Buffer | null = null;
    try {
      tsqBytes = await buildTsqForSha256(recomputedSha256);
    } catch (err: any) {
      console.warn(`[${logPrefix}] tsq generation skipped:`, err?.message || err);
      tsqBytes = null;
    }
    let tsaCaPem: Buffer;
    try {
      tsaCaPem = await loadTsaCaPem();
    } catch (certErr: any) {
      console.error(`[${logPrefix}] TSA CA certificate missing:`, certErr?.message || certErr);
      res.status(409).json({ error: "missing_tsa_ca_cert" });
      return false;
    }
    const devicePublicKeyPem = ed25519PublicKeyPemFromRawB64(effectivePublicKeyB64);

    const minimalCredential = {
      capture_id: (cred as any).id,
      sha256: recomputedSha256,
      signature_b64: signatureB64,
      capture_device_id: captureDeviceId,
      public_key_b64: effectivePublicKeyB64,
      captured_at: ((cred as any).timestamp as string | null) ?? null,
      tsa_time: ((cred as any).tsa_time as string | null) ?? null,
      tsa_serial: ((cred as any).tsa_serial as string | null) ?? null,
      tsa_policy_oid: ((cred as any).tsa_policy_oid as string | null) ?? null,
    };

    const now = new Date();
    const zipName = `prooflens_evidence_${captureId}_${formatUtcCompact(now)}.zip`;

    const readme = [
      readmeTitle,
      "",
      `Capture ID: ${captureId}`,
      `Generated: ${now.toISOString()}`,
      "",
      "Offline verification steps:",
      "1) Hash check: recompute SHA-256 of capture.jpg and compare to capture.sha256.txt",
      "2) Signature check: verify credential.json.signature_b64 over the SHA-256 BYTES (32 bytes) using device_public_key.pem",
      "3) TSA verification:",
      tsqBytes
        ? "   Preferred: openssl ts -verify -in tsa_response.tsr -queryfile tsa_query.tsq -CAfile tsa_ca.pem"
        : "   Query file not included; use digest verification below.",
      "   Fallback (nonce-safe): openssl ts -verify -in tsa_response.tsr -digest <sha256hex> -CAfile tsa_ca.pem",
      "",
      "Quick start:",
      "- macOS/Linux: ./verify.sh",
      "- Windows (PowerShell): .\\verify.ps1",
      "",
      ...(readmeExtraLines ?? []),
    ].join("\n");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=\"${zipName}\"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err: any) => {
      console.error(`[${logPrefix}] zip error:`, err?.message || err);
      try {
        if (!res.headersSent) res.status(500);
        res.end();
      } catch {
        // ignore
      }
    });

    archive.pipe(res);
    archive.append(readme, { name: "README.txt" });
    archive.append(jpgBytes, { name: "capture.jpg" });
    archive.append(`${recomputedSha256}\n`, { name: "capture.sha256.txt" });
    archive.append(JSON.stringify(minimalCredential, null, 2) + "\n", { name: "credential.json" });
    archive.append(devicePublicKeyPem, { name: "device_public_key.pem" });
    archive.append(tsrBytes, { name: "tsa_response.tsr" });
    if (tsqBytes) {
      archive.append(tsqBytes, { name: "tsa_query.tsq" });
    }
    archive.append(tsaCaPem, { name: "tsa_ca.pem" });
    archive.append(VERIFY_SH_TEMPLATE, { name: "verify.sh", mode: 0o755 });
    archive.append(VERIFY_PS1_TEMPLATE, { name: "verify.ps1" });

    await archive.finalize();
    return true;
  } catch (err: any) {
    console.error(`[${logPrefix}] error:`, err?.message || err);
    res.status(500).json({ error: failureError });
    return false;
  }
}

export async function streamAudioEvidenceBundleZip(params: {
  res: Response;
  audioId: string;
  ownerUserId: string;
  expectedSha256?: string;
  expectedShaMismatchError?: string;
  readmeTitle: string;
  logPrefix: string;
  failureError: string;
}): Promise<boolean> {
  const {
    res,
    audioId,
    ownerUserId,
    expectedSha256,
    expectedShaMismatchError,
    readmeTitle,
    logPrefix,
    failureError,
  } = params;

  try {
    const { data: rec, error: recErr } = await supabase
      .from("audio_records")
      .select("id, user_id, title, duration, sha256, signature, public_key_b64, credential_json, device_id, gps, s3_key, tsa_status, tsa_token_base64, anchor_timestamp, created_at")
      .eq("id", audioId)
      .eq("user_id", ownerUserId)
      .maybeSingle();

    if (recErr) {
      console.error(`[${logPrefix}] audio record lookup failed:`, recErr.message);
      res.status(500).json({ error: "supabase_select_failed" });
      return false;
    }
    if (!rec) {
      res.status(404).json({ error: "audio_not_found" });
      return false;
    }

    const audioKey = (rec as any).s3_key as string | null;
    const storedSha256 = (rec as any).sha256 as string | null;
    const signatureB64 = (rec as any).signature as string | null;
    const captureDeviceId = (rec as any).device_id as string | null;

    const storedCredentialJson = (rec as any).credential_json ?? null;
    const candidateAudioKeys = Array.from(
      new Set(
        [
          audioKey,
          typeof storedCredentialJson?.media_key === "string" ? storedCredentialJson.media_key : null,
          typeof storedCredentialJson?.s3_key === "string" ? storedCredentialJson.s3_key : null,
        ].flatMap((k) => expandS3KeyCandidates(k))
      )
    );

    if (!candidateAudioKeys.length) {
      res.status(409).json({ error: "missing_s3_key" });
      return false;
    }
    if (!storedSha256 || !/^[0-9a-f]{64}$/i.test(String(storedSha256))) {
      res.status(409).json({ error: "missing_or_invalid_sha256" });
      return false;
    }
    if (expectedSha256 && String(storedSha256).toLowerCase() !== String(expectedSha256).toLowerCase()) {
      res.status(401).json({ error: expectedShaMismatchError || "bundle_sha256_mismatch" });
      return false;
    }
    if (!captureDeviceId) {
      res.status(409).json({ error: "missing_capture_device_id" });
      return false;
    }

    const storedPublicKeyB64 = resolveCredentialPublicKeyB64({
      public_key_b64: (rec as any).public_key_b64 ?? null,
      credential_json: storedCredentialJson,
    });
    const registeredPublicKeyB64 = await getRegisteredDevicePublicKeyB64({
      userId: ownerUserId,
      deviceId: captureDeviceId,
    });

    const effectivePublicKeyB64 = pickValidEd25519B64(storedPublicKeyB64, registeredPublicKeyB64);
    if (!effectivePublicKeyB64) {
      res.status(409).json({ error: "device_public_key_not_found" });
      return false;
    }

    let audioBytes: Buffer | null = null;
    let resolvedAudioKey: string | null = null;
    for (const candidateKey of candidateAudioKeys) {
      try {
        audioBytes = await getS3ObjectBytes(candidateKey);
        resolvedAudioKey = candidateKey;
        break;
      } catch {
      }
    }
    if (!audioBytes || !resolvedAudioKey) {
      res.status(409).json({ error: "audio_media_not_found" });
      return false;
    }
    const recomputedSha256 = crypto.createHash("sha256").update(audioBytes).digest("hex");
    if (recomputedSha256.toLowerCase() !== String(storedSha256).toLowerCase()) {
      res.status(409).json({ error: "sha256_mismatch", stored: storedSha256, computed: recomputedSha256 });
      return false;
    }

    const tsrKey = buildTsrKey(resolvedAudioKey);
    const tsaTokenB64 = ((rec as any).tsa_token_base64 as string | null) ?? null;
    let tsrBytes: Buffer | null = null;
    if (tsaTokenB64) {
      try {
        const buf = Buffer.from(tsaTokenB64, "base64");
        if (buf.length) tsrBytes = buf;
      } catch {
        tsrBytes = null;
      }
    }
    if (!tsrBytes) {
      tsrBytes = await getS3ObjectBytes(tsrKey).catch(() => null as any);
    }
    if (!tsrBytes || !tsrBytes.length) {
      res.status(409).json({ error: "missing_tsa_token" });
      return false;
    }

    let tsqBytes: Buffer | null = null;
    try {
      tsqBytes = await buildTsqForSha256(recomputedSha256);
    } catch (err: any) {
      console.warn(`[${logPrefix}] tsq generation skipped:`, err?.message || err);
      tsqBytes = null;
    }
    let tsaCaPem: Buffer;
    try {
      tsaCaPem = await loadTsaCaPem();
    } catch (certErr: any) {
      console.error(`[${logPrefix}] TSA CA certificate missing:`, certErr?.message || certErr);
      res.status(409).json({ error: "missing_tsa_ca_cert" });
      return false;
    }
    const devicePublicKeyPem = ed25519PublicKeyPemFromRawB64(effectivePublicKeyB64);

    const minimalCredential = {
      audio_id: (rec as any).id,
      type: "audio",
      sha256: recomputedSha256,
      signature_b64: signatureB64,
      capture_device_id: captureDeviceId,
      public_key_b64: effectivePublicKeyB64,
      timestamp: ((rec as any).created_at as string | null) ?? null,
      gps: (rec as any).gps ?? null,
      duration_ms: (rec as any).duration ?? null,
      title: (rec as any).title ?? null,
      tsa_time: ((rec as any).anchor_timestamp as string | null) ?? null,
    };

    const now = new Date();
    const zipName = `prooflens_audio_${audioId}_${formatUtcCompact(now)}.zip`;

    const readme = [
      readmeTitle,
      "",
      `Audio ID: ${audioId}`,
      `Generated: ${now.toISOString()}`,
      "",
      "Offline verification steps:",
      "1) Hash check: recompute SHA-256 of audio.m4a and compare to audio.sha256.txt",
      "2) Signature check: verify credential.json.signature_b64 over SHA-256 BYTES (32 bytes from hex)",
      "3) TSA verification:",
      tsqBytes
        ? "   Preferred: openssl ts -verify -in tsa_response.tsr -queryfile tsa_query.tsq -CAfile tsa_ca.pem"
        : "   Query file not included; use digest verification below.",
      "   Fallback (nonce-safe): openssl ts -verify -in tsa_response.tsr -digest <sha256hex> -CAfile tsa_ca.pem",
      "",
      "Quick start:",
      "- macOS/Linux: ./verify.sh",
      "- Windows (PowerShell): .\\verify.ps1",
      "",
    ].join("\n");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=\"${zipName}\"`);

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err: any) => {
      console.error(`[${logPrefix}] zip error:`, err?.message || err);
      try {
        if (!res.headersSent) res.status(500);
        res.end();
      } catch {}
    });

    archive.pipe(res);
    archive.append(readme, { name: "README.txt" });
    archive.append(audioBytes, { name: "audio.m4a" });
    archive.append(`${recomputedSha256}\n`, { name: "audio.sha256.txt" });
    archive.append(JSON.stringify(minimalCredential, null, 2) + "\n", { name: "credential.json" });
    archive.append(devicePublicKeyPem, { name: "device_public_key.pem" });
    archive.append(tsrBytes, { name: "tsa_response.tsr" });
    if (tsqBytes) {
      archive.append(tsqBytes, { name: "tsa_query.tsq" });
    }
    archive.append(tsaCaPem, { name: "tsa_ca.pem" });
    archive.append(VERIFY_AUDIO_SH_TEMPLATE, { name: "verify.sh", mode: 0o755 });
    archive.append(VERIFY_AUDIO_PS1_TEMPLATE, { name: "verify.ps1" });

    await archive.finalize();
    return true;
  } catch (err: any) {
    console.error(`[${logPrefix}] error:`, err?.message || err);
    res.status(500).json({ error: failureError });
    return false;
  }
}
