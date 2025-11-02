// Disable no-unused-vars, broken for spread args
/* eslint no-unused-vars: off */
import { IpcRendererEvent, contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNELS, type RendererChannel } from "../shared/ipcChannels";

const validChannels = new Set<RendererChannel>(Object.values(IPC_CHANNELS));

const ensureChannelIsAllowed = (channel: RendererChannel) => {
  if (!validChannels.has(channel)) {
    throw new Error(`Attempted to use unsupported IPC channel: ${channel}`);
  }
};

export const electronHandler = {
  ipcRenderer: {
    sendMessage(channel: RendererChannel, ...args: unknown[]) {
      ensureChannelIsAllowed(channel);
      ipcRenderer.send(channel, ...args);
    },
    on(channel: RendererChannel, func: (...args: unknown[]) => void) {
      ensureChannelIsAllowed(channel);
      const subscription = (_event: IpcRendererEvent, ...args: unknown[]) =>
        func(...args);
      ipcRenderer.on(channel, subscription);

      return () => {
        ipcRenderer.removeListener(channel, subscription);
      };
    },
    once(channel: RendererChannel, func: (...args: unknown[]) => void) {
      ensureChannelIsAllowed(channel);
      ipcRenderer.once(channel, (_event, ...args) => func(...args));
    },
    invoke(channel: RendererChannel, ...args: unknown[]) {
      ensureChannelIsAllowed(channel);
      return ipcRenderer.invoke(channel, ...args);
    },
  },
  channels: IPC_CHANNELS,
  env: {
    NODE_ENV: process.env.NODE_ENV,
    APP_ENV: process.env.APP_ENV,
    POS_ENV: process.env.POS_ENV,
    DESKTOP_ENV: process.env.DESKTOP_ENV,
    SENTRY_DSN: process.env.SENTRY_DSN,
    ENABLE_SENTRY_IN_DEV: process.env.ENABLE_SENTRY_IN_DEV,
    SENTRY_TRACES_SAMPLE_RATE: process.env.SENTRY_TRACES_SAMPLE_RATE,
    BETTER_STACK_TOKEN: process.env.BETTER_STACK_TOKEN,
    ENABLE_BETTER_STACK_IN_DEV: process.env.ENABLE_BETTER_STACK_IN_DEV,
    POSELY_DETECTOR: process.env.POSELY_DETECTOR,
    POSELY_DEBUG_HUD: process.env.POSELY_DEBUG_HUD,
    POSELY_DEBUG_CAMERA_PREVIEW: process.env.POSELY_DEBUG_CAMERA_PREVIEW,
    POSELY_DEBUG_HEAD_POSE: process.env.POSELY_DEBUG_HEAD_POSE,
    POSELY_DEBUG_ALLOW_UNRELIABLE_SIGNALS:
      process.env.POSELY_DEBUG_ALLOW_UNRELIABLE_SIGNALS,
    POSELY_DEBUG_GUARDRAILS_VERBOSE:
      process.env.POSELY_DEBUG_GUARDRAILS_VERBOSE,
    POSELY_CALIBRATION_DEBUG: process.env.POSELY_CALIBRATION_DEBUG,
    POSELY_ENABLE_EXPERIMENTAL_SCORING:
      process.env.POSELY_ENABLE_EXPERIMENTAL_SCORING,
    POSELY_SIGNAL_TRACE: process.env.POSELY_SIGNAL_TRACE,
    POSELY_SIGNAL_TRACE_FILE: process.env.POSELY_SIGNAL_TRACE_FILE,
    POSELY_FACE_PRESENCE_MIN_AREA: process.env.POSELY_FACE_PRESENCE_MIN_AREA,
    POSELY_FACE_PRESENCE_MAX_AREA: process.env.POSELY_FACE_PRESENCE_MAX_AREA,
    POSELY_FACE_PRESENCE_STABILITY_FALLBACK:
      process.env.POSELY_FACE_PRESENCE_STABILITY_FALLBACK,
    POSELY_FACE_PRESENCE_AREA_WEIGHT:
      process.env.POSELY_FACE_PRESENCE_AREA_WEIGHT,
    POSELY_FACE_PRESENCE_STABILITY_WEIGHT:
      process.env.POSELY_FACE_PRESENCE_STABILITY_WEIGHT,
    POSELY_FACE_PRESENCE_MULTIPLE_PENALTY:
      process.env.POSELY_FACE_PRESENCE_MULTIPLE_PENALTY,
    POSELY_GUARDRAIL_YAW_ENTER_DEG: process.env.POSELY_GUARDRAIL_YAW_ENTER_DEG,
    POSELY_GUARDRAIL_YAW_EXIT_DEG: process.env.POSELY_GUARDRAIL_YAW_EXIT_DEG,
    POSELY_GUARDRAIL_YAW_ENTER_SECONDS:
      process.env.POSELY_GUARDRAIL_YAW_ENTER_SECONDS,
    POSELY_GUARDRAIL_YAW_EXIT_SECONDS:
      process.env.POSELY_GUARDRAIL_YAW_EXIT_SECONDS,
    POSELY_GUARDRAIL_ROLL_ENTER_DEG:
      process.env.POSELY_GUARDRAIL_ROLL_ENTER_DEG,
    POSELY_GUARDRAIL_ROLL_EXIT_DEG: process.env.POSELY_GUARDRAIL_ROLL_EXIT_DEG,
    POSELY_GUARDRAIL_ROLL_ENTER_SECONDS:
      process.env.POSELY_GUARDRAIL_ROLL_ENTER_SECONDS,
    POSELY_GUARDRAIL_ROLL_EXIT_SECONDS:
      process.env.POSELY_GUARDRAIL_ROLL_EXIT_SECONDS,
    POSELY_GUARDRAIL_CONF_FACE_THRESHOLD:
      process.env.POSELY_GUARDRAIL_CONF_FACE_THRESHOLD,
    POSELY_GUARDRAIL_CONF_POSE_THRESHOLD:
      process.env.POSELY_GUARDRAIL_CONF_POSE_THRESHOLD,
    POSELY_GUARDRAIL_CONF_ENTER_SECONDS:
      process.env.POSELY_GUARDRAIL_CONF_ENTER_SECONDS,
    POSELY_GUARDRAIL_CONF_EXIT_SECONDS:
      process.env.POSELY_GUARDRAIL_CONF_EXIT_SECONDS,
    POSELY_GUARDRAIL_ILLUM_THRESHOLD:
      process.env.POSELY_GUARDRAIL_ILLUM_THRESHOLD,
    POSELY_GUARDRAIL_ILLUM_ENTER_SECONDS:
      process.env.POSELY_GUARDRAIL_ILLUM_ENTER_SECONDS,
    POSELY_GUARDRAIL_ILLUM_EXIT_SECONDS:
      process.env.POSELY_GUARDRAIL_ILLUM_EXIT_SECONDS,
    POSELY_RISK_PITCH_DEG: process.env.POSELY_RISK_PITCH_DEG,
    POSELY_RISK_EHD_NORM: process.env.POSELY_RISK_EHD_NORM,
    POSELY_RISK_DPR_DELTA: process.env.POSELY_RISK_DPR_DELTA,
    POSELY_RISK_TRIGGER_SEC: process.env.POSELY_RISK_TRIGGER_SEC,
    POSELY_RISK_RECOVERY_SEC: process.env.POSELY_RISK_RECOVERY_SEC,
    POSELY_RISK_HYST_DELTA_PCT: process.env.POSELY_RISK_HYST_DELTA_PCT,
    POSELY_RISK_DEGENERATE_PITCH_DEG:
      process.env.POSELY_RISK_DEGENERATE_PITCH_DEG,
    POSELY_SIGNAL_CONF_THRESHOLD: process.env.POSELY_SIGNAL_CONF_THRESHOLD,
    POSELY_SCORE_NEUTRAL: process.env.POSELY_SCORE_NEUTRAL,
    POSELY_SCORE_ALPHA: process.env.POSELY_SCORE_ALPHA,
    POSELY_SCORE_W_PITCH: process.env.POSELY_SCORE_W_PITCH,
    POSELY_SCORE_W_EHD: process.env.POSELY_SCORE_W_EHD,
    POSELY_SCORE_W_DPR: process.env.POSELY_SCORE_W_DPR,
    POSELY_DASHBOARD_HTTP_ORIGIN: process.env.POSELY_DASHBOARD_HTTP_ORIGIN,
    npm_package_version: process.env.npm_package_version,
  },
};

contextBridge.exposeInMainWorld("electron", electronHandler);

export type ElectronHandler = typeof electronHandler;
