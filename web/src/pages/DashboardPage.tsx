import { useNavigate } from "react-router-dom";
import { Smartphone, Shield, FolderOpen } from "lucide-react";
import SectionCard from "../components/SectionCard";

const actions = [
  {
    title: "Capture Evidence",
    description:
      "Use your mobile device to capture and sign tamper-evident media.",
    cta: "Start Capture",
    route: "/capture",
    Icon: Smartphone,
  },
  {
    title: "Verify Media",
    description:
      "Upload a file to verify its cryptographic authenticity.",
    cta: "Verify File",
    route: "/verify",
    Icon: Shield,
  },
  {
    title: "Your Evidence",
    description:
      "Browse your captured and signed media.",
    cta: "View Evidence",
    route: "/evidence",
    Icon: FolderOpen,
  },
] as const;

export default function DashboardPage() {
  const navigate = useNavigate();

  return (
    <div className="dashboard-grid fade-in">
      {actions.map(({ title, description, cta, route, Icon }) => (
        <SectionCard key={route} glow>
          <div className="dashboard-action-card">
            <div className="dashboard-action-card__icon-ring">
              <Icon size={28} strokeWidth={1.5} />
            </div>
            <h2 className="dashboard-action-card__title">{title}</h2>
            <p className="dashboard-action-card__desc muted">{description}</p>
            <button
              className="dashboard-action-card__cta"
              onClick={() => navigate(route)}
            >
              {cta}
            </button>
          </div>
        </SectionCard>
      ))}
    </div>
  );
}
