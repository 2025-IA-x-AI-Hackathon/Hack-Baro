import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getLogger } from "../../shared/logger";
import {
  DEFAULT_PERFORMANCE_MODE_ID,
  type PerformanceModeId,
} from "../../shared/sampling";
import type { DetectorKind } from "../../shared/types/detector";
import type { CombinedLandmarks } from "../../shared/types/landmarks";
import { captureRendererException } from "../sentry";
import {
  DEFAULT_PERFORMANCE_CONFIG,
  type DetectionDebugState,
  type DetectionMetrics,
  DetectionPipeline,
  type PerformanceConfig,
} from "./detectionPipeline";

type PipelineStatus = "idle" | "starting" | "running" | "error";

const logger = getLogger("use-detection-pipeline", "renderer");

type Options = {
  enabled?: boolean;
  detector?: DetectorKind;
};

export const useDetectionPipeline = ({
  enabled = true,
  detector = "mediapipe",
}: Options = {}) => {
  const [status, setStatus] = useState<PipelineStatus>("idle");
  const [metrics, setMetrics] = useState<DetectionMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [debug, setDebug] = useState<DetectionDebugState | null>(null);
  const [landmarks, setLandmarks] = useState<CombinedLandmarks | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [performanceConfig, setPerformanceConfig] = useState<PerformanceConfig>(
    DEFAULT_PERFORMANCE_CONFIG,
  );
  const [isApplyingPerformance, setIsApplyingPerformance] = useState(false);
  const [performanceMode, setPerformanceModeState] =
    useState<PerformanceModeId>(DEFAULT_PERFORMANCE_MODE_ID);
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);

  const pipelineRef = useRef<DetectionPipeline | null>(null);

  const pipeline = useMemo(() => {
    if (!pipelineRef.current) {
      pipelineRef.current = new DetectionPipeline();
    }
    return pipelineRef.current;
  }, []);

  useEffect(() => {
    if (!enabled) {
      pipeline.stop();
      setStatus("idle");
      setMetrics(null);
      setDebug(null);
      setLandmarks(null);
      setCameraStream(null);
      pipeline.setCameraPreviewVisible(false);
      return () => {
        pipeline.stop();
      };
    }

    let isMounted = true;

    setStatus("starting");
    setError(null);

    pipeline
      .start(detector)
      .then((initialMetrics) => {
        if (!isMounted) {
          return undefined;
        }
        setMetrics({ ...initialMetrics });
        setDebug(pipeline.getDebugState());
        setPerformanceConfig(pipeline.getPerformanceConfig());
        setPerformanceModeState(pipeline.getPerformanceMode());
        setLandmarks(pipeline.getLatestLandmarks());
        setCameraStream(pipeline.getCameraStream());
        setStatus("running");
        return undefined;
      })
      .catch((startError) => {
        const message =
          startError instanceof Error ? startError.message : String(startError);
        logger.error("Failed to start detection pipeline", { message });
        captureRendererException(startError);
        if (isMounted) {
          setError(message);
          setStatus("error");
          setCameraStream(null);
        }
        pipeline.stop();
        return undefined;
      });

    const updateInterval = window.setInterval(() => {
      if (isMounted) {
        setMetrics(pipeline.getMetrics());
        setDebug(pipeline.getDebugState());
        setCameraStream((current) => {
          const next = pipeline.getCameraStream();
          return current === next ? current : next;
        });
      }
    }, 1000);

    return () => {
      isMounted = false;
      window.clearInterval(updateInterval);
      pipeline.stop();
      setCameraStream(null);
    };
  }, [enabled, detector, pipeline]);

  useEffect(() => {
    const dispose = pipeline.onLandmarks((latest) => {
      setLandmarks((current) => (current === latest ? current : latest));
    });
    setLandmarks(pipeline.getLatestLandmarks());
    return () => {
      dispose();
    };
  }, [pipeline]);

  const setCameraPreviewVisible = useCallback(
    (visible: boolean) => {
      pipeline.setCameraPreviewVisible(visible);
    },
    [pipeline],
  );

  const updatePerformance = useCallback(
    async (patch: Partial<PerformanceConfig>) => {
      const targetDelegate = patch.delegate ?? performanceConfig.delegate;

      let nextAlternating: number;

      if (patch.alternatingFrameCadence !== undefined) {
        nextAlternating = patch.alternatingFrameCadence;
      } else if (
        patch.delegate &&
        patch.delegate !== performanceConfig.delegate
      ) {
        if (targetDelegate === "CPU") {
          nextAlternating = 3;
        } else {
          nextAlternating = DEFAULT_PERFORMANCE_CONFIG.alternatingFrameCadence;
        }
      } else {
        nextAlternating = performanceConfig.alternatingFrameCadence;
      }

      const nextConfig: PerformanceConfig = {
        ...performanceConfig,
        ...patch,
        alternatingFrameCadence: nextAlternating,
      };

      if (
        nextConfig.delegate === performanceConfig.delegate &&
        nextConfig.fps === performanceConfig.fps &&
        nextConfig.shortSide === performanceConfig.shortSide &&
        nextConfig.alternatingFrameCadence ===
          performanceConfig.alternatingFrameCadence
      ) {
        return;
      }

      const wasRunning = pipeline.isRunning();
      if (wasRunning) {
        setStatus("starting");
      }
      setIsApplyingPerformance(true);
      try {
        await pipeline.applyPerformanceConfig(nextConfig);
        setPerformanceConfig(pipeline.getPerformanceConfig());
        setMetrics(pipeline.getMetrics());
        setDebug(pipeline.getDebugState());
        setLandmarks(pipeline.getLatestLandmarks());
        setCameraStream(pipeline.getCameraStream());
        setError(null);
        if (pipeline.isRunning()) {
          setStatus("running");
        } else if (wasRunning) {
          setStatus("idle");
        }
      } catch (applyError) {
        const message =
          applyError instanceof Error ? applyError.message : String(applyError);
        logger.error("Failed to update detection performance", { message });
        captureRendererException(applyError);
        setError(message);
        setStatus("error");
      } finally {
        setIsApplyingPerformance(false);
      }
    },
    [performanceConfig, pipeline],
  );

  const changePerformanceMode = useCallback(
    async (mode: PerformanceModeId) => {
      if (mode === pipeline.getPerformanceMode()) {
        return;
      }

      const wasRunning = pipeline.isRunning();
      if (wasRunning) {
        setStatus("starting");
      }
      setIsSwitchingMode(true);
      try {
        await pipeline.setPerformanceMode(mode);
        setPerformanceModeState(pipeline.getPerformanceMode());
        setPerformanceConfig(pipeline.getPerformanceConfig());
        setMetrics(pipeline.getMetrics());
        setDebug(pipeline.getDebugState());
        setLandmarks(pipeline.getLatestLandmarks());
        setCameraStream(pipeline.getCameraStream());
        setError(null);
        if (pipeline.isRunning()) {
          setStatus("running");
        } else if (wasRunning) {
          setStatus("idle");
        }
      } catch (applyError) {
        const message =
          applyError instanceof Error ? applyError.message : String(applyError);
        logger.error("Failed to update performance mode", { message });
        captureRendererException(applyError as Error);
        setError(message);
        setStatus("error");
      } finally {
        setIsSwitchingMode(false);
      }
    },
    [pipeline],
  );

  return {
    status,
    metrics,
    error,
    debug,
    landmarks,
    setCameraPreviewVisible,
    performanceConfig,
    updatePerformance,
    isApplyingPerformance,
    performanceMode,
    setPerformanceMode: changePerformanceMode,
    isSwitchingMode,
    cameraStream,
  } as const;
};

export default useDetectionPipeline;
