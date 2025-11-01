export type ScoreZone = "GREEN" | "YELLOW" | "RED";

export type ScoreFreezeReason =
  | "missing-metrics"
  | "baseline-pending"
  | "low-confidence"
  | "unreliable";

export type ScoreSample = {
  raw: number;
  ema: number;
  zone: ScoreZone;
  frozen: boolean;
  reason: ScoreFreezeReason | null;
};
