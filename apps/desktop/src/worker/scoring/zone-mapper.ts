import type { ScoreZone } from "../../shared/types/score";

const getZone = (score: number): ScoreZone => {
  if (!Number.isFinite(score)) return "YELLOW";
  if (score >= 80) return "GREEN";
  if (score >= 60) return "YELLOW";
  return "RED";
};

export default getZone;
