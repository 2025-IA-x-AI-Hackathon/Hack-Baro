import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Code,
  HeroUIProvider,
  Link,
  Switch,
} from "@heroui/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { HashRouter, Route, Routes } from "react-router-dom";
import icon from "../../assets/icon.svg";
import type { ElectronHandler } from "../main/preload";
import {
  DEFAULT_THRESHOLD_DELTAS,
  applyThresholdDeltas,
  resolveCustomThresholdBounds,
} from "../shared/calibration/sensitivity-presets";
import { parseBooleanFlag } from "../shared/env";
import { IPC_CHANNELS } from "../shared/ipcChannels";
import type { RendererChannel } from "../shared/ipcChannels";
import { getLogger } from "../shared/logger";
import { listPerformanceModePresets } from "../shared/sampling";
import type {
  CalibrationCompletePayload,
  CalibrationCustomThresholds,
  CalibrationSensitivity,
} from "../shared/types/calibration";
import type { DetectorKind } from "../shared/types/detector";
import type { EngineTickPayload } from "../shared/types/engine-ipc";
import type { EngineTick } from "../shared/types/engine-output";
import { useCameraPermission } from "./camera/useCameraPermission";
import ExampleHeroUI from "./components/ExampleHeroUI";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import Dashboard from "./components/dashboard/Dashboard";
import { CalibrationFlow } from "./components/onboarding/CalibrationFlow";
import { OnboardingWizard } from "./components/onboarding/OnboardingWizard";
import { OnboardingWizardV2 } from "./components/onboarding/OnboardingWizardV2";
import Settings from "./components/settings/Settings";
import { DetectionDebugHud } from "./detection/DebugHud";
import {
  PERFORMANCE_DELEGATES,
  PERFORMANCE_FPS_OPTIONS,
  PERFORMANCE_SHORT_SIDE_OPTIONS,
} from "./detection/detectionPipeline";
import { useDetectionPipeline } from "./detection/useDetectionPipeline";
import "./styles/globals.css";

type ElectronApi = Window["electron"];

type IpcArgs = unknown[];

type MessageState = {
  value: string;
  isDefault: boolean;
};

const logger = getLogger("renderer-app", "renderer");

const formatPayload = (payload: unknown): string => {
  if (payload === undefined) {
    return "undefined";
  }
  if (payload === null) {
    return "null";
  }
  if (typeof payload === "string") {
    return payload;
  }
  if (typeof payload === "object") {
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return Object.prototype.toString.call(payload);
    }
  }

  if (
    typeof payload === "number" ||
    typeof payload === "boolean" ||
    typeof payload === "bigint"
  ) {
    return String(payload);
  }

  if (typeof payload === "symbol") {
    return payload.description ? `Symbol(${payload.description})` : "Symbol()";
  }

  if (typeof payload === "function") {
    return `Function(${payload.name ?? "anonymous"})`;
  }

  return Object.prototype.toString.call(payload);
};

const createDefaultState = (value: string): MessageState => ({
  value,
  isDefault: true,
});

const markAsCustom = (value: string): MessageState => ({
  value,
  isDefault: false,
});

const formatWithPrecision = (value: number, fractionDigits: number): string => {
  return Number.isFinite(value) ? value.toFixed(fractionDigits) : "—";
};

const clamp = (value: number, min: number, max: number): number => {
  return Math.min(Math.max(value, min), max);
};

const formatSensitivityLabel = (value: CalibrationSensitivity): string => {
  if (value === "custom") {
    return "Custom";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
};

function IntegrationDashboard({ electron }: { electron: ElectronApi }) {
  const { t } = useTranslation(["common"]);
  const preferredDetector =
    (electron.env?.POSELY_DETECTOR as DetectorKind | undefined) ?? "mediapipe";
  const cameraPermission = useCameraPermission(electron);
  const detectionEnabled = cameraPermission.state === "granted";
  const detection = useDetectionPipeline({
    detector: preferredDetector,
    enabled: detectionEnabled,
  });
  const detectionMetrics = detection.metrics;
  const detectionDebug = detection.debug;
  const detectionLandmarks = detection.landmarks;
  const { setCameraPreviewVisible } = detection;
  const {
    performanceConfig,
    updatePerformance,
    isApplyingPerformance,
    performanceMode,
    setPerformanceMode,
    isSwitchingMode,
  } = detection;
  const envDebugHud = parseBooleanFlag(electron.env?.POSELY_DEBUG_HUD);
  const isDevelopmentBuild =
    (electron.env?.NODE_ENV ?? "development").toLowerCase() !== "production";
  const [hudToggle, setHudToggle] = useState(envDebugHud || isDevelopmentBuild);
  const cameraPreviewDefault = parseBooleanFlag(
    electron.env?.POSELY_DEBUG_CAMERA_PREVIEW,
  );
  const [cameraPreviewToggle, setCameraPreviewToggle] =
    useState(cameraPreviewDefault);
  useEffect(() => {
    if (!isDevelopmentBuild) {
      setHudToggle(envDebugHud);
    }
  }, [envDebugHud, isDevelopmentBuild]);
  const showDebugHud = isDevelopmentBuild ? hudToggle : envDebugHud;
  useEffect(() => {
    setCameraPreviewVisible(cameraPreviewToggle && detectionEnabled);
  }, [cameraPreviewToggle, detectionEnabled, setCameraPreviewVisible]);
  const formatMs = useCallback((value?: number) => {
    return value === undefined ? "0.0" : value.toFixed(1);
  }, []);
  const formatNumber = useCallback((value?: number) => {
    return value === undefined ? "0.00" : value.toFixed(2);
  }, []);
  const channels = useMemo<ElectronHandler["channels"]>(
    () => electron.channels ?? IPC_CHANNELS,
    [electron],
  );
  const performanceModes = useMemo(() => listPerformanceModePresets(), []);
  const { ipcRenderer } = electron;
  const [activeCalibration, setActiveCalibration] =
    useState<CalibrationCompletePayload | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState(false);
  const [isLoadingCalibration, setIsLoadingCalibration] = useState(false);
  const [calibrationStatusError, setCalibrationStatusError] = useState<
    string | null
  >(null);
  const [showRecalibration, setShowRecalibration] = useState(false);
  const [pendingSensitivity, setPendingSensitivity] =
    useState<CalibrationSensitivity>("medium");
  const [isUpdatingSensitivity, setIsUpdatingSensitivity] = useState(false);
  const [customSensitivityDraft, setCustomSensitivityDraft] = useState<{
    pitch: string;
    ehd: string;
    dpr: string;
  }>({
    pitch: "",
    ehd: "",
    dpr: "",
  });
  const [customSensitivityError, setCustomSensitivityError] = useState<
    string | null
  >(null);
  const sensitivityOptions: CalibrationSensitivity[] = [
    "low",
    "medium",
    "high",
    "custom",
  ];

  useEffect(() => {
    let cancelled = false;
    const loadCalibration = async () => {
      const loadChannel =
        (channels?.calibrationLoad as RendererChannel | undefined) ??
        IPC_CHANNELS.calibrationLoad;
      try {
        setIsLoadingCalibration(true);
        const response = (await ipcRenderer.invoke(
          loadChannel,
        )) as CalibrationCompletePayload | null;
        if (cancelled) {
          return;
        }
        if (response) {
          setActiveCalibration(response);
          setOnboardingComplete(true);
          setCalibrationStatusError(null);
        }
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        logger.error("Failed to load calibration", {
          error: error instanceof Error ? error.message : String(error),
        });
        setCalibrationStatusError(
          "Calibration data unavailable. Run calibration to personalise alerts.",
        );
      } finally {
        if (!cancelled) {
          setIsLoadingCalibration(false);
        }
      }
    };

    loadCalibration().catch((error: unknown) => {
      if (cancelled) {
        return;
      }
      logger.error("Unexpected calibration load failure", {
        error: error instanceof Error ? error.message : String(error),
      });
      setCalibrationStatusError(
        "Calibration data unavailable. Run calibration to personalise alerts.",
      );
      setIsLoadingCalibration(false);
    });

    return () => {
      cancelled = true;
    };
  }, [channels?.calibrationLoad, ipcRenderer]);

  const currentThresholds = useMemo(() => {
    if (!activeCalibration) {
      return null;
    }
    return applyThresholdDeltas(
      activeCalibration.baseline,
      activeCalibration.thresholds,
    );
  }, [activeCalibration]);

  const thresholdBounds = useMemo(() => {
    if (!activeCalibration) {
      return null;
    }
    return resolveCustomThresholdBounds(activeCalibration.baseline);
  }, [activeCalibration]);

  useEffect(() => {
    if (!activeCalibration || !currentThresholds) {
      setPendingSensitivity("medium");
      setCustomSensitivityDraft({
        pitch: "",
        ehd: "",
        dpr: "",
      });
      setCustomSensitivityError(null);
      return;
    }

    setPendingSensitivity(activeCalibration.sensitivity);

    const sourceThresholds =
      activeCalibration.sensitivity === "custom" &&
      activeCalibration.customThresholds
        ? {
            pitch:
              activeCalibration.customThresholds.pitch ??
              currentThresholds.pitch,
            ehd:
              activeCalibration.customThresholds.ehd ?? currentThresholds.ehd,
            dpr:
              activeCalibration.customThresholds.dpr ?? currentThresholds.dpr,
          }
        : currentThresholds;

    setCustomSensitivityDraft({
      pitch: formatWithPrecision(sourceThresholds.pitch, 2),
      ehd: formatWithPrecision(sourceThresholds.ehd, 3),
      dpr: formatWithPrecision(sourceThresholds.dpr, 3),
    });
    setCustomSensitivityError(null);
  }, [activeCalibration, currentThresholds]);

  const defaults = useMemo(
    () => ({
      waitingForPing: t("status.waitingForPing"),
      waitingForWorker: t("status.waitingForWorker"),
      workerBooting: t("status.workerBooting"),
      noWorkerResponse: t("status.noWorkerResponse"),
      noPayload: t("status.noPayload"),
      mainProcess: t("status.mainProcess"),
      workerStatus: t("status.workerStatus"),
      workerResponse: t("status.workerResponse"),
      engineTick: t("status.engineTick"),
      title: t("app.title"),
      tagline: t("app.tagline"),
      pingMain: t("actions.pingMain"),
      pingWorker: t("actions.pingWorker"),
      documentationTitle: t("cards.documentation.title"),
      documentationBody: t("cards.documentation.body"),
      turborepoTitle: t("cards.turborepo.title"),
      turborepoBody: t("cards.turborepo.body"),
    }),
    [t],
  );

  const cameraCopy = useMemo(
    () => ({
      title: t("camera.title", "Enable Camera Access"),
      description: t(
        "camera.description",
        "Posely needs access to your camera to analyze posture in real time.",
      ),
      requestButton: t("camera.requestButton", "Allow Camera"),
      requesting: t(
        "camera.requesting",
        "Waiting for the camera permission prompt…",
      ),
      deniedTitle: t("camera.deniedTitle", "Camera access is blocked"),
      deniedDescription: t(
        "camera.deniedDescription",
        "Enable camera access so Posely can capture frames for posture analysis.",
      ),
      openSettings: t("camera.openSettings", "Open System Settings"),
      retry: t("camera.retry", "Try Again"),
      revoked: t(
        "camera.revoked",
        "Camera access was disabled while Posely was running. Re-enable it in System Settings to resume posture analysis.",
      ),
      errorTitle: t("camera.errorTitle", "Camera access unavailable"),
      errorDescription: t(
        "camera.errorDescription",
        "We couldn't access your camera. Check your device connection and privacy settings.",
      ),
      statusWaiting: t(
        "camera.statusWaiting",
        "Waiting for camera permission…",
      ),
      instructions: [
        t("camera.instructions.openSettings", "Open System Settings"),
        t(
          "camera.instructions.privacySecurityCamera",
          "Navigate to Privacy & Security → Camera",
        ),
        t("camera.instructions.togglePosely", "Enable Posely"),
      ],
    }),
    [t],
  );

  const requestSensitivityUpdate = useCallback(
    async (
      nextSensitivity: CalibrationSensitivity,
      custom?: CalibrationCustomThresholds | null,
    ) => {
      if (!activeCalibration) {
        return null;
      }

      const updateChannel =
        (channels?.calibrationUpdateSensitivity as
          | RendererChannel
          | undefined) ?? IPC_CHANNELS.calibrationUpdateSensitivity;

      setIsUpdatingSensitivity(true);
      setCalibrationStatusError(null);
      setCustomSensitivityError(null);

      try {
        const response = (await ipcRenderer.invoke(updateChannel, {
          calibrationId: activeCalibration.calibrationId,
          sensitivity: nextSensitivity,
          customThresholds: custom ?? null,
        })) as CalibrationCompletePayload;
        setActiveCalibration(response);
        return response;
      } catch (error: unknown) {
        logger.error("Failed to update calibration sensitivity", {
          error: error instanceof Error ? error.message : String(error),
        });
        setCalibrationStatusError(
          "Failed to update sensitivity. Please try again.",
        );
        return null;
      } finally {
        setIsUpdatingSensitivity(false);
      }
    },
    [activeCalibration, channels?.calibrationUpdateSensitivity, ipcRenderer],
  );

  const handleSelectSensitivity = useCallback(
    (value: CalibrationSensitivity) => {
      setPendingSensitivity(value);
      setCustomSensitivityError(null);
      setCalibrationStatusError(null);

      if (!activeCalibration) {
        return;
      }

      if (value === "custom") {
        if (currentThresholds) {
          setCustomSensitivityDraft({
            pitch: formatWithPrecision(currentThresholds.pitch, 2),
            ehd: formatWithPrecision(currentThresholds.ehd, 3),
            dpr: formatWithPrecision(currentThresholds.dpr, 3),
          });
        }
        return;
      }

      if (value === activeCalibration.sensitivity) {
        return;
      }

      requestSensitivityUpdate(value).catch((error: unknown) => {
        logger.error("Sensitivity preset update failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
    [activeCalibration, currentThresholds, requestSensitivityUpdate],
  );

  const handleApplyCustomSensitivity = useCallback(() => {
    if (!activeCalibration || !thresholdBounds) {
      return;
    }

    const parseNumeric = (value: string) => {
      const parsed = Number.parseFloat(value.trim());
      return Number.isFinite(parsed) ? parsed : NaN;
    };

    const pitchValue = parseNumeric(customSensitivityDraft.pitch);
    const ehdValue = parseNumeric(customSensitivityDraft.ehd);
    const dprValue = parseNumeric(customSensitivityDraft.dpr);

    if (
      !Number.isFinite(pitchValue) ||
      !Number.isFinite(ehdValue) ||
      !Number.isFinite(dprValue)
    ) {
      setCustomSensitivityError("Enter numeric values for all thresholds.");
      return;
    }

    if (
      pitchValue < thresholdBounds.pitch.min ||
      pitchValue > thresholdBounds.pitch.max
    ) {
      setCustomSensitivityError(
        `Pitch must be between ${thresholdBounds.pitch.min.toFixed(1)}° and ${thresholdBounds.pitch.max.toFixed(1)}°.`,
      );
      return;
    }

    if (
      ehdValue < thresholdBounds.ehd.min ||
      ehdValue > thresholdBounds.ehd.max
    ) {
      setCustomSensitivityError(
        `EHD must be between ${thresholdBounds.ehd.min.toFixed(3)} and ${thresholdBounds.ehd.max.toFixed(3)}.`,
      );
      return;
    }

    if (
      dprValue < thresholdBounds.dpr.min ||
      dprValue > thresholdBounds.dpr.max
    ) {
      setCustomSensitivityError(
        `DPR must be between ${thresholdBounds.dpr.min.toFixed(3)} and ${thresholdBounds.dpr.max.toFixed(3)}.`,
      );
      return;
    }

    setCustomSensitivityError(null);
    setPendingSensitivity("custom");

    requestSensitivityUpdate("custom", {
      pitch: clamp(
        pitchValue,
        thresholdBounds.pitch.min,
        thresholdBounds.pitch.max,
      ),
      ehd: clamp(ehdValue, thresholdBounds.ehd.min, thresholdBounds.ehd.max),
      dpr: clamp(dprValue, thresholdBounds.dpr.min, thresholdBounds.dpr.max),
    }).catch((error: unknown) => {
      logger.error("Failed to apply custom thresholds", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, [
    activeCalibration,
    customSensitivityDraft,
    requestSensitivityUpdate,
    thresholdBounds,
  ]);

  const handleResetCustomSensitivity = useCallback(() => {
    if (!activeCalibration) {
      return;
    }
    const defaults = applyThresholdDeltas(
      activeCalibration.baseline,
      DEFAULT_THRESHOLD_DELTAS,
    );
    setCustomSensitivityDraft({
      pitch: formatWithPrecision(defaults.pitch, 2),
      ehd: formatWithPrecision(defaults.ehd, 3),
      dpr: formatWithPrecision(defaults.dpr, 3),
    });
    setCustomSensitivityError(null);
    setPendingSensitivity("custom");
  }, [activeCalibration]);

  const [mainResponse, setMainResponse] = useState<MessageState>(() =>
    createDefaultState(defaults.waitingForPing),
  );
  const [workerStatus, setWorkerStatus] = useState<MessageState>(() =>
    createDefaultState(defaults.workerBooting),
  );
  const [workerResponse, setWorkerResponse] = useState<MessageState>(() =>
    createDefaultState(defaults.noWorkerResponse),
  );
  const [engineTick, setEngineTick] = useState<EngineTick | null>(null);
  const [calibrationAlert, setCalibrationAlert] = useState<string | null>(null);

  useEffect(() => {
    setMainResponse((previous) =>
      previous.isDefault
        ? createDefaultState(defaults.waitingForPing)
        : previous,
    );
  }, [defaults.waitingForPing]);

  useEffect(() => {
    setWorkerStatus((previous) =>
      previous.isDefault
        ? createDefaultState(defaults.workerBooting)
        : previous,
    );
  }, [defaults.workerBooting]);

  useEffect(() => {
    setWorkerResponse((previous) =>
      previous.isDefault
        ? createDefaultState(defaults.noWorkerResponse)
        : previous,
    );
  }, [defaults.noWorkerResponse]);

  const formatIpcArgs = useCallback(
    (args: IpcArgs): string => {
      if (args.length === 0) {
        return defaults.noPayload;
      }
      if (args.length === 1) {
        return formatPayload(args[0]);
      }
      return formatPayload(args);
    },
    [defaults.noPayload],
  );

  const engineTickSummary = useMemo(() => {
    if (!engineTick) {
      return defaults.noPayload;
    }

    return `${engineTick.zone} • score ${engineTick.score} • ${engineTick.state}`;
  }, [defaults.noPayload, engineTick]);

  useEffect(() => {
    const disposePing = ipcRenderer.on(
      channels.rendererPing,
      (...args: unknown[]) => {
        setMainResponse(markAsCustom(formatIpcArgs(args)));
      },
    );

    const disposeWorkerStatus = ipcRenderer.on(
      channels.workerStatus,
      (...args: unknown[]) => {
        setWorkerStatus(markAsCustom(formatIpcArgs(args)));
      },
    );

    const disposeWorkerResponse = ipcRenderer.on(
      channels.workerResponse,
      (...args: unknown[]) => {
        setWorkerResponse(markAsCustom(formatIpcArgs(args)));
      },
    );

    const disposeEngineTick = ipcRenderer.on(
      channels.engineTick,
      (payload: unknown) => {
        if (payload && typeof payload === "object" && "tick" in payload) {
          const enginePayload = payload as EngineTickPayload;
          setEngineTick(enginePayload.tick);
        }
      },
    );

    const disposeCalibrationNudge = ipcRenderer.on(
      channels.calibrationNudge,
      (payload: unknown) => {
        if (payload && typeof payload === "object") {
          const data = payload as { reason?: string; ratio?: number };
          if (data.reason === "frequent-unreliable") {
            const ratioText =
              typeof data.ratio === "number"
                ? `${Math.round(data.ratio * 100)}% of frames`
                : "recent frames";
            setCalibrationAlert(
              `Detection frequently reports unreliable posture (${ratioText}). Consider recalibrating or adjusting sensitivity.`,
            );
          }
        }
      },
    );

    ipcRenderer.sendMessage(channels.workerRequest, {
      requestedAt: new Date().toISOString(),
      reason: "initial-status-check",
    });

    return () => {
      disposePing?.();
      disposeWorkerStatus?.();
      disposeWorkerResponse?.();
      disposeEngineTick?.();
      disposeCalibrationNudge?.();
    };
  }, [channels, formatIpcArgs, ipcRenderer]);

  const detectionStatus = detectionEnabled
    ? detection.status
    : cameraCopy.statusWaiting;

  const renderCameraPermissionCard = () => {
    switch (cameraPermission.state) {
      case "granted":
        return null;
      case "requesting":
        return (
          <Card className="bg-white/10 backdrop-blur">
            <CardHeader className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-white">
                {cameraCopy.title}
              </h2>
              <p className="text-sm text-white/70">{cameraCopy.requesting}</p>
            </CardHeader>
            <CardBody className="text-sm text-white/80">
              {cameraCopy.description}
            </CardBody>
          </Card>
        );
      case "denied":
        return (
          <Card className="bg-rose-500/20 backdrop-blur">
            <CardHeader className="flex flex-col gap-2 text-white">
              <h2 className="text-lg font-semibold">
                {cameraCopy.deniedTitle}
              </h2>
              <p className="text-sm text-white/80">
                {cameraPermission.error === "__revoked__"
                  ? cameraCopy.revoked
                  : cameraCopy.deniedDescription}
              </p>
            </CardHeader>
            <CardBody className="space-y-3 text-sm text-white/80">
              <ol className="list-decimal space-y-1 pl-5">
                {cameraCopy.instructions.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </CardBody>
            <CardFooter className="gap-3">
              <Button
                color="primary"
                onPress={() => {
                  cameraPermission.openSystemSettings();
                }}
              >
                {cameraCopy.openSettings}
              </Button>
              <Button
                variant="bordered"
                onPress={() => {
                  cameraPermission.requestPermission();
                }}
              >
                {cameraCopy.retry}
              </Button>
            </CardFooter>
          </Card>
        );
      case "error":
        return (
          <Card className="bg-amber-500/20 backdrop-blur">
            <CardHeader className="flex flex-col gap-2 text-white">
              <h2 className="text-lg font-semibold">{cameraCopy.errorTitle}</h2>
              <p className="text-sm text-white/80">
                {cameraPermission.error ?? cameraCopy.errorDescription}
              </p>
            </CardHeader>
            <CardFooter>
              <Button
                onPress={() => {
                  cameraPermission.openSystemSettings();
                }}
              >
                {cameraCopy.openSettings}
              </Button>
            </CardFooter>
          </Card>
        );
      default:
        return (
          <Card className="bg-white/10 backdrop-blur">
            <CardHeader className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold text-white">
                {cameraCopy.title}
              </h2>
              <p className="text-sm text-white/80">{cameraCopy.description}</p>
            </CardHeader>
            <CardFooter>
              <Button
                color="primary"
                onPress={() => {
                  cameraPermission.requestPermission();
                }}
              >
                {cameraCopy.requestButton}
              </Button>
            </CardFooter>
          </Card>
        );
    }
  };

  const sendPing = useCallback(() => {
    setMainResponse(createDefaultState(defaults.waitingForPing));
    ipcRenderer.sendMessage(channels.rendererPing, {
      requestedAt: new Date().toISOString(),
      source: "renderer",
    });
  }, [channels.rendererPing, defaults.waitingForPing, ipcRenderer]);

  const pingWorker = useCallback(() => {
    setWorkerResponse(createDefaultState(defaults.waitingForWorker));
    ipcRenderer.sendMessage(channels.workerRequest, {
      requestedAt: new Date().toISOString(),
      source: "renderer",
    });
  }, [channels.workerRequest, defaults.waitingForWorker, ipcRenderer]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-6 rounded-3xl bg-white/10 p-8 text-left shadow-2xl backdrop-blur">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-6">
            <img
              alt="Posely icon"
              className="h-20 w-20 rounded-2xl border border-white/40 shadow-xl"
              src={icon}
            />
            <div>
              <h1 className="text-3xl font-semibold text-white md:text-4xl">
                {defaults.title}
              </h1>
              <p className="mt-2 max-w-2xl text-base text-white/85 md:text-lg">
                {defaults.tagline}
              </p>
            </div>
          </div>
          <LanguageSwitcher />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button color="primary" size="lg" onPress={sendPing}>
            {defaults.pingMain}
          </Button>
          <Button
            color="secondary"
            size="lg"
            variant="bordered"
            onPress={pingWorker}
          >
            {defaults.pingWorker}
          </Button>
        </div>
      </header>

      {renderCameraPermissionCard()}
      {calibrationAlert ? (
        <section className="flex justify-center">
          <Card className="flex w-full max-w-3xl flex-col gap-3 bg-amber-500/20 p-6 text-left text-amber-50 backdrop-blur">
            <CardHeader className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">Calibration Recommended</h2>
              <p className="text-sm text-amber-100/90">{calibrationAlert}</p>
            </CardHeader>
            <CardFooter className="gap-3">
              <Button
                color="secondary"
                variant="bordered"
                onPress={() => {
                  setCalibrationAlert(null);
                  setShowRecalibration(true);
                }}
              >
                Re-calibrate now
              </Button>
              <Button
                color="primary"
                onPress={() => {
                  setCalibrationAlert(null);
                }}
              >
                Got it
              </Button>
            </CardFooter>
          </Card>
        </section>
      ) : null}
      {/* TODO: check onboarding flow & whether renderCameraPermissionCard is required */}
      <section className="flex justify-center">
        {onboardingComplete ? null : (
          <OnboardingWizard
            electron={electron}
            onComplete={(payload) => {
              if (payload) {
                setActiveCalibration(payload);
              }
              setOnboardingComplete(true);
              setCalibrationStatusError(null);
            }}
          />
        )}
      </section>

      {onboardingComplete ? (
        <section className="flex justify-center">
          <Card className="w-full max-w-3xl bg-black/40 text-left backdrop-blur-xl">
            <CardHeader className="flex flex-col gap-2 text-white">
              <h2 className="text-lg font-semibold">
                Calibration &amp; Sensitivity
              </h2>
              <p className="text-sm text-white/80">
                Personalised thresholds keep posture nudges relevant. Re-run
                calibration anytime your setup changes.
              </p>
            </CardHeader>
            <CardBody className="space-y-4 text-sm text-white/80">
              {activeCalibration ? (
                <>
                  <div className="grid gap-2 rounded-xl bg-white/5 p-3 text-xs text-white/80 sm:grid-cols-2">
                    <div>
                      <span className="font-semibold text-white/90">
                        Last calibrated:
                      </span>{" "}
                      {new Date(activeCalibration.recordedAt).toLocaleString()}
                    </div>
                    <div>
                      <span className="font-semibold text-white/90">
                        Quality score:
                      </span>{" "}
                      {activeCalibration.baseline.quality}/100
                    </div>
                    <div>
                      <span className="font-semibold text-white/90">
                        Sample count:
                      </span>{" "}
                      {activeCalibration.baseline.sampleCount}
                    </div>
                    <div>
                      <span className="font-semibold text-white/90">
                        Active sensitivity:
                      </span>{" "}
                      {formatSensitivityLabel(activeCalibration.sensitivity)}
                    </div>
                  </div>
                  {currentThresholds ? (
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-white">
                        Threshold overview
                      </p>
                      <div className="grid gap-2 rounded-xl bg-white/5 p-3 text-xs text-white/80 sm:grid-cols-3">
                        <div>
                          <span className="font-semibold text-white/90">
                            Pitch threshold:
                          </span>{" "}
                          {`${formatWithPrecision(currentThresholds.pitch, 2)}°`}
                        </div>
                        <div>
                          <span className="font-semibold text-white/90">
                            EHD threshold:
                          </span>{" "}
                          {formatWithPrecision(currentThresholds.ehd, 3)}
                        </div>
                        <div>
                          <span className="font-semibold text-white/90">
                            DPR threshold:
                          </span>{" "}
                          {formatWithPrecision(currentThresholds.dpr, 3)}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-white">
                      Sensitivity presets
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {sensitivityOptions.map((option) => {
                        const isSelected = pendingSensitivity === option;
                        const disablePreset =
                          isUpdatingSensitivity &&
                          !isSelected &&
                          option !== "custom";

                        return (
                          <Button
                            key={option}
                            color={isSelected ? "primary" : "default"}
                            variant={isSelected ? "solid" : "bordered"}
                            size="sm"
                            isDisabled={disablePreset}
                            onPress={() => {
                              if (disablePreset) {
                                return;
                              }
                              handleSelectSensitivity(option);
                            }}
                          >
                            {formatSensitivityLabel(option)}
                          </Button>
                        );
                      })}
                    </div>
                    {pendingSensitivity === "custom" && thresholdBounds ? (
                      <div className="space-y-3 rounded-xl border border-white/10 p-3">
                        <div className="grid gap-3 md:grid-cols-3">
                          <label className="flex flex-col gap-1 text-xs text-white/80">
                            <span className="uppercase tracking-wide text-white/60">
                              Pitch threshold (°)
                            </span>
                            <input
                              className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/40"
                              type="number"
                              min={thresholdBounds.pitch.min.toFixed(1)}
                              max={thresholdBounds.pitch.max.toFixed(1)}
                              step="0.1"
                              value={customSensitivityDraft.pitch}
                              onChange={(event) => {
                                const { value } = event.target;
                                setCustomSensitivityDraft((previous) => ({
                                  ...previous,
                                  pitch: value,
                                }));
                              }}
                            />
                            <span className="text-white/50">
                              Range {thresholdBounds.pitch.min.toFixed(1)}°–
                              {thresholdBounds.pitch.max.toFixed(1)}°
                            </span>
                          </label>
                          <label className="flex flex-col gap-1 text-xs text-white/80">
                            <span className="uppercase tracking-wide text-white/60">
                              EHD threshold
                            </span>
                            <input
                              className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/40"
                              type="number"
                              min={thresholdBounds.ehd.min.toFixed(3)}
                              max={thresholdBounds.ehd.max.toFixed(3)}
                              step="0.01"
                              value={customSensitivityDraft.ehd}
                              onChange={(event) => {
                                const { value } = event.target;
                                setCustomSensitivityDraft((previous) => ({
                                  ...previous,
                                  ehd: value,
                                }));
                              }}
                            />
                            <span className="text-white/50">
                              Range {thresholdBounds.ehd.min.toFixed(3)}–
                              {thresholdBounds.ehd.max.toFixed(3)}
                            </span>
                          </label>
                          <label className="flex flex-col gap-1 text-xs text-white/80">
                            <span className="uppercase tracking-wide text-white/60">
                              DPR threshold
                            </span>
                            <input
                              className="rounded-lg border border-white/20 bg-black/30 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-white/40"
                              type="number"
                              min={thresholdBounds.dpr.min.toFixed(3)}
                              max={thresholdBounds.dpr.max.toFixed(3)}
                              step="0.01"
                              value={customSensitivityDraft.dpr}
                              onChange={(event) => {
                                const { value } = event.target;
                                setCustomSensitivityDraft((previous) => ({
                                  ...previous,
                                  dpr: value,
                                }));
                              }}
                            />
                            <span className="text-white/50">
                              Range {thresholdBounds.dpr.min.toFixed(3)}–
                              {thresholdBounds.dpr.max.toFixed(3)}
                            </span>
                          </label>
                        </div>
                        {customSensitivityError ? (
                          <p className="text-xs text-rose-200">
                            {customSensitivityError}
                          </p>
                        ) : (
                          <p className="text-xs text-white/60">
                            Adjust posture deviation thresholds for advanced
                            tuning.
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            color="primary"
                            size="sm"
                            isDisabled={isUpdatingSensitivity}
                            onPress={handleApplyCustomSensitivity}
                          >
                            {isUpdatingSensitivity
                              ? "Applying…"
                              : "Apply custom thresholds"}
                          </Button>
                          <Button
                            color="secondary"
                            size="sm"
                            variant="bordered"
                            isDisabled={isUpdatingSensitivity}
                            onPress={handleResetCustomSensitivity}
                          >
                            Reset to recommended
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <p>No calibration stored yet.</p>
              )}
              {calibrationStatusError ? (
                <p className="text-amber-200">{calibrationStatusError}</p>
              ) : null}
              {isUpdatingSensitivity && activeCalibration ? (
                <p className="text-xs text-white/60">Updating sensitivity…</p>
              ) : null}
              {isLoadingCalibration ? (
                <p className="text-white/70">Refreshing calibration status…</p>
              ) : null}
            </CardBody>
            <CardFooter className="gap-3">
              <Button
                color="primary"
                isDisabled={isUpdatingSensitivity}
                onPress={() => {
                  setCalibrationStatusError(null);
                  setShowRecalibration(true);
                  setOnboardingComplete(true);
                }}
              >
                {activeCalibration ? "Re-calibrate" : "Start calibration"}
              </Button>
              {showRecalibration ? (
                <Button
                  color="secondary"
                  variant="bordered"
                  onPress={() => {
                    setShowRecalibration(false);
                  }}
                >
                  Close panel
                </Button>
              ) : null}
            </CardFooter>
          </Card>
        </section>
      ) : null}

      {showRecalibration ? (
        <section className="flex justify-center">
          <div className="flex w-full max-w-3xl flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-white">
                Re-run calibration
              </h3>
              <Button
                size="sm"
                variant="bordered"
                onPress={() => {
                  setShowRecalibration(false);
                }}
              >
                Cancel
              </Button>
            </div>
            <CalibrationFlow
              electron={electron}
              onComplete={
                () => {}
                // TODO: yeomin4242 - reinstate onboarding complete handler
                //   (payload) => {
                //   setActiveCalibration(payload);
                //   setShowRecalibration(false);
                //   setOnboardingComplete(true);
                //   setCalibrationStatusError(null);
                // }
              }
              completionDelayMs={600}
            />
          </div>
        </section>
      ) : null}

      <section className="flex justify-center">
        <OnboardingWizard
          electron={electron}
          onComplete={() => {
            logger.info("Onboarding completed successfully");
          }}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-4 xl:grid-cols-5">
        <Card className="bg-black/30 text-left backdrop-blur-lg">
          <CardHeader className="flex flex-col gap-1 text-white">
            <span className="text-sm uppercase tracking-wide text-white/60">
              {defaults.mainProcess}
            </span>
            <h2 className="text-lg font-semibold text-white">Main Process</h2>
          </CardHeader>
          <CardBody>
            <Code className="whitespace-pre-wrap break-words text-sm">
              {mainResponse.value}
            </Code>
          </CardBody>
        </Card>
        <Card className="bg-black/30 text-left backdrop-blur-lg">
          <CardHeader className="flex flex-col gap-1 text-white">
            <span className="text-sm uppercase tracking-wide text-white/60">
              {defaults.workerStatus}
            </span>
            <h2 className="text-lg font-semibold text-white">Worker Status</h2>
          </CardHeader>
          <CardBody>
            <Code className="whitespace-pre-wrap break-words text-sm">
              {workerStatus.value}
            </Code>
          </CardBody>
        </Card>
        <Card className="bg-black/30 text-left backdrop-blur-lg">
          <CardHeader className="flex flex-col gap-1 text-white">
            <span className="text-sm uppercase tracking-wide text-white/60">
              {defaults.workerResponse}
            </span>
            <h2 className="text-lg font-semibold text-white">
              Worker Response
            </h2>
          </CardHeader>
          <CardBody>
            <Code className="whitespace-pre-wrap break-words text-sm">
              {workerResponse.value}
            </Code>
          </CardBody>
        </Card>
        <Card className="bg-black/30 text-left backdrop-blur-lg">
          <CardHeader className="flex flex-col gap-1 text-white">
            <span className="text-sm uppercase tracking-wide text-white/60">
              {defaults.engineTick}
            </span>
            <h2 className="text-lg font-semibold text-white">Engine Tick</h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {engineTick ? (
              <>
                <Code className="whitespace-pre-wrap break-words text-xs text-white/80">
                  {engineTickSummary}
                </Code>
                <div className="flex flex-col gap-2 text-sm text-white/85">
                  <div className="flex justify-between">
                    <span>Updated</span>
                    <span className="font-semibold">
                      {new Date(engineTick.t).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Presence</span>
                    <span className="font-semibold">{engineTick.presence}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Reliability</span>
                    <span className="font-semibold">
                      {engineTick.reliability}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Zone</span>
                    <span className="font-semibold">{engineTick.zone}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>State</span>
                    <span className="font-semibold">{engineTick.state}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Score</span>
                    <span className="font-semibold">{engineTick.score}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Pitch (°)</span>
                    <span className="font-semibold">
                      {formatNumber(engineTick.metrics.pitchDeg)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>EHD Norm</span>
                    <span className="font-semibold">
                      {formatNumber(engineTick.metrics.ehdNorm)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>DPR</span>
                    <span className="font-semibold">
                      {formatNumber(engineTick.metrics.dpr)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Confidence</span>
                    <span className="font-semibold">
                      {formatNumber(engineTick.metrics.conf)}
                    </span>
                  </div>
                </div>
              </>
            ) : (
              <Code className="whitespace-pre-wrap break-words text-sm">
                {defaults.noPayload}
              </Code>
            )}
          </CardBody>
        </Card>
        <Card className="bg-black/30 text-left backdrop-blur-lg">
          <CardHeader className="flex flex-col gap-1 text-white">
            <span className="text-sm uppercase tracking-wide text-white/60">
              Detection Pipeline
            </span>
            <h2 className="text-lg font-semibold text-white">
              Pipeline Status
            </h2>
          </CardHeader>
          <CardBody className="flex flex-col gap-2 text-sm text-white/85">
            <div className="flex justify-between">
              <span>Status</span>
              <span className="font-semibold capitalize">
                {detectionStatus}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Detector</span>
              <span className="font-semibold capitalize">
                {detectionMetrics?.detector ?? preferredDetector}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Cross-Origin Isolated</span>
              <span className="font-semibold">
                {detectionMetrics?.crossOriginIsolated ? "true" : "false"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Frames Processed</span>
              <span className="font-semibold">
                {detectionMetrics?.framesProcessed ?? 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Frames Skipped</span>
              <span className="font-semibold">
                {detectionMetrics?.framesSkipped ?? 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Frames Dropped (busy)</span>
              <span className="font-semibold">
                {detectionMetrics?.framesDroppedWhileBusy ?? 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Inference (avg ms)</span>
              <span className="font-semibold">
                {formatMs(detectionMetrics?.averageInferenceMs)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Downscale (avg ms)</span>
              <span className="font-semibold">
                {formatMs(detectionMetrics?.averageDownscaleMs)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Main Thread (ms)</span>
              <span className="font-semibold">
                {formatMs(detectionMetrics?.lastMainThreadMs)}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Budget overruns</span>
              <span className="font-semibold">
                {detectionMetrics?.mainThreadBudgetOverruns ?? 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Presence</span>
              <span className="font-semibold">
                {detectionLandmarks?.presence ?? "UNKNOWN"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Reliability</span>
              <span className="font-semibold">
                {detectionLandmarks?.reliability ?? "UNKNOWN"}
              </span>
            </div>
            <div className="mt-3 border-t border-white/10 pt-3">
              <span className="mb-2 block text-xs uppercase tracking-wide text-white/50">
                Performance Mode
              </span>
              <div className="flex flex-wrap gap-1">
                {performanceModes.map((mode) => (
                  <Button
                    key={mode.id}
                    size="sm"
                    variant={performanceMode === mode.id ? "solid" : "bordered"}
                    color={performanceMode === mode.id ? "primary" : "default"}
                    isDisabled={
                      isSwitchingMode ||
                      isApplyingPerformance ||
                      !detectionEnabled
                    }
                    onPress={() => {
                      setPerformanceMode(mode.id);
                    }}
                  >
                    {mode.label}
                  </Button>
                ))}
              </div>
              <span className="mb-2 mt-4 block text-xs uppercase tracking-wide text-white/50">
                Advanced Overrides
              </span>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <span>Delegate</span>
                  <div className="flex gap-1">
                    {PERFORMANCE_DELEGATES.map((delegate) => (
                      <Button
                        key={delegate}
                        size="sm"
                        variant={
                          performanceConfig.delegate === delegate
                            ? "solid"
                            : "bordered"
                        }
                        color={
                          performanceConfig.delegate === delegate
                            ? "primary"
                            : "default"
                        }
                        isDisabled={
                          isApplyingPerformance ||
                          isSwitchingMode ||
                          !detectionEnabled
                        }
                        onPress={() => {
                          updatePerformance({ delegate });
                        }}
                      >
                        {delegate}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Target FPS</span>
                  <div className="flex gap-1">
                    {PERFORMANCE_FPS_OPTIONS.map((fps) => (
                      <Button
                        key={fps}
                        size="sm"
                        variant={
                          performanceConfig.fps === fps ? "solid" : "bordered"
                        }
                        color={
                          performanceConfig.fps === fps ? "primary" : "default"
                        }
                        isDisabled={
                          isApplyingPerformance ||
                          isSwitchingMode ||
                          !detectionEnabled
                        }
                        onPress={() => {
                          updatePerformance({ fps });
                        }}
                      >
                        {fps} fps
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Short Side</span>
                  <div className="flex gap-1">
                    {PERFORMANCE_SHORT_SIDE_OPTIONS.map((size) => (
                      <Button
                        key={size}
                        size="sm"
                        variant={
                          performanceConfig.shortSide === size
                            ? "solid"
                            : "bordered"
                        }
                        color={
                          performanceConfig.shortSide === size
                            ? "primary"
                            : "default"
                        }
                        isDisabled={
                          isApplyingPerformance ||
                          isSwitchingMode ||
                          !detectionEnabled
                        }
                        onPress={() => {
                          updatePerformance({ shortSide: size });
                        }}
                      >
                        {size}px
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            {isDevelopmentBuild ? (
              <div className="flex items-center justify-between">
                <span>Debug HUD</span>
                <Switch
                  isSelected={hudToggle}
                  size="sm"
                  onValueChange={setHudToggle}
                >
                  {hudToggle ? "On" : "Off"}
                </Switch>
              </div>
            ) : null}
            {isDevelopmentBuild ? (
              <div className="flex items-center justify-between">
                <span>Camera Preview</span>
                <Switch
                  isSelected={cameraPreviewToggle && detectionEnabled}
                  size="sm"
                  isDisabled={!detectionEnabled}
                  onValueChange={setCameraPreviewToggle}
                >
                  {cameraPreviewToggle && detectionEnabled ? "On" : "Off"}
                </Switch>
              </div>
            ) : null}
            {detection.error ? (
              <Code
                color="danger"
                className="whitespace-pre-wrap break-words text-xs"
              >
                {detection.error}
              </Code>
            ) : null}
          </CardBody>
        </Card>
      </section>

      <ExampleHeroUI
        engineTick={engineTick}
        onPingMain={sendPing}
        onPingWorker={pingWorker}
      />

      <DetectionDebugHud
        state={detectionDebug ?? null}
        visible={showDebugHud}
        overlay={cameraPreviewToggle && detectionEnabled}
      />

      <section className="grid gap-4 md:grid-cols-2">
        <Card className="bg-white/10 text-left backdrop-blur">
          <CardHeader className="flex items-start justify-between gap-4">
            <h3 className="text-xl font-semibold text-white">
              {defaults.documentationTitle}
            </h3>
            <Link
              color="primary"
              href="https://electron-react-boilerplate.js.org/"
              isExternal
              underline="always"
            >
              Docs
            </Link>
          </CardHeader>
          <CardBody className="text-sm text-white/80">
            {defaults.documentationBody}
          </CardBody>
          <CardFooter className="text-xs text-white/60">
            Explore Electron React Boilerplate resources.
          </CardFooter>
        </Card>
        <Card className="bg-white/10 text-left backdrop-blur">
          <CardHeader className="flex items-start justify-between gap-4">
            <h3 className="text-xl font-semibold text-white">
              {defaults.turborepoTitle}
            </h3>
            <Link
              color="primary"
              href="https://turborepo.org/docs"
              isExternal
              underline="always"
            >
              Turborepo
            </Link>
          </CardHeader>
          <CardBody className="text-sm text-white/80">
            {defaults.turborepoBody}
          </CardBody>
          <CardFooter className="text-xs text-white/60">
            Learn how Turborepo powers the build pipeline.
          </CardFooter>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-bold">
            {t("cards.documentation.title")}
          </h2>
        </CardHeader>
        <CardBody>
          <p>{defaults.documentationBody}</p>
        </CardBody>
        <CardFooter>
          <Link
            href="https://www.electronjs.org/docs/latest/"
            target="_blank"
            aria-label="Electron"
          >
            {t("actions.getStarted")}
          </Link>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-bold">
            {t("cards.errorMonitoring.title", "Error Monitoring (Live Sentry)")}
          </h2>
        </CardHeader>
        <CardBody>
          <p>
            {t(
              "cards.errorMonitoring.body",
              "These actions raise real errors using your configured Sentry project. Use them to validate instrumentation across processes and clear the events afterwards.",
            )}
          </p>
        </CardBody>
        <CardFooter className="flex justify-end space-x-2">
          <Button
            color="danger"
            onPress={() => {
              throw new Error("Intentional Renderer Error");
            }}
          >
            {t("actions.triggerRendererError", "Trigger Renderer Error")}
          </Button>
          <Button
            color="danger"
            onPress={() => {
              ipcRenderer
                .invoke(channels.triggerMainError as RendererChannel)
                .catch((error: unknown) => {
                  logger.error(
                    "Failed to trigger main process error from renderer",
                    {
                      error:
                        error instanceof Error ? error.message : String(error),
                      stack: error instanceof Error ? error.stack : undefined,
                    },
                  );
                });
            }}
          >
            {t("actions.triggerMainError", "Trigger Main Error")}
          </Button>
          <Button
            color="danger"
            onPress={() =>
              ipcRenderer.sendMessage(
                channels.triggerWorkerError as RendererChannel,
              )
            }
          >
            {t("actions.triggerWorkerError", "Trigger Worker Error")}
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-lg font-bold">{defaults.turborepoTitle}</h2>
        </CardHeader>
        <CardBody>
          <p>{defaults.turborepoBody}</p>
        </CardBody>
        <CardFooter>
          <Link
            href="https://turborepo.org/docs"
            target="_blank"
            aria-label="Turborepo"
          >
            {t("actions.getStarted")}
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}

function Hello() {
  const { electron } = window;
  const { t } = useTranslation(["errors", "common"]);

  if (!electron) {
    return (
      <Card className="bg-white/10 p-10 text-center text-white backdrop-blur">
        <CardHeader className="flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-semibold">
            {t("errors:ipc.unavailableTitle")}
          </h1>
        </CardHeader>
        <CardBody className="text-base text-white/80">
          {t("errors:ipc.unavailableDescription")}
        </CardBody>
      </Card>
    );
  }

  return <IntegrationDashboard electron={electron} />;
}

export default function App() {
  return (
    <HeroUIProvider>
      <HashRouter>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/settings" element={<Settings />} />
          <Route
            path="/calibration"
            element={
              <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-amber-300 via-rose-500 to-indigo-700 px-4 py-12">
                <OnboardingWizard
                  electron={window.electron}
                  // TODO: yeomin4242 - reinstate onboarding complete handler

                  // autoStart
                  onComplete={() => {
                    // After calibration, return to dashboard
                    window.location.hash = "#/dashboard";
                  }}
                />
              </div>
            }
          />
          <Route
            path="/onboarding"
            element={
              <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-amber-300 via-rose-500 to-indigo-700 px-4 py-12">
                <OnboardingWizardV2 />
              </div>
            }
          />
          <Route
            path="/"
            element={
              <div className="min-h-screen bg-gradient-to-br from-amber-300 via-rose-500 to-indigo-700 px-4 py-12 text-white md:px-8">
                <div className="mx-auto w-full max-w-5xl">
                  <Hello />
                </div>
              </div>
            }
          />
        </Routes>
      </HashRouter>
    </HeroUIProvider>
  );
}
