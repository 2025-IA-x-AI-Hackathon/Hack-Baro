import { getLogger } from "../../shared/logger";
import { isFiniteNumber } from "../../shared/validation/metricValues";
import type { ThresholdHysteresisConfig } from "../config/detection-config";
import { isGuardrailDebugEnabled } from "./debug-flags";

const logger = getLogger("angle-guardrail", "worker");

export default class AngleGuardrail {
  private config: ThresholdHysteresisConfig;

  private active = false;

  private timeAbove = 0;

  private timeBelow = 0;

  private readonly label: string;

  constructor(config: ThresholdHysteresisConfig, label = "angle") {
    this.config = { ...config };
    this.label = label;
  }

  setConfig(config: ThresholdHysteresisConfig): void {
    this.config = { ...config };
  }

  reset(): void {
    this.active = false;
    this.timeAbove = 0;
    this.timeBelow = 0;
  }

  update(angle: number | null | undefined, deltaSeconds: number): boolean {
    const magnitude = isFiniteNumber(angle) ? Math.abs(angle) : null;

    if (!this.active) {
      if (
        magnitude !== null &&
        magnitude > this.config.enterThreshold &&
        deltaSeconds > 0
      ) {
        this.timeAbove += deltaSeconds;
        if (this.timeAbove >= this.config.enterSeconds) {
          this.active = true;
          this.timeAbove = 0;
          this.timeBelow = 0;
        }
      } else {
        this.timeAbove = 0;
      }
    } else if (deltaSeconds > 0) {
      if (magnitude !== null && magnitude <= this.config.exitThreshold) {
        this.timeBelow += deltaSeconds;
        if (this.timeBelow >= this.config.exitSeconds) {
          this.active = false;
          this.timeAbove = 0;
          this.timeBelow = 0;
        }
      } else {
        this.timeBelow = 0;
      }
    }

    const verbose = isGuardrailDebugEnabled();

    if (verbose) {
      logger.debug(`[ANGLE GUARDRAIL] ${this.label}`, {
        cfg: this.config,
        angle,
        magnitude,
        active: this.active,
        timeAbove: this.timeAbove,
        timeBelow: this.timeBelow,
      });
    }

    return this.active;
  }

  isActive(): boolean {
    return this.active;
  }
}
