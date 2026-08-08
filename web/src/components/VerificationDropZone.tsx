import React, { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck, Upload, FileCheck, X } from "lucide-react";

interface VerificationDropZoneProps {
  accept: string;
  file: File | null;
  onFile: (f: File | null) => void;
  label?: string;
  busy?: boolean;
}

const VERIFY_STEPS = [
  "Computing SHA-256 hash…",
  "Checking credentials…",
  "Verifying signature…",
  "Validating timestamp anchor…",
];

export default function VerificationDropZone({
  accept,
  file,
  onFile,
  label,
  busy = false,
}: VerificationDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [stepIdx, setStepIdx] = useState(0);

  // Cycle through verification steps while busy
  useEffect(() => {
    if (!busy) { setStepIdx(0); return; }
    const interval = setInterval(() => {
      setStepIdx((prev) => (prev + 1) % VERIFY_STEPS.length);
    }, 1200);
    return () => clearInterval(interval);
  }, [busy]);

  const handler = useCallback(
    (files: FileList | null) => {
      if (files && files.length > 0) onFile(files[0]);
    },
    [onFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      handler(e.dataTransfer.files);
    },
    [handler],
  );

  return (
    <div
      className={`vdz ${over ? "vdz--over" : ""} ${file ? "vdz--has-file" : ""} ${busy ? "vdz--busy" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      {/* Animated corner accents */}
      <div className="vdz__corner vdz__corner--tl" />
      <div className="vdz__corner vdz__corner--tr" />
      <div className="vdz__corner vdz__corner--bl" />
      <div className="vdz__corner vdz__corner--br" />

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => handler(e.target.files)}
      />

      {busy ? (
        <div className="vdz__busy">
          <div className="vdz__busy-ring">
            <div className="spinner" />
          </div>
          <div className="vdz__steps fade-in" key={stepIdx}>
            <span className="vdz__step-text">{VERIFY_STEPS[stepIdx]}</span>
          </div>
          <div className="vdz__step-dots">
            {VERIFY_STEPS.map((_, i) => (
              <span key={i} className={`vdz__step-dot ${i === stepIdx ? "vdz__step-dot--active" : ""} ${i < stepIdx ? "vdz__step-dot--done" : ""}`} />
            ))}
          </div>
        </div>
      ) : file ? (
        <div className="vdz__file">
          <div className="vdz__file-icon">
            <FileCheck size={24} strokeWidth={1.5} />
          </div>
          <div className="vdz__file-info">
            <span className="vdz__file-name">{file.name}</span>
            <span className="vdz__file-size">{(file.size / 1024).toFixed(1)} KB</span>
          </div>
          <button
            className="vdz__clear"
            onClick={(e) => {
              e.stopPropagation();
              onFile(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            type="button"
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
      ) : (
        <div className="vdz__prompt">
          <div className="vdz__shield">
            <ShieldCheck size={44} strokeWidth={1.2} />
          </div>
          <span className="vdz__label">{label ?? "Drag & drop a file here, or click to browse"}</span>
          <span className="vdz__hint">
            <Upload size={12} strokeWidth={2} style={{ display: "inline", verticalAlign: "-2px", marginRight: 4 }} />
            Cryptographic verification via SHA-256 hash matching
          </span>
        </div>
      )}
    </div>
  );
}
