// mobile/lib/uploader.ts
import { API_BASE } from "./api";
import { logToServer } from "./logger";
import { Platform } from "react-native";
import { supabase } from "./supabase";
import { getOrCreateInstallId } from "./device";
export type PresignPost = { url: string; fields: Record<string, string> };

type MediaKeyArgs = {
  burstId?: string | null;
  captureId?: string | null;
  sha256?: string | null;
  createdAt?: string | Date | null;
  ext?: string;
};

export function buildMediaKey({ burstId, captureId, sha256, createdAt, ext = "jpg" }: MediaKeyArgs) {
  const finalId = captureId || sha256;
  if (!finalId) return undefined;

  const date = createdAt ? new Date(createdAt) : new Date();
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const base = `captures/${yyyy}/${mm}/${dd}`;

  if (burstId) return `${base}/${burstId}/${finalId}/${finalId}.${ext}`;
  return `${base}/${finalId}/${finalId}.${ext}`;
}

// Request a presigned S3 POST policy for a media upload.
// Returns the POST endpoint url, the form fields, and the final media_key.
export async function presignMedia(
  { 
    ext = "jpg", 
    sha256, 
    media_key,
  }: { 
    ext?: string; 
    sha256?: string; 
    media_key?: string;
  }
): Promise<{ url: string; fields: Record<string, string>; media_key: string }> {
  const finalMediaKey = media_key;
  const session = (await supabase.auth.getSession()).data.session;
  const deviceId = await getOrCreateInstallId();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-device-id": deviceId,
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  
  const url = `${API_BASE}/media/presign`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ext, sha256, media_key: finalMediaKey }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    await logToServer("presign_error", { status: res.status, text });
    throw new Error(`presign failed: ${res.status}`);
  }

  const json = await res.json();
  // Expecting { url, fields, key } or { url, fields, media_key }
  const responseMediaKey: string = json.media_key ?? json.key ?? json.fields?.key;
  if (!json.url || !json.fields || !responseMediaKey) {
    throw new Error("presign response missing fields");
  }

  return { url: json.url, fields: json.fields, media_key: responseMediaKey };
}


/** Plain browser-style S3 form upload (works in RN with fetch as well) */
export async function putToS3Form({
  url,
  fields,
  fileUri,
  contentType,
  filename = (fields?.key ?? "upload.jpg").split("/").pop() || "upload.jpg",
}: {
  url: string;
  fields: Record<string, string>;
  fileUri: string;         // file://… from camera
  contentType?: string;    // e.g. "image/jpeg"
  filename?: string;
}): Promise<void> {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, v));

  if (Platform.OS === "web") {
    const blob = await (await fetch(fileUri)).blob();
    const typed = contentType ? blob.slice(0, blob.size, contentType) : blob;
    form.append("file", typed, filename);
  } else {
    // RN FormData accepts { uri, name, type }
    // @ts-expect-error – RN FormData file tuple
    form.append("file", { uri: fileUri, name: filename, type: contentType ?? "image/jpeg" });
  }

  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`S3 POST failed: ${res.status} ${text}`);
  }
}



export async function presignMediaPost(
  args: { 
    ext: string; 
    contentType?: string; 
    sha256?: string; 
    media_key?: string;
    burst_id?: string;
    frame_index?: number;
  }
): Promise<{ url: string; fields: Record<string, string> }> {
  const finalMediaKey = args.media_key ?? buildMediaKey({
    burstId: args.burst_id ?? null,
    captureId: args.sha256 ?? undefined,
    sha256: args.sha256 ?? undefined,
    ext: args.ext,
  });
  const session = (await supabase.auth.getSession()).data.session;
  const deviceId = await getOrCreateInstallId();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-device-id": deviceId,
  };
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  
  const res = await fetch(`${API_BASE}/media/presign`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ext: args.ext, sha256: args.sha256, media_key: finalMediaKey }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`presign_failed: ${res.status} ${text}`);
  }

  const json = await res.json();
  if (!json?.url || !json?.fields) throw new Error("invalid_presign_response");
  return { url: json.url, fields: json.fields };
}
