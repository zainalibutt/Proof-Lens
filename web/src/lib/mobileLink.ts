type ExpoMode = "lan" | "tunnel" | "deep" | "none";

export type ExpoLinkInfo = {
  link: string | null;
  mode: ExpoMode;
  title: string;
  instructions: string[];
};

function normalizeHost(value: string): string {
  return value.trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

export function getExpoLink(): ExpoLinkInfo {
  const isDev = import.meta.env.DEV;
  const explicitDevUrl = String(import.meta.env.VITE_EXPO_DEV_URL || "").trim();
  const tunnelUrl = String(import.meta.env.VITE_EXPO_TUNNEL_URL || "").trim();
  const explicitHost = String(import.meta.env.VITE_EXPO_DEV_HOST || "").trim();
  const explicitPort = Number(import.meta.env.VITE_EXPO_DEV_PORT || 8081);
  const prodDeepLink = String(import.meta.env.VITE_EXPO_PROD_DEEP_LINK || "").trim();

  if (!isDev) {
    if (prodDeepLink) {
      return {
        link: prodDeepLink,
        mode: "deep",
        title: "Open ProofLens on Mobile",
        instructions: [
          "Install Expo Go or your dev build.",
          "Open the link on your phone to jump into capture flow.",
        ],
      };
    }

    return {
      link: null,
      mode: "none",
      title: "Continue on Mobile",
      instructions: [
        "Open Expo Go on your phone.",
        "Start the mobile app locally with LAN or tunnel and scan the QR there.",
      ],
    };
  }

  if (tunnelUrl) {
    return {
      link: tunnelUrl,
      mode: "tunnel",
      title: "Continue on Mobile",
      instructions: [
        "Scan the QR in Expo Go.",
        "Tunnel mode works even when your phone is on a different network.",
      ],
    };
  }

  if (explicitDevUrl) {
    return {
      link: explicitDevUrl,
      mode: "lan",
      title: "Continue on Mobile",
      instructions: [
        "Scan the QR in Expo Go.",
        "Use VITE_EXPO_DEV_URL to pin a known working Expo link.",
      ],
    };
  }

  const hostCandidate = explicitHost || (typeof window !== "undefined" ? window.location.hostname : "");
  const host = normalizeHost(hostCandidate);

  if (host && host !== "localhost" && host !== "127.0.0.1") {
    return {
      link: `exp://${host}:${explicitPort}`,
      mode: "lan",
      title: "Continue on Mobile",
      instructions: [
        "Phone and laptop must be on the same Wi-Fi.",
        "Open Expo Go and scan this QR.",
      ],
    };
  }

  return {
    link: null,
    mode: "none",
    title: "Continue on Mobile",
    instructions: [
      "Set VITE_EXPO_DEV_HOST to your laptop LAN IP (example: 192.168.1.42).",
      "Or set VITE_EXPO_DEV_URL / VITE_EXPO_TUNNEL_URL for direct QR linking.",
    ],
  };
}
