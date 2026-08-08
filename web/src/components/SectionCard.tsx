import React from "react";

interface SectionCardProps {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
}

export default function SectionCard({ children, className = "", glow = false }: SectionCardProps) {
  return (
    <section className={`glass-card ${glow ? "glass-card--glow" : ""} ${className}`}>
      {children}
    </section>
  );
}
