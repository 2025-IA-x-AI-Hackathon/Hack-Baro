import {
  getEnvVar,
  parseBooleanFlag,
  parseOptionalBoolean,
} from "../../shared/env";
import { type LoggerMetadata, getLogger } from "../../shared/logger";
import type { FaceLandmarks } from "../../shared/types/landmarks";
import type {
  MetricConfidence,
  MetricSource,
} from "../../shared/types/metrics";
import { estimateCameraIntrinsics } from "../cv/camera-intrinsics";
import type { RotationMatrix3 } from "../cv/euler-angles";
import { rotationMatrixToEulerAngles } from "../cv/euler-angles";
import { type Vec2, solvePnP } from "../cv/solve-pnp";

export type HeadPoseResult = {
  pitch: number | null;
  yaw: number | null;
  roll: number | null;
  source: MetricSource;
  confidence: MetricConfidence;
};

// 3D model points of facial landmarks in millimeters.
const MODEL_POINTS: [number, number, number][] = [
  [0.0, 0.0, 0.0],
  [0.0, -63.6, -12.5],
  [-43.3, 32.7, -26.0],
  [43.3, 32.7, -26.0],
  [-28.9, -28.9, -24.1],
  [28.9, -28.9, -24.1],
];

// Indices of the landmarks corresponding to the MODEL_POINTS.
const LANDMARK_INDICES = [1, 152, 33, 263, 61, 291];

const headPoseLogger = getLogger("head-pose", "worker");
const isHeadPoseDebugEnabled = (): boolean => {
  const value = getEnvVar("POSELY_DEBUG_HEAD_POSE");
  return parseOptionalBoolean(value) === true || parseBooleanFlag(value, false);
};
const logHeadPose = (message: string, metadata?: LoggerMetadata) => {
  if (!isHeadPoseDebugEnabled()) {
    return;
  }
  headPoseLogger.debug(message, metadata);
};

const toConfidence = (confidence: number | undefined): MetricConfidence => {
  if (confidence === undefined) {
    return "NONE";
  }
  if (!Number.isFinite(confidence)) {
    return "NONE";
  }
  // The confidence threshold for 'HIGH' was lowered from 0.6 to 0.3
  // to align with guardrail thresholds as specified in Story 4.12.
  // This change may affect detection quality; see story documentation for details.
  if (confidence >= 0.3) {
    return "HIGH";
  }
  if (confidence >= 0.1) {
    return "LOW";
  }
  return "NONE";
};

type Vec3 = [number, number, number];

const toNumber = (value: number | undefined): number =>
  Number.isFinite(value) ? (value as number) : Number.NaN;

const normalizeVec = (vector: Vec3): Vec3 | null => {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!Number.isFinite(length) || length < 1e-6) {
    return null;
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
};

const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const subtractVec = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];

const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const extractRotationFromTransform = (
  matrix: number[],
): RotationMatrix3 | null => {
  if (!Array.isArray(matrix)) {
    return null;
  }

  if (matrix.length >= 16) {
    // MediaPipe provides column-major 4x4 matrices.
    const r00 = toNumber(matrix[0]);
    const r01 = toNumber(matrix[4]);
    const r02 = toNumber(matrix[8]);
    const r10 = toNumber(matrix[1]);
    const r11 = toNumber(matrix[5]);
    const r12 = toNumber(matrix[9]);
    const r20 = toNumber(matrix[2]);
    const r21 = toNumber(matrix[6]);
    const r22 = toNumber(matrix[10]);
    const components = [r00, r01, r02, r10, r11, r12, r20, r21, r22];
    if (components.some((value) => !Number.isFinite(value))) {
      return null;
    }
    return [
      [r00, r01, r02],
      [r10, r11, r12],
      [r20, r21, r22],
    ];
  }

  if (matrix.length >= 9) {
    const components = matrix
      .slice(0, 9)
      .map((value) => (Number.isFinite(value) ? value : Number.NaN));
    if (
      components.length < 9 ||
      components.some((value) => !Number.isFinite(value))
    ) {
      return null;
    }
    const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = components as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    return [
      [m00, m01, m02],
      [m10, m11, m12],
      [m20, m21, m22],
    ];
  }

  return null;
};

const orthonormalizeRotation = (
  rotation: RotationMatrix3,
): RotationMatrix3 | null => {
  const c0: Vec3 = [rotation[0][0], rotation[1][0], rotation[2][0]];
  const c1: Vec3 = [rotation[0][1], rotation[1][1], rotation[2][1]];

  const u0 = normalizeVec(c0);
  if (!u0) {
    return null;
  }

  const projC1OnU0 = dot(c1, u0);
  const temp1 = subtractVec(c1, [
    projC1OnU0 * u0[0],
    projC1OnU0 * u0[1],
    projC1OnU0 * u0[2],
  ]);
  const u1 = normalizeVec(temp1);
  if (!u1) {
    return null;
  }

  const temp2 = cross(u0, u1);
  const u2 = normalizeVec(temp2);
  if (!u2) {
    return null;
  }

  const handedness = dot(cross(u0, u1), u2);
  const finalU2: Vec3 =
    handedness < 0 ? ([-u2[0], -u2[1], -u2[2]] as Vec3) : u2;

  return [
    [u0[0], u1[0], finalU2[0]],
    [u0[1], u1[1], finalU2[1]],
    [u0[2], u1[2], finalU2[2]],
  ];
};

const isNearSingularYaw = (yawRadians: number): boolean => {
  const nearHalfPi = Math.abs(Math.abs(yawRadians) - Math.PI / 2);
  return nearHalfPi < 1e-3;
};

const radToDeg = (value: number | null): number | null => {
  if (!Number.isFinite(value ?? NaN)) {
    return null;
  }
  return ((value as number) * 180) / Math.PI;
};

const extractLandmark = (face: FaceLandmarks, index: number): Vec2 | null => {
  if (!Array.isArray(face.landmarks)) {
    return null;
  }
  const landmark = face.landmarks[index];
  if (!landmark) {
    return null;
  }
  if (!Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) {
    return null;
  }
  return { x: landmark.x, y: landmark.y } satisfies Vec2;
};

const toPixelCoordinates = (
  normalizedPoints: Vec2[],
  imageWidth: number,
  imageHeight: number,
): Vec2[] => {
  return normalizedPoints.map((point) => ({
    x: point.x * imageWidth,
    y: point.y * imageHeight,
  }));
};

export const computeHeadPose = (
  face: FaceLandmarks | null | undefined,
  imageWidth: number,
  imageHeight: number,
): HeadPoseResult => {
  if (!face) {
    return {
      pitch: null,
      yaw: null,
      roll: null,
      source: "unknown",
      confidence: "NONE",
    } satisfies HeadPoseResult;
  }

  const confidence = toConfidence(face.confidence);

  const transformResult = (() => {
    if (!Array.isArray(face.transformationMatrix)) {
      return null;
    }
    if (isHeadPoseDebugEnabled()) {
      logHeadPose("transform matrix", {
        matrix:
          face.transformationMatrix.length >= 16
            ? face.transformationMatrix.slice(0, 16)
            : face.transformationMatrix,
      });
    }
    const rawRotation = extractRotationFromTransform(face.transformationMatrix);
    if (!rawRotation) {
      if (isHeadPoseDebugEnabled()) {
        logHeadPose("raw rotation invalid");
      }
      return null;
    }
    if (isHeadPoseDebugEnabled()) {
      logHeadPose("raw rotation", { rotation: rawRotation });
    }
    const rotation = orthonormalizeRotation(rawRotation);
    if (!rotation) {
      if (isHeadPoseDebugEnabled()) {
        logHeadPose("orthonormalized rotation invalid");
      }
      return null;
    }

    if (isHeadPoseDebugEnabled()) {
      logHeadPose("normalized rotation", { rotation });
    }
    const euler = rotationMatrixToEulerAngles(rotation);
    if (!euler) {
      if (isHeadPoseDebugEnabled()) {
        logHeadPose("rotationMatrixToEulerAngles returned null");
      }
      return null;
    }

    if (
      [euler.pitch, euler.yaw, euler.roll].some(
        (angle) => !Number.isFinite(angle),
      )
    ) {
      return null;
    }

    // Reject gimbal lock near ±90° yaw to avoid unstable angle conversions
    if (isNearSingularYaw(euler.yaw)) {
      return null;
    }

    const pitchDeg = radToDeg(euler.pitch);
    const yawDeg = radToDeg(euler.yaw);
    const rollDeg = radToDeg(euler.roll);

    // Reject cases where any of the Euler angles are null, which can occur due to
    // numeric instability, invalid input, or near-singularities (e.g., gimbal lock).
    if ([pitchDeg, yawDeg, rollDeg].some((value) => value === null)) {
      return null;
    }

    if (isHeadPoseDebugEnabled()) {
      logHeadPose("face-transform euler", {
        pitch: pitchDeg,
        yaw: yawDeg,
        roll: rollDeg,
      });
    }

    return {
      pitch: pitchDeg,
      yaw: yawDeg,
      roll: rollDeg,
      source: "face-transform",
      confidence,
    } satisfies HeadPoseResult;
  })();

  if (transformResult) {
    return transformResult;
  }

  if (isHeadPoseDebugEnabled()) {
    logHeadPose("falling back to solvePnP");
  }

  if (!Array.isArray(face.landmarks) || face.landmarks.length === 0) {
    return {
      pitch: null,
      yaw: null,
      roll: null,
      source: "unknown",
      confidence,
    } satisfies HeadPoseResult;
  }

  const normalizedPoints = LANDMARK_INDICES.map((index) => {
    return extractLandmark(face, index);
  }).filter((point): point is Vec2 => point !== null);

  if (normalizedPoints.length !== MODEL_POINTS.length) {
    return {
      pitch: null,
      yaw: null,
      roll: null,
      source: "unknown",
      confidence,
    } satisfies HeadPoseResult;
  }

  const pixels = toPixelCoordinates(normalizedPoints, imageWidth, imageHeight);
  const intrinsics = estimateCameraIntrinsics(imageWidth, imageHeight);
  const solution = solvePnP({
    modelPoints: MODEL_POINTS.map(([x, y, z]) => ({ x, y, z })),
    imagePoints: pixels,
    intrinsics,
  });

  if (!solution) {
    if (isHeadPoseDebugEnabled()) {
      logHeadPose("solvePnP solution missing");
    }
    return {
      pitch: null,
      yaw: null,
      roll: null,
      source: "unknown",
      confidence,
    } satisfies HeadPoseResult;
  }

  const euler = rotationMatrixToEulerAngles(solution.rotation);
  if (!euler) {
    if (isHeadPoseDebugEnabled()) {
      logHeadPose("solvePnP rotation invalid", {
        rotation: solution.rotation,
      });
    }
    return {
      pitch: null,
      yaw: null,
      roll: null,
      source: "unknown",
      confidence,
    } satisfies HeadPoseResult;
  }

  const pitchDeg = radToDeg(euler.pitch);
  const yawDeg = radToDeg(euler.yaw);
  const rollDeg = radToDeg(euler.roll);

  if (isHeadPoseDebugEnabled()) {
    logHeadPose("solvePnP euler", {
      pitch: pitchDeg,
      yaw: yawDeg,
      roll: rollDeg,
    });
  }

  return {
    pitch: pitchDeg,
    yaw: yawDeg,
    roll: rollDeg,
    source: "solve-pnp",
    confidence,
  } satisfies HeadPoseResult;
};
