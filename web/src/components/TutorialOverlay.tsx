import React, { useCallback, useEffect, useState } from "react";

/* Types */
export type WebTutorialStep = {
  id: string;
  title: string;
  description: string;
  /** CSS selector of the element to highlight (optional) */
  targetSelector?: string;
  position?: "top" | "bottom" | "center";
};

interface TutorialOverlayProps {
  visible: boolean;
  steps: WebTutorialStep[];
  onClose: () => void;
}

/* Tutorial overlay for web walkthrough */
export default function TutorialOverlay({ visible, steps, onClose }: TutorialOverlayProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [viewportW, setViewportW] = useState(typeof window !== "undefined" ? window.innerWidth : 1400);

  const step = steps[currentIdx];
  const isFirst = currentIdx === 0;
  const isLast = currentIdx === steps.length - 1;

  /* Reset when opened */
  useEffect(() => {
    if (visible) setCurrentIdx(0);
  }, [visible]);

  /* Scroll to and measure target */
  useEffect(() => {
    if (!visible || !step?.targetSelector) {
      setTargetRect(null);
      return;
    }
    const el = document.querySelector(step.targetSelector);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Wait for scroll to settle.
      const t = window.setTimeout(() => {
        window.requestAnimationFrame(() => setTargetRect(el.getBoundingClientRect()));
      }, 350);
      return () => clearTimeout(t);
    } else {
      setTargetRect(null);
    }
  }, [visible, currentIdx, step?.targetSelector]);

  /* Re-measure on scroll */
  useEffect(() => {
    if (!visible || !step?.targetSelector) return;
    const onScroll = () => {
      const el = document.querySelector(step.targetSelector!);
      if (el) setTargetRect(el.getBoundingClientRect());
    };
    const onResize = () => {
      setViewportW(window.innerWidth);
      onScroll();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [visible, currentIdx, step?.targetSelector]);

  useEffect(() => {
    if (!visible) return;
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [visible]);

  /* Keyboard controls */
  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight" || e.key === "Enter") goNext();
      if (e.key === "ArrowLeft") goBack();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, currentIdx]);

  const goNext = useCallback(() => {
    if (currentIdx >= steps.length - 1) { onClose(); return; }
    setCurrentIdx((i) => i + 1);
  }, [currentIdx, steps.length, onClose]);

  const goBack = useCallback(() => {
    if (currentIdx > 0) setCurrentIdx((i) => i - 1);
  }, [currentIdx]);

  if (!visible || !step) return null;

  const cardWidth = Math.min(360, Math.max(300, viewportW - 32));
  const cardDynamicStyle: React.CSSProperties = {
    width: cardWidth,
    right: viewportW < 900 ? 16 : 32,
    top: viewportW < 900 ? 80 : 100,
    maxHeight: "calc(100vh - 120px)",
    overflowY: "auto",
  };

  return (
    <div style={styles.backdrop} onClick={onClose}>
      {/* Target highlight */}
      {targetRect && (
        <div
          style={{
            position: "fixed",
            left: targetRect.left - 1,
            top: targetRect.top - 1,
            width: targetRect.width + 2,
            height: targetRect.height + 2,
            borderRadius: 8,
            border: "2px solid #818cf8",
            background: "rgba(99,102,241,0.06)",
            pointerEvents: "none",
            transition: "all 0.3s ease",
            zIndex: 100002,
          }}
        />
      )}

      {/* Fixed side card */}
      <div style={{ ...styles.card, ...cardDynamicStyle }} onClick={(e) => e.stopPropagation()}>
        {/* Progress bar */}
        <div style={styles.progressTrack}>
          <div
            style={{
              ...styles.progressBar,
              width: `${((currentIdx + 1) / steps.length) * 100}%`,
            }}
          />
        </div>

        <span style={styles.stepIndicator}>
          Step {currentIdx + 1} of {steps.length}
        </span>

        <h3 style={styles.title}>{step.title}</h3>
        <p style={styles.description}>{step.description}</p>

        <div style={styles.navRow}>
          <button style={styles.exitBtn} onClick={onClose}>
            Exit
          </button>
          <div style={styles.navRight}>
            {!isFirst && (
              <button style={styles.backBtn} onClick={goBack}>
                ← Back
              </button>
            )}
            <button style={styles.nextBtn} onClick={goNext}>
              {isLast ? "Done ✓" : "Next →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Inline styles */
const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    zIndex: 100000,
  },
  card: {
    position: "fixed",
    zIndex: 100001,
    top: 100,
    right: 32,
    width: 360,
    background: "linear-gradient(135deg, #151b2b 0%, #0f1420 100%)",
    borderRadius: 16,
    padding: "24px 24px 20px",
    border: "1px solid #1f2937",
    boxShadow: "0 12px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(99,102,241,0.12)",
    transition: "opacity 0.2s ease",
  },
  progressTrack: {
    height: 3,
    background: "#1f2937",
    borderRadius: 2,
    marginBottom: 16,
    overflow: "hidden",
  },
  progressBar: {
    height: "100%",
    background: "linear-gradient(90deg, #6366f1, #818cf8)",
    borderRadius: 2,
    transition: "width 0.3s ease",
  },
  stepIndicator: {
    color: "#818cf8",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 0.8,
    textTransform: "uppercase" as const,
    display: "block",
    marginBottom: 10,
  },
  title: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: 700,
    margin: "0 0 8px",
    letterSpacing: -0.3,
  },
  description: {
    color: "#9ca3af",
    fontSize: 13.5,
    lineHeight: "21px",
    margin: "0 0 22px",
  },
  navRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  navRight: {
    display: "flex",
    gap: 8,
  },
  exitBtn: {
    padding: "7px 12px",
    background: "transparent",
    border: "none",
    color: "#6b7280",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },
  backBtn: {
    padding: "7px 14px",
    background: "#1f2937",
    border: "none",
    borderRadius: 8,
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  nextBtn: {
    padding: "7px 18px",
    background: "#6366f1",
    border: "none",
    borderRadius: 8,
    color: "#ffffff",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
};
