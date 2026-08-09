import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  ScrollView,
  View,
  Text,
  Pressable,
  Linking,
  StyleSheet,
} from "react-native";
import Constants from "expo-constants";
import {
  ArrowUpRight,
  Camera,
  Clock3,
  FileCheck2,
  Fingerprint,
  Focus,
  HelpCircle,
  Inbox,
  LogOut,
  Mic,
} from "lucide-react-native";
import { supabase } from "../lib/supabase";
import { useRouter } from "expo-router";
import { useTutorialFlow } from "../lib/tutorialFlow";
import { palette, radius } from "../lib/theme";

const WEB_DASHBOARD_URL =
  process.env.EXPO_PUBLIC_WEB_BASE ||
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_WEB_BASE ||
  "https://proof-lens.vercel.app/";

const assurances = [
  { label: "File integrity", Icon: FileCheck2 },
  { label: "Device-linked", Icon: Fingerprint },
  { label: "Trusted time", Icon: Clock3 },
] as const;

export default function Home() {
  const router = useRouter();
  const { startTutorial } = useTutorialFlow();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}><Focus color={palette.primary} size={22} strokeWidth={1.8} /></View>
            <View style={styles.brandCopy}>
              <Text style={styles.brand}>ProofLens</Text>
              <Text style={styles.account} numberOfLines={1}>{email}</Text>
            </View>
          </View>
          <Pressable onPress={startTutorial} style={styles.iconButton} accessibilityLabel="Open guide">
            <HelpCircle color={palette.textSecondary} size={19} />
          </Pressable>
        </View>

        <View style={styles.intro}>
          <Text style={styles.eyebrow}>Cryptographic capture</Text>
          <Text style={styles.title}>Preserve the proof behind the file.</Text>
          <Text style={styles.description}>
            Capture media, sign it on this device and anchor the record with an independent timestamp.
          </Text>
        </View>

        <View style={styles.assuranceRow}>
          {assurances.map(({ label, Icon }) => (
            <View key={label} style={styles.assuranceItem}>
              <Icon color={palette.primary} size={17} />
              <Text style={styles.assuranceLabel}>{label}</Text>
            </View>
          ))}
        </View>

        <Pressable onPress={() => router.push("/capture")} style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}>
          <View style={styles.primaryActionIcon}><Camera color="#FFFFFF" size={22} /></View>
          <View style={styles.actionCopy}>
            <Text style={styles.primaryActionTitle}>Capture photo evidence</Text>
            <Text style={styles.primaryActionDetail}>Hash, sign and anchor automatically</Text>
          </View>
          <ArrowUpRight color="rgba(255,255,255,0.78)" size={19} />
        </Pressable>

        <View style={styles.secondaryGrid}>
          <Pressable onPress={() => router.push("/audio-capture")} style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}>
            <Mic color={palette.primary} size={20} />
            <Text style={styles.secondaryTitle}>Record audio</Text>
            <Text style={styles.secondaryDetail}>Same proof chain, for sound</Text>
          </Pressable>
          <Pressable onPress={() => router.push("/queue")} style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}>
            <Inbox color={palette.primary} size={20} />
            <Text style={styles.secondaryTitle}>Capture queue</Text>
            <Text style={styles.secondaryDetail}>Review pending and submitted proof</Text>
          </Pressable>
        </View>

        <View style={styles.boundary}>
          <Text style={styles.boundaryLabel}>Trust boundary</Text>
          <Text style={styles.boundaryText}>ProofLens verifies a file’s provenance. It does not prove that the scene itself was truthful.</Text>
        </View>

        <Pressable onPress={() => Linking.openURL(WEB_DASHBOARD_URL)} style={styles.webAction}>
          <Text style={styles.webActionText}>Open evidence library on the web</Text>
          <ArrowUpRight color={palette.textSecondary} size={18} />
        </Pressable>

        <Pressable
          onPress={async () => { await supabase.auth.signOut(); router.replace("/"); }}
          style={styles.signOut}
        >
          <LogOut color={palette.textMuted} size={15} />
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: palette.background },
  content: { padding: 22, paddingBottom: 40 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 44 },
  brandRow: { flexDirection: "row", alignItems: "center", flex: 1 },
  brandMark: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: palette.primarySoft, borderWidth: 1, borderColor: palette.borderStrong },
  brandCopy: { flex: 1, marginLeft: 12 },
  brand: { color: palette.text, fontSize: 19, fontWeight: "700", letterSpacing: -0.4 },
  account: { color: palette.textMuted, fontSize: 12, marginTop: 2 },
  iconButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  intro: { marginBottom: 24 },
  eyebrow: { color: palette.primary, fontSize: 11, fontWeight: "700", letterSpacing: 1.3, textTransform: "uppercase" },
  title: { color: palette.text, fontSize: 38, lineHeight: 41, fontWeight: "700", letterSpacing: -1.5, marginTop: 12 },
  description: { color: palette.textSecondary, fontSize: 14, lineHeight: 22, marginTop: 15, maxWidth: 340 },
  assuranceRow: { flexDirection: "row", borderTopWidth: 1, borderBottomWidth: 1, borderColor: palette.border, marginBottom: 24 },
  assuranceItem: { flex: 1, alignItems: "center", paddingVertical: 16, gap: 7 },
  assuranceLabel: { color: palette.textSecondary, fontSize: 10, fontWeight: "600", textAlign: "center" },
  primaryAction: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: radius.lg, backgroundColor: palette.primary, marginBottom: 12 },
  primaryActionIcon: { width: 42, height: 42, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  actionCopy: { flex: 1, marginLeft: 13 },
  primaryActionTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  primaryActionDetail: { color: "rgba(255,255,255,0.72)", fontSize: 11, marginTop: 4 },
  secondaryGrid: { flexDirection: "row", gap: 12 },
  secondaryAction: { flex: 1, minHeight: 140, padding: 16, borderRadius: radius.lg, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  secondaryTitle: { color: palette.text, fontSize: 14, fontWeight: "700", marginTop: 24 },
  secondaryDetail: { color: palette.textMuted, fontSize: 11, lineHeight: 16, marginTop: 6 },
  pressed: { opacity: 0.82 },
  boundary: { padding: 17, borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, marginTop: 20 },
  boundaryLabel: { color: palette.primary, fontSize: 10, fontWeight: "700", letterSpacing: 1.1, textTransform: "uppercase" },
  boundaryText: { color: palette.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 7 },
  webAction: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 18, borderBottomWidth: 1, borderColor: palette.border, marginTop: 16 },
  webActionText: { color: palette.text, fontSize: 13, fontWeight: "600" },
  signOut: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: 18 },
  signOutText: { color: palette.textMuted, fontSize: 13 },
});
