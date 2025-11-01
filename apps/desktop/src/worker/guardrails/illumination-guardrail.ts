import { isFiniteNumber } from "../../shared/validation/metricValues";
import type { IlluminationGuardrailConfig } from "../config/detection-config";

export default class IlluminationGuardrail {
  private config: IlluminationGuardrailConfig;

  private active = false;

  private timeBelow = 0;

  private timeAbove = 0;

  constructor(config: IlluminationGuardrailConfig) {
    this.config = { ...config };
  }

  setConfig(config: IlluminationGuardrailConfig): void {
    this.config = { ...config };
  }

  reset(): void {
    this.active = false;
    this.timeBelow = 0;
    this.timeAbove = 0;
  }

  update(
    illuminationConfidence: number | null | undefined,
    deltaSeconds: number,
  ): boolean {
    const value = isFiniteNumber(illuminationConfidence)
      ? illuminationConfidence
      : null;

    const below = value === null || value < this.config.illuminationThreshold;

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
