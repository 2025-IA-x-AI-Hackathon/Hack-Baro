export const IPC_CHANNELS = {
  rendererPing: "system:ping",
  workerRequest: "worker:request",
  workerStatus: "worker:status",
  workerResponse: "worker:response",
  engineFrame: "engine:frame",
  engineTick: "engine:tick",
  triggerMainError: "error:trigger-main",
  triggerWorkerError: "error:trigger-worker",
  // TODO: check if `openCameraPrivacySettings` and `openCameraSettings` is overlapping
  openCameraPrivacySettings: "system:open-camera-privacy-settings",
  signalTraceAppend: "signal-trace:append",
  calibrationRequest: "calibration:request",
  requestCameraPermission: "camera:request-permission",
  openCameraSettings: "camera:open-settings",
} as const;

export type RendererChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const WORKER_MESSAGES = {
  ping: "worker:ping",
  pong: "worker:pong",
  ready: "worker:ready",
  status: "worker:status",
  engineFrame: "engine:frame",
  engineTick: "engine:tick",
  engineError: "engine:error",
  triggerWorkerError: "error:trigger-worker",
} as const;

export type WorkerMessageType =
  (typeof WORKER_MESSAGES)[keyof typeof WORKER_MESSAGES];

export type WorkerMessage<T extends WorkerMessageType = WorkerMessageType> = {
  type: T;
  payload?: unknown;
};
