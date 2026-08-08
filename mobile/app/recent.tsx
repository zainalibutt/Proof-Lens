import { useCallback, useMemo, useState } from "react";
import { View, Text, Image, ScrollView, ActivityIndicator, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { queueLoad, QueueItem } from "../lib/storage";
import { audioLoad, AudioRecord } from "../lib/audioStorage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";

type Row = QueueItem & { idx: number };

type BurstGroup = {
  burst_id: string;
  frames: Row[];
  mode: number;
  trigger: string;
  created_at: string;
};

export default function RecentScreen() {
  const [items, setItems] = useState<Row[] | null>(null);
  const [audioItems, setAudioItems] = useState<AudioRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedBurstId, setExpandedBurstId] = useState<string | null>(null);
  const [expandedFrameIdx, setExpandedFrameIdx] = useState<number | null>(null);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const arr = await queueLoad();
      const audioArr = await audioLoad();
      const userId = (await supabase.auth.getSession()).data.session?.user?.id ?? null;

      const scopedPhotos = arr.filter((it) => it.user_id && it.user_id === userId);
      const scopedAudio = audioArr.filter((it) => it.user_id && it.user_id === userId);
      
      // Filter to last 24 hours
      const now = Date.now();
      const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);
      
      const list = scopedPhotos
        .filter(it => {
          const t = new Date(it.created_at).getTime();
          return !isNaN(t) && t >= twentyFourHoursAgo;
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map((it, idx) => ({ ...it, idx }));
      
      setItems(list);

      const audioList = scopedAudio
        .filter(it => {
          const t = new Date(it.created_at).getTime();
          return !isNaN(t) && t >= twentyFourHoursAgo;
        })
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setAudioItems(audioList);
    } catch (e) {
      console.warn("recent load failed", e);
      setItems([]);
      setAudioItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Group items by burst_id
  const groupedData = useMemo(() => {
    if (!items) return { bursts: [], singles: [] };
    
    const bursts = new Map<string, Row[]>();
    const singles: Row[] = [];
    
    items.forEach(item => {
      const burstId = item.credential?.burst_id;
      if (burstId) {
        if (!bursts.has(burstId)) {
          bursts.set(burstId, []);
        }
        bursts.get(burstId)!.push(item);
      } else {
        singles.push(item);
      }
    });
    
    // Convert to array and sort frames within bursts
    const burstGroups: BurstGroup[] = [];
    bursts.forEach((frames, burst_id) => {
      frames.sort((a, b) => {
        const aIdx = a.credential?.frame_index ?? 0;
        const bIdx = b.credential?.frame_index ?? 0;
        return aIdx - bIdx;
      });
      
      const first = frames[0];
      burstGroups.push({
        burst_id,
        frames,
        mode: first.credential?.frame_total ?? frames.length,
        trigger: first.credential?.trigger || 'manual',
        created_at: first.created_at,
      });
    });
    
    // Sort bursts by created_at
    burstGroups.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    
    return { bursts: burstGroups, singles };
  }, [items]);

  const content = useMemo(() => {
    if ((!items || items.length === 0) && (!audioItems || audioItems.length === 0)) {
      return (
        <View style={s.center}>
          <Text style={s.emptyTitle}>No recent captures</Text>
          <Text style={s.emptySub}>Photos from the last 24 hours will appear here</Text>
        </View>
      );
    }

    return (
      <ScrollView contentContainerStyle={s.container}>
        {/* Recent Audio */}
        {audioItems && audioItems.length > 0 && (
          <View style={s.block}>
            <Text style={s.sectionTitle}>Recent Audio</Text>
            {audioItems.map((a) => (
              <TouchableOpacity
                key={a.id}
                onPress={() => router.push({ pathname: "/audio-detail", params: { id: a.id } })}
                style={s.audioCard}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.audioTitle}>{a.title}</Text>
                  <Text style={s.meta}>{new Date(a.created_at).toLocaleString()}</Text>
                  <Text style={s.meta}>{Math.round((a.duration_ms || 0) / 1000)}s</Text>
                </View>
                <View style={s.badge}>
                  <Text style={s.badgeText}>{(a.tsa_status || "pending").toUpperCase()}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Bursts */}
        {groupedData.bursts.map((burst) => {
          const isBurstExpanded = expandedBurstId === burst.burst_id;
          
          return (
            <View key={burst.burst_id} style={s.block}>
              {/* Burst header */}
              <TouchableOpacity
                onPress={() => setExpandedBurstId(isBurstExpanded ? null : burst.burst_id)}
                style={s.burstHeader}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                    <Text style={s.burstTitle}>
                      {burst.mode === 1 ? "Single" : burst.mode === 5 ? "5-Frame Burst" : "10-Frame Burst"}
                    </Text>
                    <Text style={s.burstTrigger}>
                      {burst.trigger === 'motion' ? 'Motion' : 'Manual'}
                    </Text>
                  </View>
                  <Text style={s.meta}>
                    {new Date(burst.created_at).toLocaleString()}
                  </Text>
                  <Text style={s.frameCount}>
                    {burst.frames.length} frame{burst.frames.length > 1 ? 's' : ''}
                  </Text>
                </View>
                <Text style={{ color: "#9ca3af", fontSize: 18 }}>
                  {isBurstExpanded ? "−" : "+"}
                </Text>
              </TouchableOpacity>

              {/* Expanded frames */}
              {isBurstExpanded && (
                <View style={{ marginTop: 12 }}>
                  {burst.frames.map((frame) => {
                    const frameIdx = frame.credential?.frame_index ?? 0;
                    const isFrameExpanded = expandedFrameIdx === frame.idx;
                    
                    return (
                      <View key={frame.idx} style={s.frameBlock}>
                        {/* Frame preview */}
                        <TouchableOpacity
                          onPress={() => setExpandedFrameIdx(isFrameExpanded ? null : frame.idx)}
                        >
                          <View style={s.frameHeader}>
                            <View style={s.frameImageWrap}>
                              {!!frame.mediaUri && (
                                <Image
                                  source={{ uri: frame.mediaUri }}
                                  style={s.frameImage}
                                  resizeMode="cover"
                                />
                              )}
                            </View>
                            <View style={{ flex: 1, marginLeft: 12 }}>
                              <Text style={s.frameTitle}>Frame {frameIdx + 1}</Text>
                              <Text style={s.meta}>
                                {new Date(frame.created_at).toLocaleString()}
                              </Text>
                            </View>
                            <Text style={{ color: "#9ca3af", fontSize: 16 }}>
                              {isFrameExpanded ? "−" : "+"}
                            </Text>
                          </View>
                        </TouchableOpacity>

                        {/* Expanded frame details */}
                        {isFrameExpanded && (
                          <>
                            {!!frame.mediaUri && (
                              <View style={s.imageWrap}>
                                <Image
                                  source={{ uri: frame.mediaUri }}
                                  style={s.image}
                                  resizeMode="cover"
                                />
                              </View>
                            )}
                            
                            <View style={s.card}>
                              <Text style={s.title}>SHA-256 Hash</Text>
                              <Text selectable style={s.meta}>{frame.sha256}</Text>
                            </View>

                            {frame.credential?.gps && (
                              <View style={s.card}>
                                <Text style={s.title}>GPS Location</Text>
                                <Text style={s.meta}>
                                  {frame.credential.gps.lat.toFixed(6)}, {frame.credential.gps.lon.toFixed(6)}
                                </Text>
                                <Text style={s.meta}>
                                  Accuracy: {frame.credential.gps.accuracy?.toFixed(1)}m | Altitude: {frame.credential.gps.altitude?.toFixed(1)}m
                                </Text>
                              </View>
                            )}

                            <View style={s.card}>
                              <Text style={s.title}>Cryptographic Signature</Text>
                              <Text selectable style={s.meta} numberOfLines={2}>{frame.signature}</Text>
                            </View>

                            <View style={s.card}>
                              <Text style={s.title}>Anchor Status</Text>
                              <Text style={[s.meta, { color: frame.anchor.status === "anchored" ? "#10b981" : "#fbbf24" }]}>
                                {frame.anchor.status.toUpperCase()}
                              </Text>
                              {frame.anchor.anchored_at && (
                                <Text style={s.meta}>
                                  Anchored: {new Date(frame.anchor.anchored_at).toLocaleString()}
                                </Text>
                              )}
                            </View>
                          </>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}

        {/* Singles (non-burst captures) */}
        {groupedData.singles.map((it) => {
          const isExpanded = expandedFrameIdx === it.idx;
          return (
            <View key={`${it.sha256}-${it.idx}`} style={s.block}>
              {/* 4:3 image preview container */}
              <View style={s.imageWrap}>
                {!!it.mediaUri && (
                  <Image
                    source={{ uri: it.mediaUri }}
                    style={s.image}
                    resizeMode="cover"
                  />
                )}
              </View>
              <View style={s.card}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <Text style={s.title}>Capture Info</Text>
                  <TouchableOpacity
                    onPress={() => setExpandedFrameIdx(isExpanded ? null : it.idx)}
                    style={{
                      backgroundColor: "#1f2937",
                      paddingVertical: 6,
                      paddingHorizontal: 12,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: "#374151",
                    }}
                  >
                    <Text style={{ color: "#e8f0ff", fontSize: 13, fontWeight: "600" }}>
                      {isExpanded ? "Hide Details" : "View Details"}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={s.meta}>
                  {new Date(it.created_at).toLocaleString()}
                </Text>
              </View>

              {/* Expandable metadata */}
              {isExpanded && (
                <>
                  <View style={s.card}>
                    <Text style={s.title}>SHA-256 Hash</Text>
                    <Text selectable style={s.meta}>{it.sha256}</Text>
                  </View>

                  {it.credential?.gps && (
                    <View style={s.card}>
                      <Text style={s.title}>GPS Location</Text>
                      <Text style={s.meta}>
                        {it.credential.gps.lat.toFixed(6)}, {it.credential.gps.lon.toFixed(6)}
                      </Text>
                      <Text style={s.meta}>
                        Accuracy: {it.credential.gps.accuracy?.toFixed(1)}m | Altitude: {it.credential.gps.altitude?.toFixed(1)}m
                      </Text>
                    </View>
                  )}

                  <View style={s.card}>
                    <Text style={s.title}>Cryptographic Signature</Text>
                    <Text selectable style={s.meta} numberOfLines={2}>{it.signature}</Text>
                  </View>

                  <View style={s.card}>
                    <Text style={s.title}>Anchor Status</Text>
                    <Text style={[s.meta, { color: it.anchor.status === "anchored" ? "#10b981" : "#fbbf24" }]}>
                      {it.anchor.status.toUpperCase()}
                    </Text>
                    {it.anchor.anchored_at && (
                      <Text style={s.meta}>
                        Anchored: {new Date(it.anchor.anchored_at).toLocaleString()}
                      </Text>
                    )}
                  </View>
                </>
              )}
            </View>
          );
        })}
      </ScrollView>
    );
  }, [items, audioItems, groupedData, expandedBurstId, expandedFrameIdx, router]);

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.headerTitle}>Recent</Text>
        <Text style={s.headerSub}>Last 24 hours</Text>
      </View>
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color="#7C9CFF" />
        </View>
      ) : (
        content
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#0a0e17",
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  headerTitle: {
    color: "white",
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  headerSub: {
    color: "#9ca3af",
    marginTop: 4,
    fontSize: 14,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  emptyTitle: {
    color: "#e8f0ff",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  emptySub: {
    color: "#6b7280",
    fontSize: 14,
    textAlign: "center",
  },
  container: {
    padding: 16,
  },
  block: {
    marginBottom: 24,
  },
  burstHeader: {
    backgroundColor: "#151b2b",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#1f2937",
    flexDirection: "row",
    alignItems: "center",
  },
  burstTitle: {
    color: "white",
    fontSize: 16,
    fontWeight: "700",
    marginRight: 8,
  },
  burstTrigger: {
    color: "#9ca3af",
    fontSize: 13,
  },
  frameCount: {
    color: "#6b7280",
    fontSize: 12,
    marginTop: 4,
  },
  frameBlock: {
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  frameHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  frameImageWrap: {
    width: 60,
    height: 60,
    backgroundColor: "#1f2937",
    borderRadius: 8,
    overflow: "hidden",
  },
  frameImage: {
    width: "100%",
    height: "100%",
  },
  frameTitle: {
    color: "#e8f0ff",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  imageWrap: {
    width: "100%",
    aspectRatio: 4 / 3,
    backgroundColor: "#1f2937",
    borderRadius: 12,
    overflow: "hidden",
    marginTop: 12,
  },
  image: {
    width: "100%",
    height: "100%",
  },
  card: {
    backgroundColor: "#151b2b",
    borderRadius: 12,
    padding: 14,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  title: {
    color: "white",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 6,
  },
  meta: {
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 18,
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
  },
  sectionTitle: {
    color: "#e8f0ff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 12,
  },
  audioCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#151b2b",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1f2937",
    marginBottom: 10,
  },
  audioTitle: {
    color: "#e8f0ff",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4,
  },
  badge: {
    backgroundColor: "#111827",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  badgeText: {
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: "700",
  },
});
