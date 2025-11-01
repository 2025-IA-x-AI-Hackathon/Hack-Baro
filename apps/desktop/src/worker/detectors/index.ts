import type { Detector, DetectorKind } from "../../shared/types/detector";
import { createMediapipeDetector } from "./mediapipeDetector";
import { createOnnxDetector } from "./onnxDetector";

const createDetector = (kind: DetectorKind): Detector => {
  switch (kind) {
    case "onnx":
      return createOnnxDetector();
    case "mediapipe":
    default:
      return createMediapipeDetector();
  }
};

export default createDetector;
