// mobile/app/index.tsx
import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
} from "react-native";
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "../lib/supabase";

const PASSWORD_RESET_REDIRECT =
  process.env.EXPO_PUBLIC_WEB_BASE ||
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_WEB_BASE ||
  "https://proof-lens.vercel.app";

const goHome = (router: any) => router.replace("/home");

async function probeAuth() {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      method: "GET",
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    console.warn("supabase /auth/v1/health:", r.status);
  } catch (e) {
    console.warn("supabase auth health failed:", e);
  }
}

export default function FrontPage() {
  const router = useRouter();

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(""); // user-defined pw
  const [loading, setLoading] = useState(false);

  // If already signed in, go straight to home
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      await probeAuth();

      const { data } = await supabase.auth.getSession();
      if (mounted && data.session) {
        goHome(router);
      }
    };

    init();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      if (session) {
        goHome(router);
      }
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [router]);

  const onSignIn = async () => {
    if (!email || !password) {
      return Alert.alert("Missing details", "Enter both email and password.");
    }
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      // onAuthStateChange will navigate on success
    } catch (e: any) {
      console.warn("[signin error]", e);
      Alert.alert("Sign in failed", e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const onSignUp = async () => {
    if (!email || !password) {
      return Alert.alert("Missing details", "Enter both email and a new password.");
    }
    try {
      setLoading(true);
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        console.warn("[signup error]", error);
        throw error;
      }

      // Optional: ping auth health after signup
      await probeAuth();

      Alert.alert("Check your inbox", "Confirm your email, then sign in.");
      setMode("signin");
    } catch (e: any) {
      console.warn("[signup catch]", e);
      Alert.alert("Sign up failed", e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const onResetPassword = async () => {
    if (!email) return Alert.alert("Enter your email first");
    try {
      setLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: PASSWORD_RESET_REDIRECT,
      });
      if (error) throw error;
      Alert.alert("Password reset", "Check your email for a reset link.");
    } catch (e: any) {
      Alert.alert("Reset error", e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const onMagicLink = async () => {
    if (!email) return Alert.alert("Enter your email first");
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
      if (error) throw error;
      Alert.alert("Magic link sent", "Check your inbox to sign in.");
    } catch (e: any) {
      Alert.alert("Magic link error", e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0a0e17" }}>
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: "padding", android: undefined })}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1, padding: 24, justifyContent: "center" }}>
          {/* Logo */}
          <View style={{ alignItems: "center", marginBottom: 48 }}>
            <View style={{ width: 80, height: 80, borderRadius: 20, backgroundColor: "#151b2b", alignItems: "center", justifyContent: "center", marginBottom: 16, borderWidth: 1, borderColor: "#1f2937" }}>
              <Image source={require("../assets/images/logo.png")} style={{ width: 60, height: 60 }} resizeMode="contain" />
            </View>
            <Text style={{ color: "white", fontSize: 32, fontWeight: "700", letterSpacing: -0.5 }}>
              ProofLens
            </Text>
            <Text style={{ color: "#9ca3af", fontSize: 15, marginTop: 8, textAlign: "center" }}>
              Cryptographic capture verification with timestamped evidence
            </Text>
          </View>

          <View style={{ gap: 16 }}>
            <View>
              <Text style={{ color: "#9ca3af", marginBottom: 8, fontSize: 14, fontWeight: "600" }}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="you@example.com"
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
            </View>

            <View>
              <Text style={{ color: "#9ca3af", marginBottom: 8, fontSize: 14, fontWeight: "600" }}>Password</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholder={mode === "signin" ? "Your password" : "Create a password"}
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
            </View>
          </View>

          <View style={{ height: 16 }} />

          {loading ? (
            <ActivityIndicator color="#6366f1" size="large" />
          ) : mode === "signin" ? (
            <>
              <TouchableOpacity
                onPress={onSignIn}
                style={{
                  backgroundColor: "#6366f1",
                  padding: 16,
                  borderRadius: 12,
                  alignItems: "center",
                  shadowColor: "#6366f1",
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                  elevation: 4,
                }}
              >
                <Text style={{ color: "white", fontWeight: "700", fontSize: 16 }}>Sign in</Text>
              </TouchableOpacity>

              <View style={{ height: 16 }} />

              <TouchableOpacity onPress={onResetPassword} style={{ padding: 8 }}>
                <Text style={{ color: "#9ca3af", textAlign: "center", fontSize: 14 }}>Forgot password?</Text>
              </TouchableOpacity>

              <View style={{ height: 8 }} />

              <TouchableOpacity onPress={onMagicLink} style={{ padding: 8 }}>
                <Text style={{ color: "#9ca3af", textAlign: "center", fontSize: 14 }}>
                  ✉️ Or send me a magic link
                </Text>
              </TouchableOpacity>

              <View style={{ height: 24 }} />

              <TouchableOpacity onPress={() => setMode("signup")} style={{ padding: 8 }}>
                <Text style={{ color: "#e8f0ff", textAlign: "center", fontSize: 15 }}>
                  New here? <Text style={{ color: "#818cf8", fontWeight: "600" }}>Create an account</Text>
                </Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity
                onPress={onSignUp}
                style={{
                  backgroundColor: "#10b981",
                  padding: 16,
                  borderRadius: 12,
                  alignItems: "center",
                  shadowColor: "#10b981",
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 8,
                  elevation: 4,
                }}
              >
                <Text style={{ color: "white", fontWeight: "700", fontSize: 16 }}>✨ Create account</Text>
              </TouchableOpacity>

              <View style={{ height: 24 }} />

              <TouchableOpacity onPress={() => setMode("signin")} style={{ padding: 8 }}>
                <Text style={{ color: "#e8f0ff", textAlign: "center", fontSize: 15 }}>
                  Already have an account?{" "}
                  <Text style={{ color: "#818cf8", fontWeight: "600" }}>Sign in instead</Text>
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
