import type { PoseKeypoint } from "../types/calibration";
import type { EngineTick, EngineZone } from "../types/engine";

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(max, Math.max(min, value));
};

type AnalyzerThresholds = {
  green: number;
  yellow: number;
};

type PostureAnalyzerOptions = {
  baseline: PoseKeypoint[];
  thresholds?: AnalyzerThresholds;
  smoothing?: number;
  calibrated?: boolean;
};

type PairedKeypoint = {
  baseline: PoseKeypoint;
  current: PoseKeypoint;
};

const DEFAULT_THRESHOLDS: AnalyzerThresholds = {
  green: 0.025,
  yellow: 0.075,
};

const DEFAULT_SMOOTHING = 0.2;

const pairKeypoints = (
  baseline: PoseKeypoint[],
  current: PoseKeypoint[],
): PairedKeypoint[] => {
  if (baseline.length === 0 || current.length === 0) {
    return [];
  }

  const pairs: PairedKeypoint[] = [];
  const currentByName = new Map<string, PoseKeypoint>();

  current.forEach((point) => {
    if (point.name) {
      currentByName.set(point.name, point);
    }
  });

  baseline.forEach((reference, index) => {
    let match: PoseKeypoint | undefined;
    if (reference.name && currentByName.has(reference.name)) {
      match = currentByName.get(reference.name);
    } else {
      match = current[index];
    }

    if (match) {
      pairs.push({
        baseline: reference,
        current: match,
      });
    }
  });

  return pairs;
};

const distance = (a: PoseKeypoint, b: PoseKeypoint): number => {
  const dx = (a.x ?? 0) - (b.x ?? 0);
  const dy = (a.y ?? 0) - (b.y ?? 0);
  const dz = (a.z ?? 0) - (b.z ?? 0);

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

export class PostureAnalyzer {
  private readonly baseline: PoseKeypoint[];

  private readonly thresholds: AnalyzerThresholds;

  private readonly smoothing: number;

  private readonly calibrated: boolean;

  private smoothedScore: number | null = null;

  constructor({
    baseline,
    thresholds = DEFAULT_THRESHOLDS,
    smoothing = DEFAULT_SMOOTHING,
    calibrated = true,
  }: PostureAnalyzerOptions) {
    this.baseline = baseline;
    this.thresholds = thresholds;
    this.smoothing = clamp(smoothing, 0, 1);
    this.calibrated = calibrated;
  }

  evaluate(current: PoseKeypoint[], timestamp: number): EngineTick {
    const pairs = pairKeypoints(this.baseline, current);

    if (pairs.length === 0) {
      return {
        t: timestamp,
        presence: "ABSENT",
        reliability: "UNRELIABLE",
        metrics: {
          pitchDeg: 0,
          ehdNorm: 0,
          dpr: 0,
          conf: 0,
        },
        score: 0,
        zone: "RED",
        state: "IDLE",
      };
    }

    let cumulativeDeviation = 0;
    let cumulativeVisibility = 0;

    pairs.forEach((pair) => {
      cumulativeDeviation += distance(pair.baseline, pair.current);
      cumulativeVisibility += pair.current.visibility ?? 1;
    });

    const averageDeviation = cumulativeDeviation / pairs.length;
    const averageVisibility = cumulativeVisibility / pairs.length;

    const presence =
      averageVisibility >= 0.35 && pairs.length >= 4 ? "PRESENT" : "ABSENT";

    const rawScore = clamp(100 - averageDeviation * 1000, 0, 100);

    if (this.smoothedScore === null) {
      this.smoothedScore = rawScore;
    } else {
      this.smoothedScore =
        this.smoothedScore * (1 - this.smoothing) + rawScore * this.smoothing;
    }

    let zone: EngineZone = "RED";
    if (averageDeviation <= this.thresholds.green) {
      zone = "GREEN";
    } else if (averageDeviation <= this.thresholds.yellow) {
      zone = "YELLOW";
    }

    const reliability =
      presence === "PRESENT" && this.calibrated && averageVisibility >= 0.5
        ? "OK"
        : "UNRELIABLE";

    let state: EngineTick["state"] = "BAD_POSTURE";
    if (reliability === "UNRELIABLE") {
      state = "UNRELIABLE";
    } else if (zone === "GREEN") {
      state = "GOOD";
    } else if (zone === "YELLOW") {
      state = "AT_RISK";
    }

    const confidence = clamp(averageVisibility, 0, 1);
    const downscalePerceptionRatio = clamp(
      1 - averageDeviation / (this.thresholds.yellow * 1.5),
      0,
      1,
    );

    return {
      t: timestamp,
      presence,
      reliability,
      metrics: {
        pitchDeg: Number((averageDeviation * 90).toFixed(2)),
        ehdNorm: Number(averageDeviation.toFixed(4)),
        dpr: Number(downscalePerceptionRatio.toFixed(4)),
        conf: Number(confidence.toFixed(4)),
      },
      score: Math.round(this.smoothedScore),
      zone,
      state,
    };
  }
}

export const createDefaultBaseline = (): PoseKeypoint[] => {
  return [
    { name: "nose", x: 0.5, y: 0.2, z: 0.0, visibility: 1 },
    { name: "left_shoulder", x: 0.4, y: 0.5, z: 0.0, visibility: 1 },
    { name: "right_shoulder", x: 0.6, y: 0.5, z: 0.0, visibility: 1 },
    { name: "mid_hip", x: 0.5, y: 0.8, z: 0.0, visibility: 1 },
    { name: "left_ear", x: 0.42, y: 0.18, z: 0.0, visibility: 0.95 },
    { name: "right_ear", x: 0.58, y: 0.18, z: 0.0, visibility: 0.95 },
  ];
};
