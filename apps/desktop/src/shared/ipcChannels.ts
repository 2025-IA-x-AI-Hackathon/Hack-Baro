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
  reCalibrate: "calibration:re-calibrate",
  openSettings: "settings:open",
  TRIGGER_MAIN_ERROR: "error:trigger-main",
  TRIGGER_WORKER_ERROR: "error:trigger-worker",
  REQUEST_CAMERA_PERMISSION: "camera:request-permission",
  OPEN_CAMERA_SETTINGS: "camera:open-settings",
  getSetting: "settings:get",
  setSetting: "settings:set",
  requestCameraPermission: "camera:request-permission",
  openCameraSettings: "camera:open-settings",
  appStatusChanged: "app:status-changed",
  getDailySummary: "dashboard:get-daily-summary",
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
  setPaused: "worker:set-paused",
  persistPostureData: "worker:persist-posture-data",
  getDailySummary: "worker:get-daily-summary",
  dailySummaryResponse: "worker:daily-summary-response",
} as const;

export type WorkerMessageType =
  (typeof WORKER_MESSAGES)[keyof typeof WORKER_MESSAGES];

export type WorkerMessage<T extends WorkerMessageType = WorkerMessageType> = {
  type: T;
  payload?: unknown;
};
