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
import icon from "../../assets/icon.svg";
import type { ElectronHandler } from "../main/preload";
import { parseBooleanFlag } from "../shared/env";
import { IPC_CHANNELS } from "../shared/ipcChannels";
import type { RendererChannel } from "../shared/ipcChannels";
import { getLogger } from "../shared/logger";
import { listPerformanceModePresets } from "../shared/sampling";
import type { DetectorKind } from "../shared/types/detector";
import type { EngineTickPayload } from "../shared/types/engine-ipc";
import type { EngineTick } from "../shared/types/engine-output";
import { useCameraPermission } from "./camera/useCameraPermission";
import ExampleHeroUI from "./components/ExampleHeroUI";
import { LanguageSwitcher } from "./components/LanguageSwitcher";
import { OnboardingWizard } from "./components/onboarding/OnboardingWizard";
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
  const channels = useMemo<ElectronHandler["channels"]>(
    () => electron.channels ?? IPC_CHANNELS,
    [electron],
  );
  const performanceModes = useMemo(() => listPerformanceModePresets(), []);
  const { ipcRenderer } = electron;

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

    ipcRenderer.sendMessage(channels.workerRequest, {
      requestedAt: new Date().toISOString(),
      reason: "initial-status-check",
    });

    return () => {
      disposePing?.();
      disposeWorkerStatus?.();
      disposeWorkerResponse?.();
      disposeEngineTick?.();
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
      {/* TODO: check onboarding flow & whether renderCameraPermissionCard is required */}
      <section className="flex justify-center">
        <OnboardingWizard />
      </section>

      <section className="grid gap-4 md:grid-cols-4">
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
      <div className="min-h-screen bg-gradient-to-br from-amber-300 via-rose-500 to-indigo-700 px-4 py-12 text-white md:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <Hello />
        </div>
      </div>
    </HeroUIProvider>
  );
}
