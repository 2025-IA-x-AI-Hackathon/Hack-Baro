import type { Detector, DetectorKind } from "../../shared/types/detector";
import { createMediapipeDetector } from "./mediapipeDetector";
import { createOnnxDetector } from "./onnxDetector";

const createDetector = (kind: DetectorKind): Detector => {
  switch (kind) {
    case "mediapipe":
      return createMediapipeDetector();
    case "onnx":
      return createOnnxDetector();
    default:
      throw new Error(`Unknown detector kind: ${kind as string}`);
  }
};

export default createDetector;
