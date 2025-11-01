export type Landmark = {
  x: number;
  y: number;
  z: number;
};

export type PoseLandmark = Landmark & {
  visibility?: number;
};

export type WorldLandmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
};

export type FaceLandmarks = {
  landmarks: Landmark[];
  confidence: number;
  transformationMatrix?: number[];
};

export type PoseLandmarks = {
  landmarks: PoseLandmark[];
  worldLandmarks?: WorldLandmark[];
  confidence: number;
};

export type DetectionPresence = "PRESENT" | "ABSENT" | "MULTIPLE" | "UNKNOWN";

export type DetectionReliability = "OK" | "LOW" | "UNRELIABLE" | "UNKNOWN";

export type CombinedLandmarks = {
  frameId: number;
  capturedAt: number;
  processedAt: number;
  face?: FaceLandmarks | null;
  pose?: PoseLandmarks | null;
  presence: DetectionPresence;
  reliability: DetectionReliability;
};
