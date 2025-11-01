export type PresenceState = "PRESENT" | "ABSENT";

export type PresenceSnapshot = {
  state: PresenceState;
  consecutiveFrames: number;
  lastStateChangeAt: number;
  lastUpdatedAt: number;
  faceConfidence: number | null;
  poseConfidence: number | null;
};

export type CoreRiskState = "GOOD" | "AT_RISK" | "BAD_POSTURE" | "RECOVERING";

export type RiskState = "INITIAL" | CoreRiskState | "IDLE" | "UNRELIABLE";

export type RiskTimers = {
  good: number;
  atRisk: number;
  badPosture: number;
};

export type EngineReliability = "OK" | "UNRELIABLE";

export type EngineStateSnapshot = {
  state: RiskState;
  presence: PresenceState;
  updatedAt: number;
  timers: RiskTimers;
  reliability: EngineReliability;
};
