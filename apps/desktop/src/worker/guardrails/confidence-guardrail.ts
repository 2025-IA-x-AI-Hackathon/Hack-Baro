import { isFiniteNumber } from "../../shared/validation/metricValues";
import type { ConfidenceGuardrailConfig } from "../config/detection-config";

export default class ConfidenceGuardrail {
  private config: ConfidenceGuardrailConfig;

  private active = false;

  private timeBelow = 0;

  private timeAbove = 0;

  constructor(config: ConfidenceGuardrailConfig) {
    this.config = { ...config };
  }

  setConfig(config: ConfidenceGuardrailConfig): void {
    this.config = { ...config };
  }

  reset(): void {
    this.active = false;
    this.timeBelow = 0;
    this.timeAbove = 0;
  }

  update(
    faceConfidence: number | null | undefined,
    poseConfidence: number | null | undefined,
    deltaSeconds: number,
  ): boolean {
    const safeFace = isFiniteNumber(faceConfidence) ? faceConfidence : null;
    const safePose = isFiniteNumber(poseConfidence) ? poseConfidence : null;

    const below =
      safeFace === null ||
      safePose === null ||
      safeFace < this.config.faceThreshold ||
      safePose < this.config.poseThreshold;

    if (!this.active) {
      if (below && deltaSeconds > 0) {
        this.timeBelow += deltaSeconds;
        if (this.timeBelow >= this.config.enterSeconds) {
          this.active = true;
          this.timeBelow = 0;
          this.timeAbove = 0;
        }
      } else {
        this.timeBelow = 0;
      }
    } else if (deltaSeconds > 0) {
      if (!below) {
        this.timeAbove += deltaSeconds;
        if (this.timeAbove >= this.config.exitSeconds) {
          this.active = false;
          this.timeBelow = 0;
          this.timeAbove = 0;
        }
      } else {
        this.timeAbove = 0;
      }
    }

    return this.active;
  }

  isActive(): boolean {
    return this.active;
  }
}
