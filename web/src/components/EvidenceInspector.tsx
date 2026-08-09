import { useEffect, useState, type ReactNode } from "react";
import {
  Anchor,
  ChevronDown,
  Clock,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileKey,
  FileText,
  Hash,
  ImageOff,
  Music,
  Share2,
  Shield,
  Smartphone,
  X,
} from "lucide-react";
import StatusBadge from "./StatusBadge";

type EvidenceRecord = Record<string, any>;

interface EvidenceInspectorProps {
  capture: EvidenceRecord | null;
  audio: EvidenceRecord | null;
  mediaUrl: string | null;
  tsrUrl: string | null;
  audioUrl: string | null;
  shareUrl: string | null;
  shareExpiresAt: string | null;
  shareBusy: boolean;
  shareError: string | null;
  bundleBusy: boolean;
  bundleError: string | null;
  audioShareUrl: string | null;
  audioShareExpiresAt: string | null;
  audioShareBusy: boolean;
  audioShareError: string | null;
  audioBundleBusy: boolean;
  audioBundleError: string | null;
  onCreateShare: () => void;
  onCopyShare: () => void;
  onDownloadBundle: () => void;
  onCreateAudioShare: () => void;
  onCopyAudioShare: () => void;
  onDownloadAudioBundle: () => void;
  onClose: () => void;
}

function formatValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function MetaItem({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="detail-panel__meta-item">
      {icon}
      <span className="detail-panel__meta-label">{label}</span>
      <span className="detail-panel__meta-value">{children}</span>
    </div>
  );
}

function RawCredential({ value }: { value: EvidenceRecord }) {
  return (
    <details className="raw-json-details">
      <summary className="raw-json-summary">
        <Code2 size={13} strokeWidth={2} /> Technical details
        <ChevronDown size={13} strokeWidth={2} className="raw-json-chevron" />
      </summary>
      <div className="kv-list fade-in">
        {Object.entries(value).map(([key, item]) => (
          <div key={key} className="kv-row">
            <div className="kv-key">{key}</div>
            <div className="kv-value">{formatValue(item)}</div>
          </div>
        ))}
      </div>
    </details>
  );
}

export default function EvidenceInspector(props: EvidenceInspectorProps) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const selected = props.capture ?? props.audio;

  useEffect(() => {
    setPreviewFailed(false);
  }, [props.capture?.id, props.mediaUrl]);

  if (!selected) {
    return (
      <div className="evidence-inspector__empty">
        <FileKey size={26} strokeWidth={1.5} />
        <h3>Select evidence to inspect</h3>
        <p>Open a capture or recording to review its media, cryptographic status and export actions.</p>
      </div>
    );
  }

  if (props.capture) {
    const capture = props.capture;
    const identifier = capture.id || capture.sha256 || "Capture";

    return (
      <div className="evidence-inspector__content fade-in">
        <div className="evidence-inspector__topbar">
          <div>
            <span className="evidence-inspector__eyebrow">Selected capture</span>
            <h3>Capture details</h3>
          </div>
          <button className="evidence-inspector__close" onClick={props.onClose} type="button" aria-label="Close evidence details">
            <X size={18} />
          </button>
        </div>

        <div className="mono small evidence-inspector__id">{identifier}</div>

        <div className="evidence-inspector__actions">
          <button className="secondary" onClick={props.onCreateShare} disabled={props.shareBusy}>
            <Share2 size={14} /> {props.shareBusy ? "Creating…" : "Share"}
          </button>
          <button className="secondary" onClick={props.onDownloadBundle} disabled={props.bundleBusy}>
            <Download size={14} /> {props.bundleBusy ? "Preparing…" : "Bundle"}
          </button>
          {props.mediaUrl && (
            <a className="secondary evidence-inspector__link" href={props.mediaUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Original
            </a>
          )}
          {props.tsrUrl && (
            <a className="secondary evidence-inspector__link" href={props.tsrUrl} target="_blank" rel="noreferrer">
              <FileText size={14} /> Timestamp
            </a>
          )}
        </div>

        {props.mediaUrl && !previewFailed ? (
          <div className="detail-panel__preview">
            <img
              src={props.mediaUrl}
              alt={`Evidence captured ${capture.timestamp ? new Date(capture.timestamp).toLocaleString() : "at an unknown time"}`}
              decoding="async"
              onError={() => setPreviewFailed(true)}
            />
          </div>
        ) : (
          <div className="detail-panel__preview detail-panel__preview--unavailable" role="status">
            <ImageOff size={24} />
            <strong>Preview unavailable</strong>
            <span>The original remains protected. Refresh after storage access is restored.</span>
          </div>
        )}

        <div className="detail-panel__meta">
          {capture.timestamp && (
            <MetaItem icon={<Clock size={13} />} label="Captured">
              {new Date(capture.timestamp).toLocaleString()}
            </MetaItem>
          )}
          {capture.device_id && (
            <MetaItem icon={<Smartphone size={13} />} label="Device">
              <span className="font-mono">{capture.device_id}</span>
            </MetaItem>
          )}
          {capture.sha256 && (
            <MetaItem icon={<Hash size={13} />} label="SHA-256">
              <span className="font-mono evidence-inspector__hash">{capture.sha256}</span>
            </MetaItem>
          )}
          {(capture.tsa_time || capture.anchor_timestamp) && (
            <MetaItem icon={<Anchor size={13} />} label="Anchored">
              {new Date(capture.tsa_time || capture.anchor_timestamp).toLocaleString()}
            </MetaItem>
          )}
          {capture.status && (
            <MetaItem icon={<Shield size={13} />} label="Status">
              <StatusBadge status={capture.status} size="sm" />
            </MetaItem>
          )}
        </div>

        {props.bundleError && <div className="alert error">{props.bundleError}</div>}
        {props.shareError && <div className="alert error">{props.shareError}</div>}
        {props.shareUrl && (
          <div className="result evidence-inspector__share-result">
            <strong>Verification link ready</strong>
            <div className="mono">{props.shareUrl}</div>
            <button className="secondary" onClick={props.onCopyShare}>
              <Copy size={14} /> Copy link
            </button>
            {props.shareExpiresAt && <span className="muted">Expires {new Date(props.shareExpiresAt).toLocaleString()}</span>}
          </div>
        )}

        <RawCredential value={capture} />
      </div>
    );
  }

  const audio = props.audio!;

  return (
    <div className="evidence-inspector__content fade-in">
      <div className="evidence-inspector__topbar">
        <div>
          <span className="evidence-inspector__eyebrow">Selected recording</span>
          <h3>{audio.title || "Audio evidence"}</h3>
        </div>
        <button className="evidence-inspector__close" onClick={props.onClose} type="button" aria-label="Close evidence details">
          <X size={18} />
        </button>
      </div>

      <div className="mono small evidence-inspector__id">{audio.id || "Audio evidence"}</div>

      <div className="evidence-inspector__actions">
        <button className="secondary" onClick={props.onCreateAudioShare} disabled={props.audioShareBusy}>
          <Share2 size={14} /> {props.audioShareBusy ? "Creating…" : "Share"}
        </button>
        <button className="secondary" onClick={props.onDownloadAudioBundle} disabled={props.audioBundleBusy}>
          <Download size={14} /> {props.audioBundleBusy ? "Preparing…" : "Bundle"}
        </button>
        {props.audioUrl && (
          <a className="secondary evidence-inspector__link" href={props.audioUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> Original
          </a>
        )}
      </div>

      {props.audioUrl ? (
        <div className="audio-preview">
          <audio controls src={props.audioUrl} preload="metadata" />
        </div>
      ) : (
        <div className="detail-panel__preview detail-panel__preview--unavailable" role="status">
          <Music size={24} />
          <strong>Audio preview unavailable</strong>
        </div>
      )}

      <div className="detail-panel__meta">
        {audio.created_at && <MetaItem icon={<Clock size={13} />} label="Created">{new Date(audio.created_at).toLocaleString()}</MetaItem>}
        {audio.device_id && <MetaItem icon={<Smartphone size={13} />} label="Device"><span className="font-mono">{audio.device_id}</span></MetaItem>}
        {audio.sha256 && <MetaItem icon={<Hash size={13} />} label="SHA-256"><span className="font-mono evidence-inspector__hash">{audio.sha256}</span></MetaItem>}
        {audio.anchor_timestamp && <MetaItem icon={<Anchor size={13} />} label="Anchored">{new Date(audio.anchor_timestamp).toLocaleString()}</MetaItem>}
        {audio.tsa_status && <MetaItem icon={<Shield size={13} />} label="Status"><StatusBadge status={audio.tsa_status} size="sm" /></MetaItem>}
      </div>

      {props.audioBundleError && <div className="alert error">{props.audioBundleError}</div>}
      {props.audioShareError && <div className="alert error">{props.audioShareError}</div>}
      {props.audioShareUrl && (
        <div className="result evidence-inspector__share-result">
          <strong>Verification link ready</strong>
          <div className="mono">{props.audioShareUrl}</div>
          <button className="secondary" onClick={props.onCopyAudioShare}><Copy size={14} /> Copy link</button>
          {props.audioShareExpiresAt && <span className="muted">Expires {new Date(props.audioShareExpiresAt).toLocaleString()}</span>}
        </div>
      )}

      <RawCredential value={audio} />
    </div>
  );
}
