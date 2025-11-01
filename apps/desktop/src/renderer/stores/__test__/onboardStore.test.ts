import { beforeEach, describe, expect, it } from "vitest";
import { type OnboardingStep, useOnboardingStore } from "../onboardingStore";

describe("onboardingStore", () => {
  beforeEach(() => {
    // Reset store before each test
    useOnboardingStore.getState().resetOnboarding();
  });

  it("should initialize with welcome step", () => {
    const { currentStep } = useOnboardingStore.getState();
    expect(currentStep).toBe("welcome");
  });

  it("should set step directly", () => {
    const { setStep } = useOnboardingStore.getState();

    setStep("calibration");
    expect(useOnboardingStore.getState().currentStep).toBe("calibration");
  });

  it("should move to next step in sequence", () => {
    const { nextStep } = useOnboardingStore.getState();

    // Start at welcome (step 1)
    expect(useOnboardingStore.getState().currentStep).toBe("welcome");

    // Move to permissions (step 2)
    nextStep();
    expect(useOnboardingStore.getState().currentStep).toBe("permissions");

    // Move to calibration (step 3)
    nextStep();
    expect(useOnboardingStore.getState().currentStep).toBe("calibration");

    // Move to feedback-explanation (step 4)
    nextStep();
    expect(useOnboardingStore.getState().currentStep).toBe(
      "feedback-explanation",
    );
  });

  it("should not move past last step", () => {
    const { setStep, nextStep } = useOnboardingStore.getState();

    // Jump to last step
    setStep("feedback-explanation");
    expect(useOnboardingStore.getState().currentStep).toBe(
      "feedback-explanation",
    );

    // Try to move next - should stay at last step
    nextStep();
    expect(useOnboardingStore.getState().currentStep).toBe(
      "feedback-explanation",
    );
  });

  it("should move to previous step in sequence", () => {
    const { setStep, previousStep } = useOnboardingStore.getState();

    // Start at feedback-explanation (step 4)
    setStep("feedback-explanation");
    expect(useOnboardingStore.getState().currentStep).toBe(
      "feedback-explanation",
    );

    // Move to calibration (step 3)
    previousStep();
    expect(useOnboardingStore.getState().currentStep).toBe("calibration");

    // Move to permissions (step 2)
    previousStep();
    expect(useOnboardingStore.getState().currentStep).toBe("permissions");

    // Move to welcome (step 1)
    previousStep();
    expect(useOnboardingStore.getState().currentStep).toBe("welcome");
  });

  it("should not move before first step", () => {
    const { previousStep } = useOnboardingStore.getState();

    // Start at welcome (step 1)
    expect(useOnboardingStore.getState().currentStep).toBe("welcome");

    // Try to move previous - should stay at first step
    previousStep();
    expect(useOnboardingStore.getState().currentStep).toBe("welcome");
  });

  it("should reset to welcome step", () => {
    const { setStep, resetOnboarding } = useOnboardingStore.getState();

    // Move to a different step
    setStep("calibration");
    expect(useOnboardingStore.getState().currentStep).toBe("calibration");

    // Reset
    resetOnboarding();
    expect(useOnboardingStore.getState().currentStep).toBe("welcome");
  });

  it("should handle all step types", () => {
    const { setStep } = useOnboardingStore.getState();
    const allSteps: OnboardingStep[] = [
      "welcome",
      "permissions",
      "calibration",
      "feedback-explanation",
    ];

    allSteps.forEach((step) => {
      setStep(step);
      expect(useOnboardingStore.getState().currentStep).toBe(step);
    });
  });
});
