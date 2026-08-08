import React from "react";
import { Image } from "lucide-react";
import StatusBadge from "./StatusBadge";

interface BurstFrame {
  id?: string;
  status?: string;
  timestamp?: string | null;
  media_key?: string | null;
  media_url?: string | null;
  metadata?: Record<string, any>;
  [key: string]: any;
}

interface BurstFrameStripProps {
  frames: BurstFrame[];
  selectedFrameId?: string | null;
  onFrameClick?: (frame: BurstFrame) => void;
}

export default function BurstFrameStrip({ frames, selectedFrameId, onFrameClick }: BurstFrameStripProps) {
  if (!frames.length) return null;

  return (
    <div className="burst-strip">
      <div className="burst-strip__scroll">
        {frames.map((frame, idx) => {
          const isSelected = frame.id === selectedFrameId;
          const thumbUrl = frame.media_url ?? null;

          return (
            <button
              key={frame.id ?? idx}
              type="button"
              className={`burst-strip__frame ${isSelected ? "burst-strip__frame--selected" : ""}`}
              onClick={() => onFrameClick?.(frame)}
              title={`Frame ${idx + 1}`}
            >
              {thumbUrl ? (
                <img src={thumbUrl} alt={`Frame ${idx + 1}`} className="burst-strip__thumb" loading="lazy" />
              ) : (
                <div className="burst-strip__placeholder">
                  <Image size={16} strokeWidth={1.5} />
                </div>
              )}
              <div className="burst-strip__idx">{idx + 1}</div>
              {isSelected && <div className="burst-strip__ring" />}
            </button>
          );
        })}
      </div>
      <div className="burst-strip__meta">
        <StatusBadge status="anchored" label={`${frames.length} frame${frames.length !== 1 ? "s" : ""}`} size="sm" />
      </div>
    </div>
  );
}
