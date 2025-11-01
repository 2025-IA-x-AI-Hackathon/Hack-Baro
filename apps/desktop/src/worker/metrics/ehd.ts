import type {
  Landmark,
  PoseLandmark,
  PoseLandmarks,
  WorldLandmark,
} from "../../shared/types/landmarks";
import type {
  MetricConfidence,
  MetricSource,
} from "../../shared/types/metrics";

export type EhdComputationResult = {
  value: number | null;
  source: MetricSource;
  confidence: MetricConfidence;
  usedWorldLandmarks: boolean;
};

const LEFT_EAR_INDEX = 7;
const RIGHT_EAR_INDEX = 8;
const LEFT_SHOULDER_INDEX = 11;
const RIGHT_SHOULDER_INDEX = 12;

type ExtractableLandmarks = Array<Landmark | PoseLandmark | WorldLandmark>;

const selectLandmark = <T extends Landmark | PoseLandmark | WorldLandmark>(
  landmarks: T[] | undefined,
  index: number,
): T | null => {
  if (!landmarks || index < 0 || index >= landmarks.length) {
    return null;
  }
  const landmark = landmarks[index];
  if (!landmark) {
    return null;
  }
  const { x, y } = landmark;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return landmark;
};

const averagePoint = (points: ExtractableLandmarks): Landmark | null => {
  const valid = points.filter(
    (point): point is Landmark | PoseLandmark | WorldLandmark => {
      return (
        !!point &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        Number.isFinite(point.z)
      );
    },
  );

  if (valid.length === 0) {
    return null;
  }

  const sum = valid.reduce(
    (accumulator, point) => ({
      x: accumulator.x + point.x,
      y: accumulator.y + point.y,
      z: accumulator.z + point.z,
    }),
    { x: 0, y: 0, z: 0 },
  );

  return {
    x: sum.x / valid.length,
    y: sum.y / valid.length,
    z: sum.z / valid.length,
  } satisfies Landmark;
};

const computeShoulderWidth = (
  shoulders: [Landmark | null, Landmark | null],
): number | null => {
  const [left, right] = shoulders;
  if (!left || !right) {
    return null;
  }
  if (!Number.isFinite(left.x) || !Number.isFinite(right.x)) {
    return null;
  }
  const width = Math.abs(left.x - right.x);
  if (width < 1e-5) {
    return null;
  }
  return width;
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

const calculateFromLandmarks = (
  landmarks: ExtractableLandmarks,
): Landmark | null => {
  return averagePoint(landmarks);
};

export const computeEhd = (
  pose: PoseLandmarks | null | undefined,
): EhdComputationResult => {
  if (!pose) {
    return {
      value: null,
      source: "unknown",
      confidence: "NONE",
      usedWorldLandmarks: false,
    } satisfies EhdComputationResult;
  }

  const confidence = toConfidence(pose.confidence);

  const { worldLandmarks } = pose;

  const useWorld = Array.isArray(worldLandmarks) && worldLandmarks.length > 0;
  const source: MetricSource = useWorld ? "pose-world" : "pose-image";

  const leftEar = selectLandmark(
    useWorld ? worldLandmarks : pose.landmarks,
    LEFT_EAR_INDEX,
  );
  const rightEar = selectLandmark(
    useWorld ? worldLandmarks : pose.landmarks,
    RIGHT_EAR_INDEX,
  );
  const leftShoulder = selectLandmark(
    useWorld ? worldLandmarks : pose.landmarks,
    LEFT_SHOULDER_INDEX,
  );
  const rightShoulder = selectLandmark(
    useWorld ? worldLandmarks : pose.landmarks,
    RIGHT_SHOULDER_INDEX,
  );

  const earCenter = calculateFromLandmarks([
    leftEar,
    rightEar,
  ] as ExtractableLandmarks);
  const shoulderCenter = calculateFromLandmarks([
    leftShoulder,
    rightShoulder,
  ] as ExtractableLandmarks);

  const shoulderWidth = computeShoulderWidth([leftShoulder, rightShoulder]);

  if (!earCenter || !shoulderCenter || shoulderWidth === null) {
    return {
      value: null,
      source,
      confidence,
      usedWorldLandmarks: useWorld,
    } satisfies EhdComputationResult;
  }

  const horizontalOffset = Math.abs(earCenter.x - shoulderCenter.x);

  if (!Number.isFinite(horizontalOffset) || !Number.isFinite(shoulderWidth)) {
    return {
      value: null,
      source,
      confidence,
      usedWorldLandmarks: useWorld,
    } satisfies EhdComputationResult;
  }

  const normalized = horizontalOffset / shoulderWidth;

  return {
    value: Number.isFinite(normalized) ? normalized : null,
    source,
    confidence,
    usedWorldLandmarks: useWorld,
  } satisfies EhdComputationResult;
};
