import AsyncStorage from "@react-native-async-storage/async-storage";

export const AUDIO_KEY = "audio_records";

export type AudioRecord = {
  id: string;
  user_id?: string | null;
  title: string;
  created_at: string;
  duration_ms: number;
  device_id: string;
  sha256: string;
  signature: string;
  gps?: any | null;
  s3_key?: string | null;
  tsa_status?: string | null;
  anchor_timestamp?: string | null;
  tsa_token_base64?: string | null;
  local_uri: string;
  credential: any;
  public_key: string;
};

function parseAudioRecords(raw: string | null): AudioRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AudioRecord[]) : [];
  } catch (err) {
    console.warn("[audioStorage] audio_records parse failed:", err);
    return [];
  }
}

export async function audioLoad(): Promise<AudioRecord[]> {
  const raw = await AsyncStorage.getItem(AUDIO_KEY);
  return parseAudioRecords(raw);
}

export async function audioSaveAll(items: AudioRecord[]) {
  await AsyncStorage.setItem(AUDIO_KEY, JSON.stringify(items));
}

export async function audioAdd(item: AudioRecord) {
  const arr = await audioLoad();
  arr.push(item);
  await audioSaveAll(arr);
}

export async function audioUpdate(id: string, patch: Partial<AudioRecord>) {
  const arr = await audioLoad();
  const idx = arr.findIndex((a) => a.id === id);
  if (idx < 0) return;
  arr[idx] = { ...arr[idx], ...patch };
  await audioSaveAll(arr);
}

export async function audioRemove(id: string) {
  const arr = await audioLoad();
  const next = arr.filter((a) => a.id !== id);
  await audioSaveAll(next);
}
