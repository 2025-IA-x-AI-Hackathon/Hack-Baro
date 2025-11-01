import type { FaceLandmarks } from "../../shared/types/landmarks";
import type {
  MetricConfidence,
  MetricSource,
} from "../../shared/types/metrics";

export type DprComputationResult = {
  size: number | null;
  ratio: number | null;
  confidence: MetricConfidence;
  source: MetricSource;
};

const toConfidence = (confidence: number | undefined): MetricConfidence => {
  if (confidence === undefined) {
    return "NONE";
  }
  if (!Number.isFinite(confidence)) {
    return "NONE";
  }
  if (confidence >= 0.3) {
    return "HIGH";
  }
  if (confidence >= 0.1) {
    return "LOW";
  }
  return "NONE";
};

type BoundingBox = {
  width: number;
  height: number;
};

const computeBoundingBox = (face: FaceLandmarks): BoundingBox | null => {
  if (!Array.isArray(face.landmarks) || face.landmarks.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  face.landmarks.forEach((landmark) => {
    if (!landmark) {
      return;
    }

    const { x, y } = landmark;

    if (Number.isFinite(x)) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    if (Number.isFinite(y)) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  });

  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) {
    return null;
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return null;
  }

  const width = Math.max(maxX - minX, 0);
  const height = Math.max(maxY - minY, 0);

  if (width <= 0 || height <= 0) {
    return null;
  }

  return { width, height } satisfies BoundingBox;
};

const computeSize = (box: BoundingBox | null): number | null => {
  if (!box) {
    return null;
  }
  const area = Math.max(box.width * box.height, 0);
  if (!Number.isFinite(area) || area <= 0) {
    return null;
  }
  return Math.sqrt(area);
};

export const computeDpr = (
  face: FaceLandmarks | null | undefined,
  baselineSize: number | null,
): DprComputationResult => {
  if (!face) {
    return {
      size: null,
      ratio: null,
      confidence: "NONE",
      source: "unknown",
    } satisfies DprComputationResult;
  }

  const confidence = toConfidence(face.confidence);
  const box = computeBoundingBox(face);
  const size = computeSize(box);

  if (!Number.isFinite(size) || size === null) {
    return {
      size: null,
      ratio: null,
      confidence,
      source: "unknown",
    } satisfies DprComputationResult;
  }

  if (
    !Number.isFinite(baselineSize) ||
    baselineSize === null ||
    baselineSize <= 0
  ) {
    return {
      size,
      ratio: 1,
      confidence,
      source: "unknown",
    } satisfies DprComputationResult;
  }

  const ratio = size / baselineSize;

  return {
    size,
    ratio: Number.isFinite(ratio) ? ratio : null,
    confidence,
    source: "dpr-baseline",
  } satisfies DprComputationResult;
};
