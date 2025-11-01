import type { StateCreator } from "zustand";
import { create } from "zustand";

export type OnboardingStep =
  | "welcome"
  | "permissions"
  | "calibration"
  | "feedback-explanation";

interface OnboardingState {
  currentStep: OnboardingStep;
  setStep: (step: OnboardingStep) => void;
  nextStep: () => void;
  previousStep: () => void;
  resetOnboarding: () => void;
}

const STEP_ORDER: OnboardingStep[] = [
  "welcome",
  "permissions",
  "calibration",
  "feedback-explanation",
];

const stateCreator: StateCreator<OnboardingState> = (set, get) => ({
  currentStep: "welcome",

  setStep: (step: OnboardingStep) => set({ currentStep: step }),

  nextStep: () => {
    const { currentStep } = get();
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex < STEP_ORDER.length - 1) {
      set({ currentStep: STEP_ORDER[currentIndex + 1] });
    }
  },

  previousStep: () => {
    const { currentStep } = get();
    const currentIndex = STEP_ORDER.indexOf(currentStep);
    if (currentIndex > 0) {
      set({ currentStep: STEP_ORDER[currentIndex - 1] });
    }
  },

  resetOnboarding: () => set({ currentStep: "welcome" }),
});

export const useOnboardingStore = create<OnboardingState>(stateCreator);
