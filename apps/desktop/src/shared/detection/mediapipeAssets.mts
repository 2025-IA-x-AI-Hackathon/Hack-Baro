const wasmLoaderUrl = new URL(
  "./assets/vision_wasm_internal.js",
  import.meta.url,
);
const wasmLoader = wasmLoaderUrl.toString();
const wasmBinary = new URL(
  "./assets/vision_wasm_internal.wasm",
  import.meta.url,
).toString();
const poseModel = new URL(
  "./assets/pose_landmarker_lite.task",
  import.meta.url,
).toString();
const faceModel = new URL(
  "./assets/face_landmarker.task",
  import.meta.url,
).toString();

const baseUrl = new URL("./", wasmLoaderUrl).toString().replace(/\/$/, "");

export const MEDIAPIPE_ASSETS = {
  wasmLoader,
  wasmBinary,
  poseModel,
  faceModel,
  baseUrl,
} as const;

export type MediapipeAssetManifest = typeof MEDIAPIPE_ASSETS;
