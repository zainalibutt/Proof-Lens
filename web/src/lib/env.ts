const rawApiBase = (import.meta.env.VITE_API_BASE || "").trim();

function isLocalOrLanHost(value: string): boolean {
  const host = value.trim().replace(/^https?:\/\//i, "").split("/")[0].split(":")[0].toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const match172 = host.match(/^172\.(\d{1,3})\./);
  if (match172) {
    const secondOctet = Number(match172[1]);
    if (Number.isFinite(secondOctet) && secondOctet >= 16 && secondOctet <= 31) return true;
  }
  return false;
}

function normalizeApiBase(value: string): string {
  if (!value) {
    console.warn("[env] VITE_API_BASE is not set — API calls will fail.");
    return "";
  }
  if (/^https?:\/\//i.test(value)) return value.replace(/\/$/, "");
  const scheme = isLocalOrLanHost(value) ? "http" : "https";
  return `${scheme}://${value}`.replace(/\/$/, "");
}

export const API_BASE = normalizeApiBase(rawApiBase);

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const S3_PUBLIC_BASE =
  import.meta.env.VITE_S3_PUBLIC_BASE || "";
