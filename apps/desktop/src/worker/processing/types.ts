import type { DetectionReliability } from "../../shared/types/landmarks";
import type {
  MetricConfidence,
  MetricSource,
} from "../../shared/types/metrics";

export type MetricKey = "pitch" | "yaw" | "roll" | "ehd" | "dpr";

export type MetricSample = {
  key: MetricKey;
  rawValue: number | null;
  confidence: MetricConfidence;
  source: MetricSource;
};

export type SignalProcessingContext = {
  deltaSeconds: number;
  reliability: DetectionReliability;
  frameConfidence: number | null;
};

export type SignalProcessingResult = {
  raw: number | null;
  smoothed: number | null;
  outlier: boolean;
  gated: boolean;
  reliabilityPaused: boolean;
  updated: boolean;
};
