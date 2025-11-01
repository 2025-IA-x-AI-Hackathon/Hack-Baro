export type CameraIntrinsics = {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  matrix: number[][];
};

const toRadians = (degrees: number): number => {
  return (degrees * Math.PI) / 180;
};

const clampFov = (degrees: number): number => {
  if (!Number.isFinite(degrees)) {
    return 60;
  }
  return Math.min(Math.max(degrees, 35), 110);
};

export const estimateCameraIntrinsics = (
  width: number,
  height: number,
  horizontalFovDegrees = 60,
): CameraIntrinsics => {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 640;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 480;

  const fov = clampFov(horizontalFovDegrees);
  const halfWidth = safeWidth / 2;
  const halfHeight = safeHeight / 2;

  const horizontalFovRadians = toRadians(fov);
  const verticalFovRadians =
    2 *
    Math.atan(Math.tan(horizontalFovRadians / 2) * (safeHeight / safeWidth));

  const fx = halfWidth / Math.tan(horizontalFovRadians / 2);
  const fy = halfHeight / Math.tan(verticalFovRadians / 2);
  const cx = halfWidth;
  const cy = halfHeight;

  return {
    fx,
    fy,
    cx,
    cy,
    matrix: [
      [fx, 0, cx],
      [0, fy, cy],
      [0, 0, 1],
    ],
  } satisfies CameraIntrinsics;
};

export const createZeroDistortionCoefficients = (): [
  number,
  number,
  number,
  number,
  number,
] => {
  return [0, 0, 0, 0, 0];
};
