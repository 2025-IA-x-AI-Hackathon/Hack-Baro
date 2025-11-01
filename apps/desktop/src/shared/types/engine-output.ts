import type {
  EngineReliability,
  PresenceState,
  RiskState,
} from "./engine-state";
import type { ScoreZone } from "./score";

export type EngineTickMetrics = {
  /** Head pitch in degrees (positive = forward tilt). */
  pitchDeg: number;
  /** Ear-shoulder horizontal distance (normalised 0-1+). */
  ehdNorm: number;
  /** Depth proxy ratio (1.0 = calibrated baseline). */
  dpr: number;
  /** Overall detection confidence [0, 1]. */
  conf: number;
};

export type EngineDiagnostics = {
  /** Effective input width for the processed frame. */
  inputWidth?: number;
  /** Frames per second currently achieved by the engine. */
  fps?: number;
  /** Debug-only identifier for the dominant detected track. */
  dominantTrackId?: string;
};

/**
 * Stable contract emitted by the detection engine on every processing cycle.
 * Consumed by UI (Epic 1) and dashboard surfaces (Epic 2).
 */
export interface EngineTick {
  /** Unix timestamp in milliseconds when the tick was produced. */
  t: number;
  /** Presence classification derived from face and pose tracking. */
  presence: PresenceState;
  /** Reliability classification after guardrail evaluation. */
  reliability: EngineReliability;
  /** Raw biomechanical metrics used for scoring. */
  metrics: EngineTickMetrics;
  /** Posture score, 0-100, rounded after EMA smoothing. */
  score: number;
  /** Colour zone derived from score thresholds. */
  zone: ScoreZone;
  /** Envelope state from the risk state machine plus reliability gating. */
  state: RiskState;
  /** Optional diagnostics exposed for QA and tuning workflows. */
  diagnostics?: EngineDiagnostics;
}
