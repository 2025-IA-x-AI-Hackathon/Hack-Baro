import { getEnvVar, parseNumericEnv } from "../../shared/env";
import type { ScoreWeights } from "../scoring/calculator";

export type ScoreConfigOverrides = Partial<{
  alpha: number;
  neutralScore: number;
  weights: Partial<ScoreWeights>;
}>;

export type ResolvedScoreConfig = {
  alpha: number;
  neutralScore: number;
  weights: ScoreWeights;
};

const DEFAULT_SCORE_CONFIG: ResolvedScoreConfig = {
  alpha: 0.2,
  neutralScore: 70,
  weights: {
    pitchPerDegree: 3,
    ehdPerUnit: 250,
    dprPerUnit: 150,
  },
};

const clampAlpha = (value: number | null | undefined): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_SCORE_CONFIG.alpha;
  }
  return Math.min(Math.max(value as number, 0.01), 1);
};

const clampNeutral = (value: number | null | undefined): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_SCORE_CONFIG.neutralScore;
  }
  return Math.min(Math.max(value as number, 0), 100);
};

const clampWeight = (value: number | null | undefined, fallback: number) => {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(Math.max(value as number, 0), 1000);
};

const cloneScoreConfig = (config: ResolvedScoreConfig): ResolvedScoreConfig => {
  return {
    alpha: config.alpha,
    neutralScore: config.neutralScore,
    weights: {
      pitchPerDegree: config.weights.pitchPerDegree,
      ehdPerUnit: config.weights.ehdPerUnit,
      dprPerUnit: config.weights.dprPerUnit,
    },
  };
};

const mergeScoreConfig = (
  config: ResolvedScoreConfig,
  overrides?: ScoreConfigOverrides | null,
): ResolvedScoreConfig => {
  if (!overrides) {
    return cloneScoreConfig(config);
  }

  const next = cloneScoreConfig(config);

  if (overrides.alpha !== undefined) {
    next.alpha = clampAlpha(overrides.alpha);
  }
  if (overrides.neutralScore !== undefined) {
    next.neutralScore = clampNeutral(overrides.neutralScore);
  }
  if (overrides.weights) {
    next.weights = {
      pitchPerDegree: clampWeight(
        overrides.weights.pitchPerDegree,
        next.weights.pitchPerDegree,
      ),
      ehdPerUnit: clampWeight(
        overrides.weights.ehdPerUnit,
        next.weights.ehdPerUnit,
      ),
      dprPerUnit: clampWeight(
        overrides.weights.dprPerUnit,
        next.weights.dprPerUnit,
      ),
    };
  }

  return next;
};

const createEnvOverrides = (): ScoreConfigOverrides | null => {
  const alpha = parseNumericEnv(getEnvVar("POSELY_SCORE_ALPHA"), {
    min: 0.01,
    max: 1,
  });
  const neutralScore = parseNumericEnv(getEnvVar("POSELY_SCORE_NEUTRAL"), {
    min: 0,
    max: 100,
  });
  const pitchPerDegree = parseNumericEnv(getEnvVar("POSELY_SCORE_W_PITCH"), {
    min: 0,
    max: 1000,
  });
  const ehdPerUnit = parseNumericEnv(getEnvVar("POSELY_SCORE_W_EHD"), {
    min: 0,
    max: 1000,
  });
  const dprPerUnit = parseNumericEnv(getEnvVar("POSELY_SCORE_W_DPR"), {
    min: 0,
    max: 1000,
  });

  const weights: Partial<ScoreWeights> = {};
  if (pitchPerDegree !== null) {
    weights.pitchPerDegree = pitchPerDegree;
  }
  if (ehdPerUnit !== null) {
    weights.ehdPerUnit = ehdPerUnit;
  }
  if (dprPerUnit !== null) {
    weights.dprPerUnit = dprPerUnit;
  }

  const overrides: ScoreConfigOverrides = {};
  if (alpha !== null) {
    overrides.alpha = alpha;
  }
  if (neutralScore !== null) {
    overrides.neutralScore = neutralScore;
  }
  if (Object.keys(weights).length > 0) {
    overrides.weights = weights;
  }

  return Object.keys(overrides).length > 0 ? overrides : null;
};

const initialOverrides = createEnvOverrides();

let activeScoreConfig: ResolvedScoreConfig = mergeScoreConfig(
  DEFAULT_SCORE_CONFIG,
  initialOverrides,
);

export const getScoreConfig = (): ResolvedScoreConfig => {
  return cloneScoreConfig(activeScoreConfig);
};

export const updateScoreConfig = (
  overrides: ScoreConfigOverrides,
): ResolvedScoreConfig => {
  activeScoreConfig = mergeScoreConfig(activeScoreConfig, overrides);
  return getScoreConfig();
};

export const resetScoreConfig = (): ResolvedScoreConfig => {
  activeScoreConfig = mergeScoreConfig(DEFAULT_SCORE_CONFIG, initialOverrides);
  return getScoreConfig();
};
