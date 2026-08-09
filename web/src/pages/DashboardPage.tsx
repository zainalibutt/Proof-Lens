import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Clock3,
  FileCheck2,
  Fingerprint,
  Focus,
  ShieldCheck,
  Smartphone,
} from "lucide-react";

const proofs = [
  {
    label: "Integrity",
    detail: "The file bytes still match the capture record.",
    Icon: FileCheck2,
  },
  {
    label: "Device-linked",
    detail: "A registered device key signed the capture hash.",
    Icon: Fingerprint,
  },
  {
    label: "Trusted time",
    detail: "An independent RFC 3161 authority anchored the record.",
    Icon: Clock3,
  },
] as const;

export default function DashboardPage() {
  const navigate = useNavigate();

  return (
    <main className="forensic-home fade-in">
      <section className="forensic-home__hero">
        <div className="forensic-home__copy">
          <span className="forensic-home__eyebrow">
            <Focus size={13} /> Independent media provenance
          </span>
          <h2>Preserve the proof behind the file.</h2>
          <p>
            Capture on your phone, anchor the record automatically, then verify
            the same evidence in a browser or offline bundle.
          </p>
          <div className="forensic-home__actions">
            <button onClick={() => navigate("/capture")}>
              <Smartphone size={16} /> Capture evidence
            </button>
            <button className="secondary" onClick={() => navigate("/verify")}>
              Verify a file <ArrowRight size={15} />
            </button>
          </div>
        </div>

        <div className="forensic-home__assurance" aria-label="ProofLens assurance model">
          <div className="forensic-home__assurance-header">
            <span className="forensic-home__assurance-icon"><ShieldCheck size={20} /></span>
            <div>
              <span>Assurance model</span>
              <strong>Three checks. One bounded claim.</strong>
            </div>
          </div>
          <div className="forensic-home__proofs">
            {proofs.map(({ label, detail, Icon }) => (
              <div className="forensic-home__proof" key={label}>
                <Icon size={16} />
                <div>
                  <strong>{label}</strong>
                  <span>{detail}</span>
                </div>
                <Check size={14} className="forensic-home__check" />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="forensic-home__boundary">
        <div>
          <span className="forensic-home__boundary-label">Trust boundary</span>
          <h3>ProofLens verifies provenance, not reality.</h3>
        </div>
        <p>
          It can show that specific file bytes were signed by a registered device
          and anchored in time. It cannot prove that the depicted scene was truthful
          or unstaged.
        </p>
      </section>

      <button className="forensic-home__library" onClick={() => navigate("/evidence")}>
        <span className="forensic-home__library-icon"><FileCheck2 size={20} /></span>
        <span>
          <strong>Open evidence library</strong>
          <small>Inspect captures, recordings, signatures and portable bundles.</small>
        </span>
        <ArrowRight size={17} />
      </button>
    </main>
  );
}
