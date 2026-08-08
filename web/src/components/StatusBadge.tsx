import React from "react";
import { ShieldCheck, Clock, AlertTriangle, XCircle, CircleDot } from "lucide-react";

export type BadgeStatus = "anchored" | "pending" | "failed" | "verified" | "not-verified" | string;

interface StatusBadgeProps {
  status: BadgeStatus;
  label?: string;
  size?: "sm" | "md";
}

const statusConfig: Record<string, { className: string; Icon: React.FC<any> }> = {
  anchored: { className: "badge--success", Icon: ShieldCheck },
  verified: { className: "badge--success", Icon: ShieldCheck },
  pending: { className: "badge--warning", Icon: Clock },
  submitted: { className: "badge--warning", Icon: Clock },
  failed: { className: "badge--error", Icon: XCircle },
  "not-verified": { className: "badge--error", Icon: AlertTriangle },
};

const defaultConfig = { className: "badge--neutral", Icon: CircleDot };

export default function StatusBadge({ status, label, size = "md" }: StatusBadgeProps) {
  const config = statusConfig[status] ?? defaultConfig;
  const displayLabel = label ?? status;
  const iconSize = size === "sm" ? 10 : 12;

  return (
    <span className={`badge ${config.className} ${size === "sm" ? "badge--sm" : ""}`}>
      <config.Icon size={iconSize} strokeWidth={2.5} />
      <span>{displayLabel}</span>
    </span>
  );
}
