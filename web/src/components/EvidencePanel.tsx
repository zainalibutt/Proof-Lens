import React, { useState } from "react";
import {
  ShieldCheck,
  ShieldX,
  CheckCircle2,
  XCircle,
  Download,
  Clock,
  Smartphone,
  Hash,
  FileKey,
  Anchor,
  ChevronDown,
  ChevronUp,
  Code2,
} from "lucide-react";

interface EvidencePanelProps {
  result: any;
  isShare?: boolean;
  sha256?: string;
  bundleToken?: string;
  onDownloadBundle?: () => void;
  bundleBusy?: boolean;
  bundleError?: string | null;
}

function Row({ label, value, mono, icon }: { label: string; value: React.ReactNode; mono?: boolean; icon?: React.ReactNode }) {
  return (
    <div className="ep__row">
      <span className="ep__label">
        {icon && <span className="ep__label-icon">{icon}</span>}
        {label}
      </span>
      <span className={`ep__value ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function ProofIndicator({ label, valid, description }: { label: string; valid: boolean; description?: string }) {
  return (
    <div className={`ep__proof ${valid ? "ep__proof--valid" : "ep__proof--invalid"}`}>
      <div className="ep__proof-main">
        <span className="ep__proof-icon">
          {valid ? <CheckCircle2 size={14} strokeWidth={2.5} /> : <XCircle size={14} strokeWidth={2.5} />}
        </span>
        <span>{label}</span>
      </div>
      {description && <span className="ep__proof-desc">{description}</span>}
    </div>
  );
}

export default function EvidencePanel({
  result,
  sha256,
  bundleToken,
  onDownloadBundle,
  bundleBusy = false,
  bundleError,
}: EvidencePanelProps) {
  const [showRaw, setShowRaw] = useState(false);

  if (!result) return null;

  const integrityValid = typeof result?.verdict?.integrity === "boolean"
    ? result.verdict.integrity
    : !!result.found;
  const signatureValid = typeof result?.signatureValid === "boolean"
    ? result.signatureValid
    : typeof result?.verdict?.authenticity === "boolean"
        ? result.verdict.authenticity
        : false;
  const anchorValid = typeof result?.anchorValid === "boolean"
    ? result.anchorValid
    : typeof result?.timestampValid === "boolean"
        ? result.timestampValid
        : typeof result?.verdict?.temporality === "boolean"
          ? result.verdict.temporality
          : false;

  const derivedTier = integrityValid
    ? (signatureValid ? (anchorValid ? "anchored" : "authentic") : "integrity")
    : "invalid";
  const verificationTier = typeof result?.verificationTier === "string" ? result.verificationTier : derivedTier;
  const verified = verificationTier === "anchored";

  const statusLabel = verificationTier === "anchored"
    ? "All Checks Passed (Anchored)"
    : verificationTier === "authentic"
      ? "Signature Valid (Not Anchored)"
      : verificationTier === "integrity"
        ? "Integrity Match Only"
        : "Verification Failed";

  const reasonMessage = (() => {
    switch (result?.reason) {
      case "FILE_REQUIRED_FOR_FULL_VERIFICATION":
        return "Upload the original file to complete full verification.";
      case "HASH_MISMATCH":
        return "Uploaded file hash does not match the stored credential hash.";
      case "MISSING_MEDIA_OBJECT":
        return "The stored credential exists, but the original media object is missing from storage.";
      case "SIGNATURE_INVALID":
        return "Integrity matched, but signature verification failed.";
      case "ANCHOR_INVALID":
        return "Integrity and signature matched, but TSA anchoring could not be verified.";
      case "NOT_FOUND":
      case "SHARE_NOT_FOUND":
      case "CAPTURE_NOT_FOUND":
      case "AUDIO_NOT_FOUND":
        return "No matching evidence record was found for this verification attempt.";
      default:
        return null;
    }
  })();

  const hash = sha256 || result.sha256 || result.captureId || "";

  return (
    <div className={`ep fade-in ${verified ? "ep--verified" : "ep--failed"}`}>
      {/* Result header */}
      <div className="ep__header">
        <div className={`ep__status ${verified ? "ep__status--ok" : "ep__status--fail"}`}>
          <span className="ep__status-icon">
            {verified ? <ShieldCheck size={18} strokeWidth={2} /> : <ShieldX size={18} strokeWidth={2} />}
          </span>
          <span>{statusLabel}</span>
        </div>
      </div>

      {/* Hash */}
      {hash && (
        <div className="ep__hash">
          <span className="ep__hash-label">
            <Hash size={10} strokeWidth={2.5} style={{ display: "inline", verticalAlign: "-1px", marginRight: 4 }} />
            SHA-256
          </span>
          <code className="ep__hash-value">{hash}</code>
        </div>
      )}

      {/* Proof indicators */}
      <div className="ep__proofs">
        <ProofIndicator
          label="Integrity Verified"
          valid={integrityValid}
          description={integrityValid
            ? "The uploaded file hash matches the stored credential hash."
            : "No matching file hash proof was established."}
        />
        <ProofIndicator
          label="Signature Valid"
          valid={signatureValid}
          description={signatureValid
            ? "The Ed25519 signature matches the registered device public key."
            : "The digital signature could not be verified against the registered key."}
        />
        <ProofIndicator
          label="Timestamp Anchored"
          valid={anchorValid}
          description={anchorValid
            ? `An RFC 3161 timestamp authority has anchored this credential.${result.anchoredAt ? ` Anchored at ${new Date(result.anchoredAt).toLocaleString()}.` : ""}`
            : "No valid TSA timestamp anchor was found for this credential."}
        />
        {("mediaExists" in result || "media_exists" in result) && (
          <ProofIndicator
            label="Media Stored"
            valid={Boolean(result.mediaExists ?? result.media_exists)}
            description={Boolean(result.mediaExists ?? result.media_exists)
              ? "The original media file is securely stored and retrievable."
              : "The original media file could not be located in storage."}
          />
        )}
      </div>

      {/* Details */}
      <div className="ep__details">
        {result.status && <Row label="Status" value={result.status} icon={<FileKey size={11} />} />}
        {result.capturedAt && (
          <Row label="Captured" value={new Date(result.capturedAt).toLocaleString()} icon={<Clock size={11} />} />
        )}
        {result.anchoredAt && (
          <Row label="Anchored" value={new Date(result.anchoredAt).toLocaleString()} icon={<Anchor size={11} />} />
        )}
        {result.credential?.device_id && (
          <Row label="Device" value={result.credential.device_id} mono icon={<Smartphone size={11} />} />
        )}
      </div>

      {/* Failure message */}
      {!verified && (
        <div className="ep__alert ep__alert--error">
          <XCircle size={16} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {reasonMessage || "Full verification requires hash integrity, signature validity, and a valid RFC 3161 timestamp token."}
          </span>
        </div>
      )}

      {/* Actions row */}
      <div className="ep__actions">
        {/* Download bundle */}
        {verified && bundleToken && onDownloadBundle && (
          <button className="btn btn--secondary" onClick={onDownloadBundle} disabled={bundleBusy}>
            <Download size={14} strokeWidth={2} />
            {bundleBusy ? "Preparing…" : "Download Evidence Bundle"}
          </button>
        )}

        {/* Raw JSON toggle */}
        {result.credential && (
          <button className="btn btn--secondary" onClick={() => setShowRaw((p) => !p)}>
            <Code2 size={14} strokeWidth={2} />
            {showRaw ? "Hide" : "View"} Raw Credential
            {showRaw ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}

        {bundleError && <span className="ep__inline-error">{bundleError}</span>}
      </div>

      {/* Raw JSON */}
      {showRaw && result.credential && (
        <pre className="ep__raw fade-in">{JSON.stringify(result.credential, null, 2)}</pre>
      )}
    </div>
  );
}
