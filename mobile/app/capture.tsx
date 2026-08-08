// mobile/app/capture.tsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, Pressable, Image, Alert, Platform, Switch } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Location from "expo-location";
import * as FileSystem from "expo-file-system/legacy";
import { decodeBase64 } from "tweetnacl-util";
import { router } from "expo-router";
import { sha256Hex, signSha256 } from "../lib/crypto";
import { getOrCreateKeypairB64 } from "../state/keypair";
import { queueAdd, queueLoad, type QueueItem } from "../lib/storage";
import { createDraft, createBurst } from "../lib/api";
import { getOrCreateInstallId } from "../lib/device";
import { DeviceMotion } from "expo-sensors";
import { supabase } from "../lib/supabase";

async function persistToDocuments(srcUri: string, b64?: string) {
  if (Platform.OS === "web") return b64 ? `data:image/jpeg;base64,${b64}` : srcUri;
  const docDir = (FileSystem as any).documentDirectory as string | null;
  if (!docDir) return srcUri;
  const dir = `${docDir}captures/`;
  try { await FileSystem.makeDirectoryAsync(dir, { intermediates: true }); } catch {}
  const dest = `${dir}${Date.now()}.jpg`;
  await FileSystem.moveAsync({ from: srcUri, to: dest });
  return dest;
}

async function createRemoteDraft(params: {
  sha256: string;
  credential_json: any;
  device_id?: string;
  burst_id?: string;
}) {
  return await createDraft({ 
    credential: params.credential_json, 
    sha256: params.sha256,
    device_id: params.device_id,
    burst_id: params.burst_id,
  });
}

export default function CaptureScreen() {
  const [cameraPerm, requestCameraPerm] = useCameraPermissions();
  const camRef = useRef<CameraView | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [facing, setFacing] = useState<"front" | "back">("back");
  const [recent, setRecent] = useState<QueueItem | null>(null);
  
  // Burst controls
  const [burstMode, setBurstMode] = useState<1 | 5 | 10>(1);
  const [motionTrigger, setMotionTrigger] = useState(false);
  const [motionThreshold] = useState(2.5); // m/s²
  const [motionCooldown] = useState(5000); // ms
  const lastTriggerTime = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const q = await queueLoad();
        const userId = (await supabase.auth.getSession()).data.session?.user?.id ?? null;
        const scoped = q.filter((item) => item.user_id && item.user_id === userId);
        setRecent(scoped.length ? scoped[scoped.length - 1] : null);
      } catch {}
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const svc = await Location.hasServicesEnabledAsync();
        if (svc) await Location.requestForegroundPermissionsAsync();
      } catch {}
    })();
  }, []);

  const onCameraReady = useCallback(() => setIsReady(true), []);

  // Capture single frame helper
  const captureFrame = useCallback(async () => {
    if (!camRef.current || !isReady) throw new Error("Camera not ready");

    const shot = await camRef.current.takePictureAsync({
      quality: 1,
      exif: true,
      base64: true,
      skipProcessing: false,
    });
    
    if (!shot?.uri || !shot.base64) throw new Error("Camera did not return image/base64");
    
    const persistedUri = await persistToDocuments(shot.uri, shot.base64);
    const bytes = decodeBase64(shot.base64);
    const hash = sha256Hex(bytes);
    
    return { persistedUri, hash, shot };
  }, [isReady]);

  // Burst capture (1/5/10 frames)
  const takePhotoBurst = useCallback(async () => {
    try {
      if (!camRef.current || !isReady || busy) return;
      setBusy(true);

      const { publicKeyB64, secretKey } = await getOrCreateKeypairB64();
      const installId = await getOrCreateInstallId();
      const userId = (await supabase.auth.getSession()).data.session?.user?.id ?? null;

      // Get GPS once for the burst
      let gps: any = null;
      try {
        const svc = await Location.hasServicesEnabledAsync();
        const perm = await Location.getForegroundPermissionsAsync();
        if (svc && perm.granted) {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          gps = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            acc_m: pos.coords.accuracy ?? null,
            time: new Date(pos.timestamp).toISOString(),
          };
        }
      } catch {}

      // 1. Create burst
      const burst = await createBurst({
        mode: burstMode === 1 ? 'single' : 'burst',
        trigger: motionTrigger ? 'motion' : 'manual',
        frame_total: burstMode,
      });

      if (!burst) throw new Error("Failed to create burst");

      const frames: QueueItem[] = [];
      let draftSyncFailures = 0;

      // 2. Capture N frames
      for (let i = 0; i < burstMode; i++) {
        const { persistedUri, hash, shot } = await captureFrame();

        const timestamp = new Date().toISOString();
        
        const cred = {
          version: 1,
          schema: "alexander-alpha/credential@1",
          sha256: hash,
          public_key: publicKeyB64,
          capture_device_id: installId,
          timestamp,
          exif: shot.exif ?? null,
          gps,
          burst_id: burst.id,
          frame_index: i,
          frame_total: burstMode,
        };

        const signatureB64 = signSha256(hash, secretKey);

        const bundle: QueueItem = {
          user_id: userId,
          mediaUri: persistedUri,
          sha256: hash,
          credential: cred,
          signature: signatureB64,
          public_key: publicKeyB64,
          created_at: timestamp,
          anchor: { status: "pending" },
        };

        frames.push(bundle);
        await queueAdd(bundle);

        // Create draft with burst_id
        const remoteDraft = await createRemoteDraft({
          sha256: hash,
          credential_json: cred,
          device_id: installId,
          burst_id: burst.id,
        });
        if (!remoteDraft) {
          draftSyncFailures += 1;
          console.warn("draft upsert failed (non-fatal):", hash);
        }

        // Small delay between frames for multi-frame bursts
        if (i < burstMode - 1) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      setRecent(frames[0]);
      if (draftSyncFailures > 0) {
        Alert.alert(
          "Burst Captured",
          `${burstMode} frame${burstMode > 1 ? "s" : ""} signed & queued locally. Cloud draft sync failed for ${draftSyncFailures} frame${draftSyncFailures > 1 ? "s" : ""}.`
        );
      } else {
        Alert.alert(
          "Burst Captured",
          `${burstMode} frame${burstMode > 1 ? "s" : ""} signed & queued.`
        );
      }
      
    } catch (e: any) {
      console.error("[capture] takePhotoBurst failed:", e?.message ?? e);
      Alert.alert("Capture failed", e?.message ?? "Unknown error");
    } finally {
      setBusy(false);
    }
  }, [isReady, busy, burstMode, motionTrigger, captureFrame]);

  // Motion detection for auto-trigger
  useEffect(() => {
    if (!motionTrigger || busy || !isReady) return;

    DeviceMotion.setUpdateInterval(100);

    const subscription = DeviceMotion.addListener(({ acceleration }) => {
      if (!acceleration || busy) return;

      const magnitude = Math.sqrt(
        acceleration.x ** 2 +
        acceleration.y ** 2 +
        acceleration.z ** 2
      );

      const now = Date.now();
      if (magnitude > motionThreshold && now - lastTriggerTime.current > motionCooldown) {
        lastTriggerTime.current = now;
        void takePhotoBurst();
      }
    });

    return () => subscription.remove();
  }, [motionTrigger, busy, isReady, motionThreshold, motionCooldown, takePhotoBurst]);

  const takePhoto = useCallback(async () => {
    // Delegate to burst capture which handles both single and multi-frame
    return takePhotoBurst();
  }, [takePhotoBurst]);

  const flip = useCallback(() => setFacing((p) => (p === "back" ? "front" : "back")), []);

  if (!cameraPerm) {
    return <View style={{ flex: 1, backgroundColor: "#000" }} />;
  }

  if (!cameraPerm.granted) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32, backgroundColor: "#0a0e17" }}>
        <Text style={{ color: "#e8f0ff", fontSize: 20, fontWeight: "700", textAlign: "center", marginBottom: 12 }}>
          Camera Access Required
        </Text>
        <Text style={{ color: "#9ca3af", fontSize: 15, textAlign: "center", marginBottom: 32, lineHeight: 22 }}>
          ProofLens needs camera permission to capture and cryptographically sign photos.
        </Text>
        <Pressable 
          onPress={requestCameraPerm} 
          style={{ 
            backgroundColor: "#6366f1", 
            paddingVertical: 14, 
            paddingHorizontal: 24, 
            borderRadius: 12,
            shadowColor: "#6366f1",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
            elevation: 4,
          }}
        >
          <Text style={{ color: "white", fontWeight: "700", fontSize: 16 }}>Grant Permission</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <View style={{ width: "100%", aspectRatio: 3 / 4, backgroundColor: "#000", overflow: "hidden" }}>
          <CameraView
            ref={camRef}
            facing={facing}
            style={{ flex: 1 }}
            onCameraReady={onCameraReady}
            enableTorch={false}
          />
        </View>
      </View>

      {/* Burst Controls */}
      <View style={{ paddingVertical: 16, paddingHorizontal: 16, backgroundColor: "#0a0e17", borderTopWidth: 1, borderTopColor: "#1f2937" }}>
        {/* Burst Mode Slider */}
        <View style={{ marginBottom: 12 }}>
          <Text style={{ color: "#9ca3af", fontSize: 13, fontWeight: "600", marginBottom: 8 }}>
            Burst Frames: {burstMode}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {([1, 5, 10] as const).map(n => (
              <Pressable
                key={n}
                onPress={() => setBurstMode(n)}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  paddingHorizontal: 16,
                  backgroundColor: burstMode === n ? "#6366f1" : "#151b2b",
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: burstMode === n ? "#6366f1" : "#1f2937",
                  alignItems: "center",
                }}
              >
                <Text style={{ 
                  color: burstMode === n ? "#fff" : "#9ca3af", 
                  fontWeight: burstMode === n ? "700" : "600",
                  fontSize: 16
                }}>
                  {n}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Motion Trigger Toggle */}
        <View style={{ 
          flexDirection: "row", 
          alignItems: "center", 
          justifyContent: "space-between",
          paddingVertical: 12,
          paddingHorizontal: 16,
          backgroundColor: "#151b2b",
          borderRadius: 10,
          borderWidth: 1,
          borderColor: "#1f2937",
          marginBottom: 16,
        }}>
          <View>
            <Text style={{ color: "#e8f0ff", fontSize: 15, fontWeight: "600", marginBottom: 2 }}>
              Motion Trigger
            </Text>
            <Text style={{ color: "#6b7280", fontSize: 12 }}>
              Auto-capture on movement
            </Text>
          </View>
          <Switch
            value={motionTrigger}
            onValueChange={setMotionTrigger}
            trackColor={{ false: "#374151", true: "#6366f1" }}
            thumbColor="#fff"
          />
        </View>
      </View>

      {/* Action Bar */}
      <View style={{ paddingVertical: 20, paddingHorizontal: 16, backgroundColor: "#0a0e17" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Pressable 
            onPress={flip} 
            style={{ 
              padding: 14, 
              backgroundColor: "#151b2b", 
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#1f2937",
              minWidth: 80,
            }}
          >
            <Text style={{ color: "#e8f0ff", fontWeight: "600", textAlign: "center" }}>Flip</Text>
          </Pressable>

          <Pressable
            disabled={busy || !isReady}
            onPress={takePhoto}
            style={{
              width: 76,
              height: 76,
              borderRadius: 999,
              borderWidth: 4,
              borderColor: busy ? "#374151" : "#6366f1",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: busy ? "#1f2937" : "transparent",
            }}
          >
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 999,
                backgroundColor: busy ? "#374151" : "#6366f1",
              }}
            />
          </Pressable>

          <Pressable
            onPress={() => router.push("/recent")}
            style={{ 
              width: 64, 
              height: 64, 
              borderRadius: 12, 
              overflow: "hidden", 
              backgroundColor: "#151b2b",
              borderWidth: 1,
              borderColor: "#1f2937",
            }}
          >
            {recent?.mediaUri ? (
              <Image source={{ uri: recent.mediaUri }} style={{ width: "100%", height: "100%" }} />
            ) : (
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#6b7280", fontSize: 11, fontWeight: "600" }}>Recent</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}
