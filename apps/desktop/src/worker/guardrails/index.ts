import { getLogger } from "../../shared/logger";
import { resolveTimestamp } from "../../shared/time";
import type { EngineReliability } from "../../shared/types/engine-state";
import { ReliabilityReason } from "../../shared/types/guardrails";
import type { DetectionReliability } from "../../shared/types/landmarks";
import {
  type DetectionGuardrailConfig,
  getDetectionGuardrailConfig,
} from "../config/detection-config";
import AngleGuardrail from "./angle-guardrail";
import ConfidenceGuardrail from "./confidence-guardrail";
import { isGuardrailDebugEnabled } from "./debug-flags";
import IlluminationGuardrail from "./illumination-guardrail";

const logger = getLogger("reliability-guardrails", "worker");

export type GuardrailEvaluationInput = {
  timestamp: number;
  yaw: number | null | undefined;
  roll: number | null | undefined;
  faceConfidence: number | null | undefined;
  poseConfidence: number | null | undefined;
  illuminationConfidence: number | null | undefined;
  detectionReliability?: DetectionReliability;
};

export type GuardrailEvaluationResult = {
  reliability: EngineReliability;
  reasons: ReliabilityReason[];
};

const computeDeltaSeconds = (
  previousTimestamp: number | null,
  timestamp: number,
): number => {
  if (previousTimestamp === null) {
    return 0;
  }
  const delta = Math.max(0, (timestamp - previousTimestamp) / 1000);
  if (!Number.isFinite(delta)) {
    return 0;
  }
  return Math.min(delta, 1);
};

export class ReliabilityGuardrails {
  private yawGuardrail: AngleGuardrail;

  private rollGuardrail: AngleGuardrail;

  private confidenceGuardrail: ConfidenceGuardrail;

  private illuminationGuardrail: IlluminationGuardrail;

  private lastTimestamp: number | null = null;

  private configSnapshot: DetectionGuardrailConfig;

  constructor(config?: DetectionGuardrailConfig) {
    const initialConfig = config ?? getDetectionGuardrailConfig();
    this.configSnapshot = { ...initialConfig };
    this.yawGuardrail = new AngleGuardrail(initialConfig.yaw, "yaw");
    this.rollGuardrail = new AngleGuardrail(initialConfig.roll, "roll");
    this.confidenceGuardrail = new ConfidenceGuardrail(
      initialConfig.confidence,
    );
    this.illuminationGuardrail = new IlluminationGuardrail(
      initialConfig.illumination,
    );
  }

  reset(): void {
    this.lastTimestamp = null;
    this.yawGuardrail.reset();
    this.rollGuardrail.reset();
    this.confidenceGuardrail.reset();
    this.illuminationGuardrail.reset();
  }

  evaluate(input: GuardrailEvaluationInput): GuardrailEvaluationResult {
    const timestamp = resolveTimestamp(input.timestamp);
    const deltaSeconds = computeDeltaSeconds(this.lastTimestamp, timestamp);
    this.lastTimestamp = timestamp;

    this.refreshConfig();

    const reasons: ReliabilityReason[] = [];

    const detectionReliability = input.detectionReliability ?? "UNKNOWN";

    const yawTriggered = this.yawGuardrail.update(input.yaw, deltaSeconds);
    if (yawTriggered) {
      reasons.push("yaw-threshold");
    }

    const rollTriggered = this.rollGuardrail.update(input.roll, deltaSeconds);
    if (rollTriggered) {
      reasons.push("roll-threshold");
    }

    const orientationTriggered = yawTriggered || rollTriggered;

    const faceAboveThreshold =
      typeof input.faceConfidence === "number" &&
      Number.isFinite(input.faceConfidence) &&
      input.faceConfidence >= this.configSnapshot.confidence.faceThreshold;
    const poseAboveThreshold =
      typeof input.poseConfidence === "number" &&
      Number.isFinite(input.poseConfidence) &&
      input.poseConfidence >= this.configSnapshot.confidence.poseThreshold;
    const illuminationValue =
      typeof input.illuminationConfidence === "number" &&
      Number.isFinite(input.illuminationConfidence)
        ? input.illuminationConfidence
        : null;
    const illuminationAboveThreshold =
      illuminationValue !== null &&
      illuminationValue >=
        this.configSnapshot.illumination.illuminationThreshold;
    const meetsConfidenceThresholds =
      faceAboveThreshold &&
      poseAboveThreshold &&
      (illuminationValue === null || illuminationAboveThreshold);

    if (orientationTriggered) {
      this.confidenceGuardrail.reset();
      this.illuminationGuardrail.reset();
    } else if (detectionReliability === "OK" && meetsConfidenceThresholds) {
      this.confidenceGuardrail.reset();
      this.illuminationGuardrail.reset();
    } else {
      const confidenceTriggered = this.confidenceGuardrail.update(
        input.faceConfidence,
        input.poseConfidence,
        deltaSeconds,
      );
      if (confidenceTriggered) {
        reasons.push("confidence-low");
      }

      if (illuminationValue !== null) {
        const illuminationTriggered = this.illuminationGuardrail.update(
          illuminationValue,
          deltaSeconds,
        );
        if (illuminationTriggered) {
          reasons.push("illumination-low");
        }
      }
    }
    const reliability: EngineReliability =
      reasons.length > 0 ? "UNRELIABLE" : "OK";

    const verbose = isGuardrailDebugEnabled();

    if (verbose) {
      logger.debug("[GUARDRAILS] evaluation", {
        yaw: input.yaw,
        roll: input.roll,
        faceConfidence: input.faceConfidence,
        poseConfidence: input.poseConfidence,
        detectionReliability,
        reasons,
        reliability,
      });
    }

    return {
      reliability,
      reasons,
    };
  }

  private refreshConfig(): void {
    const latest = getDetectionGuardrailConfig();

    const needsYawUpdate =
      latest.yaw.enterThreshold !== this.configSnapshot.yaw.enterThreshold ||
      latest.yaw.exitThreshold !== this.configSnapshot.yaw.exitThreshold ||
      latest.yaw.enterSeconds !== this.configSnapshot.yaw.enterSeconds ||
      latest.yaw.exitSeconds !== this.configSnapshot.yaw.exitSeconds;
    if (needsYawUpdate) {
      this.yawGuardrail.setConfig(latest.yaw);
    }

    const needsRollUpdate =
      latest.roll.enterThreshold !== this.configSnapshot.roll.enterThreshold ||
      latest.roll.exitThreshold !== this.configSnapshot.roll.exitThreshold ||
      latest.roll.enterSeconds !== this.configSnapshot.roll.enterSeconds ||
      latest.roll.exitSeconds !== this.configSnapshot.roll.exitSeconds;
    if (needsRollUpdate) {
      this.rollGuardrail.setConfig(latest.roll);
    }

    const needsConfidenceUpdate =
      latest.confidence.faceThreshold !==
        this.configSnapshot.confidence.faceThreshold ||
      latest.confidence.poseThreshold !==
        this.configSnapshot.confidence.poseThreshold ||
      latest.confidence.enterSeconds !==
        this.configSnapshot.confidence.enterSeconds ||
      latest.confidence.exitSeconds !==
        this.configSnapshot.confidence.exitSeconds;
    if (needsConfidenceUpdate) {
      this.confidenceGuardrail.setConfig(latest.confidence);
    }

    const needsIlluminationUpdate =
      latest.illumination.illuminationThreshold !==
        this.configSnapshot.illumination.illuminationThreshold ||
      latest.illumination.enterSeconds !==
        this.configSnapshot.illumination.enterSeconds ||
      latest.illumination.exitSeconds !==
        this.configSnapshot.illumination.exitSeconds;
    if (needsIlluminationUpdate) {
      this.illuminationGuardrail.setConfig(latest.illumination);
    }

    this.configSnapshot = latest;
  }
}
