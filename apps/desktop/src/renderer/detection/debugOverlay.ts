import type {
  EngineReliability,
  PresenceState,
} from "../../shared/types/engine-state";
import type {
  MetricConfidence,
  MetricSource,
} from "../../shared/types/metrics";

type MetricKeys = "ehd" | "pitch" | "yaw" | "roll" | "dpr";

type MetricSnapshot = {
  raw: number | null;
  ema: number | null;
  confidence: MetricConfidence;
  source: MetricSource;
  outlier: boolean;
};

export type RendererMetricDebugSample = {
  timestamp: number;
  frameId: number | null;
  presence: PresenceState;
  faceConfidence: number | null;
  poseConfidence: number | null;
  yawDeweighted: boolean;
  lowConfidence: boolean;
  baselinePending: boolean;
  baseline: number | null;
  illuminationConfidence: number | null;
  reliability: EngineReliability;
  reliabilityReasons: readonly string[];
  metrics: Record<MetricKeys, MetricSnapshot>;
};

const MAX_HISTORY = 300;
const history: RendererMetricDebugSample[] = [];
let overlayEnabled = false;
let overlayElement: HTMLDivElement | null = null;
let latestSample: RendererMetricDebugSample | null = null;

const formatNumber = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) {
    return "—";
  }
  if (Math.abs(value) >= 100) {
    return value.toFixed(1);
  }
  return value.toFixed(3);
};

const formatDelta = (raw: number | null, ema: number | null): string => {
  if (raw === null || ema === null || Number.isNaN(raw) || Number.isNaN(ema)) {
    return "—";
  }
  return (raw - ema).toFixed(3);
};

const ensureOverlay = () => {
  if (typeof document === "undefined") {
    return;
  }
  if (overlayElement) {
    return;
  }
  overlayElement = document.createElement("div");
  overlayElement.id = "posely-metrics-overlay";
  overlayElement.style.cssText = [
    "position:fixed",
    "top:1.25rem",
    "right:1.25rem",
    "z-index:9999",
    "padding:1rem 1.25rem",
    "max-width:24rem",
    "font-family:Menlo,Consolas,monospace",
    "font-size:12px",
    "line-height:1.45",
    "color:#ffffff",
    "background:rgba(0,0,0,0.78)",
    "border-radius:10px",
    "box-shadow:0 6px 18px rgba(0,0,0,0.35)",
    "pointer-events:none",
    "white-space:pre-wrap",
  ].join(";");
  document.body.appendChild(overlayElement);
};

const renderOverlay = () => {
  if (!overlayEnabled || !latestSample || typeof document === "undefined") {
    return;
  }
  ensureOverlay();
  if (!overlayElement) {
    return;
  }

  const sample = latestSample;
  const timestamp = new Date(sample.timestamp).toLocaleTimeString();
  const header = `Frame: ${sample.frameId ?? "—"}  @ ${timestamp}`;
  const baseline = `Baseline face size: ${formatNumber(sample.baseline)}`;
  const reliabilityReasonsArr = Array.isArray(sample.reliabilityReasons)
    ? sample.reliabilityReasons
    : [];
  const reliabilityReasons =
    reliabilityReasonsArr.length > 0 ? reliabilityReasonsArr.join(", ") : "—";
  const metrics = sample.metrics ?? ({} as Record<MetricKeys, MetricSnapshot>);
  const headPoseSource = metrics?.pitch?.source ?? "unknown";
  const status = `Reliability: ${sample.reliability}  |  Reasons: ${reliabilityReasons}  |  HeadPose: ${headPoseSource}`;
  const confidenceLine = `Conf: face=${formatNumber(sample.faceConfidence)}  pose=${formatNumber(sample.poseConfidence)}  illum=${formatNumber(sample.illuminationConfidence)}`;
  const flags = `Presence: ${sample.presence}\n${confidenceLine}\nYaw de-weighted: ${sample.yawDeweighted ? "YES" : "NO"}  |  Low confidence: ${sample.lowConfidence ? "YES" : "NO"}  |  DPR baseline pending: ${sample.baselinePending ? "YES" : "NO"}`;

  const metricKeys = metrics ? (Object.keys(metrics) as MetricKeys[]) : [];
  const metricRows = metricKeys
    .map((key) => {
      const metric = metrics[key];
      const label = key.toUpperCase().padEnd(4, " ");
      const delta = formatDelta(metric?.raw ?? null, metric?.ema ?? null);
      const warning = metric?.outlier ? " ⚠" : "";
      return `${label}  raw: ${formatNumber(metric?.raw ?? null)}  ema: ${formatNumber(
        metric?.ema ?? null,
      )}  Δ:${delta}  src:${metric?.source ?? "unknown"}  conf:${
        metric?.confidence ?? "NONE"
      }${warning}`;
    })
    .join("\n");

  overlayElement.textContent = `${header}\n${status}\n${flags}\n${baseline}\n\n${metricRows}`;
};

const setOverlayEnabled = (enabled: boolean) => {
  overlayEnabled = enabled;
  if (!enabled && overlayElement) {
    overlayElement.remove();
    overlayElement = null;
  }
  if (enabled) {
    renderOverlay();
  }
};

const toggleOverlay = () => {
  setOverlayEnabled(!overlayEnabled);
};

const getHistory = (limit = 50): RendererMetricDebugSample[] => {
  if (limit <= 0) {
    return [...history];
  }
  return history.slice(Math.max(0, history.length - limit));
};

const printMetricHistory = (metric: MetricKeys = "dpr", limit = 10) => {
  const rows = getHistory(limit).map((sample) => ({
    time: new Date(sample.timestamp).toLocaleTimeString(),
    raw: formatNumber(sample.metrics?.[metric]?.raw ?? null),
    ema: formatNumber(sample.metrics?.[metric]?.ema ?? null),
    delta: formatDelta(
      sample.metrics?.[metric]?.raw ?? null,
      sample.metrics?.[metric]?.ema ?? null,
    ),
    outlier: sample.metrics?.[metric]?.outlier,
    confidence: sample.metrics?.[metric]?.confidence,
    source: sample.metrics?.[metric]?.source,
    presence: sample.presence,
    faceConfidence: sample.faceConfidence,
    poseConfidence: sample.poseConfidence,
    yawDeweighted: metric === "yaw" ? sample.yawDeweighted : undefined,
  }));
  // eslint-disable-next-line no-console
  console.table(rows);
};

export const handleMetricsDebug = (sample: RendererMetricDebugSample): void => {
  if (!sample) {
    return;
  }
  history.push(sample);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
  latestSample = sample;
  if (typeof window !== "undefined") {
    window.__POSELY_METRICS_HISTORY__ = history;
  }
  if (overlayEnabled) {
    renderOverlay();
  }
};

if (typeof window !== "undefined") {
  window.togglePoselyMetricsOverlay = toggleOverlay;
  window.getPoselyMetricsHistory = getHistory;
  window.printPoselyMetricHistory = (
    metric: MetricKeys = "dpr",
    limit = 10,
  ) => {
    printMetricHistory(metric, limit);
  };
  window.addEventListener("keydown", (event) => {
    if (
      (event.metaKey || event.ctrlKey) &&
      event.shiftKey &&
      event.code === "KeyM"
    ) {
      event.preventDefault();
      toggleOverlay();
    }
  });
}

declare global {
  interface Window {
    togglePoselyMetricsOverlay?: () => void;
    getPoselyMetricsHistory?: (limit?: number) => RendererMetricDebugSample[];
    printPoselyMetricHistory?: (metric?: MetricKeys, limit?: number) => void;
    __POSELY_METRICS_HISTORY__?: RendererMetricDebugSample[];
  }
}

export const setMetricsOverlayEnabled = setOverlayEnabled;
export const isMetricsOverlayEnabled = () => overlayEnabled;
