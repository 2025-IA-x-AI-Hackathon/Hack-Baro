export type GuardrailThresholdOverride = {
  enterThreshold?: number;
  exitThreshold?: number;
  enterSeconds?: number;
  exitSeconds?: number;
};

export type GuardrailConfidenceOverride = {
  faceThreshold?: number;
  poseThreshold?: number;
  enterSeconds?: number;
  exitSeconds?: number;
};

export type GuardrailIlluminationOverride = {
  illuminationThreshold?: number;
  enterSeconds?: number;
  exitSeconds?: number;
};

export type GuardrailOverrides = {
  yaw?: GuardrailThresholdOverride;
  roll?: GuardrailThresholdOverride;
  confidence?: GuardrailConfidenceOverride;
  illumination?: GuardrailIlluminationOverride;
};

export type ReliabilityReason =
  | "yaw-threshold"
  | "roll-threshold"
  | "confidence-low"
  | "illumination-low";
