// mobile/app/queue.tsx
import React, { useCallback, useEffect, useState, useMemo } from "react";
import {
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";

import { supabase } from "../lib/supabase";
import { API_BASE, createAudioDraft, createAudioRecord, createDraft, deleteAudioDraft, ensureDeviceKeyRegistered, fetchAudioRecords, fetchPendingAudioDrafts, fetchPendingDrafts, fetchSubmittedCreds, RemoteAudioDraft, RemoteDraft } from "../lib/api";
import { buildMediaKey, presignMedia, presignMediaPost, putToS3Form } from "../lib/uploader";
import { queueLoad, queueSaveAll, type QueueItem } from "../lib/storage";
import { audioLoad, audioRemove, audioUpdate, type AudioRecord } from "../lib/audioStorage";
import { getOrCreateKeypairB64 } from "../state/keypair";
import nacl from "tweetnacl";
import { getOrCreateInstallId } from "../lib/device";
import { encodeBase64 } from "tweetnacl-util";

type PendingAudioItem = AudioRecord & {
  local_only?: boolean;
};


// Screen
export default function QueueScreen() {
  const insets = useSafeAreaInsets();

  const [pending, setPending] = useState<RemoteDraft[]>([]);
  const [localImages, setLocalImages] = useState<QueueItem[]>([]);
  const [localAudio, setLocalAudio] = useState<AudioRecord[]>([]);
  const [remoteAudioDrafts, setRemoteAudioDrafts] = useState<RemoteAudioDraft[]>([]);
  const [audioSubmitted, setAudioSubmitted] = useState<AudioRecord[]>([]);
  const [installId, setInstallId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<any[]>([]);
  const [segment, setSegment] = useState<"pending" | "submitted">("pending");
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedBursts, setExpandedBursts] = useState<Set<string>>(new Set());

  const getCurrentUserId = useCallback(async () => {
    return (await supabase.auth.getSession()).data.session?.user?.id ?? null;
  }, []);
  


  const refresh = useCallback(async () => {
    try {
      const [p, s, a, remoteAudio, localAudioItems, localImageItems] = await Promise.all([
        fetchPendingDrafts(),
        fetchSubmittedCreds(),
        fetchAudioRecords(),
        fetchPendingAudioDrafts(),
        audioLoad(),
        queueLoad(),
      ]);
      const userId = await getCurrentUserId();
      const scopedLocalAudio = localAudioItems.filter((item) => item.user_id && item.user_id === userId);
      const scopedLocalImages = localImageItems.filter((item) => item.user_id && item.user_id === userId);
      setPending(p);
      setSubmitted(s);
      setAudioSubmitted(a);
      setRemoteAudioDrafts(remoteAudio);
      setLocalAudio(scopedLocalAudio);
      setLocalImages(scopedLocalImages);
    } catch (err) {
      console.warn("[queue] refresh failed:", err);
    }
  }, [getCurrentUserId]);

  useEffect(() => {
    (async () => {
      const id = await getOrCreateInstallId();
      setInstallId(id);
      await refresh();
    })();
  }, [refresh]);

  const onPull = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const pendingImageDrafts = useMemo(() => {
    const remoteBySha = new Set(pending.map((d) => d.sha256));
    const submittedBySha = new Set(
      submitted
        .map((s) => (typeof s?.sha256 === "string" ? s.sha256 : null))
        .filter(Boolean) as string[]
    );

    const localOnly = localImages
      .filter((item) => {
        const status = item.anchor?.status || "pending";
        if (status === "submitted" || status === "anchored") return false;
        if (remoteBySha.has(item.sha256)) return false;
        if (submittedBySha.has(item.sha256)) return false;
        return true;
      })
      .map((item) => {
        const captureDeviceId = item.credential?.capture_device_id || item.credential?.device_id || "";
        return {
          id: `local-${item.sha256}`,
          created_at: item.created_at,
          sha256: item.sha256,
          media_key: item.anchor?.media_key ?? null,
          capture_device_id: captureDeviceId,
          credential_json: item.credential ?? null,
        } as RemoteDraft;
      });

    return [...pending, ...localOnly];
  }, [localImages, pending, submitted]);

  const deleteLocalImage = useCallback(async (sha256: string) => {
    const arr = await queueLoad();
    const next = arr.filter((q) => q.sha256 !== sha256);
    if (next.length !== arr.length) {
      await queueSaveAll(next);
    }
  }, []);

  const ensureRemoteDraftForSha = useCallback(async (sha256: string): Promise<RemoteDraft> => {
    const existing = pending.find((d) => d.sha256 === sha256);
    if (existing) return existing;

    const localQueue = await queueLoad();
    const local = localQueue.find((q) => q.sha256 === sha256);
    if (!local) {
      throw new Error("Missing local capture for this draft");
    }

    const created = await createDraft({
      credential: local.credential,
      sha256: local.sha256,
      burst_id: local.credential?.burst_id,
    });

    if (!created) {
      throw new Error("Failed to sync draft to cloud");
    }

    const fresh = await fetchPendingDrafts();
    setPending(fresh);
    const synced = fresh.find((d) => d.sha256 === sha256);
    if (!synced) {
      throw new Error("Draft sync succeeded but pending list did not refresh");
    }
    return synced;
  }, [pending]);

  const discardCapture = useCallback(async (sha256: string) => {
    await deleteLocalImage(sha256);
    const remote = pending.find((d) => d.sha256 === sha256);
    if (remote) {
      await deleteDraft(sha256);
    }
  }, [deleteLocalImage, pending]);

  // Group drafts by burst_id
  const groupedPending = useMemo(() => {
    const bursts = new Map<string, RemoteDraft[]>();
    const singles: RemoteDraft[] = [];
    
    pendingImageDrafts.forEach(draft => {
      const burstId = draft.credential_json?.burst_id;
      if (burstId) {
        if (!bursts.has(burstId)) {
          bursts.set(burstId, []);
        }
        bursts.get(burstId)!.push(draft);
      } else {
        singles.push(draft);
      }
    });
    
    // Sort frames within each burst by frame_index
    bursts.forEach(frames => {
      frames.sort((a, b) => {
        const aIdx = a.credential_json?.frame_index ?? 0;
        const bIdx = b.credential_json?.frame_index ?? 0;
        return aIdx - bIdx;
      });
    });
    
    return { bursts, singles };
  }, [pendingImageDrafts]);

  const displayItems = useMemo(() => {
    const items: { type: 'burst' | 'single', burst_id?: string, drafts: RemoteDraft[] }[] = [];
    
    // Add bursts
    groupedPending.bursts.forEach((drafts, burst_id) => {
      items.push({ type: 'burst', burst_id, drafts });
    });
    
    // Add singles
    groupedPending.singles.forEach(draft => {
      items.push({ type: 'single', drafts: [draft] });
    });
    
    // Sort by created_at desc
    items.sort((a, b) => {
      const aTime = new Date(a.drafts[0].created_at).getTime();
      const bTime = new Date(b.drafts[0].created_at).getTime();
      return bTime - aTime;
    });
    
    return items;
  }, [groupedPending]);

  const audioPending = useMemo(() => {
    // Remote audio drafts are the source of truth for pending audio.
    // Merge with local records to get local_uri for upload, and include
    // local-only fallback items when remote draft sync failed.
    const submittedShas = new Set(audioSubmitted.map((a: any) => a.sha256));
    const remoteShas = new Set(remoteAudioDrafts.map((rd) => rd.sha256));

    const mergedRemote: PendingAudioItem[] = remoteAudioDrafts
      .filter((rd) => !submittedShas.has(rd.sha256))
      .map((rd) => {
        const local = localAudio.find((la) => la.sha256 === rd.sha256);
        return {
          id: rd.id,
          user_id: rd.credential_json?.user_id ?? local?.user_id ?? null,
          title: rd.credential_json?.title ?? local?.title ?? "Audio",
          created_at: rd.created_at,
          duration_ms: rd.duration_ms ?? local?.duration_ms ?? 0,
          device_id: rd.capture_device_id,
          sha256: rd.sha256,
          signature: local?.signature ?? "",
          gps: rd.credential_json?.gps ?? local?.gps ?? null,
          s3_key: null,
          tsa_status: "pending",
          anchor_timestamp: null,
          local_uri: local?.local_uri ?? "",
          credential: rd.credential_json ?? local?.credential ?? {},
          public_key: rd.credential_json?.public_key ?? local?.public_key ?? "",
          local_only: false,
        } as PendingAudioItem;
      });

    const localOnly: PendingAudioItem[] = localAudio
      .filter((la) => !submittedShas.has(la.sha256) && !remoteShas.has(la.sha256))
      .map((la) => ({
        ...la,
        local_only: true,
      }));

    return [...mergedRemote, ...localOnly];
  }, [remoteAudioDrafts, localAudio, audioSubmitted]);

  const pendingCount = pendingImageDrafts.length + audioPending.length;
  const submittedCount = submitted.length + audioSubmitted.length;

  const pendingData = useMemo(() => {
    const items = displayItems.map((item) => ({ kind: "image" as const, item }));
    const audioItems = audioPending.map((audio) => ({ kind: "audio" as const, audio }));
    const all = [...items, ...audioItems];
    all.sort((a, b) => {
      const aTime = a.kind === "audio" ? Date.parse(a.audio.created_at) : Date.parse(a.item.drafts[0].created_at);
      const bTime = b.kind === "audio" ? Date.parse(b.audio.created_at) : Date.parse(b.item.drafts[0].created_at);
      return bTime - aTime;
    });
    return all;
  }, [displayItems, audioPending]);

  const submittedData = useMemo(() => {
    const items = submitted.map((cred) => ({ kind: "image" as const, cred }));
    const audioItems = audioSubmitted.map((audio) => ({ kind: "audio" as const, audio }));
    const all = [...items, ...audioItems];
    all.sort((a, b) => {
      const aTime = a.kind === "audio"
        ? Date.parse(a.audio.created_at || "")
        : Date.parse(a.cred.created_at || a.cred.timestamp || "");
      const bTime = b.kind === "audio"
        ? Date.parse(b.audio.created_at || "")
        : Date.parse(b.cred.created_at || b.cred.timestamp || "");
      return bTime - aTime;
    });
    return all;
  }, [submitted, audioSubmitted]);

  const onUploadBurst = async (burstId: string) => {
    const frames = groupedPending.bursts.get(burstId);
    if (!frames || frames.length === 0) {
      Alert.alert("Error", "No frames found for this burst");
      return;
    }

    try {
      setBusy(true);
      for (const draft of frames) {
        const remoteDraft = await ensureRemoteDraftForSha(draft.sha256);
        await uploadDraft(remoteDraft);
      }
      await refresh();
      Alert.alert("Success", `Uploaded ${frames.length} frame${frames.length > 1 ? 's' : ''}`);
    } catch (err: any) {
      Alert.alert("Upload failed", String(err.message || err));
    } finally {
      setBusy(false);
    }
  };

  const onUpload = async (sha256: string) => {
    try {
      setBusy(true);
      const draft = await ensureRemoteDraftForSha(sha256);

      await uploadDraft(draft);
      await refresh();
    } catch (err: any) {
      Alert.alert("Upload failed", String(err.message || err));
    } finally {
      setBusy(false);
    }
  };

  const onUploadAudio = async (sha256: string) => {
    try {
      setBusy(true);
      const record = audioPending.find((a) => a.sha256 === sha256);
      if (!record) {
        Alert.alert("Missing audio", "Could not find audio record.");
        return;
      }

      // If this record was only cached locally, create remote audio draft first.
      const hasRemoteDraft = remoteAudioDrafts.some((rd) => rd.sha256 === record.sha256);
      if (!hasRemoteDraft) {
        const created = await createAudioDraft({
          credential: record.credential,
          sha256: record.sha256,
          duration_ms: record.duration_ms,
        });
        if (!created) {
          console.warn("[queue] audio draft sync unavailable; continuing with direct upload path");
        }
      }

      if (!record.local_uri) {
        throw new Error("Missing local audio file for upload.");
      }

      await uploadAudioRecord(record);
      await refresh();
      Alert.alert("Success", "Audio uploaded.");
    } catch (err: any) {
      Alert.alert("Upload failed", String(err.message || err));
    } finally {
      setBusy(false);
    }
  };

  const onDeleteAudio = async (sha256: string) => {
    Alert.alert(
      "Discard Audio",
      "Are you sure you want to discard this pending audio?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: async () => {
            try {
              setBusy(true);
              const record = audioPending.find((a) => a.sha256 === sha256);
              if (record?.sha256) {
                await deleteAudioDraft(record.sha256);
              }
              if (record?.id) {
                await audioRemove(record.id);
              }
              await refresh();
            } catch (err: any) {
              Alert.alert("Delete failed", String(err.message || err));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  };

  const onClearLocalStorage = useCallback(() => {
    Alert.alert(
      "Clear Local Storage",
      "This will remove all local cached captures/audio and device cache on this phone. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            try {
              setBusy(true);
              await AsyncStorage.clear();
              await Promise.all([
                SecureStore.deleteItemAsync("prooflens_install_id"),
                SecureStore.deleteItemAsync("prooflens_keypair_v1"),
                SecureStore.deleteItemAsync("prooflens_device_key_registered_meta_v2"),
              ]);
              await refresh();
              Alert.alert("Local storage cleared", "All local cache has been removed.");
            } catch (err: any) {
              Alert.alert("Clear failed", String(err?.message || err));
            } finally {
              setBusy(false);
            }
          },
        },
      ]
    );
  }, [refresh]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#0a0e17",
        paddingTop: insets.top,
      }}
    >
      <Header
        segment={segment}
        setSegment={setSegment}
        pendingCount={pendingCount}
        submittedCount={submittedCount}
        busy={busy}
        onClearLocalStorage={onClearLocalStorage}
      />

      <FlatList
        data={segment === "pending" ? pendingData : submittedData}
        keyExtractor={(item: any) =>
          segment === "pending"
            ? (item.kind === "audio"
                ? `audio-${item.audio.id}`
                : (item.item.type === "burst" ? `burst-${item.item.burst_id}` : `single-${item.item.drafts[0].sha256}`))
            : (item.kind === "audio" ? `audio-${item.audio.id}` : item.cred.id)
        }
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPull}
            tintColor="#7C9CFF"
          />
        }
        renderItem={({ item }) =>
          segment === "pending" ? (
            item.kind === "audio" ? (
              <AudioPendingCard
                audio={item.audio}
                onUpload={onUploadAudio}
                onDelete={onDeleteAudio}
                deviceId={installId}
              />
            ) : item.item.type === "burst" ? (
              <BurstCard
                burstId={item.item.burst_id!}
                drafts={item.item.drafts}
                onUpload={onUploadBurst}
                onDelete={async (burstId) => {
                  Alert.alert(
                    "Discard Burst",
                    `Are you sure you want to discard all ${item.item.drafts.length} frames in this burst?`,
                    [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Discard",
                        style: "destructive",
                        onPress: async () => {
                          try {
                            setBusy(true);
                            for (const draft of item.item.drafts) {
                              await discardCapture(draft.sha256);
                            }
                            await refresh();
                          } catch (err: any) {
                            Alert.alert("Delete failed", String(err.message || err));
                          } finally {
                            setBusy(false);
                          }
                        },
                      },
                    ]
                  );
                }}
                deviceId={installId}
                expanded={expandedBursts.has(item.item.burst_id!)}
                onToggleExpand={(burstId) => {
                  const newExpanded = new Set(expandedBursts);
                  if (newExpanded.has(burstId)) {
                    newExpanded.delete(burstId);
                  } else {
                    newExpanded.add(burstId);
                  }
                  setExpandedBursts(newExpanded);
                }}
              />
            ) : (
              <PendingCard
                draft={item.item.drafts[0]}
                onUpload={onUpload}
                onDelete={async (sha) => {
                  await discardCapture(sha);
                }}
                deviceId={installId}
              />
            )
          ) : item.kind === "audio" ? (
            <AudioSubmittedCard audio={item.audio} />
          ) : (
            <SubmittedCard cred={item.cred} />
          )
        }
        ListEmptyComponent={<EmptyState segment={segment} />}
      />
    </View>
  );
}

// Upload logic
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex length");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
async function uploadDraft(draft: RemoteDraft) {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("Not logged in");

  const registered = await ensureDeviceKeyRegistered();
  if (!registered) throw new Error("Device key not registered");

  const deviceId = await getOrCreateInstallId();

  // hard lock check (optional but recommended)
  if (draft.capture_device_id !== deviceId) {
    throw new Error("This capture can only be uploaded from the device that created it.");
  }

  const { publicKeyB64, secretKey } = await getOrCreateKeypairB64();

  const localQueue = await queueLoad();
  const local = localQueue.find((q) => q.sha256 === draft.sha256);
  if (!local?.mediaUri) {
    throw new Error("Missing local media for this draft");
  }

  const shaBytes = hexToBytes(draft.sha256);
  const sigBytes = nacl.sign.detached(shaBytes, secretKey);
  const signatureB64 = encodeBase64(sigBytes);

  // Extract burst info from credential_json
  const burstId = draft.credential_json?.burst_id;
  const frameIndex = draft.credential_json?.frame_index;
  const mediaKey = buildMediaKey({
    burstId,
    captureId: draft.id,
    sha256: draft.sha256,
    createdAt: draft.created_at,
    ext: "jpg",
  });

  // 1) Presign S3 key (uses burst folder if burst_id present)
  const presign = await presignMediaPost({
    ext: "jpg",
    contentType: "image/jpeg",
    sha256: draft.sha256,
    media_key: mediaKey,
    burst_id: burstId,
    frame_index: frameIndex,
  });

  // 2) Upload to S3
  await putToS3Form({
    url: presign.url,
    fields: presign.fields,
    fileUri: local.mediaUri,
    contentType: "image/jpeg",
  });

  const key = presign.fields.key;

  // 3) Create credential in API
  const res = await fetch(`${API_BASE}/credentials/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
      "x-device-id": deviceId,
    },
    body: JSON.stringify({
      sha256: draft.sha256,
      signatureB64,
      publicKeyB64,
      media_key: key,
      // include if your server merges/uses it
      credential_json: draft.credential_json ?? null,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`/credentials/upload failed ${res.status}: ${text}`);
  }

  return await res.json();
}

function sanitizeAudioFilename(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 40);
}

function buildAudioKeyFromRecord(record: AudioRecord) {
  const date = record.created_at ? new Date(record.created_at) : new Date();
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const safe = sanitizeAudioFilename(record.title || "audio");
  const base = safe || record.id;

  // Include a stable record-specific suffix so same-title recordings do not overwrite each other.
  const idSuffix = String(record.id || "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 12)
    .toLowerCase();
  const stem = idSuffix ? `${base}-${idSuffix}` : `${base}-${Date.now()}`;

  return `audio/${yyyy}/${mm}/${dd}/${stem}/${stem}.m4a`;
}

async function uploadAudioRecord(record: AudioRecord) {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("Not logged in");

  const registered = await ensureDeviceKeyRegistered();
  if (!registered) throw new Error("Device key not registered");

  const deviceId = await getOrCreateInstallId();
  if (record.device_id !== deviceId) {
    throw new Error("This audio can only be uploaded from the device that created it.");
  }

  const audioKey = buildAudioKeyFromRecord(record);
  const presign = await presignMedia({
    ext: "m4a",
    sha256: record.sha256,
    media_key: audioKey,
  });

  await putToS3Form({
    url: presign.url,
    fields: presign.fields,
    fileUri: record.local_uri,
    contentType: "audio/m4a",
    filename: audioKey.split("/").pop() || `${record.id}.m4a`,
  });

  const credential = {
    ...record.credential,
    title: record.title,
  };

  const created = await createAudioRecord({
    credential,
    signatureB64: record.signature,
    media_key: presign.media_key,
    title: record.title,
    duration_ms: record.duration_ms,
    sha256: record.sha256,
  });

  await audioUpdate(record.id, {
    s3_key: created.s3_key ?? presign.media_key,
    tsa_status: created.tsa_status ?? "submitted",
    anchor_timestamp: created.anchor_timestamp ?? null,
    tsa_token_base64: created.tsa_token_base64 ?? null,
  });

  return created;
}

async function deleteDraft(sha256: string) {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("Not logged in");

  const deviceId = await getOrCreateInstallId();

  const res = await fetch(`${API_BASE}/drafts/${sha256}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "x-device-id": deviceId,
    },
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `HTTP ${res.status}`);
  }

  return res.json();
}

// UI components
function Header({
  segment,
  setSegment,
  pendingCount,
  submittedCount,
  busy,
  onClearLocalStorage,
}: {
  segment: "pending" | "submitted";
  setSegment: (s: "pending" | "submitted") => void;
  pendingCount: number;
  submittedCount: number;
  busy: boolean;
  onClearLocalStorage: () => void;
}) {
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#1f2937" }}>
      <Text style={{ color: "white", fontSize: 28, fontWeight: "800", letterSpacing: -0.5 }}>
        Queue
      </Text>
      <Text style={{ color: "#9ca3af", marginTop: 4, fontSize: 14 }}>
        {busy ? "Uploading…" : "Manage pending and submitted captures"}
      </Text>

      <Pressable
        onPress={onClearLocalStorage}
        style={{ alignSelf: "flex-start", marginTop: 6, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 6, borderWidth: 1, borderColor: "#374151" }}
      >
        <Text style={{ color: "#9ca3af", fontSize: 11, fontWeight: "600" }}>Clear local storage</Text>
      </Pressable>

      <View style={{ flexDirection: "row", marginTop: 16, gap: 10 }}>
        <SegmentButton
          active={segment === "pending"}
          label={`Pending (${pendingCount})`}
          onPress={() => setSegment("pending")}
        />
        <SegmentButton
          active={segment === "submitted"}
          label={`Submitted (${submittedCount})`}
          onPress={() => setSegment("submitted")}
        />
      </View>
    </View>
  );
}

function SegmentButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 10,
        paddingHorizontal: 18,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: active ? "#6366f1" : "#1f2937",
        backgroundColor: active ? "#6366f1" : "#151b2b",
      }}
    >
      <Text
        style={{
          color: active ? "white" : "#e8f0ff",
          fontWeight: "700",
          fontSize: 14,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function PendingCard({
  draft,
  onUpload,
  onDelete,
  deviceId,
}: {
  draft: RemoteDraft;
  onUpload: (sha: string) => void;
  onDelete: (sha: string) => void;
  deviceId: string | null;
}) {
  const locked = draft.capture_device_id !== deviceId;

  return (
    <View
      style={{
        backgroundColor: "#151b2b",
        padding: 16,
        borderRadius: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: "#1f2937",
      }}
    >
      <Text style={{ color: "white", fontWeight: "700", marginBottom: 6, fontSize: 16 }}>
        {locked ? "Pending (other device)" : "Pending"}
      </Text>
      <Text style={{ color: "#9ca3af", marginBottom: 8, fontSize: 13 }}>
        {new Date(draft.created_at).toLocaleString()}
      </Text>
      <Text
        style={{
          color: "#e8f0ff",
          fontFamily: Platform.select({
            ios: "Menlo",
            android: "monospace",
            default: "monospace",
          }),
          fontSize: 12,
          backgroundColor: "#111827",
          padding: 8,
          borderRadius: 8,
        }}
        numberOfLines={1}
      >
        {draft.sha256}
      </Text>

      {locked ? (
        <>
          <Text style={{ color: "#ef4444", marginTop: 12, fontSize: 13, lineHeight: 18 }}>
            This capture can only be uploaded from the device that created it.
          </Text>
          <Pressable
            style={{
              marginTop: 12,
              backgroundColor: "#7f1d1d",
              paddingVertical: 10,
              borderRadius: 12,
              alignItems: "center",
              borderWidth: 1,
              borderColor: "#991b1b",
            }}
            onPress={() => onDelete(draft.sha256)}
          >
            <Text style={{ color: "#fca5a5", fontWeight: "600", fontSize: 14 }}>
              Discard
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable
            style={{
              marginTop: 14,
              backgroundColor: "#6366f1",
              paddingVertical: 12,
              borderRadius: 12,
              alignItems: "center",
            }}
            onPress={() => onUpload(draft.sha256)}
          >
            <Text
              style={{
                color: "white",
                fontWeight: "800",
                fontSize: 15,
              }}
            >
              Upload
            </Text>
          </Pressable>
          <Pressable
            style={{
              marginTop: 8,
              backgroundColor: "#1f2937",
              paddingVertical: 10,
              borderRadius: 12,
              alignItems: "center",
              borderWidth: 1,
              borderColor: "#374151",
            }}
            onPress={() => onDelete(draft.sha256)}
          >
            <Text style={{ color: "#9ca3af", fontWeight: "600", fontSize: 14 }}>
              Discard
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function AudioPendingCard({
  audio,
  onUpload,
  onDelete,
  deviceId,
}: {
  audio: PendingAudioItem;
  onUpload: (sha256: string) => void;
  onDelete: (sha256: string) => void;
  deviceId: string | null;
}) {
  const locked = audio.device_id !== deviceId;

  return (
    <View
      style={{
        backgroundColor: "#151b2b",
        padding: 16,
        borderRadius: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: "#1f2937",
      }}
    >
      <Text style={{ color: "white", fontWeight: "700", marginBottom: 6, fontSize: 16 }}>
        {locked ? "Audio Pending (other device)" : audio.local_only ? "Audio Pending (local-only)" : "Audio Pending"}
      </Text>
      <Text style={{ color: "#9ca3af", marginBottom: 8, fontSize: 13 }}>
        {audio.title} · {new Date(audio.created_at).toLocaleString()}
      </Text>
      <Text
        style={{
          color: "#e8f0ff",
          fontFamily: Platform.select({
            ios: "Menlo",
            android: "monospace",
            default: "monospace",
          }),
          fontSize: 12,
          backgroundColor: "#111827",
          padding: 8,
          borderRadius: 8,
        }}
        numberOfLines={1}
      >
        {audio.sha256}
      </Text>

      {locked ? (
        <>
          <Text style={{ color: "#ef4444", marginTop: 12, fontSize: 13, lineHeight: 18 }}>
            This audio can only be uploaded from the device that created it.
          </Text>
          <Pressable
            style={{
              marginTop: 12,
              backgroundColor: "#7f1d1d",
              paddingVertical: 10,
              borderRadius: 12,
              alignItems: "center",
              borderWidth: 1,
              borderColor: "#991b1b",
            }}
            onPress={() => onDelete(audio.sha256)}
          >
            <Text style={{ color: "#fca5a5", fontWeight: "600", fontSize: 14 }}>Discard</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable
            style={{
              marginTop: 14,
              backgroundColor: "#6366f1",
              paddingVertical: 12,
              borderRadius: 12,
              alignItems: "center",
            }}
            onPress={() => onUpload(audio.sha256)}
          >
            <Text style={{ color: "white", fontWeight: "800", fontSize: 15 }}>Upload</Text>
          </Pressable>
          <Pressable
            style={{
              marginTop: 8,
              backgroundColor: "#1f2937",
              paddingVertical: 10,
              borderRadius: 12,
              alignItems: "center",
              borderWidth: 1,
              borderColor: "#374151",
            }}
            onPress={() => onDelete(audio.sha256)}
          >
            <Text style={{ color: "#9ca3af", fontWeight: "600", fontSize: 14 }}>Discard</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function SubmittedCard({ cred }: { cred: any }) {
  return (
    <View
      style={{
        backgroundColor: "#151b2b",
        padding: 16,
        borderRadius: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: "#1f2937",
      }}
    >
      <Text style={{ color: "white", fontWeight: "700", marginBottom: 6, fontSize: 16 }}>
        ✅ Submitted
      </Text>
      <Text style={{ color: "#9ca3af", marginBottom: 8, fontSize: 13 }}>
        {new Date(cred.created_at).toLocaleString()}
      </Text>
      <Text
        style={{
          color: "#e8f0ff",
          fontFamily: Platform.select({
            ios: "Menlo",
            android: "monospace",
            default: "monospace",
          }),
          fontSize: 12,
          backgroundColor: "#111827",
          padding: 8,
          borderRadius: 8,
        }}
        numberOfLines={1}
      >
        {cred.sha256}
      </Text>

      <Pressable
        style={{
          marginTop: 14,
          backgroundColor: "#1f2937",
          paddingVertical: 12,
          borderRadius: 12,
          alignItems: "center",
          borderWidth: 1,
          borderColor: "#374151",
        }}
        onPress={async () => {
          await Clipboard.setStringAsync(
            JSON.stringify(cred.credential_json ?? cred, null, 2)
          );
          Alert.alert("Copied", "Credential JSON copied to clipboard.");
        }}
      >
        <Text
          style={{
            color: "#e8f0ff",
            fontWeight: "700",
            fontSize: 14,
          }}
        >
          Copy JSON
        </Text>
      </Pressable>
    </View>
  );
}

function AudioSubmittedCard({ audio }: { audio: AudioRecord }) {
  return (
    <View
      style={{
        backgroundColor: "#151b2b",
        padding: 16,
        borderRadius: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: "#1f2937",
      }}
    >
      <Text style={{ color: "white", fontWeight: "700", marginBottom: 6, fontSize: 16 }}>
        ✅ Audio Submitted
      </Text>
      <Text style={{ color: "#9ca3af", marginBottom: 8, fontSize: 13 }}>
        {audio.title} · {audio.created_at ? new Date(audio.created_at).toLocaleString() : ""}
      </Text>
      <Text
        style={{
          color: "#e8f0ff",
          fontFamily: Platform.select({
            ios: "Menlo",
            android: "monospace",
            default: "monospace",
          }),
          fontSize: 12,
          backgroundColor: "#111827",
          padding: 8,
          borderRadius: 8,
        }}
        numberOfLines={1}
      >
        {audio.sha256}
      </Text>
    </View>
  );
}

function BurstCard({
  burstId,
  drafts,
  onUpload,
  onDelete,
  deviceId,
  expanded,
  onToggleExpand,
}: {
  burstId: string;
  drafts: RemoteDraft[];
  onUpload: (burstId: string) => void;
  onDelete: (burstId: string) => void;
  deviceId: string | null;
  expanded: boolean;
  onToggleExpand: (burstId: string) => void;
}) {
  const locked = drafts.some(d => d.capture_device_id !== deviceId);
  const frameCount = drafts.length;
  const frameTotal = drafts[0]?.credential_json?.frame_total ?? frameCount;
  const trigger = drafts[0]?.credential_json?.trigger || 'manual';
  const createdAt = drafts[0]?.created_at;

  return (
    <View
      style={{
        backgroundColor: "#151b2b",
        padding: 16,
        borderRadius: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: "#1f2937",
      }}
    >
      <Pressable
        onPress={() => onToggleExpand(burstId)}
        style={{ marginBottom: 12 }}
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
              <Text style={{ color: "white", fontWeight: "700", fontSize: 16, marginRight: 8 }}>
                {frameTotal === 1 ? "Single" : frameTotal === 5 ? "5-Frame Burst" : "10-Frame Burst"}
              </Text>
              <Text style={{ color: "#9ca3af", fontSize: 13 }}>
                {trigger === 'motion' ? 'Motion' : 'Manual'}
              </Text>
            </View>
            <Text style={{ color: "#9ca3af", fontSize: 13 }}>
              {new Date(createdAt).toLocaleString()}
            </Text>
            <Text style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>
              {frameCount}/{frameTotal} frames
            </Text>
          </View>
          <Text style={{ color: "#9ca3af", fontSize: 18 }}>
            {expanded ? "−" : "+"}
          </Text>
        </View>
      </Pressable>

      {expanded && (
        <View style={{ marginTop: 8, marginBottom: 12 }}>
          <Text style={{ color: "#9ca3af", fontSize: 13, fontWeight: "600", marginBottom: 8 }}>
            Frames:
          </Text>
          {drafts.map((draft, idx) => (
            <View
              key={draft.sha256}
              style={{
                backgroundColor: "#111827",
                padding: 8,
                borderRadius: 8,
                marginBottom: 6,
              }}
            >
              <Text style={{ color: "#e8f0ff", fontSize: 12, marginBottom: 4 }}>
                Frame {idx + 1}
              </Text>
              <Text
                style={{
                  color: "#6b7280",
                  fontFamily: Platform.select({
                    ios: "Menlo",
                    android: "monospace",
                    default: "monospace",
                  }),
                  fontSize: 10,
                }}
                numberOfLines={1}
              >
                {draft.sha256}
              </Text>
            </View>
          ))}
        </View>
      )}

      {locked ? (
        <>
          <Text style={{ color: "#ef4444", marginTop: 12, fontSize: 13, lineHeight: 18 }}>
            This capture can only be uploaded from the device that created it.
          </Text>
          <Pressable
            style={{
              marginTop: 12,
              backgroundColor: "#7f1d1d",
              paddingVertical: 10,
              borderRadius: 12,
              alignItems: "center",
              borderWidth: 1,
              borderColor: "#991b1b",
            }}
            onPress={() => onDelete(burstId)}
          >
            <Text style={{ color: "#fca5a5", fontWeight: "600", fontSize: 14 }}>
              Discard Burst
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable
            style={{
              marginTop: 14,
              backgroundColor: "#6366f1",
              paddingVertical: 12,
              borderRadius: 12,
              alignItems: "center",
            }}
            onPress={() => onUpload(burstId)}
          >
            <Text
              style={{
                color: "white",
                fontWeight: "800",
                fontSize: 15,
              }}
            >
              Upload {frameCount} Frame{frameCount > 1 ? 's' : ''}
            </Text>
          </Pressable>
          <Pressable
            style={{
              marginTop: 8,
              backgroundColor: "#1f2937",
              paddingVertical: 10,
              borderRadius: 12,
              alignItems: "center",
              borderWidth: 1,
              borderColor: "#374151",
            }}
            onPress={() => onDelete(burstId)}
          >
            <Text style={{ color: "#9ca3af", fontWeight: "600", fontSize: 14 }}>
              Discard Burst
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

function EmptyState({ segment }: { segment: "pending" | "submitted" }) {
  return (
    <View style={{ padding: 48, alignItems: "center" }}>
      <Text style={{ color: "#e8f0ff", fontSize: 16, fontWeight: "600", marginBottom: 8 }}>
        {segment === "pending"
          ? "No pending captures"
          : "No submitted credentials"}
      </Text>
      <Text style={{ color: "#6b7280", textAlign: "center", fontSize: 14 }}>
        {segment === "pending"
          ? "Take a photo to get started"
          : "Upload pending captures to see them here"}
      </Text>
    </View>
  );
}
