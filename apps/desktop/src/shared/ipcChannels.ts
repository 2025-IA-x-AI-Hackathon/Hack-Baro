export const IPC_CHANNELS = {
  rendererPing: "system:ping",
  workerRequest: "worker:request",
  workerStatus: "worker:status",
  workerResponse: "worker:response",
  engineFrame: "engine:frame",
  engineTick: "engine:tick",
  engineCaptureTick: "engine:capture-tick",
  triggerMainError: "error:trigger-main",
  triggerWorkerError: "error:trigger-worker",
  openCameraPrivacySettings: "system:open-camera-privacy-settings",
  signalTraceAppend: "signal-trace:append",
  calibrationRequest: "calibration:request",
  calibrationStart: "calibration:start",
  calibrationProgress: "calibration:progress",
  calibrationComplete: "calibration:complete",
  calibrationFailed: "calibration:failed",
  calibrationNudge: "calibration:nudge",
  calibrationLoad: "calibration:load",
  calibrationUpdateSensitivity: "calibration:update-sensitivity",
  calibrationLatest: "calibration:latest",
  requestCameraPermission: "camera:request-permission",
  getDailySummary: "posture:get-daily-summary",
  getWeeklySummary: "posture:get-weekly-summary",
  postureDataUpdated: "posture:data-updated",
  getSetting: "settings:get",
  setSetting: "settings:set",
  reCalibrate: "calibration:recalibrate",
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
  calibrationStart: "calibration:start",
  calibrationCancel: "calibration:cancel",
  calibrationProgress: "calibration:progress",
  calibrationComplete: "calibration:complete",
  calibrationFailed: "calibration:failed",
  calibrationApply: "calibration:apply",
  refreshBaseline: "worker:refresh-baseline",
  setPaused: "worker:set-paused", // Story 3.3: Pause/Resume monitoring
} as const;

export type WorkerMessageType =
  (typeof WORKER_MESSAGES)[keyof typeof WORKER_MESSAGES];

export type WorkerMessage<T extends WorkerMessageType = WorkerMessageType> = {
  type: T;
  payload?: unknown;
};
