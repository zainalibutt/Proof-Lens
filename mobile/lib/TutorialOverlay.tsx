import React from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";

/* Types */
export type TutorialStep = {
  id: string;
  title: string;
  description: string;
  route?: string;
};

interface TutorialOverlayProps {
  visible: boolean;
  step: TutorialStep | null;
  currentIdx: number;
  total: number;
  isFirst: boolean;
  isLast: boolean;
  onClose: () => void;
  onNext: () => void;
  onBack: () => void;
}

/* Tutorial overlay for mobile walkthrough */
export default function TutorialOverlay({
  visible,
  step,
  currentIdx,
  total,
  isFirst,
  isLast,
  onClose,
  onNext,
  onBack,
}: TutorialOverlayProps) {
  const exit = () => onClose();

  if (!visible || !step) return null;

  return (
    <Modal transparent animationType="none" visible={visible} statusBarTranslucent onRequestClose={exit}>
      <View style={styles.backdrop}>
        {/* Bottom card */}
        <View style={styles.card}>
          {/* Progress bar */}
          <View style={styles.progressTrack}>
            <View style={[styles.progressBar, { width: `${((currentIdx + 1) / total) * 100}%` as any }]} />
          </View>

          {/* Step indicator */}
          <Text style={styles.stepIndicator}>
            STEP {currentIdx + 1} OF {total}
          </Text>

          <Text style={styles.title}>{step.title}</Text>
          <Text style={styles.description}>{step.description}</Text>

          {/* Route badge */}
          {step.route && (
            <View style={styles.routeBadge}>
              <Text style={styles.routeBadgeText}>ROUTE: {step.route.replace("/", "").replace("-", " ").toUpperCase()}</Text>
            </View>
          )}

          {/* Navigation buttons */}
          <View style={styles.navRow}>
            <TouchableOpacity onPress={exit} style={styles.exitBtn} activeOpacity={0.7}>
              <Text style={styles.exitText}>Exit</Text>
            </TouchableOpacity>

            <View style={styles.navRight}>
              {!isFirst && (
                <TouchableOpacity onPress={onBack} style={styles.backBtn} activeOpacity={0.7}>
                  <Text style={styles.backText}>Back</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onNext} style={styles.nextBtn} activeOpacity={0.7}>
                <Text style={styles.nextText}>{isLast ? "Done" : "Next"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* Styles */
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "flex-end",
  },
  card: {
    marginHorizontal: 16,
    marginBottom: 40,
    backgroundColor: "#151b2b",
    borderRadius: 20,
    padding: 22,
    borderWidth: 1,
    borderColor: "#1f2937",
    shadowColor: "#6366f1",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  progressTrack: {
    height: 3,
    backgroundColor: "#1f2937",
    borderRadius: 2,
    marginBottom: 16,
    overflow: "hidden",
  },
  progressBar: {
    height: 3,
    backgroundColor: "#818cf8",
    borderRadius: 2,
  },
  stepIndicator: {
    color: "#818cf8",
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 8,
    letterSpacing: 1,
  },
  title: {
    color: "#ffffff",
    fontSize: 19,
    fontWeight: "700",
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  description: {
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 16,
  },
  routeBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#1e1b4b",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginBottom: 18,
  },
  routeBadgeText: {
    color: "#a5b4fc",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
  navRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  navRight: {
    flexDirection: "row",
    gap: 10,
  },
  exitBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  exitText: {
    color: "#6b7280",
    fontSize: 13,
    fontWeight: "500",
  },
  backBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: "#1f2937",
    borderRadius: 10,
  },
  backText: {
    color: "#d1d5db",
    fontSize: 13,
    fontWeight: "600",
  },
  nextBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: "#6366f1",
    borderRadius: 10,
  },
  nextText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },
});
