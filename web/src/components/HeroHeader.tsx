import React from "react";
import { Shield } from "lucide-react";
import logoImage from "../logo.png";

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
          <img src={logoImage} alt="ProofLens" className="hero__logo" />
          <div>
            <h1 className="hero__title">ProofLens</h1>
            <p className="hero__subtitle">
              <Shield size={12} strokeWidth={2} style={{ display: "inline", verticalAlign: "-1px", marginRight: 4, opacity: 0.6 }} />
              {subtitle ?? "Cryptographic Media Verification System"}
            </p>
          </div>
        </div>
        {rightContent && <div className="hero__right">{rightContent}</div>}
      </div>
    </header>
  );
}
