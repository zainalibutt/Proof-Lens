import React, { Suspense, useState } from "react";
import { Shield } from "lucide-react";
import { verifyUpload } from "../lib/api";
import SectionCard from "../components/SectionCard";

const VerificationDropZone = React.lazy(
  () => import("../components/VerificationDropZone")
);
const EvidencePanel = React.lazy(
  () => import("../components/EvidencePanel")
);

function LazyFallback() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
      <div className="spinner" />
    </div>
  );
}

interface Props {
  accessToken: string;
}

export default function VerifyPage({ accessToken }: Props) {
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const onVerify = async () => {
    setVerifyError(null);
    setVerifyResult(null);
    if (!uploadFile) {
      setVerifyError("Select a file first.");
      return;
    }
    try {
      setVerifyBusy(true);
      setVerifyResult(await verifyUpload(uploadFile, accessToken));
    } catch (e: any) {
      setVerifyError(e?.message || "Verify failed");
    } finally {
      setVerifyBusy(false);
    }
  };

  return (
    <Suspense fallback={<LazyFallback />}>
      <div className="stack fade-in" style={{ gap: 28 }}>
        <div className="page-intro">
          <h2 className="page-intro__title">Verify a file</h2>
          <p className="page-intro__desc muted">
            ProofLens checks the file bytes, device signature and independent time anchor against the stored record.
          </p>
        </div>

        <SectionCard glow>
          <div className="stack">
            <VerificationDropZone
              accept="image/*"
              file={uploadFile}
              onFile={setUploadFile}
              label="Drop the original image here, or choose a file"
              busy={verifyBusy}
            />

            <div className="row">
              <button onClick={onVerify} disabled={verifyBusy || !uploadFile}>
                <Shield size={14} strokeWidth={2} />
                {verifyBusy ? "Checking proof\u2026" : "Check proof"}
              </button>
            </div>

            {verifyError && <div className="alert error">{verifyError}</div>}

            {verifyResult && (
              <EvidencePanel
                result={verifyResult}
                sha256={verifyResult.sha256}
              />
            )}
          </div>
        </SectionCard>
      </div>
    </Suspense>
  );
}
