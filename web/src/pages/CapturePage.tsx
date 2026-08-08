import SectionCard from "../components/SectionCard";
import MobileConnectPanel from "../components/MobileConnectPanel";

interface Props {
  emailHint: string | null;
}

export default function CapturePage({ emailHint }: Props) {
  return (
    <div className="stack fade-in" style={{ gap: 28 }}>
      <div className="page-intro">
        <h2 className="page-intro__title">Capture Evidence</h2>
        <p className="page-intro__desc muted">
          Use your mobile device to capture and cryptographically sign tamper-evident media.
        </p>
      </div>

      <SectionCard>
        <MobileConnectPanel emailHint={emailHint} />
      </SectionCard>
    </div>
  );
}
