import { useEffect, useMemo, useRef, useState } from "react";
import { getLogger } from "../../shared/logger";
import type { DetectorKind } from "../../shared/types/detector";
import { type DetectionMetrics, DetectionPipeline } from "./detectionPipeline";

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
        setStatus("running");
        return undefined;
      })
      .catch((startError) => {
        const message =
          startError instanceof Error ? startError.message : String(startError);
        logger.error("Failed to start detection pipeline", { message });
        if (isMounted) {
          setError(message);
          setStatus("error");
        }
        pipeline.stop();
        return undefined;
      });

    const updateInterval = window.setInterval(() => {
      if (isMounted) {
        setMetrics(pipeline.getMetrics());
      }
    }, 1000);

    return () => {
      isMounted = false;
      window.clearInterval(updateInterval);
      pipeline.stop();
    };
  }, [enabled, detector, pipeline]);

  return {
    status,
    metrics,
    error,
  } as const;
};

export default useDetectionPipeline;
