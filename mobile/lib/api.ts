// mobile/lib/api.ts
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { supabase } from "./supabase";
import { getOrCreateInstallId } from "./device";
import nacl from "tweetnacl";
import { decodeUTF8, encodeBase64 } from "tweetnacl-util";
import { getOrCreateKeypairB64 } from "../state/keypair";

// API base
export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ||
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_API_BASE ||
  "";

if (!API_BASE) {
  console.warn("[api] API_BASE is empty — set EXPO_PUBLIC_API_BASE in app.json extra or environment");
}

// Types
export type RemoteDraft = {
  id: string;
  created_at: string;
  sha256: string;
  media_key: string | null;
  capture_device_id: string;
  has_media_blob?: boolean;
  thumbnail_key?: string | null;
  credential_json?: any;
};

const DEVICE_KEY_REGISTERED_META = "prooflens_device_key_registered_meta_v2";

export async function ensureDeviceKeyRegistered(deviceIdOverride?: string): Promise<boolean> {
  try {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session?.access_token || !session.user?.id) return false;

    const deviceId = deviceIdOverride || (await getOrCreateInstallId());
    if (!deviceId) return false;

    const { publicKeyB64, secretKey } = await getOrCreateKeypairB64();

    const cachedMetaRaw = await SecureStore.getItemAsync(DEVICE_KEY_REGISTERED_META);
    if (cachedMetaRaw) {
      try {
        const cachedMeta = JSON.parse(cachedMetaRaw) as {
          userId?: string;
          deviceId?: string;
          publicKeyB64?: string;
        };
        if (
          cachedMeta.userId === session.user.id &&
          cachedMeta.deviceId === deviceId &&
          cachedMeta.publicKeyB64 === publicKeyB64
        ) {
          return true;
        }
      } catch {
        // Ignore corrupt cache and continue with registration.
      }
    }

    const signedAt = new Date().toISOString();
    const msg = `prooflens:device-register:v1:${session.user.id}:${deviceId}:${publicKeyB64}:${signedAt}`;
    const sigBytes = nacl.sign.detached(decodeUTF8(msg), secretKey);
    const signatureB64 = encodeBase64(sigBytes);

    const res = await fetch(`${API_BASE}/devices/register`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        "x-device-id": deviceId,
      },
      body: JSON.stringify({ publicKeyB64, signedAt, signatureB64 }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[api] /devices/register failed:", res.status, text);
      return false;
    }

    await SecureStore.setItemAsync(
      DEVICE_KEY_REGISTERED_META,
      JSON.stringify({
        userId: session.user.id,
        deviceId,
        publicKeyB64,
      })
    );
    return true;
  } catch (err) {
    console.warn("[api] ensureDeviceKeyRegistered failed:", err);
    return false;
  }
}

export async function createDraft(params: {
  credential: any;
  sha256: string;
  device_id?: string;
  burst_id?: string;
}): Promise<RemoteDraft | null> {
  try {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session?.access_token) return null;

    const deviceId =
      params.device_id ??
      params.credential?.capture_device_id ??
      params.credential?.device_id ??
      (await getOrCreateInstallId());

    const registered = await ensureDeviceKeyRegistered(deviceId);
    if (!registered) return null;

    const body = {
      credential: params.credential,
      sha256: params.sha256,
      burst_id: params.burst_id || null,
    };

    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      ...(deviceId ? { "x-device-id": deviceId } : {}),
    };

    const res = await fetch(`${API_BASE}/drafts`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[api] createDraft failed:", {
        status: res.status,
        statusText: res.statusText,
        response: text,
      });
      return null;
    }
    const json = await res.json().catch(() => null);
    return json as RemoteDraft;
  } catch (err) {
    console.warn("[api] createDraft failed:", err);
    return null;
  }
}



// After upload, credentials come from your "credentials" table
export type SubmittedCredential = {
  id: string;
  sha256: string;
  media_key: string | null;
  timestamp: string | null;
  status: "submitted" | "anchored" | "failed" | "local";
  capture_device_id: string | null;
  submitter_device_id: string | null;
};


// Fetch pending drafts from server
export async function fetchPendingDrafts(): Promise<RemoteDraft[]> {
  try {
    const session = (await supabase.auth.getSession()).data.session;
    const headers: any = {};
    if (session) headers["Authorization"] = `Bearer ${session.access_token}`;

    const res = await fetch(`${API_BASE}/drafts/pending`, {
      method: "GET",
      headers,
    });

    if (!res.ok) return [];
    const json = await res.json().catch(() => []);
    return json as RemoteDraft[];
  } catch (err) {
    console.warn("[api] fetchPendingDrafts failed:", err);
    return [];
  }
}

// Fetch submitted credentials
export async function fetchSubmittedCreds(): Promise<SubmittedCredential[]> {
  try {
    const session = (await supabase.auth.getSession()).data.session;
    const headers: any = {};
    if (session) headers["Authorization"] = `Bearer ${session.access_token}`;

    const res = await fetch(`${API_BASE}/credentials?status=submitted`, {
      method: "GET",
      headers,
    });

    if (!res.ok) return [];

    const json: any = await res.json().catch(() => null);

    // server returns { items, nextOffset }
    if (json?.items && Array.isArray(json.items)) return json.items;

    // fallback if server ever returns a raw array
    if (Array.isArray(json)) return json;

    return [];
  } catch (err) {
    console.warn("[api] fetchSubmittedCreds failed:", err);
    return [];
  }
}

// Fetch audio records
export async function fetchAudioRecords(): Promise<any[]> {
  try {
    const session = (await supabase.auth.getSession()).data.session;
    const headers: any = {};
    if (session) headers["Authorization"] = `Bearer ${session.access_token}`;

    const res = await fetch(`${API_BASE}/audio/records`, {
      method: "GET",
      headers,
    });

    if (!res.ok) return [];
    const json: any = await res.json().catch(() => null);
    if (json?.items && Array.isArray(json.items)) return json.items;
    return Array.isArray(json) ? json : [];
  } catch (err) {
    console.warn("[api] fetchAudioRecords failed:", err);
    return [];
  }
}
// Burst API functions
export type Burst = {
  id: string;
  user_id: string;
  capture_device_id: string;
  mode: "single" | "burst";
  trigger: "manual" | "motion";
  frame_total: number;
  status: string;
  cover_credential_id: string | null;
  created_at: string;
};

export async function createBurst(params: {
  mode: "single" | "burst";
  trigger: "manual" | "motion";
  frame_total: number;
}): Promise<Burst | null> {
  try {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session?.access_token) return null;

    const deviceId = await getOrCreateInstallId();

    const res = await fetch(`${API_BASE}/bursts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        "x-device-id": deviceId,
      },
      body: JSON.stringify(params),
    });

    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    return json as Burst;
  } catch (err) {
    console.warn("[api] createBurst failed:", err);
    return null;
  }
}

export async function finalizeBurst(burstId: string): Promise<any> {
  try {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session?.access_token) return null;

    const res = await fetch(`${API_BASE}/bursts/${burstId}/finalize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch (err) {
    console.warn("[api] finalizeBurst failed:", err);
    return null;
  }
}

// Audio API functions
export type AudioRecordResponse = {
  id: string;
  user_id: string;
  title: string;
  duration: number;
  sha256: string;
  signature: string;
  device_id: string;
  gps?: any | null;
  s3_key: string;
  tsa_status?: string | null;
  tsa_token_base64?: string | null;
  anchor_timestamp?: string | null;
  created_at: string;
};

export async function createAudioRecord(payload: {
  credential: any;
  signatureB64: string;
  media_key: string;
  title: string;
  duration_ms: number;
  sha256: string;
}): Promise<AudioRecordResponse> {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session?.access_token) {
    throw new Error("Not logged in");
  }

  const deviceId = await getOrCreateInstallId();

  const res = await fetch(`${API_BASE}/audio/records`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      "x-device-id": deviceId,
    },
    body: JSON.stringify(payload),
  });

  const raw = await res.text().catch(() => "");
  let parsed: any = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    const serverError = parsed?.error || raw || `HTTP ${res.status}`;
    throw new Error(String(serverError));
  }

  if (parsed && typeof parsed === "object") {
    return parsed as AudioRecordResponse;
  }

  const fallbackId = (payload.credential?.audio_id || "").toString() || `audio-${Date.now()}`;
  const fallbackCreatedAt = (payload.credential?.timestamp || new Date().toISOString()).toString();

  return {
    id: fallbackId,
    user_id: "",
    title: payload.title || payload.credential?.title || `Audio ${fallbackId.slice(0, 6)}`,
    duration: payload.duration_ms,
    sha256: payload.sha256,
    signature: payload.signatureB64,
    device_id: (payload.credential?.capture_device_id || "").toString(),
    gps: payload.credential?.gps ?? null,
    s3_key: payload.media_key,
    tsa_status: "submitted",
    tsa_token_base64: null,
    anchor_timestamp: null,
    created_at: fallbackCreatedAt,
  };
}

// Audio drafts (same flow as image drafts)
export type RemoteAudioDraft = {
  id: string;
  created_at: string;
  sha256: string;
  media_key: string | null;
  capture_device_id: string;
  duration_ms: number | null;
  credential_json?: any;
};

export async function createAudioDraft(params: {
  credential: any;
  sha256: string;
  duration_ms?: number | null;
  media_key?: string;
}): Promise<RemoteAudioDraft | null> {
  try {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session?.access_token) return null;

    const deviceId =
      params.credential?.capture_device_id ??
      params.credential?.device_id ??
      (await getOrCreateInstallId());

    const registered = await ensureDeviceKeyRegistered(deviceId);
    if (!registered) return null;

    const body = {
      credential: params.credential,
      sha256: params.sha256,
      duration_ms: params.duration_ms ?? null,
      media_key: params.media_key || undefined,
    };

    const res = await fetch(`${API_BASE}/audio/drafts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
        "x-device-id": deviceId,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[api] createAudioDraft failed:", res.status, text);
      if (res.status === 404) {
        console.warn("[api] /audio/drafts route not found on API_BASE. Deploy backend with new audio drafts routes.");
      }
      return null;
    }
    return (await res.json()) as RemoteAudioDraft;
  } catch (err) {
    console.warn("[api] createAudioDraft failed:", err);
    return null;
  }
}

export async function fetchPendingAudioDrafts(): Promise<RemoteAudioDraft[]> {
  try {
    const session = (await supabase.auth.getSession()).data.session;
    const headers: any = {};
    if (session) headers["Authorization"] = `Bearer ${session.access_token}`;

    const res = await fetch(`${API_BASE}/audio/drafts/pending`, {
      method: "GET",
      headers,
    });

    if (!res.ok) return [];
    const json = await res.json().catch(() => []);
    return Array.isArray(json) ? json : [];
  } catch (err) {
    console.warn("[api] fetchPendingAudioDrafts failed:", err);
    return [];
  }
}

export async function deleteAudioDraft(sha256: string): Promise<boolean> {
  try {
    const session = (await supabase.auth.getSession()).data.session;
    if (!session?.access_token) return false;

    const deviceId = await getOrCreateInstallId();
    const res = await fetch(`${API_BASE}/audio/drafts/${sha256}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "x-device-id": deviceId,
      },
    });

    return res.ok;
  } catch (err) {
    console.warn("[api] deleteAudioDraft failed:", err);
    return false;
  }
}