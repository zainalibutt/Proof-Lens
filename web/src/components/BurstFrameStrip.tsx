import { useState } from "react";
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
  const [failedFrames, setFailedFrames] = useState<Set<string>>(() => new Set());

  if (!frames.length) return null;

  return (
    <div className="burst-strip">
      <div className="burst-strip__scroll">
        {frames.map((frame, idx) => {
          const isSelected = frame.id === selectedFrameId;
          const thumbUrl = frame.media_url ?? null;
          const frameKey = frame.id ?? String(idx);
          const capturedAt = frame.timestamp ? new Date(frame.timestamp).toLocaleString() : "time unavailable";

          return (
            <button
              key={frame.id ?? idx}
              type="button"
              className={`burst-strip__frame ${isSelected ? "burst-strip__frame--selected" : ""}`}
              onClick={() => onFrameClick?.(frame)}
              title={`Frame ${idx + 1}`}
              aria-label={`Open frame ${idx + 1}, ${frame.status ?? "pending"}, captured ${capturedAt}`}
              aria-pressed={isSelected}
            >
              {thumbUrl && !failedFrames.has(frameKey) ? (
                <img
                  src={thumbUrl}
                  alt={`Frame ${idx + 1}, captured ${capturedAt}`}
                  className="burst-strip__thumb"
                  loading="lazy"
                  decoding="async"
                  onError={() => setFailedFrames((current) => new Set(current).add(frameKey))}
                />
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
