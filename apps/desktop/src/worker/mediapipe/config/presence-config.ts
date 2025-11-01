import { getEnvVar, parseNumericEnv } from "../../../shared/env";

export type FacePresenceConfig = {
  /** Minimum normalized face bounding-box area (fraction of frame). */
  minArea: number;
  /** Maximum normalized face bounding-box area (fraction of frame). */
  maxArea: number;
  /** Fallback stability score when no previous track exists. */
  stabilityFallback: number;
  /** Weight applied to area score when combining with stability. */
  areaWeight: number;
  /** Weight applied to stability score when combining with area. */
  stabilityWeight: number;
  /** Multiplier applied when multiple faces are detected. */
  multiplePenalty: number;
};

const DEFAULT_FACE_PRESENCE_CONFIG: FacePresenceConfig = {
  minArea: 0.004,
  maxArea: 0.09,
  stabilityFallback: 0.7,
  areaWeight: 0.65,
  stabilityWeight: 0.35,
  multiplePenalty: 0.6,
};

const getNumericOverride = (
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

export const getFacePresenceConfig = (): FacePresenceConfig => {
  const config = { ...DEFAULT_FACE_PRESENCE_CONFIG };

  const minArea = getNumericOverride("POSELY_FACE_PRESENCE_MIN_AREA", {
    min: 1e-4,
    max: 0.5,
  });
  if (minArea !== null) {
    config.minArea = minArea;
  }

  const maxArea = getNumericOverride("POSELY_FACE_PRESENCE_MAX_AREA", {
    min: config.minArea + 1e-4,
    max: 1,
  });
  if (maxArea !== null) {
    config.maxArea = maxArea;
  }

  const stabilityFallback = getNumericOverride(
    "POSELY_FACE_PRESENCE_STABILITY_FALLBACK",
    {
      min: 0,
      max: 1,
    },
  );
  if (stabilityFallback !== null) {
    config.stabilityFallback = stabilityFallback;
  }

  const areaWeight = getNumericOverride("POSELY_FACE_PRESENCE_AREA_WEIGHT", {
    min: 0,
    max: 1,
  });
  const stabilityWeight = getNumericOverride(
    "POSELY_FACE_PRESENCE_STABILITY_WEIGHT",
    {
      min: 0,
      max: 1,
    },
  );

  if (areaWeight !== null && stabilityWeight !== null) {
    const total = areaWeight + stabilityWeight;
    if (total > 0) {
      config.areaWeight = areaWeight / total;
      config.stabilityWeight = stabilityWeight / total;
    }
  }

  const multiplePenalty = getNumericOverride(
    "POSELY_FACE_PRESENCE_MULTIPLE_PENALTY",
    {
      min: 0,
      max: 1,
    },
  );
  if (multiplePenalty !== null) {
    config.multiplePenalty = multiplePenalty;
  }

  return config;
};

export const FACE_PRESENCE_CONFIG = getFacePresenceConfig();
