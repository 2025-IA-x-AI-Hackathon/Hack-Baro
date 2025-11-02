export type EnginePresence = "PRESENT" | "ABSENT";

export type EngineReliability = "OK" | "UNRELIABLE";

export type EngineZone = "GREEN" | "YELLOW" | "RED";

export type EngineState =
  | "GOOD"
  | "AT_RISK"
  | "BAD_POSTURE"
  | "RECOVERING"
  | "IDLE"
  | "UNRELIABLE"
  | "INITIAL";

export type EngineMetrics = {
  pitchDeg: number;
  ehdNorm: number;
  dpr: number;
  conf: number;
};

export type EngineTick = {
  t: number;
  presence: EnginePresence;
  reliability: EngineReliability;
  metrics: EngineMetrics;
  score: number;
  zone: EngineZone;
  state: EngineState;
};
