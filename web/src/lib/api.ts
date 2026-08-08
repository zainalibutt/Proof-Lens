import { API_BASE, S3_PUBLIC_BASE } from "./env";

/* Fetch wrapper */
function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init });
}

async function readErrorText(res: Response): Promise<string> {
  return (await res.text().catch(() => "")).trim();
}

export type VerifyResult = {
  found: boolean;
  verified?: boolean;
  reason?: string | null;
  verificationTier?: "invalid" | "integrity" | "authentic" | "anchored";
  sha256: string;
  credential?: any;
  mediaUrl?: string | null;
  tsrUrl?: string | null;
  mediaExists?: boolean;
  signatureValid?: boolean;
  anchorValid?: boolean;
};

export type ShareVerifyResult = {
  verified: boolean;
  reason?: string | null;
  verificationTier?: "invalid" | "integrity" | "authentic" | "anchored";
  captureId?: string;
  sha256?: string;
  status?: string;
  capturedAt?: string | null;
  anchoredAt?: string | null;
  signatureValid?: boolean;
  anchorValid?: boolean;
  timestampValid?: boolean;
  credential?: any;
  mediaUrl?: string | null;
  tsrUrl?: string | null;
  mediaExists?: boolean;
  tsrExists?: boolean;
};

export async function fetchShareByToken(token: string): Promise<ShareVerifyResult> {
  const res = await apiFetch(`${API_BASE}/verify/share/${encodeURIComponent(token)}`);
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(text || `verify_share_failed_${res.status}`);
  }
  return text ? JSON.parse(text) : { verified: false };
}

export async function verifyUpload(file: File, token?: string): Promise<VerifyResult> {
  const form = new FormData();
  form.append("file", file);

  const res = await apiFetch(`${API_BASE}/verify/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(text || `verify_failed_${res.status}`);
  }
  return text ? JSON.parse(text) : { found: false, sha256: "" };
}

export async function verifyShare(file: File, token: string, captureId: string): Promise<ShareVerifyResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("token", token);
  form.append("captureId", captureId);

  const res = await apiFetch(`${API_BASE}/verify/share`, {
    method: "POST",
    body: form,
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(text || `verify_share_failed_${res.status}`);
  }
  return text ? JSON.parse(text) : { verified: false };
}

export async function createShare(token: string, captureId: string, ttlHours?: number): Promise<{ shareUrl: string; expiresAt?: string }> {
  const res = await apiFetch(`${API_BASE}/shares`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ captureId, ttlHours }),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(text || `share_create_failed_${res.status}`);
  }
  return text ? JSON.parse(text) : { shareUrl: "" };
}

export type CredentialItem = Record<string, any> & {
  id?: string;
  sha256?: string;
  media_key?: string | null;
  timestamp?: string | null;
  status?: string;
  media_url?: string | null;
  tsr_url?: string | null;
};

export type AudioRecordItem = Record<string, any> & {
  id?: string;
  title?: string;
  duration?: number;
  sha256?: string;
  signature?: string;
  device_id?: string;
  s3_key?: string | null;
  tsa_status?: string | null;
  anchor_timestamp?: string | null;
  created_at?: string | null;
  media_url?: string | null;
  tsr_url?: string | null;
};

export function mediaUrlForKey(key: string | null) {
  if (!key || !S3_PUBLIC_BASE) return null;
  return `${S3_PUBLIC_BASE}/${key}`;
}

export function tsrUrlForKey(key: string | null) {
  if (!key || !S3_PUBLIC_BASE) return null;
  const tsrKey = key.replace(/\.[^/.]+$/, ".tsr");
  return `${S3_PUBLIC_BASE}/${tsrKey === key ? `${key}.tsr` : tsrKey}`;
}

export async function fetchCredentials(token: string): Promise<CredentialItem[]> {
  const res = await apiFetch(`${API_BASE}/credentials?status=submitted`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await readErrorText(res);
    throw new Error(text || `credentials_fetch_failed_${res.status}`);
  }
  const json = await res.json().catch(() => null);
  if (json?.items && Array.isArray(json.items)) return json.items;
  return Array.isArray(json) ? json : [];
}

export async function fetchAudioRecords(token: string): Promise<AudioRecordItem[]> {
  const res = await apiFetch(`${API_BASE}/audio/records`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await readErrorText(res);
    throw new Error(text || `audio_records_fetch_failed_${res.status}`);
  }
  const json = await res.json().catch(() => null);
  if (json?.items && Array.isArray(json.items)) return json.items;
  return Array.isArray(json) ? json : [];
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/filename\*?=(?:UTF-8''|\")?([^\";]+)\"?/i);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

export async function downloadEvidenceBundleZip(token: string, captureId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/captures/${encodeURIComponent(captureId)}/evidence-bundle`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `download_failed_${res.status}`);
  }

  const blob = await res.blob();
  const filename = filenameFromContentDisposition(res.headers.get("content-disposition")) || `prooflens_evidence_${captureId}.zip`;

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export async function downloadAudioEvidenceBundleZip(token: string, audioId: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/audio/${encodeURIComponent(audioId)}/evidence-bundle`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `download_failed_${res.status}`);
  }

  const blob = await res.blob();
  const filename = filenameFromContentDisposition(res.headers.get("content-disposition")) || `prooflens_audio_${audioId}.zip`;

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

export async function createAudioShare(token: string, audioId: string, ttlHours?: number): Promise<{ shareUrl: string; expiresAt?: string }> {
  const res = await apiFetch(`${API_BASE}/audio/shares/create`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ audioId, ttlHours }),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(text || `audio_share_create_failed_${res.status}`);
  return text ? JSON.parse(text) : { shareUrl: "" };
}

export type AudioShareVerifyResult = {
  verified: boolean;
  reason?: string | null;
  verificationTier?: "invalid" | "integrity" | "authentic" | "anchored";
  audioId?: string;
  sha256?: string;
  signatureValid?: boolean;
  anchorValid?: boolean;
  timestampValid?: boolean;
  mediaUrl?: string | null;
  tsrUrl?: string | null;
  media_url?: string | null;
  tsr_url?: string | null;
  mediaExists?: boolean;
  tsrExists?: boolean;
  bundleToken?: string | null;
  audio?: any;
};

export async function verifyAudioShare(file: File, token: string, audioId: string): Promise<AudioShareVerifyResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("token", token);
  form.append("audioId", audioId);

  const res = await apiFetch(`${API_BASE}/audio/verify/share`, {
    method: "POST",
    body: form,
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(text || `audio_share_verify_failed_${res.status}`);
  return text ? JSON.parse(text) : { verified: false };
}

export async function downloadAudioEvidenceBundleZipFromShare(audioId: string, bundleToken: string): Promise<void> {
  const url = `${API_BASE}/audio/shares/${encodeURIComponent(audioId)}/evidence-bundle?bundle=${encodeURIComponent(bundleToken)}`;
  const res = await apiFetch(url, { method: "GET" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `download_failed_${res.status}`);
  }

  const blob = await res.blob();
  const filename = filenameFromContentDisposition(res.headers.get("content-disposition")) || `prooflens_audio_${audioId}.zip`;

  const objUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
  }
}

export async function downloadEvidenceBundleZipFromShare(captureId: string, bundleToken: string): Promise<void> {
  const url = `${API_BASE}/shares/${encodeURIComponent(captureId)}/evidence-bundle?bundle=${encodeURIComponent(bundleToken)}`;
  const res = await apiFetch(url, { method: "GET" });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `download_failed_${res.status}`);
  }

  const blob = await res.blob();
  const filename = filenameFromContentDisposition(res.headers.get("content-disposition")) || `prooflens_evidence_${captureId}.zip`;

  const objUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(objUrl), 10_000);
  }
}
// Burst API functions

export type Burst = {
  id: string;
  user_id: string;
  capture_device_id: string;
  mode: number;
  trigger: string;
  frame_total: number;
  frame_count: number;
  status: string;
  cover_credential_id: string | null;
  created_at: string;
  updated_at: string;
};

export type BurstWithFrames = {
  burst: Burst;
  frames: {
    anchored: CredentialItem[];
    pending: any[];
  };
};

export async function fetchBursts(token: string, status?: string): Promise<Burst[]> {
  const url = status 
    ? `${API_BASE}/bursts?status=${encodeURIComponent(status)}`
    : `${API_BASE}/bursts`;
    
  const res = await apiFetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await readErrorText(res);
    throw new Error(text || `bursts_fetch_failed_${res.status}`);
  }
  const json = await res.json().catch(() => null);
  return json?.bursts || [];
}

export async function fetchBurstWithFrames(token: string, burstId: string): Promise<BurstWithFrames | null> {
  const res = await apiFetch(`${API_BASE}/bursts/${encodeURIComponent(burstId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const text = await readErrorText(res);
    throw new Error(text || `burst_fetch_failed_${res.status}`);
  }
  const data = await res.json().catch(() => null);
  return data;
}

export async function createShareLink(
  token: string, 
  captureId: string, 
  expiresInDays?: number
): Promise<{ shareUrl: string; expiresAt?: string; captureId?: string }> {
  const res = await apiFetch(`${API_BASE}/shares`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ 
      captureId,
      ttlHours: typeof expiresInDays === "number" ? expiresInDays * 24 : undefined,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `share_create_failed_${res.status}`);
  }
  
  return await res.json();
}
