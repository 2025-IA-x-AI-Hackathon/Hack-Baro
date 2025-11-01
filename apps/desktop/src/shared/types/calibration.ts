import type { DetectorKind } from "./detector";

export type PoseKeypoint = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  name?: string;
};

export type CalibrationBaselinePayload = {
  detector: DetectorKind;
  keypoints: PoseKeypoint[];
};

export type CalibrationBaselineRecord = CalibrationBaselinePayload & {
  id: number;
  createdAt: number;
};
