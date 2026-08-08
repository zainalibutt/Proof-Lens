// Optional background upload pipeline kept for future use.

import { Alert } from "react-native";
import { API_BASE, fetchPendingDrafts } from "./api";
import { presignMediaPost, putToS3Form } from "./uploader"; // POST flow
import { queueLoad, queueSaveAtIndex, type QueueItem } from "./storage";
import { supabase } from "./supabase"; 
import { getOrCreateInstallId } from "./device";


export async function submitCredential(payload: {
  credential: any;
  signatureB64: string;
  media_key: string;
}) {
  const installId = await getOrCreateInstallId();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("not_signed_in");

  const res = await fetch(`${API_BASE}/credentials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "x-device-id": installId,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`credentials_${res.status}: ${text || "no_body"}`);
  return text ? JSON.parse(text) : {};
}

export async function drainOnce(): Promise<number> {
  const items = await queueLoad();
  let uploaded = 0;
  const reasons: string[] = [];

  const MAX_RETRIES = 3;
  const BASE_DELAY_MS = 2_000; // 2s, 4s, 8s backoff

  const markRetryOrFail = async (i: number, it: QueueItem, msg: string) => {
    const retryCount = (it.retryCount ?? 0) + 1;
    if (retryCount >= MAX_RETRIES) {
      // Permanent failure after max retries
      it.anchor = {
        ...(it.anchor || { status: "pending" }),
        status: "failed",
      };
      it.retryCount = retryCount;
      it.lastError = msg;
      it.nextRetryAt = undefined;
      await queueSaveAtIndex(i, it);
      reasons.push(`${(it.sha256 || "").slice(0, 8)}… → FAILED (${retryCount} attempts): ${msg}`);
    } else {
      // Schedule retry with exponential backoff
      const delayMs = BASE_DELAY_MS * Math.pow(2, retryCount - 1);
      it.retryCount = retryCount;
      it.lastError = msg;
      it.nextRetryAt = Date.now() + delayMs;
      // Keep status as pending so it's retried
      it.anchor = {
        ...(it.anchor || { status: "pending" }),
        status: "pending",
      };
      await queueSaveAtIndex(i, it);
      reasons.push(`${(it.sha256 || "").slice(0, 8)}… → retry ${retryCount}/${MAX_RETRIES} in ${delayMs}ms: ${msg}`);
    }
  };

  const withTimeout = async <T>(p: Promise<T>, ms: number, label: string) => {
    let to: any;
    const t = new Promise<never>((_, rej) =>
      (to = setTimeout(() => rej(new Error(`${label}_timeout`)), ms))
    );
    try {
      return await Promise.race([p, t]);
    } finally {
      clearTimeout(to);
    }
  };

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if ((it.anchor?.status ?? "pending") !== "pending") continue;

    // Respect exponential backoff schedule
    if (it.nextRetryAt && Date.now() < it.nextRetryAt) continue;

    try {
      const signatureB64 = (it as any).signature || (it as any).signatureB64;
      if (!signatureB64) throw new Error("missing_signatureB64");
      if (!it.credential?.public_key) throw new Error("missing_public_key");
      if (!it.credential?.sha256) throw new Error("missing_sha256");
      if (!(it as any).mediaUri) throw new Error("missing_mediaUri");

      const localId = await getOrCreateInstallId();
      const captured =
        it.credential?.capture_device_id ??
        it.credential?.device_id ??
        (it as any).capture_device_id ??
        (it as any).device_id;

      if (captured && captured !== localId) {
        await markRetryOrFail(i, it, "locked_other_device");
        continue;
      }

      const pending = it.anchor?.media_key
        ? null
        : await fetchPendingDrafts().catch(() => []);
      const draftMatch = !it.anchor?.media_key
        ? (pending || []).find((d) => d.sha256 === it.sha256)
        : null;
      if (!it.anchor?.media_key && draftMatch?.media_key) {
        it.anchor = { ...(it.anchor || { status: "pending" }), media_key: draftMatch.media_key };
        await queueSaveAtIndex(i, it);
      }

      const mediaKey = it.anchor?.media_key || draftMatch?.media_key || null;
      if (!mediaKey) {
        await markRetryOrFail(i, it, "missing_media_key");
        continue;
      }

      // 1) PRESIGN (POST policy)
      let presign: { url: string; fields: Record<string, string> };
      try {
        presign = await withTimeout(
          presignMediaPost({ ext: "jpg", contentType: "image/jpeg", sha256: it.sha256, media_key: mediaKey }),
          12000,
          "presign"
        );
      } catch (e: any) {
        await markRetryOrFail(i, it, e?.message || "presign_failed");
        continue;
      }

      

      // 2) S3 POST (multipart/form-data)
      try {
        await withTimeout(
          putToS3Form({
            url: presign.url,
            fields: presign.fields,
            fileUri: (it as any).mediaUri,
            contentType: "image/jpeg",
          }),
          30000,
          "s3"
        );
      } catch (e: any) {
        await markRetryOrFail(i, it, e?.message || "s3_failed");
        continue;
      }

      const key = presign.fields.key; // policy includes the final key

      // 3) /credentials
      try {
        const rjson = await withTimeout(
          submitCredential({
            credential: it.credential,
            signatureB64,
            media_key: key,
          }),
          12000,
          "credentials"
        );

        it.anchor = {
          ...(it.anchor || { status: "pending" }),
          status: "submitted",
          credential_id: rjson?.id ?? it.anchor?.credential_id,
          media_key: key,
        };
        await queueSaveAtIndex(i, it);
        uploaded++;
      } catch (e: any) {
        await markRetryOrFail(i, it, e?.message || "credentials_failed");
        continue;
      }
    } catch (e: any) {
      await markRetryOrFail(i, items[i], e?.message || "client_validation_failed");
      continue;
    }
  }

  if (uploaded === 0) {
    const pendingRetries = items.filter(
      (it) => it.anchor?.status === "pending" && it.nextRetryAt && it.nextRetryAt > Date.now()
    ).length;
    const summary = pendingRetries > 0
      ? `${pendingRetries} item(s) scheduled for retry.\n${reasons.slice(0, 4).join("\n")}`
      : reasons.slice(0, 6).join("\n") || "Unknown";
    Alert.alert("No items uploaded", summary);
  } else {
    Alert.alert("Upload complete", `Uploaded ${uploaded} item(s).`);
  }
  return uploaded;
}
