import React, { createContext, useContext, useState } from "react";
import { useRouter } from "expo-router";
import TutorialOverlay from "./TutorialOverlay";
import { mobileTutorialSteps } from "./tutorialSteps";

type TutorialFlowContextValue = {
  startTutorial: () => void;
  stopTutorial: () => void;
};

const TutorialFlowContext = createContext<TutorialFlowContextValue | undefined>(undefined);

export function TutorialFlowProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);

  const total = mobileTutorialSteps.length;
  const step = mobileTutorialSteps[currentIdx] ?? null;
  const isFirst = currentIdx === 0;
  const isLast = currentIdx === total - 1;

  const navigateToStepRoute = (index: number) => {
    const target = mobileTutorialSteps[index];
    if (target?.route) router.replace(target.route as any);
  };

  const startTutorial = () => {
    setCurrentIdx(0);
    setVisible(true);
    navigateToStepRoute(0);
  };

  const stopTutorial = () => {
    setVisible(false);
    setCurrentIdx(0);
    router.replace("/home");
  };

  const nextStep = () => {
    if (isLast) {
      stopTutorial();
      return;
    }
    setCurrentIdx((prev) => {
      const next = prev + 1;
      navigateToStepRoute(next);
      return next;
    });
  };

  const backStep = () => {
    if (!isFirst) {
      setCurrentIdx((prev) => {
        const next = prev - 1;
        navigateToStepRoute(next);
        return next;
      });
    }
  };

  const value = {
    startTutorial,
    stopTutorial,
  };

  return (
    <TutorialFlowContext.Provider value={value}>
      {children}
      <TutorialOverlay
        visible={visible}
        step={step}
        currentIdx={currentIdx}
        total={total}
        isFirst={isFirst}
        isLast={isLast}
        onClose={stopTutorial}
        onNext={nextStep}
        onBack={backStep}
      />
    </TutorialFlowContext.Provider>
  );
}

export function useTutorialFlow() {
  const ctx = useContext(TutorialFlowContext);
  if (!ctx) {
    throw new Error("useTutorialFlow must be used within TutorialFlowProvider");
  }
  return ctx;
}
