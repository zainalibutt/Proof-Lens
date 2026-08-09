import React from "react";
import { Focus } from "lucide-react";

interface HeroHeaderProps {
  subtitle?: string;
  rightContent?: React.ReactNode;
}

export default function HeroHeader({ subtitle, rightContent }: HeroHeaderProps) {
  return (
    <header className="hero">
      <div className="hero__bg" />
      <div className="hero__content">
        <div className="hero__brand">
          <span className="hero__mark" aria-hidden="true">
            <Focus size={22} strokeWidth={1.8} />
          </span>
          <div>
            <h1 className="hero__title">ProofLens</h1>
            <p className="hero__subtitle">
              {subtitle ?? "Capture proof. Verify independently."}
            </p>
          </div>
        </div>
        {rightContent && <div className="hero__right">{rightContent}</div>}
      </div>
    </header>
  );
}
