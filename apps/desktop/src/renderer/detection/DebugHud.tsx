import { cn } from "@heroui/theme";
import { memo, useEffect, useMemo, useRef } from "react";
import type { DetectionDebugState } from "./detectionPipeline";

interface ClassNames {
  container?: string;
  canvas?: string;
}

type DebugHudProps = {
  state: DetectionDebugState | null;
  visible: boolean;
  overlay: boolean;
  classNames?: ClassNames;
};

const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 240;
const FACE_POINT_SIZE = 2;
const POSE_POINT_SIZE = 4;
const FACE_COLOR = "rgba(0, 200, 255, 0.8)";
const POSE_COLOR = "rgba(0, 255, 120, 0.9)";
const SHOULDER_COLOR = "rgba(255, 200, 0, 0.9)";

const formatMetric = (value: number | null | undefined, digits = 2): string =>
  Number.isFinite(value ?? NaN) ? (value as number).toFixed(digits) : "--";

const clearCanvas = (context: CanvasRenderingContext2D) => {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  context.restore();
};

const drawPoint = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  size: number,
) => {
  context.beginPath();
  context.fillStyle = color;
  context.arc(x, y, size, 0, 2 * Math.PI);
  context.fill();
};

const project = (value: number): number => value * CANVAS_WIDTH;
const projectY = (value: number): number => value * CANVAS_HEIGHT;

function DetectionDebugHudComponent({
  state,
  visible,
  overlay = false,
  classNames,
}: DebugHudProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const metrics = useMemo(
    () =>
      state?.metrics ?? {
        pitchRaw: null,
        pitchEma: null,
        ehdRaw: null,
        ehdEma: null,
        dprRaw: null,
        dprEma: null,
      },
    [state],
  );

  const combined = state?.landmarks ?? null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    clearCanvas(context);

    if (!combined) {
      return;
    }

    if (combined.face?.landmarks) {
      combined.face.landmarks.forEach((landmark) => {
        if (Number.isFinite(landmark.x) && Number.isFinite(landmark.y)) {
          drawPoint(
            context,
            project(landmark.x),
            projectY(landmark.y),
            FACE_COLOR,
            FACE_POINT_SIZE,
          );
        }
      });
    }

    if (combined.pose?.landmarks) {
      const poseLandmarks = combined.pose.landmarks;
      poseLandmarks.forEach((landmark, index) => {
        if (Number.isFinite(landmark.x) && Number.isFinite(landmark.y)) {
          const highlight =
            index === 7 ||
            index === 8 ||
            index === 11 ||
            index === 12 ||
            index === 0;
          drawPoint(
            context,
            project(landmark.x),
            projectY(landmark.y),
            highlight ? SHOULDER_COLOR : POSE_COLOR,
            highlight ? POSE_POINT_SIZE + 1 : POSE_POINT_SIZE,
          );
        }
      });
    }
  }, [combined]);

  if (!visible) {
    return null;
  }

  const presence = combined?.presence ?? "UNKNOWN";
  const reliability = combined?.reliability ?? "UNKNOWN";

  const containerClasses = overlay
    ? "pointer-events-none fixed bottom-6 right-6 z-[9999]"
    : "fixed bottom-6 right-6 z-[9999] w-[360px] rounded-xl border border-white/10 bg-[rgba(10,12,16,0.78)] p-3 font-mono text-xs text-slate-100 shadow-2xl backdrop-blur-xl";

  const canvasClasses = overlay
    ? "h-auto w-[320px] rounded-md border border-white/40 bg-transparent"
    : "mb-3 h-auto w-full rounded-md border border-white/10 bg-[rgba(8,12,20,0.8)]";

  return (
    <div className={cn(containerClasses, classNames?.container)}>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className={cn(canvasClasses, classNames?.canvas)}
        style={
          overlay ? { boxShadow: "0 0 0 2px rgba(255,255,255,0.5)" } : undefined
        }
      />
      {overlay ? null : (
        <div className="grid gap-1 text-[11px] leading-relaxed">
          <div>
            <span className="font-semibold">presence:</span> {presence}
          </div>
          <div>
            <span className="font-semibold">reliability:</span> {reliability}
          </div>
          <div>
            <span className="font-semibold">pitch</span> raw{" "}
            {formatMetric(metrics.pitchRaw, 1)}° / ema{" "}
            {formatMetric(metrics.pitchEma, 1)}°
          </div>
          <div>
            <span className="font-semibold">ehd</span> raw{" "}
            {formatMetric(metrics.ehdRaw, 3)} / ema{" "}
            {formatMetric(metrics.ehdEma, 3)}
          </div>
          <div>
            <span className="font-semibold">dpr</span> raw{" "}
            {formatMetric(metrics.dprRaw, 3)} / ema{" "}
            {formatMetric(metrics.dprEma, 3)}
          </div>
          <div className="opacity-70">
            <span className="font-semibold">frame</span>{" "}
            {combined?.frameId ?? "--"}
          </div>
        </div>
      )}
    </div>
  );
}

export const DetectionDebugHud = memo(DetectionDebugHudComponent);

export default DetectionDebugHud;
