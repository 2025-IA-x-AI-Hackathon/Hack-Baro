import type {
  EngineDiagnostics,
  EngineTick,
  EngineTickMetrics,
} from "../../shared/types/engine-output";
import type {
  EngineReliability,
  PresenceState,
  RiskState,
} from "../../shared/types/engine-state";
import type {
  MetricConfidence,
  MetricValues,
} from "../../shared/types/metrics";
import type { ScoreSample, ScoreZone } from "../../shared/types/score";
import getZone from "../scoring/zone-mapper";
import type { RiskMachineSnapshot } from "../state-machine";
import type { EngineDiagnosticsInput, EngineTickBuildInput } from "./types";

export type EngineOutputBuilderOptions = {
  neutralScore?: number;
};

const DEFAULT_NEUTRAL_SCORE = 35;

const normaliseScore = (value: number | null | undefined): number | null => {
  if (!Number.isFinite(value)) {
    return null;
  }
  const numeric = value as number;
  const clamped = Math.max(0, Math.min(100, numeric));
  return Number(clamped.toFixed(1));
};

const metricConfidenceToNumeric = (confidence: MetricConfidence): number => {
  switch (confidence) {
    case "HIGH":
      return 0.9;
    case "LOW":
      return 0.5;
    default:
      return 0;
  }
};

const pickMetricValue = (series: MetricValues["metrics"]["pitch"]): number => {
  const { smoothed, raw } = series;
  if (Number.isFinite(smoothed)) {
    return smoothed as number;
  }
  if (Number.isFinite(raw)) {
    return raw as number;
  }
  return 0;
};

const resolveConfidence = (
  presence: EngineTickBuildInput["presence"],
  metrics: MetricValues | null | undefined,
): number => {
  const values: number[] = [];
  if (
    presence?.faceConfidence !== null &&
    presence?.faceConfidence !== undefined
  ) {
    if (Number.isFinite(presence.faceConfidence)) {
      values.push(presence.faceConfidence);
    }
  }
  if (
    presence?.poseConfidence !== null &&
    presence?.poseConfidence !== undefined
  ) {
    if (Number.isFinite(presence.poseConfidence)) {
      values.push(presence.poseConfidence);
    }
  }
  if (metrics) {
    values.push(metricConfidenceToNumeric(metrics.metrics.pitch.confidence));
    values.push(metricConfidenceToNumeric(metrics.metrics.ehd.confidence));
    values.push(metricConfidenceToNumeric(metrics.metrics.dpr.confidence));
    if (metrics.flags.lowConfidence) {
      values.push(0.3);
    }
  }
  if (values.length === 0) {
    return 0;
  }
  const min = Math.max(0, Math.min(...values));
  return Number(min.toFixed(3));
};

const toEngineMetrics = (
  metrics: MetricValues | null | undefined,
  presence: PresenceState,
): EngineTickMetrics => {
  if (!metrics || presence === "ABSENT") {
    return {
      pitchDeg: 0,
      ehdNorm: 0,
      dpr: 1,
      conf: 0,
    };
  }

  return {
    pitchDeg: Number(pickMetricValue(metrics.metrics.pitch).toFixed(3)),
    ehdNorm: Number(pickMetricValue(metrics.metrics.ehd).toFixed(3)),
    dpr: Number(pickMetricValue(metrics.metrics.dpr).toFixed(3)),
    conf: 0,
  };
};

const resolveState = (
  risk: RiskMachineSnapshot | null | undefined,
  presence: PresenceState,
  reliability: EngineReliability,
): RiskState => {
  if (risk?.state) {
    return risk.state;
  }
  if (reliability === "UNRELIABLE") {
    return "UNRELIABLE";
  }
  if (presence === "ABSENT") {
    return "IDLE";
  }
  return "INITIAL";
};

const resolveDiagnostics = (
  diagnostics?: EngineDiagnosticsInput | null,
): EngineDiagnostics | undefined => {
  if (!diagnostics) {
    return undefined;
  }

  const resolved: EngineDiagnostics = {};

  if (
    Number.isFinite(diagnostics.inputWidth) &&
    (diagnostics.inputWidth as number) > 0
  ) {
    resolved.inputWidth = Math.round(diagnostics.inputWidth as number);
  }

  let fps: number | null = null;
  if (Number.isFinite(diagnostics.fps)) {
    fps = diagnostics.fps as number;
  } else if (
    Number.isFinite(diagnostics.frameIntervalMs) &&
    (diagnostics.frameIntervalMs as number) > 0
  ) {
    fps = 1000 / (diagnostics.frameIntervalMs as number);
  }

  if (fps !== null && Number.isFinite(fps)) {
    resolved.fps = Number(fps.toFixed(2));
  }

  if (diagnostics.dominantTrackId) {
    resolved.dominantTrackId = diagnostics.dominantTrackId;
  }

  return Object.keys(resolved).length > 0 ? resolved : undefined;
};

const resolvePresence = (
  presence: EngineTickBuildInput["presence"],
  risk: RiskMachineSnapshot | null | undefined,
): PresenceState => {
  if (presence?.state) {
    return presence.state;
  }
  if (risk?.presence) {
    return risk.presence;
  }
  return "ABSENT";
};

const resolveReliability = (
  input: EngineTickBuildInput,
  risk: RiskMachineSnapshot | null | undefined,
): EngineReliability => {
  if (input.reliability) {
    return input.reliability;
  }
  if (risk?.reliability) {
    return risk.reliability;
  }
  return "OK";
};

export class EngineOutputBuilder {
  private readonly neutralScore: number;

  private lastScore: number;

  private lastZone: ScoreZone;

  constructor(options?: EngineOutputBuilderOptions) {
    const configuredNeutral = options?.neutralScore ?? DEFAULT_NEUTRAL_SCORE;
    const neutral = normaliseScore(configuredNeutral) ?? DEFAULT_NEUTRAL_SCORE;
    this.neutralScore = neutral;
    this.lastScore = neutral;
    this.lastZone = getZone(Math.floor(this.lastScore));
  }

  reset(): void {
    this.lastScore = this.neutralScore;
    this.lastZone = getZone(Math.floor(this.neutralScore));
  }

  build(input: EngineTickBuildInput): EngineTick {
    const timestamp = Number.isFinite(input.timestamp)
      ? Math.trunc(input.timestamp)
      : Date.now();

    const { risk } = input;
    const presence = resolvePresence(input.presence, risk);
    const reliability = resolveReliability(input, risk);
    const metrics = toEngineMetrics(input.metrics, presence);
    if (presence !== "ABSENT") {
      metrics.conf = resolveConfidence(input.presence, input.metrics);
    } else {
      metrics.conf = 0;
    }

    const { score, zone } = this.resolveScore(input.score);
    const state = resolveState(risk, presence, reliability);
    const diagnostics = resolveDiagnostics(input.diagnostics);

    const tick: EngineTick = {
      t: timestamp,
      presence,
      reliability,
      metrics,
      score,
      zone,
      state,
    };

    if (diagnostics) {
      tick.diagnostics = diagnostics;
    }

    return tick;
  }

  private resolveScore(sample: ScoreSample | null | undefined): {
    score: number;
    zone: ScoreZone;
  } {
    if (!sample) {
      return {
        score: this.lastScore,
        zone: this.lastZone,
      };
    }

    let baseValue: number | null = null;
    if (Number.isFinite(sample.ema)) {
      baseValue = sample.ema;
    } else if (Number.isFinite(sample.raw)) {
      baseValue = sample.raw;
    }

    if (baseValue === null) {
      return {
        score: this.lastScore,
        zone: this.lastZone,
      };
    }

    const candidateScore = normaliseScore(baseValue);
    if (candidateScore === null) {
      return {
        score: this.lastScore,
        zone: this.lastZone,
      };
    }

    const candidateZone = sample.zone ?? getZone(Math.floor(candidateScore));

    if (!sample.frozen) {
      this.lastScore = candidateScore;
      this.lastZone = candidateZone;
      return {
        score: this.lastScore,
        zone: this.lastZone,
      };
    }

    if (this.lastScore === undefined || this.lastZone === undefined) {
      this.lastScore = candidateScore;
      this.lastZone = candidateZone;
    }

    return {
      score: this.lastScore,
      zone: this.lastZone,
    };
  }
}
