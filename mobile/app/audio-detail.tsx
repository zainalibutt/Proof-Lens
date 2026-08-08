import React, { useCallback, useMemo, useState } from "react";
import { View, Text, TouchableOpacity, SafeAreaView, Pressable, ScrollView } from "react-native";
import { useLocalSearchParams, useFocusEffect } from "expo-router";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { fetchAudioRecords } from "../lib/api";
import { audioLoad, audioUpdate, AudioRecord } from "../lib/audioStorage";

function formatMs(ms: number) {
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function AudioDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [record, setRecord] = useState<AudioRecord | null>(null);
  const [scrubWidth, setScrubWidth] = useState(0);

  const player = useAudioPlayer(
    record?.local_uri ? { uri: record.local_uri } : null,
    { updateInterval: 250 }
  );
  const playback = useAudioPlayerStatus(player);
  const isPlaying = playback.playing;
  const positionMs = playback.currentTime * 1000;
  const durationMs = playback.duration > 0
    ? playback.duration * 1000
    : (record?.duration_ms || 0);

  const progress = durationMs > 0 ? Math.min(positionMs / durationMs, 1) : 0;

  const loadRecord = useCallback(async () => {
    const items = await audioLoad();
    const local = items.find((a) => a.id === id) ?? null;
    if (local) setRecord(local);

    try {
      const remoteItems = await fetchAudioRecords();
      const remote = remoteItems.find((a: any) => a.id === id) ?? null;
      if (remote && local) {
        const merged: AudioRecord = {
          ...local,
          ...remote,
          duration_ms: (remote as any).duration_ms ?? remote.duration ?? local.duration_ms,
          tsa_token_base64: remote.tsa_token_base64 ?? local.tsa_token_base64,
          anchor_timestamp: remote.anchor_timestamp ?? local.anchor_timestamp,
          tsa_status: remote.tsa_status ?? local.tsa_status,
          s3_key: remote.s3_key ?? local.s3_key,
          title: remote.title ?? local.title,
          sha256: remote.sha256 ?? local.sha256,
        };
        setRecord(merged);
        await audioUpdate(local.id, {
          duration_ms: merged.duration_ms,
          tsa_token_base64: merged.tsa_token_base64 ?? null,
          anchor_timestamp: merged.anchor_timestamp ?? null,
          tsa_status: merged.tsa_status ?? null,
          s3_key: merged.s3_key ?? null,
          title: merged.title,
          sha256: merged.sha256,
        });
      }
    } catch {
      // ignore remote fetch
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadRecord();
    }, [loadRecord])
  );

  const togglePlay = async () => {
    if (!record?.local_uri) return;
    if (playback.playing) {
      player.pause();
    } else {
      if (playback.didJustFinish) await player.seekTo(0);
      player.play();
    }
  };

  const onSeek = async (x: number) => {
    if (!record?.local_uri || durationMs <= 0 || scrubWidth <= 0) return;
    const target = Math.min(Math.max(x / scrubWidth, 0), 1) * durationMs;
    await player.seekTo(target / 1000);
  };

  const details = useMemo(() => {
    if (!record) return [];
    return [
      { label: "SHA-256", value: record.sha256 },
      { label: "Device ID", value: record.device_id },
      { label: "GPS", value: record.gps ? JSON.stringify(record.gps) : "" },
      { label: "Signature", value: record.signature },
      { label: "TSA Token", value: record.tsa_token_base64 || "" },
      { label: "Anchoring", value: record.tsa_status || "" },
      { label: "TSA Time", value: record.anchor_timestamp || "" },
      { label: "S3 Key", value: record.s3_key || "" },
    ];
  }, [record]);

  if (!record) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0a0e17", justifyContent: "center", alignItems: "center" }}>
        <Text style={{ color: "#9ca3af" }}>Recording not found</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0a0e17" }}>
      <ScrollView contentContainerStyle={{ padding: 24 }}>
        <Text style={{ color: "white", fontSize: 24, fontWeight: "700" }}>{record.title}</Text>
        <Text style={{ color: "#9ca3af", marginTop: 6 }}>
          {formatMs(record.duration_ms)} · {new Date(record.created_at).toLocaleString()}
        </Text>

        <View style={{ marginTop: 24, padding: 16, backgroundColor: "#111827", borderRadius: 12, borderWidth: 1, borderColor: "#1f2937" }}>
          <TouchableOpacity
            onPress={togglePlay}
            style={{
              backgroundColor: "#6366f1",
              paddingVertical: 12,
              borderRadius: 10,
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <Text style={{ color: "white", fontWeight: "700" }}>{isPlaying ? "Pause" : "Play"}</Text>
          </TouchableOpacity>

          <Pressable
            onLayout={(e) => setScrubWidth(e.nativeEvent.layout.width)}
            onPress={(e) => onSeek(e.nativeEvent.locationX)}
            style={{ height: 12, backgroundColor: "#1f2937", borderRadius: 6, overflow: "hidden" }}
          >
            <View style={{ height: 12, width: `${progress * 100}%`, backgroundColor: "#6366f1" }} />
          </Pressable>

          <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 8 }}>
            <Text style={{ color: "#9ca3af", fontSize: 12 }}>{formatMs(positionMs)}</Text>
            <Text style={{ color: "#9ca3af", fontSize: 12 }}>{formatMs(durationMs)}</Text>
          </View>
        </View>

        <View style={{ marginTop: 24 }}>
          <Text style={{ color: "#e8f0ff", fontSize: 16, fontWeight: "700", marginBottom: 12 }}>
            Capture Details
          </Text>
          {details.map((d) => (
            <View key={d.label} style={{ marginBottom: 12, padding: 12, backgroundColor: "#111827", borderRadius: 10, borderWidth: 1, borderColor: "#1f2937" }}>
              <Text style={{ color: "#9ca3af", fontSize: 12, fontWeight: "600" }}>{d.label}</Text>
              <Text style={{ color: "#e8f0ff", fontSize: 13 }}>{d.value || "—"}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
