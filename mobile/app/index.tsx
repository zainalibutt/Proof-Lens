import React, { useEffect, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import Constants from "expo-constants";
import { Focus, Mail } from "lucide-react-native";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";
import { palette, radius } from "../lib/theme";

const PASSWORD_RESET_REDIRECT =
  process.env.EXPO_PUBLIC_WEB_BASE ||
  (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_WEB_BASE ||
  "https://proof-lens.vercel.app";

const goHome = (router: any) => router.replace("/home");

export default function FrontPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted && data.session) goHome(router);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) goHome(router);
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [router]);

  const onSignIn = async () => {
    if (!email || !password) return Alert.alert("Missing details", "Enter both email and password.");
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (error: any) {
      Alert.alert("Sign in failed", error.message || String(error));
    } finally {
      setLoading(false);
    }
  };

  const onSignUp = async () => {
    if (!email || !password) return Alert.alert("Missing details", "Enter both email and a new password.");
    try {
      setLoading(true);
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) throw error;
      Alert.alert("Check your inbox", "Confirm your email, then sign in.");
      setMode("signin");
    } catch (error: any) {
      Alert.alert("Sign up failed", error.message || String(error));
    } finally {
      setLoading(false);
    }
  };

  const onResetPassword = async () => {
    if (!email) return Alert.alert("Enter your email first");
    try {
      setLoading(true);
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: PASSWORD_RESET_REDIRECT });
      if (error) throw error;
      Alert.alert("Password reset", "Check your email for a reset link.");
    } catch (error: any) {
      Alert.alert("Reset error", error.message || String(error));
    } finally {
      setLoading(false);
    }
  };

  const onMagicLink = async () => {
    if (!email) return Alert.alert("Enter your email first");
    try {
      setLoading(true);
      const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
      if (error) throw error;
      Alert.alert("Magic link sent", "Check your inbox to sign in.");
    } catch (error: any) {
      Alert.alert("Magic link error", error.message || String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.select({ ios: "padding", android: undefined })} style={styles.flex}>
        <View style={styles.container}>
          <View style={styles.brandBlock}>
            <View style={styles.brandMark}><Focus color={palette.primary} size={30} strokeWidth={1.7} /></View>
            <Text style={styles.brand}>ProofLens</Text>
            <Text style={styles.tagline}>Capture proof. Verify independently.</Text>
          </View>

          <View style={styles.form}>
            <View>
              <Text style={styles.label}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                placeholder="you@example.com"
                placeholderTextColor={palette.textMuted}
                style={styles.input}
              />
            </View>

            <View>
              <Text style={styles.label}>Password</Text>
              <TextInput
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                placeholder={mode === "signin" ? "Your password" : "Create a password"}
                placeholderTextColor={palette.textMuted}
                style={styles.input}
                onSubmitEditing={mode === "signin" ? onSignIn : onSignUp}
              />
            </View>
          </View>

          {loading ? (
            <ActivityIndicator color={palette.primary} size="large" style={styles.loader} />
          ) : (
            <Pressable onPress={mode === "signin" ? onSignIn : onSignUp} style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonText}>{mode === "signin" ? "Sign in" : "Create account"}</Text>
            </Pressable>
          )}

          {mode === "signin" ? (
            <>
              <Pressable onPress={onResetPassword} style={styles.textButton}>
                <Text style={styles.textButtonLabel}>Forgot password?</Text>
              </Pressable>
              <Pressable onPress={onMagicLink} style={styles.magicButton}>
                <Mail color={palette.textSecondary} size={15} />
                <Text style={styles.magicButtonLabel}>Send me a magic link</Text>
              </Pressable>
              <View style={styles.switchRow}>
                <Text style={styles.switchCopy}>New to ProofLens?</Text>
                <Pressable onPress={() => setMode("signup")}><Text style={styles.switchAction}>Create an account</Text></Pressable>
              </View>
            </>
          ) : (
            <View style={styles.switchRow}>
              <Text style={styles.switchCopy}>Already have an account?</Text>
              <Pressable onPress={() => setMode("signin")}><Text style={styles.switchAction}>Sign in instead</Text></Pressable>
            </View>
          )}

          <Text style={styles.boundary}>ProofLens verifies provenance, not whether a scene itself was truthful.</Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: palette.background },
  container: { flex: 1, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 32 },
  brandBlock: { alignItems: "center", marginBottom: 46 },
  brandMark: { width: 68, height: 68, alignItems: "center", justifyContent: "center", borderRadius: radius.xl, backgroundColor: palette.primarySoft, borderWidth: 1, borderColor: palette.borderStrong, marginBottom: 18 },
  brand: { color: palette.text, fontSize: 30, fontWeight: "700", letterSpacing: -1 },
  tagline: { color: palette.textSecondary, fontSize: 14, marginTop: 8 },
  form: { gap: 16 },
  label: { color: palette.textSecondary, fontSize: 12, fontWeight: "600", marginBottom: 8 },
  input: { minHeight: 52, paddingHorizontal: 15, color: palette.text, fontSize: 15, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: radius.md },
  loader: { minHeight: 52, marginTop: 18 },
  primaryButton: { minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: palette.primary, marginTop: 18 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  pressed: { opacity: 0.82 },
  textButton: { alignItems: "center", paddingVertical: 14 },
  textButtonLabel: { color: palette.textSecondary, fontSize: 13 },
  magicButton: { minHeight: 46, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", borderRadius: radius.md, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  magicButtonLabel: { color: palette.textSecondary, fontSize: 13, fontWeight: "600" },
  switchRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 5, marginTop: 28 },
  switchCopy: { color: palette.textMuted, fontSize: 13 },
  switchAction: { color: palette.primary, fontSize: 13, fontWeight: "700" },
  boundary: { color: palette.textMuted, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 40, paddingHorizontal: 24 },
});
