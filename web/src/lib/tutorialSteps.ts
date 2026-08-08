import { WebTutorialStep } from "../components/TutorialOverlay";

/**
 * Web dashboard walkthrough steps.
 * targetSelector uses CSS selectors to highlight existing DOM elements.
 */
export const webTutorialSteps: WebTutorialStep[] = [
  {
    id: "welcome",
    title: "Welcome to ProofLens",
    description:
      "This guide walks you through the web dashboard. ProofLens lets you verify, manage, and share cryptographically signed captures and audio evidence.",
    position: "center",
  },
  {
    id: "verify-upload",
    title: "Verify Upload",
    description:
      "Drag & drop any photo here to verify its authenticity. The system computes a SHA-256 hash and checks it against your signed, timestamped capture records.",
    targetSelector: "[data-tutorial='verify-upload-title']",
    position: "bottom",
  },
  {
    id: "captures-tabs",
    title: "Your Captures",
    description:
      "Switch between Bursts, All Frames, and Audio tabs to browse your verified evidence. Each item shows its anchoring status and timestamp.",
    targetSelector: "[data-tutorial='captures-title']",
    position: "bottom",
  },
  {
    id: "evidence-panel",
    title: "Verification Results",
    description:
      "After verifying a file, the evidence panel shows the full cryptographic proof \u2014 integrity verification, signature validity, and timestamp anchor status with detailed explanations.",
    position: "center",
  },
  {
    id: "share-link",
    title: "Share Evidence",
    description:
      "Create a time-limited share link for any capture. Recipients can independently verify the file without needing an account.",
    position: "center",
  },
  {
    id: "done",
    title: "You're All Set!",
    description:
      "Reopen this guide anytime using the 'Guide' button in the header. Explore the dashboard and verify your evidence.",
    position: "center",
  },
];
