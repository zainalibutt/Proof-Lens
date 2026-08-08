import React from "react";
import StatusBadge from "./StatusBadge";
import { Image, Layers, Music, Hash } from "lucide-react";

interface CaptureCardProps {
  id: string;
  status: string;
  timestamp?: string | null;
  type?: "single" | "burst" | "audio";
  label?: string;
  sublabel?: string;
  selected?: boolean;
  onClick?: () => void;
  frameIndex?: number;
  thumbnailUrl?: string | null;
}

const typeConfig = {
  single: { Icon: Image, label: "Single" },
  burst: { Icon: Layers, label: "Burst" },
  audio: { Icon: Music, label: "Audio" },
};

export default function CaptureCard({
  id,
  status,
  timestamp,
  type = "single",
  label,
  sublabel,
  selected = false,
  onClick,
  frameIndex,
  thumbnailUrl,
}: CaptureCardProps) {
  const shortId = id ? `${id.slice(0, 8)}…` : "";
  const { Icon: TypeIcon, label: typeLabel } = typeConfig[type] ?? typeConfig.single;

  return (
    <button
      className={`capture-card ${selected ? "capture-card--selected" : ""}`}
      onClick={onClick}
      type="button"
    >
      {/* Thumbnail preview */}
      {thumbnailUrl && (
        <div className="capture-card__thumb">
          <img src={thumbnailUrl} alt="" loading="lazy" />
        </div>
      )}

      <div className="capture-card__header">
        <StatusBadge status={status} label={frameIndex !== undefined ? `${status} #${frameIndex}` : undefined} size="sm" />
        <span className="capture-card__type">
          <TypeIcon size={12} strokeWidth={2} />
          {typeLabel}
        </span>
      </div>

      {label && <div className="capture-card__label">{label}</div>}
      {sublabel && <div className="capture-card__sublabel">{sublabel}</div>}

      <div className="capture-card__footer">
        <span className="capture-card__hash">
          <Hash size={10} strokeWidth={2} style={{ opacity: 0.5 }} />
          {shortId}
        </span>
        {timestamp && (
          <span className="capture-card__time">
            {new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
      </div>
    </button>
  );
}
