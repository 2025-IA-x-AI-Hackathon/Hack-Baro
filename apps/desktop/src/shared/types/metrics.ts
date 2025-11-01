export type MetricConfidence = "HIGH" | "LOW" | "NONE";

export type MetricSource =
  | "pose-world"
  | "pose-image"
  | "face-transform"
  | "solve-pnp"
  | "dpr-baseline"
  | "unknown";

export type MetricSeries = {
  raw: number | null;
  smoothed: number | null;
  confidence: MetricConfidence;
  source: MetricSource;
  outlier: boolean;
  gated: boolean;
  reliabilityPaused: boolean;
};

export type MetricFrameFlags = {
  yawDeweighted: boolean;
  lowConfidence: boolean;
  baselinePending: boolean;
};

export type MetricValues = {
  frameId: number;
  timestamp: number;
  baselineFaceSize: number | null;
  metrics: {
    ehd: MetricSeries;
    pitch: MetricSeries;
    yaw: MetricSeries;
    roll: MetricSeries;
    dpr: MetricSeries;
  };
  flags: MetricFrameFlags;
};
