import type {
  CalibrationBaselineMetrics,
  CalibrationQualitySnapshot,
  CalibrationSample,
} from "../../shared/types/calibration";

export type BaselineComputationResult = CalibrationBaselineMetrics &
  CalibrationQualitySnapshot & {
    pitchStdDev: number;
    ehdStdDev: number;
    dprStdDev: number;
  };

export type BaselineCalculatorOptions = {
  targetSamples?: number;
  minConfidence?: number;
  sessionWindow?: number;
};

export type BaselineSampleOutcome =
  | "accepted"
  | "low-confidence"
  | "unreliable"
  | "invalid";

const DEFAULT_TARGET_SAMPLES = 50;
const DEFAULT_MIN_CONFIDENCE = 0.3;
const DEFAULT_STABILITY_WINDOW = 25;

const confidenceNormaliser = (confidence: number | null): number => {
  if (!Number.isFinite(confidence) || confidence === null) {
    return 0;
  }
  if (confidence < 0) {
    return 0;
  }
  if (confidence > 1) {
    return 1;
  }
  return confidence;
};

const calculateMean = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
};

const calculateStdDev = (values: number[], mean: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const variance =
    values.reduce((accumulator, value) => {
      const delta = value - mean;
      return accumulator + delta * delta;
    }, 0) / values.length;
  return Math.sqrt(Math.max(variance, 0));
};

const qualityFromStd = (pitchStd: number, ehdStd: number): number => {
  const qualityPitch = Math.max(0, 100 - pitchStd * 50);
  const qualityEhd = Math.max(0, 100 - ehdStd * 500);
  return (qualityPitch + qualityEhd) / 2;
};

export class BaselineCalculator {
  private readonly samples: CalibrationSample[] = [];

  private readonly targetSamples: number;

  private readonly minConfidence: number;

  private readonly stabilityWindow: number;

  constructor(options: BaselineCalculatorOptions = {}) {
    this.targetSamples = Math.max(
      1,
      Math.floor(options.targetSamples ?? DEFAULT_TARGET_SAMPLES),
    );
    this.minConfidence = confidenceNormaliser(
      options.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
    );
    this.stabilityWindow = Math.max(
      5,
      Math.floor(options.sessionWindow ?? DEFAULT_STABILITY_WINDOW),
    );
  }

  addSample(sample: CalibrationSample): BaselineSampleOutcome {
    const rawConfidence = confidenceNormaliser(sample.confidence);
    let effectiveConfidence = rawConfidence;
    if (rawConfidence < this.minConfidence) {
      if (sample.reliability === "UNRELIABLE") {
        return "unreliable";
      }
      effectiveConfidence = this.minConfidence;
    }

    const { pitch, ehd, dpr } = sample;

    if (
      pitch === null ||
      ehd === null ||
      dpr === null ||
      Number.isNaN(pitch) ||
      Number.isNaN(ehd) ||
      Number.isNaN(dpr)
    ) {
      return "invalid";
    }

    this.samples.push({
      pitch,
      ehd,
      dpr,
      confidence: effectiveConfidence,
      timestamp: sample.timestamp,
      reliability: sample.reliability,
    });
    return "accepted";
  }

  getSampleCount(): number {
    return this.samples.length;
  }

  getTargetSamples(): number {
    return this.targetSamples;
  }

  isComplete(): boolean {
    return this.samples.length >= this.targetSamples;
  }

  estimateStability(windowSize?: number): number {
    const window = Math.max(
      5,
      Math.min(
        typeof windowSize === "number" ? windowSize : this.stabilityWindow,
        this.samples.length,
      ),
    );

    if (this.samples.length === 0) {
      return 0;
    }

    const windowSamples = this.samples.slice(-window);
    const pitchValues = windowSamples.map((sample) => sample.pitch as number);
    const ehdValues = windowSamples.map((sample) => sample.ehd as number);

    const pitchStd = calculateStdDev(pitchValues, calculateMean(pitchValues));
    const ehdStd = calculateStdDev(ehdValues, calculateMean(ehdValues));

    const quality = qualityFromStd(pitchStd, ehdStd);
    return Math.round(quality);
  }

  calculate(): BaselineComputationResult {
    if (!this.isComplete()) {
      throw new Error("Insufficient samples for calibration baseline");
    }

    const pitchValues = this.samples.map((sample) => sample.pitch as number);
    const ehdValues = this.samples.map((sample) => sample.ehd as number);
    const dprValues = this.samples.map((sample) => sample.dpr as number);

    const baselinePitch = calculateMean(pitchValues);
    const baselineEHD = calculateMean(ehdValues);
    const baselineDPR = calculateMean(dprValues);

    const pitchStdDev = calculateStdDev(pitchValues, baselinePitch);
    const ehdStdDev = calculateStdDev(ehdValues, baselineEHD);
    const dprStdDev = calculateStdDev(dprValues, baselineDPR);

    const quality = qualityFromStd(pitchStdDev, ehdStdDev);

    return {
      baselinePitch,
      baselineEHD,
      baselineDPR,
      quality: Math.round(quality),
      sampleCount: this.samples.length,
      pitchStdDev,
      ehdStdDev,
      dprStdDev,
    };
  }

  reset(): void {
    this.samples.splice(0, this.samples.length);
  }
}

export default BaselineCalculator;
