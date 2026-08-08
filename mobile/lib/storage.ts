import AsyncStorage from "@react-native-async-storage/async-storage";

export const QUEUE_KEY = "capture_queue";

export type AnchorStatus = "pending" | "submitted" | "anchored" | "failed";

export type QueueItem = {
  user_id?: string | null;
  mediaUri: string;
  sha256: string;
  credential: any;
  signature: string;
  public_key: string;
  created_at: string;
  retryCount?: number;     // number of upload attempts so far
  nextRetryAt?: number;    // epoch ms – earliest time to retry
  lastError?: string;      // last failure reason for diagnostics
  anchor: {
    status: AnchorStatus;
    credential_id?: string;
    media_key?: string;
    anchored_at?: string;
  };
};

function parseQueueItems(raw: string | null): QueueItem[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueueItem[]) : [];
  } catch (err) {
    console.warn("[storage] capture_queue parse failed:", err);
    return [];
  }
}

export async function queueLoad(): Promise<QueueItem[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return parseQueueItems(raw);
}

export async function queueSaveAll(items: QueueItem[]) {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export async function queueAdd(item: QueueItem) {
  const arr = await queueLoad();
  arr.push(item);
  await queueSaveAll(arr);
}

export async function queueSaveAtIndex(index: number, item: QueueItem) {
  const arr = await queueLoad();
  if (index < 0 || index >= arr.length) return;
  arr[index] = item;
  await queueSaveAll(arr);
}

export async function queueClear() {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([]));
}

export async function queueSave(itemOrArray: QueueItem | QueueItem[]) {
  if (Array.isArray(itemOrArray)) {
    await queueSaveAll(itemOrArray);
  } else {
    await queueAdd(itemOrArray);
  }
}

