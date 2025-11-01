export const IPC_CHANNELS = {
  rendererPing: "system:ping",
  workerRequest: "worker:request",
  workerStatus: "worker:status",
  workerResponse: "worker:response",
  calibrationRequest: "calibration:request",
  TRIGGER_MAIN_ERROR: "error:trigger-main",
  TRIGGER_WORKER_ERROR: "error:trigger-worker",
  REQUEST_CAMERA_PERMISSION: "camera:request-permission",
  OPEN_CAMERA_SETTINGS: "camera:open-settings",
  getSetting: "settings:get",
  setSetting: "settings:set",
  requestCameraPermission: "camera:request-permission",
  openCameraPrivacySettings: "system:open-camera-privacy-settings",
} as const;

export type RendererChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const WORKER_MESSAGES = {
  ping: "worker:ping",
  pong: "worker:pong",
  ready: "worker:ready",
  status: "worker:status",
  TRIGGER_WORKER_ERROR: "error:trigger-worker",
} as const;

export type WorkerMessageType =
  (typeof WORKER_MESSAGES)[keyof typeof WORKER_MESSAGES];

export type WorkerMessage<T extends WorkerMessageType = WorkerMessageType> = {
  type: T;
  payload?: unknown;
};
