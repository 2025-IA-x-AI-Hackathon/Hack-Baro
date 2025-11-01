export type RotationMatrix3 = [
  [number, number, number],
  [number, number, number],
  [number, number, number],
];

export type EulerAngles = {
  pitch: number; // Rotation around X axis in radians
  yaw: number; // Rotation around Y axis in radians
  roll: number; // Rotation around Z axis in radians
};

const clamp = (value: number, lower: number, upper: number): number => {
  return Math.max(lower, Math.min(upper, value));
};

const isValidRotationMatrix = (matrix: RotationMatrix3): boolean => {
  if (!Array.isArray(matrix)) {
    return false;
  }

  const rows = matrix.length === 3;
  const columns = matrix.every((row) => Array.isArray(row) && row.length === 3);

  if (!rows || !columns) {
    return false;
  }

  const EPSILON = 1e-5;
  const row0Length = Math.hypot(matrix[0][0], matrix[0][1], matrix[0][2]);
  const row1Length = Math.hypot(matrix[1][0], matrix[1][1], matrix[1][2]);
  const row2Length = Math.hypot(matrix[2][0], matrix[2][1], matrix[2][2]);

  const orthogonality0 =
    matrix[0][0] * matrix[1][0] +
    matrix[0][1] * matrix[1][1] +
    matrix[0][2] * matrix[1][2];
  const orthogonality1 =
    matrix[0][0] * matrix[2][0] +
    matrix[0][1] * matrix[2][1] +
    matrix[0][2] * matrix[2][2];
  const orthogonality2 =
    matrix[1][0] * matrix[2][0] +
    matrix[1][1] * matrix[2][1] +
    matrix[1][2] * matrix[2][2];

  const determinant =
    matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
    matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
    matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);

  return (
    Math.abs(row0Length - 1) < EPSILON &&
    Math.abs(row1Length - 1) < EPSILON &&
    Math.abs(row2Length - 1) < EPSILON &&
    Math.abs(orthogonality0) < EPSILON &&
    Math.abs(orthogonality1) < EPSILON &&
    Math.abs(orthogonality2) < EPSILON &&
    Math.abs(determinant - 1) < 1e-3
  );
};

export const rotationMatrixToEulerAngles = (
  matrix: RotationMatrix3,
): EulerAngles | null => {
  if (!isValidRotationMatrix(matrix)) {
    return null;
  }

  const r20 = clamp(matrix[2][0], -1, 1);
  const pitch = Math.atan2(matrix[2][1], matrix[2][2]);
  const yaw = Math.asin(-r20);

  const cosYaw = Math.cos(yaw);
  let roll: number;

  if (Math.abs(cosYaw) > 1e-6) {
    roll = Math.atan2(matrix[1][0], matrix[0][0]);
  } else {
    roll = Math.atan2(-matrix[0][1], matrix[1][1]);
  }

  return {
    pitch,
    yaw,
    roll,
  } satisfies EulerAngles;
};
