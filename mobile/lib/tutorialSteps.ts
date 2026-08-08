import { TutorialStep } from "./TutorialOverlay";

/**
 * Mobile walkthrough steps — each step navigates to the relevant screen.
 */
export const mobileTutorialSteps: TutorialStep[] = [
  {
    id: "welcome",
    title: "Welcome to ProofLens",
    description:
      "This guide walks you through each screen. You'll see the actual pages as we go — tap Next to begin.",
  },
  {
    id: "capture",
    title: "Camera Capture",
    description:
      "This is the camera screen. Take a photo or burst sequence — each capture is SHA-256 hashed, signed with your device key, and submitted for timestamp anchoring as tamper-evident evidence.",
    route: "/capture",
  },
  {
    id: "audio",
    title: "Audio Recording",
    description:
      "Record audio evidence here. Recordings are cryptographically hashed and signed just like photos, creating verifiable audio proof.",
    route: "/audio-capture",
  },
  {
    id: "queue",
    title: "Upload Queue",
    description:
      "This screen shows your pending and submitted captures. Pending items get uploaded and submitted to an RFC 3161 timestamp authority (TSA).",
    route: "/queue",
  },
  {
    id: "recent",
    title: "Recent Captures",
    description:
      "Browse your last 24 hours of captures and audio, grouped by burst or individual frames.",
    route: "/recent",
  },
  {
    id: "web-dashboard",
    title: "Web Dashboard",
    description:
      "Use the web dashboard to verify captures, view evidence panels, and create share links. Access it from the home screen link.",
  },
  {
    id: "done",
    title: "You're All Set!",
    description:
      "Reopen this guide anytime from the home screen. Start creating tamper-evident records now.",
    route: "/home",
  },
];
