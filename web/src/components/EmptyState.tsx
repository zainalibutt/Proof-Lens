import React from "react";
import { Camera, Layers, Music, ShieldCheck } from "lucide-react";

interface EmptyStateProps {
  type?: "captures" | "bursts" | "audio" | "verification";
  title?: string;
  description?: string;
}

const configs = {
  captures: {
    Icon: Camera,
    title: "No captures yet",
    description: "Use the ProofLens mobile app to create verified captures. They will appear here once anchored.",
  },
  bursts: {
    Icon: Layers,
    title: "No bursts yet",
    description: "Use the mobile app to capture burst sequences. Completed bursts will appear here.",
  },
  audio: {
    Icon: Music,
    title: "No audio recordings yet",
    description: "Use the mobile app to record verified audio. Recordings will appear here once anchored.",
  },
  verification: {
    Icon: ShieldCheck,
    title: "No verified captures yet",
    description: "Upload a file above to verify its authenticity against your signed capture credentials.",
  },
};

export default function EmptyState({ type = "captures", title, description }: EmptyStateProps) {
  const config = configs[type];
  const { Icon } = config;

  return (
    <div className="empty-state fade-in">
      <div className="empty-state__icon-ring">
        <Icon size={32} strokeWidth={1.2} />
      </div>
      <h4 className="empty-state__title">{title ?? config.title}</h4>
      <p className="empty-state__desc">{description ?? config.description}</p>
    </div>
  );
}
