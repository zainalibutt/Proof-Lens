import { API_BASE } from "./api";

export async function logToServer(tag: string, payload: unknown) {
  try {
    await fetch(`${API_BASE}/client-log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tag,
        ts: new Date().toISOString(),
        payload,
      }),
    });
  } catch {
  }
}
