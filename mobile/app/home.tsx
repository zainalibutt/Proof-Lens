import React, { useEffect, useState } from "react";
import { SafeAreaView, View, Text, TouchableOpacity, Image, Linking } from "react-native";
import Constants from "expo-constants";
import { supabase } from "../lib/supabase";
import { useRouter } from "expo-router";
import { useTutorialFlow } from "../lib/tutorialFlow";

const WEB_DASHBOARD_URL =
  process.env.EXPO_PUBLIC_WEB_BASE ||
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_WEB_BASE ||
  "https://proof-lens.vercel.app/";


export default function Home() {
  const router = useRouter();
  const { startTutorial } = useTutorialFlow();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0a0e17" }}>
      <View style={{ padding: 24 }}>
        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 32, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: "#1f2937" }}>
          <View style={{ width: 56, height: 56, borderRadius: 14, backgroundColor: "#151b2b", alignItems: "center", justifyContent: "center", marginRight: 16, borderWidth: 1, borderColor: "#1f2937" }}>
            <Image source={require("../assets/images/logo.png")} style={{ width: 42, height: 42 }} resizeMode="contain" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: "white", fontSize: 28, fontWeight: "700", letterSpacing: -0.5 }}>ProofLens</Text>
            <Text style={{ color: "#9ca3af", marginTop: 2, fontSize: 14 }}>{email}</Text>
          </View>
          <TouchableOpacity
            onPress={startTutorial}
            style={{
              paddingVertical: 8,
              paddingHorizontal: 14,
              backgroundColor: "#1e1b4b",
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "#312e81",
            }}
          >
            <Text style={{ color: "#a5b4fc", fontSize: 13, fontWeight: "600" }}>Guide</Text>
          </TouchableOpacity>
        </View>

        {/* System Overview */}
        <View style={{ marginBottom: 24 }}>
          <Text style={{ color: "#818cf8", fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
            Cryptographic Media Verification
          </Text>
          <Text style={{ color: "#8b95b0", fontSize: 13, lineHeight: 20, marginBottom: 16 }}>
            Capture, sign, timestamp-anchor, and verify media with end-to-end cryptographic integrity.
          </Text>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", paddingHorizontal: 4, marginBottom: 4 }}>
            {[
              { label: "Capture", num: "1" },
              { label: "Hash", num: "2" },
              { label: "Sign", num: "3" },
              { label: "Anchor", num: "4" },
              { label: "Verify", num: "5" },
            ].map((step, i, arr) => (
              <React.Fragment key={step.label}>
                <View style={{ alignItems: "center", gap: 6 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: "rgba(99, 102, 241, 0.15)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(99, 102, 241, 0.3)" }}>
                    <Text style={{ color: "#818cf8", fontSize: 12, fontWeight: "700" }}>{step.num}</Text>
                  </View>
                  <Text style={{ color: "#8b95b0", fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 }}>{step.label}</Text>
                </View>
                {i < arr.length - 1 && <View style={{ flex: 1, height: 2, backgroundColor: "#1f2937", marginTop: 15, marginHorizontal: 2 }} />}
              </React.Fragment>
            ))}
          </View>
        </View>

        {/* Actions */}
        <View style={{ gap: 16 }}>
          <TouchableOpacity 
            onPress={() => router.push("/capture")} 
            style={{ 
              backgroundColor: "#6366f1", 
              padding: 18, 
              borderRadius: 16, 
              shadowColor: "#6366f1",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.3,
              shadowRadius: 8,
              elevation: 4,
            }}
          >
            <Text style={{ color: "white", fontWeight: "700", textAlign: "center", fontSize: 16 }}>Open Camera</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            onPress={() => router.push("/audio-capture")} 
            style={{ 
              backgroundColor: "#151b2b", 
              padding: 18, 
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#1f2937",
            }}
          >
            <Text style={{ color: "#e8f0ff", fontWeight: "700", textAlign: "center", fontSize: 16 }}>Audio Recording</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            onPress={() => router.push("/queue")} 
            style={{ 
              backgroundColor: "#151b2b", 
              padding: 18, 
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#1f2937",
            }}
          >
            <Text style={{ color: "#e8f0ff", fontWeight: "700", textAlign: "center", fontSize: 16 }}>View Queue</Text>
          </TouchableOpacity>

          <View style={{ height: 24 }} />

          <TouchableOpacity
            onPress={() => Linking.openURL(WEB_DASHBOARD_URL)}
            style={{
              backgroundColor: "#151b2b",
              padding: 18,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#312e81",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <Text style={{ color: "#a5b4fc", fontWeight: "700", fontSize: 15 }}>Open Web Dashboard</Text>
          </TouchableOpacity>

          <View style={{ height: 8 }} />

          <TouchableOpacity 
            onPress={async () => { await supabase.auth.signOut(); router.replace("/"); }} 
            style={{ padding: 14 }}
          >
            <Text style={{ color: "#9ca3af", textAlign: "center", fontSize: 15 }}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}
