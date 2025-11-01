export type ConfidenceGateDecision = {
  allowUpdate: boolean;
  reason: "LOW_CONFIDENCE" | "NO_CONFIDENCE" | null;
};

export class ConfidenceGate {
  private threshold: number;

  private skippedFrameCount = 0;

  constructor(threshold: number) {
    this.threshold = threshold;
  }

  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }

  evaluate(confidence: number | null): ConfidenceGateDecision {
    const allow = this.shouldAllow(confidence);
    if (allow) {
      this.skippedFrameCount = 0;
      return {
        allowUpdate: true,
        reason: null,
      };
    }

    this.skippedFrameCount += 1;

    return {
      allowUpdate: false,
      reason: confidence === null ? "NO_CONFIDENCE" : "LOW_CONFIDENCE",
    };
  }

  getSkippedFrameCount(): number {
    return this.skippedFrameCount;
  }

  private shouldAllow(confidence: number | null): boolean {
    if (confidence === null) {
      return false;
    }
    if (!Number.isFinite(confidence)) {
      return false;
    }
    if (confidence <= 0) {
      return false;
    }
    return confidence >= this.threshold;
  }
}
