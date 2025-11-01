import { getEnvVar, parseNumericEnv } from "../../shared/env";
import type { GuardrailOverrides } from "../../shared/types/guardrails";

export type RiskThresholdConfig = {
  /** Threshold for pitch delta above baseline (degrees). */
  pitchDeg: number;
  /** Threshold for EHD delta above baseline (normalised units). */
  ehdNorm: number;
  /** Threshold for DPR delta above baseline (ratio delta). */
  dprDelta: number;
  /** Percentage (0-100) applied to thresholds to compute hysteresis delta. */
  hysteresisDeltaPct: number;
  /** Absolute pitch magnitude that marks a frame as degenerate/unreliable. */
  degeneratePitchDeg: number;
};

export type RiskTimingConfig = {
  /** Seconds required for sustained bad posture before escalating. */
  triggerSeconds: number;
  /** Seconds required for sustained recovery before clearing alert. */
  recoverySeconds: number;
  /** Maximum delta seconds applied per update to avoid large timer jumps. */
  maxDeltaSeconds: number;
};

export type RiskDetectionConfig = {
  thresholds: RiskThresholdConfig;
  timings: RiskTimingConfig;
};

export type RiskConfigOverrides = Partial<{
  thresholds: Partial<RiskThresholdConfig>;
  timings: Partial<RiskTimingConfig>;
}>;

const DEFAULT_RISK_CONFIG: RiskDetectionConfig = {
  thresholds: {
    pitchDeg: 12,
    ehdNorm: 0.18,
    dprDelta: 0.12,
    hysteresisDeltaPct: 20,
    degeneratePitchDeg: 85,
  },
  timings: {
    triggerSeconds: 60,
    recoverySeconds: 30,
    maxDeltaSeconds: 5,
  },
};

export const DEFAULT_MAX_DELTA_SECONDS =
  DEFAULT_RISK_CONFIG.timings.maxDeltaSeconds;

export const cloneRiskConfig = (
  config: RiskDetectionConfig,
): RiskDetectionConfig => {
  return {
    thresholds: { ...config.thresholds },
    timings: { ...config.timings },
  };
};

const mergeRiskConfig = (
  current: RiskDetectionConfig,
  overrides?: RiskConfigOverrides,
): RiskDetectionConfig => {
  if (!overrides) {
    return cloneRiskConfig(current);
  }

  const mergedThresholds: RiskThresholdConfig = {
    ...current.thresholds,
    ...(overrides.thresholds ?? {}),
  };

  const mergedTimings: RiskTimingConfig = {
    ...current.timings,
    ...(overrides.timings ?? {}),
  };

  return {
    thresholds: mergedThresholds,
    timings: mergedTimings,
  };
};

const clampRiskPercent = (value: number | null, fallback: number): number => {
  if (value === null || Number.isNaN(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(100, value));
};

const createRiskEnvOverrides = (): RiskConfigOverrides => {
  const pitchDeg = parseNumericEnv(getEnvVar("POSELY_RISK_PITCH_DEG"), {
    min: 0,
    max: 45,
  });
  const ehdNorm = parseNumericEnv(getEnvVar("POSELY_RISK_EHD_NORM"), {
    min: 0,
    max: 1,
  });
  const dprDelta = parseNumericEnv(getEnvVar("POSELY_RISK_DPR_DELTA"), {
    min: 0,
    max: 0.5,
  });
  const triggerSeconds = parseNumericEnv(getEnvVar("POSELY_RISK_TRIGGER_SEC"), {
    min: 1,
    max: 600,
  });
  const recoverySeconds = parseNumericEnv(
    getEnvVar("POSELY_RISK_RECOVERY_SEC"),
    {
      min: 1,
      max: 600,
    },
  );
  const hysteresisPctRaw = parseNumericEnv(
    getEnvVar("POSELY_RISK_HYST_DELTA_PCT"),
    {
      min: 0,
      max: 100,
    },
  );
  const hysteresisDeltaPct = clampRiskPercent(
    hysteresisPctRaw,
    DEFAULT_RISK_CONFIG.thresholds.hysteresisDeltaPct,
  );

  const thresholds: Partial<RiskThresholdConfig> = {};
  if (pitchDeg !== null) {
    thresholds.pitchDeg = pitchDeg;
  }
  if (ehdNorm !== null) {
    thresholds.ehdNorm = ehdNorm;
  }
  if (dprDelta !== null) {
    thresholds.dprDelta = dprDelta;
  }
  if (hysteresisPctRaw !== null) {
    thresholds.hysteresisDeltaPct = hysteresisDeltaPct;
  }
  const degeneratePitchDeg = parseNumericEnv(
    getEnvVar("POSELY_RISK_DEGENERATE_PITCH_DEG"),
    {
      min: 0,
      max: 180,
    },
  );
  if (degeneratePitchDeg !== null) {
    thresholds.degeneratePitchDeg = degeneratePitchDeg;
  }

  const timings: Partial<RiskTimingConfig> = {};
  if (triggerSeconds !== null) {
    timings.triggerSeconds = triggerSeconds;
  }
  if (recoverySeconds !== null) {
    timings.recoverySeconds = recoverySeconds;
  }

  return {
    thresholds: Object.keys(thresholds).length > 0 ? thresholds : undefined,
    timings: Object.keys(timings).length > 0 ? timings : undefined,
  };
};

const initialRiskEnvOverrides = createRiskEnvOverrides();

let activeRiskConfig: RiskDetectionConfig = mergeRiskConfig(
  cloneRiskConfig(DEFAULT_RISK_CONFIG),
  initialRiskEnvOverrides,
);

export const getRiskDetectionConfig = (): RiskDetectionConfig => {
  return cloneRiskConfig(activeRiskConfig);
};

export const updateRiskDetectionConfig = (
  overrides: RiskConfigOverrides,
): RiskDetectionConfig => {
  activeRiskConfig = mergeRiskConfig(activeRiskConfig, overrides);
  return getRiskDetectionConfig();
};

export const resetRiskDetectionConfig = (): RiskDetectionConfig => {
  activeRiskConfig = mergeRiskConfig(
    cloneRiskConfig(DEFAULT_RISK_CONFIG),
    initialRiskEnvOverrides,
  );
  return getRiskDetectionConfig();
};

export type ThresholdDurationConfig = {
  /** Duration in seconds required to enter the unreliable state. */
  enterSeconds: number;
  /** Duration in seconds required to recover back to OK. */
  exitSeconds: number;
};

export type ThresholdHysteresisConfig = ThresholdDurationConfig & {
  /** Threshold for entering the unreliable state. */
  enterThreshold: number;
  /** Threshold for exiting (recovering from) the unreliable state. */
  exitThreshold: number;
};

export type ConfidenceGuardrailConfig = ThresholdDurationConfig & {
  /** Minimum confidence required for the face landmarks (0-1 range). */
  faceThreshold: number;
  /** Minimum confidence required for the pose landmarks (0-1 range). */
  poseThreshold: number;
};

export type IlluminationGuardrailConfig = ThresholdDurationConfig & {
  /** Minimum aggregate illumination/face-box confidence required (0-1 range). */
  illuminationThreshold: number;
};

export type DetectionGuardrailConfig = {
  yaw: ThresholdHysteresisConfig;
  roll: ThresholdHysteresisConfig;
  confidence: ConfidenceGuardrailConfig;
  illumination: IlluminationGuardrailConfig;
};

export type DetectionGuardrailOverrides = GuardrailOverrides;

export const DEFAULT_DETECTION_GUARDRAIL_CONFIG: DetectionGuardrailConfig = {
  yaw: {
    enterThreshold: 30,
    exitThreshold: 25,
    enterSeconds: 2,
    exitSeconds: 1,
  },
  roll: {
    enterThreshold: 20,
    exitThreshold: 15,
    enterSeconds: 2,
    exitSeconds: 1,
  },
  confidence: {
    faceThreshold: 0.3, // Lowered to 0.3 per Story 4.12 to improve stability in typical laptop posture
    poseThreshold: 0.3, // Lowered to 0.3 per Story 4.12 to improve stability in typical laptop posture
    enterSeconds: 2,
    exitSeconds: 1,
  },
  illumination: {
    illuminationThreshold: 0.3,
    enterSeconds: 2,
    exitSeconds: 1,
  },
};

const cloneConfig = (
  config: DetectionGuardrailConfig,
): DetectionGuardrailConfig => {
  return {
    yaw: { ...config.yaw },
    roll: { ...config.roll },
    confidence: { ...config.confidence },
    illumination: { ...config.illumination },
  };
};

const mergeHysteresisConfig = (
  current: ThresholdHysteresisConfig,
  override: Partial<ThresholdHysteresisConfig> | undefined,
): ThresholdHysteresisConfig => {
  if (!override) {
    return { ...current };
  }
  return {
    enterThreshold: override.enterThreshold ?? current.enterThreshold,
    exitThreshold: override.exitThreshold ?? current.exitThreshold,
    enterSeconds: override.enterSeconds ?? current.enterSeconds,
    exitSeconds: override.exitSeconds ?? current.exitSeconds,
  };
};

const mergeConfidenceConfig = (
  current: ConfidenceGuardrailConfig,
  override: Partial<ConfidenceGuardrailConfig> | undefined,
): ConfidenceGuardrailConfig => {
  if (!override) {
    return { ...current };
  }
  return {
    faceThreshold: override.faceThreshold ?? current.faceThreshold,
    poseThreshold: override.poseThreshold ?? current.poseThreshold,
    enterSeconds: override.enterSeconds ?? current.enterSeconds,
    exitSeconds: override.exitSeconds ?? current.exitSeconds,
  };
};

const mergeIlluminationConfig = (
  current: IlluminationGuardrailConfig,
  override: Partial<IlluminationGuardrailConfig> | undefined,
): IlluminationGuardrailConfig => {
  if (!override) {
    return { ...current };
  }
  return {
    illuminationThreshold:
      override.illuminationThreshold ?? current.illuminationThreshold,
    enterSeconds: override.enterSeconds ?? current.enterSeconds,
    exitSeconds: override.exitSeconds ?? current.exitSeconds,
  };
};

const mergeConfig = (
  current: DetectionGuardrailConfig,
  override: DetectionGuardrailOverrides,
): DetectionGuardrailConfig => {
  return {
    yaw: mergeHysteresisConfig(current.yaw, override.yaw),
    roll: mergeHysteresisConfig(current.roll, override.roll),
    confidence: mergeConfidenceConfig(current.confidence, override.confidence),
    illumination: mergeIlluminationConfig(
      current.illumination,
      override.illumination,
    ),
  } satisfies DetectionGuardrailConfig;
};

const numericOverride = (
  key: string,
  options: { min: number; max: number },
): number | null => {
  return (
    parseNumericEnv(getEnvVar(key), {
      min: options.min,
      max: options.max,
    }) ?? null
  );
};

export const createDetectionGuardrailEnvOverrides =
  (): DetectionGuardrailOverrides => {
    const overrides: DetectionGuardrailOverrides = {};

    const yawEnter = numericOverride("POSELY_GUARDRAIL_YAW_ENTER_DEG", {
      min: 0,
      max: 180,
    });
    const yawExit = numericOverride("POSELY_GUARDRAIL_YAW_EXIT_DEG", {
      min: 0,
      max: 180,
    });
    const yawEnterSeconds = numericOverride(
      "POSELY_GUARDRAIL_YAW_ENTER_SECONDS",
      {
        min: 0,
        max: 10,
      },
    );
    const yawExitSeconds = numericOverride(
      "POSELY_GUARDRAIL_YAW_EXIT_SECONDS",
      {
        min: 0,
        max: 10,
      },
    );
    if (
      yawEnter !== null ||
      yawExit !== null ||
      yawEnterSeconds !== null ||
      yawExitSeconds !== null
    ) {
      overrides.yaw = {
        enterThreshold: yawEnter ?? undefined,
        exitThreshold: yawExit ?? undefined,
        enterSeconds: yawEnterSeconds ?? undefined,
        exitSeconds: yawExitSeconds ?? undefined,
      };
    }

    const rollEnter = numericOverride("POSELY_GUARDRAIL_ROLL_ENTER_DEG", {
      min: 0,
      max: 180,
    });
    const rollExit = numericOverride("POSELY_GUARDRAIL_ROLL_EXIT_DEG", {
      min: 0,
      max: 180,
    });
    const rollEnterSeconds = numericOverride(
      "POSELY_GUARDRAIL_ROLL_ENTER_SECONDS",
      {
        min: 0,
        max: 10,
      },
    );
    const rollExitSeconds = numericOverride(
      "POSELY_GUARDRAIL_ROLL_EXIT_SECONDS",
      {
        min: 0,
        max: 10,
      },
    );
    if (
      rollEnter !== null ||
      rollExit !== null ||
      rollEnterSeconds !== null ||
      rollExitSeconds !== null
    ) {
      overrides.roll = {
        enterThreshold: rollEnter ?? undefined,
        exitThreshold: rollExit ?? undefined,
        enterSeconds: rollEnterSeconds ?? undefined,
        exitSeconds: rollExitSeconds ?? undefined,
      };
    }

    const faceThreshold = numericOverride(
      "POSELY_GUARDRAIL_CONF_FACE_THRESHOLD",
      {
        min: 0,
        max: 1,
      },
    );
    const poseThreshold = numericOverride(
      "POSELY_GUARDRAIL_CONF_POSE_THRESHOLD",
      {
        min: 0,
        max: 1,
      },
    );
    const confidenceEnterSeconds = numericOverride(
      "POSELY_GUARDRAIL_CONF_ENTER_SECONDS",
      {
        min: 0,
        max: 10,
      },
    );
    const confidenceExitSeconds = numericOverride(
      "POSELY_GUARDRAIL_CONF_EXIT_SECONDS",
      {
        min: 0,
        max: 10,
      },
    );
    if (
      faceThreshold !== null ||
      poseThreshold !== null ||
      confidenceEnterSeconds !== null ||
      confidenceExitSeconds !== null
    ) {
      overrides.confidence = {
        faceThreshold: faceThreshold ?? undefined,
        poseThreshold: poseThreshold ?? undefined,
        enterSeconds: confidenceEnterSeconds ?? undefined,
        exitSeconds: confidenceExitSeconds ?? undefined,
      };
    }

    const illuminationThreshold = numericOverride(
      "POSELY_GUARDRAIL_ILLUM_THRESHOLD",
      {
        min: 0,
        max: 1,
      },
    );
    const illuminationEnterSeconds = numericOverride(
      "POSELY_GUARDRAIL_ILLUM_ENTER_SECONDS",
      {
        min: 0,
        max: 10,
      },
    );
    const illuminationExitSeconds = numericOverride(
      "POSELY_GUARDRAIL_ILLUM_EXIT_SECONDS",
      {
        min: 0,
        max: 10,
      },
    );
    if (
      illuminationThreshold !== null ||
      illuminationEnterSeconds !== null ||
      illuminationExitSeconds !== null
    ) {
      overrides.illumination = {
        illuminationThreshold: illuminationThreshold ?? undefined,
        enterSeconds: illuminationEnterSeconds ?? undefined,
        exitSeconds: illuminationExitSeconds ?? undefined,
      };
    }

    return overrides;
  };

const initialEnvOverrides = createDetectionGuardrailEnvOverrides();

let activeConfig: DetectionGuardrailConfig = mergeConfig(
  cloneConfig(DEFAULT_DETECTION_GUARDRAIL_CONFIG),
  initialEnvOverrides,
);

export const getDetectionGuardrailConfig = (): DetectionGuardrailConfig => {
  return cloneConfig(activeConfig);
};

export const updateDetectionGuardrailConfig = (
  overrides: DetectionGuardrailOverrides,
): DetectionGuardrailConfig => {
  activeConfig = mergeConfig(activeConfig, overrides);

  return getDetectionGuardrailConfig();
};

export const resetDetectionGuardrailConfig = (): DetectionGuardrailConfig => {
  activeConfig = mergeConfig(
    cloneConfig(DEFAULT_DETECTION_GUARDRAIL_CONFIG),
    initialEnvOverrides,
  );
  return getDetectionGuardrailConfig();
};
