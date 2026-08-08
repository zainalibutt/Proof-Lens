import "react-native-get-random-values";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  SafeAreaView,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import * as Location from "expo-location";
import { decodeBase64 } from "tweetnacl-util";
import { v4 as uuidv4 } from "uuid";
import { sha256Hex, signSha256 } from "../lib/crypto";
import { getOrCreateKeypairB64 } from "../state/keypair";
import { getOrCreateInstallId } from "../lib/device";
import { audioAdd, audioLoad, AudioRecord } from "../lib/audioStorage";
import { supabase } from "../lib/supabase";
import { createAudioDraft, ensureDeviceKeyRegistered } from "../lib/api";

function formatMs(ms: number) {
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function AudioCaptureScreen() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [busy, setBusy] = useState(false);
  const [showRename, setShowRename] = useState(false);
  const [title, setTitle] = useState("");
  const [pendingRecord, setPendingRecord] = useState<AudioRecord | null>(null);
  const [recent, setRecent] = useState<AudioRecord | null>(null);

  const timerRef = useRef<any>(null);
  const startAtRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const loadRecent = useCallback(async () => {
    try {
      const arr = await audioLoad();
      const userId = (await supabase.auth.getSession()).data.session?.user?.id ?? null;
      const scoped = arr.filter((a) => a.user_id && a.user_id === userId);
      setRecent(scoped.length ? scoped[scoped.length - 1] : null);
    } catch {
      setRecent(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadRecent();
    }, [loadRecent])
  );

  const requestMic = async () => {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Microphone access required", "Enable microphone permission to record audio.");
      return false;
    }
    return true;
  };

  const startRecording = async () => {
    if (isRecording || busy) return;
    const ok = await requestMic();
    if (!ok) return;

    try {
      setBusy(true);
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
      setDurationMs(0);
      startAtRef.current = Date.now();
      timerRef.current = setInterval(() => {
        if (startAtRef.current) {
          setDurationMs(Date.now() - startAtRef.current);
        }
      }, 250);
    } catch (e: any) {
      Alert.alert("Recording failed", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const stopRecording = async () => {
    if (!isRecording) return;
    setBusy(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      const status = recorder.getStatus();
      const statusDuration = status.durationMillis;
      const fallbackDuration = durationMs;
      const duration = typeof statusDuration === "number" && statusDuration > 0
        ? statusDuration
        : fallbackDuration;

      if (!uri) throw new Error("recording_uri_missing");

      if (timerRef.current) clearInterval(timerRef.current);
      startAtRef.current = null;
      setIsRecording(false);
      setDurationMs(duration);

      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const bytes = decodeBase64(base64);
      const sha256 = sha256Hex(bytes);

      const { publicKeyB64, secretKey } = await getOrCreateKeypairB64();
      const installId = await getOrCreateInstallId();
      const userId = (await supabase.auth.getSession()).data.session?.user?.id ?? null;

      let gps: any = null;
      try {
        const svc = await Location.hasServicesEnabledAsync();
        const perm = await Location.getForegroundPermissionsAsync();
        if (svc && perm.granted) {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          gps = {
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            acc_m: pos.coords.accuracy ?? null,
            time: new Date(pos.timestamp).toISOString(),
          };
        }
      } catch {}

      const nowIso = new Date().toISOString();
      const dayCount = await getDefaultNameIndex();
      const defaultTitle = `New Recording (${dayCount})`;
      setTitle(defaultTitle);

      const audioId = uuidv4();

      const credential = {
        version: 1,
        schema: "alexander-alpha/credential@1",
        type: "audio",
        sha256,
        public_key: publicKeyB64,
        capture_device_id: installId,
        timestamp: nowIso,
        gps,
        duration_ms: duration,
        title: defaultTitle,
        audio_id: audioId,
      };

      const signatureB64 = signSha256(sha256, secretKey);

      const pending: AudioRecord = {
        id: audioId,
        user_id: userId,
        title: defaultTitle,
        created_at: nowIso,
        duration_ms: duration,
        device_id: installId,
        sha256,
        signature: signatureB64,
        gps,
        s3_key: null,
        tsa_status: "pending",
        anchor_timestamp: null,
        local_uri: uri,
        credential,
        public_key: publicKeyB64,
      };

      setPendingRecord(pending);
      setShowRename(true);
    } catch (e: any) {
      Alert.alert("Stop failed", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const getDefaultNameIndex = async () => {
    const arr = await audioLoad();
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const count = arr.filter((a) => {
      const t = Date.parse(a.created_at);
      return Number.isFinite(t) && t >= dayAgo;
    }).length;
    return count + 1;
  };

  const onConfirmTitle = async () => {
    if (!pendingRecord) return;
    const finalTitle = title.trim() || pendingRecord.title;

    setBusy(true);
    try {
      const { secretKey } = await getOrCreateKeypairB64();

      const signatureB64 = signSha256(pendingRecord.sha256, secretKey);
      const record: AudioRecord = {
        ...pendingRecord,
        title: finalTitle,
        signature: signatureB64,
        s3_key: null,
        tsa_status: "pending",
        anchor_timestamp: null,
        credential: {
          ...pendingRecord.credential,
          title: finalTitle,
        },
      };

      // Ensure device key is registered before creating draft
      await ensureDeviceKeyRegistered();

      // Create audio draft on backend (mirrors image draft flow)
      const remoteDraft = await createAudioDraft({
        credential: record.credential,
        sha256: record.sha256,
        duration_ms: record.duration_ms,
      });

      // Store locally as cache (with draft id if available)
      const localRecord: AudioRecord = {
        ...record,
        id: remoteDraft?.id ?? record.id,
      };
      await audioAdd(localRecord);
      setRecent(localRecord);
      setShowRename(false);
      setPendingRecord(null);

      if (remoteDraft) {
        Alert.alert("Saved", "Audio recording added to cloud queue.");
      } else {
        Alert.alert(
          "Saved Locally",
          "Cloud draft sync failed. This recording is in Queue as local-only pending."
        );
      }
    } catch (e: any) {
      Alert.alert("Save failed", e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#0a0e17" }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 80 : 0}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0a0e17" }}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24 }}>
          <Text style={{ color: "#e8f0ff", fontSize: 40, fontWeight: "700", marginBottom: 20 }}>
            {formatMs(durationMs)}
          </Text>

          <View style={{ flex: 1 }} />

          <View style={{ width: "100%", alignItems: "center" }}>
            <TouchableOpacity
              onPress={isRecording ? stopRecording : startRecording}
              disabled={busy}
              style={{
                width: 96,
                height: 96,
                borderRadius: 48,
                backgroundColor: isRecording ? "#ef4444" : "#6366f1",
                alignItems: "center",
                justifyContent: "center",
                shadowColor: isRecording ? "#ef4444" : "#6366f1",
                shadowOpacity: 0.4,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 6 },
                elevation: 6,
                marginBottom: 24,
              }}
            >
              <Text style={{ color: "white", fontWeight: "700", fontSize: 16 }}>
                {isRecording ? "Stop" : "Record"}
              </Text>
            </TouchableOpacity>

            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
              <TouchableOpacity
                onPress={() => router.push("/recent")}
                style={{
                  width: 96,
                  height: 64,
                  borderRadius: 12,
                  backgroundColor: "#151b2b",
                  borderWidth: 1,
                  borderColor: "#1f2937",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {recent ? (
                  <>
                    <Text style={{ color: "#e8f0ff", fontSize: 12, fontWeight: "700" }} numberOfLines={1}>
                      {recent.title}
                    </Text>
                    <Text style={{ color: "#9ca3af", fontSize: 10 }}>
                      {new Date(recent.created_at).toLocaleDateString()}
                    </Text>
                  </>
                ) : (
                  <Text style={{ color: "#6b7280", fontSize: 11, fontWeight: "600" }}>Recent</Text>
                )}
              </TouchableOpacity>

              <View style={{ width: 96 }} />
            </View>
          </View>

          {busy && <ActivityIndicator color="#9ca3af" style={{ marginTop: 12 }} />}

          {showRename && pendingRecord && (
            <View style={{ width: "100%", marginTop: 20 }}>
              <Text style={{ color: "#9ca3af", marginBottom: 8, fontSize: 14, fontWeight: "600" }}>
                Recording name
              </Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="New Recording"
                placeholderTextColor="#6b7280"
                style={{
                  backgroundColor: "#111827",
                  color: "white",
                  padding: 14,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#1f2937",
                  fontSize: 15,
                }}
              />
              <TouchableOpacity
                onPress={onConfirmTitle}
                disabled={busy}
                style={{
                  marginTop: 12,
                  backgroundColor: "#151b2b",
                  padding: 14,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#1f2937",
                }}
              >
                <Text style={{ color: "#e8f0ff", fontWeight: "700", textAlign: "center" }}>
                  Save Recording
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}
