// mobile/app/_layout.tsx
import "react-native-url-polyfill/auto";
import { Stack, useRouter, usePathname } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import * as Linking from "expo-linking";
import { StyleSheet, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import { TutorialFlowProvider } from "../lib/tutorialFlow";

function resolveDeepLinkTarget(url: string): "/capture" | "/home" | null {
  const raw = String(url || "").trim();
  if (!raw) return null;

  // Only treat explicit app links as deep links.
  // Avoid matching plain web paths like http://localhost:8081/home.
  const allowedSchemes = ["prooflens://", "mobile://", "exp://"];
  const lower = raw.toLowerCase();
  if (!allowedSchemes.some((scheme) => lower.startsWith(scheme))) {
    return null;
  }

  const parsed = Linking.parse(raw);
  const path = String(parsed.path || "").toLowerCase().replace(/^\/+/, "");
  const host = String(parsed.hostname || "").toLowerCase();

  if (path === "capture" || host === "capture") return "/capture";
  if (path === "home" || host === "home") return "/home";
  return null;
}

export default function RootLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const [showLinkedHint, setShowLinkedHint] = useState(false);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      const authed = !!data.session;
      const atLogin = pathname === "/" || pathname === "" || pathname === undefined;

      // If not signed in, force them to the login screen
      if (mounted && !authed && !atLogin) {
        router.replace("/");
      }
    };

    init();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const authed = !!session;
      if (!authed) {
        // If they log out, always go back to login
        router.replace("/");
      }
      // When authed, your index screen will redirect to /home in its own effect
    });

    return () => {
      mounted = false;
      sub?.subscription?.unsubscribe?.();
    };
  }, [pathname, router]);

  useEffect(() => {
    const handleUrl = (url: string | null | undefined) => {
      const target = resolveDeepLinkTarget(String(url || ""));
      if (!target) return;

      router.replace(target);
      setShowLinkedHint(true);

      if (bannerTimerRef.current) {
        clearTimeout(bannerTimerRef.current);
      }
      bannerTimerRef.current = setTimeout(() => setShowLinkedHint(false), 3200);
    };

    Linking.getInitialURL().then(handleUrl).catch(() => {
      // ignore deep-link bootstrap failures
    });

    const sub = Linking.addEventListener("url", (event) => {
      handleUrl(event.url);
    });

    return () => {
      sub.remove();
      if (bannerTimerRef.current) {
        clearTimeout(bannerTimerRef.current);
      }
    };
  }, [router]);

  return (
    <TutorialFlowProvider>
      {showLinkedHint ? (
        <View style={styles.deepLinkBanner} pointerEvents="none">
          <Text style={styles.deepLinkBannerText}>You are ready to capture secure evidence.</Text>
        </View>
      ) : null}
      <Stack screenOptions={{ headerShown: false }} />
    </TutorialFlowProvider>
  );
}

const styles = StyleSheet.create({
  deepLinkBanner: {
    position: "absolute",
    top: 58,
    left: 16,
    right: 16,
    zIndex: 1000,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(129, 140, 248, 0.5)",
    backgroundColor: "rgba(30, 41, 59, 0.92)",
  },
  deepLinkBannerText: {
    color: "#e5e7eb",
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
    letterSpacing: 0.2,
  },
});
