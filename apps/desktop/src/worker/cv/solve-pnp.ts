import type { CameraIntrinsics } from "./camera-intrinsics";
import type { RotationMatrix3 } from "./euler-angles";

export type Vec2 = {
  x: number;
  y: number;
};

export type Vec3 = {
  x: number;
  y: number;
  z: number;
};

export type SolvePnPInput = {
  modelPoints: Vec3[];
  imagePoints: Vec2[];
  intrinsics: CameraIntrinsics;
};

export type SolvePnPResult = {
  rotation: RotationMatrix3;
  translation: Vec3;
};

type Matrix3x3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

type Quaternion4 = [number, number, number, number];

type Matrix4x4 = [
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
  [number, number, number, number],
];

const subtract = (a: Vec3, b: Vec3): Vec3 => {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
};

const add = (a: Vec3, b: Vec3): Vec3 => {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z,
  };
};

const scale = (vector: Vec3, factor: number): Vec3 => {
  return {
    x: vector.x * factor,
    y: vector.y * factor,
    z: vector.z * factor,
  };
};

const computeCentroid = (points: Vec3[]): Vec3 => {
  if (points.length === 0) {
    return { x: 0, y: 0, z: 0 };
  }

  return scale(
    points.reduce((accumulator, point) => add(accumulator, point), {
      x: 0,
      y: 0,
      z: 0,
    }),
    1 / points.length,
  );
};

const multiply4x4Vector = (
  matrix: Matrix4x4,
  vector: Readonly<Quaternion4>,
): Quaternion4 => {
  const [r0, r1, r2, r3] = matrix;
  const [v0, v1, v2, v3] = vector;

  return [
    r0[0] * v0 + r0[1] * v1 + r0[2] * v2 + r0[3] * v3,
    r1[0] * v0 + r1[1] * v1 + r1[2] * v2 + r1[3] * v3,
    r2[0] * v0 + r2[1] * v1 + r2[2] * v2 + r2[3] * v3,
    r3[0] * v0 + r3[1] * v1 + r3[2] * v2 + r3[3] * v3,
  ];
};

const normaliseQuaternion = (
  quaternion: Readonly<Quaternion4>,
): Quaternion4 => {
  const magnitude = Math.hypot(...quaternion);
  if (magnitude < 1e-8) {
    return [1, 0, 0, 0];
  }
  return quaternion.map((value) => value / magnitude) as Quaternion4;
};

const quaternionToRotationMatrix = (
  quaternion: Readonly<Quaternion4>,
): RotationMatrix3 => {
  const [w = 1, x = 0, y = 0, z = 0] = quaternion;

  const ww = w * w;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;

  return [
    [ww + xx - yy - zz, 2 * (xy - wz), 2 * (xz + wy)],
    [2 * (xy + wz), ww - xx + yy - zz, 2 * (yz - wx)],
    [2 * (xz - wy), 2 * (yz + wx), ww - xx - yy + zz],
  ];
};

const buildHornMatrix = (covariance: Matrix3x3): Matrix4x4 => {
  const [[sxx, sxy, sxz], [syx, syy, syz], [szx, szy, szz]] = covariance;

  return [
    [sxx + syy + szz, syz - szy, szx - sxz, sxy - syx],
    [syz - szy, sxx - syy - szz, sxy + syx, szx + sxz],
    [szx - sxz, sxy + syx, -sxx + syy - szz, syz + szy],
    [sxy - syx, szx + sxz, syz + szy, -sxx - syy + szz],
  ];
};

const findDominantEigenVector = (
  matrix: Matrix4x4,
  iterations = 32,
): Quaternion4 => {
  let vector: Quaternion4 = [1, 0, 0, 0];

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = multiply4x4Vector(matrix, vector);
    const magnitude = Math.hypot(...next);
    if (magnitude < 1e-8) {
      break;
    }
    vector = next.map((value) => value / magnitude) as Quaternion4;
  }

  return vector;
};

const computeCovarianceMatrix = (model: Vec3[], image: Vec3[]): Matrix3x3 => {
  const covariance: Matrix3x3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let index = 0; index < model.length; index += 1) {
    const m = model[index]!;
    const i = image[index]!;

    covariance[0][0] += m.x * i.x;
    covariance[0][1] += m.x * i.y;
    covariance[0][2] += m.x * i.z;

    covariance[1][0] += m.y * i.x;
    covariance[1][1] += m.y * i.y;
    covariance[1][2] += m.y * i.z;

    covariance[2][0] += m.z * i.x;
    covariance[2][1] += m.z * i.y;
    covariance[2][2] += m.z * i.z;
  }

  return covariance;
};

export const solvePnP = ({
  modelPoints,
  imagePoints,
  intrinsics,
}: SolvePnPInput): SolvePnPResult | null => {
  if (modelPoints.length !== imagePoints.length || modelPoints.length < 4) {
    return null;
  }

  const normalizedImageVectors = imagePoints.map((point) => {
    const nx = (point.x - intrinsics.cx) / intrinsics.fx;
    const ny = (point.y - intrinsics.cy) / intrinsics.fy;
    return { x: nx, y: ny, z: 1 } satisfies Vec3;
  });

  const modelCentroid = computeCentroid(modelPoints);
  const imageCentroid = computeCentroid(normalizedImageVectors);

  const centeredModel = modelPoints.map((point) =>
    subtract(point, modelCentroid),
  );
  const centeredImage = normalizedImageVectors.map((point) =>
    subtract(point, imageCentroid),
  );

  const covariance = computeCovarianceMatrix(centeredModel, centeredImage);
  const hornMatrix = buildHornMatrix(covariance);
  const quaternion = normaliseQuaternion(findDominantEigenVector(hornMatrix));
  const rotation = quaternionToRotationMatrix(quaternion);

  const rotatedModelCentroid = {
    x:
      rotation[0][0] * modelCentroid.x +
      rotation[0][1] * modelCentroid.y +
      rotation[0][2] * modelCentroid.z,
    y:
      rotation[1][0] * modelCentroid.x +
      rotation[1][1] * modelCentroid.y +
      rotation[1][2] * modelCentroid.z,
    z:
      rotation[2][0] * modelCentroid.x +
      rotation[2][1] * modelCentroid.y +
      rotation[2][2] * modelCentroid.z,
  } satisfies Vec3;

  const translation = subtract(imageCentroid, rotatedModelCentroid);

  return {
    rotation,
    translation,
  } satisfies SolvePnPResult;
};
