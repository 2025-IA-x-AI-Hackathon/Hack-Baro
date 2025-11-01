import { clamp } from "../env";

export type PerformanceModeId = "battery_saver" | "balanced" | "responsive";

export type PerformanceRange = {
  min: number;
  max: number;
};

export type PerformanceModePreset = {
  id: PerformanceModeId;
  label: string;
  baseline: PerformanceRange;
  boosted: PerformanceRange;
  defaultShortSide: number;
  minShortSide: number;
  maxShortSide: number;
};

export const DEFAULT_PERFORMANCE_MODE_ID: PerformanceModeId = "balanced";

const clampRange = (
  range: PerformanceRange,
  floor: number,
  ceiling: number,
) => {
  const clampedMin = clamp(range.min, floor, ceiling);
  const clampedMax = clamp(range.max, floor, ceiling);
  return {
    min: clampedMin,
    max: clampedMax >= clampedMin ? clampedMax : clampedMin,
  } satisfies PerformanceRange;
};

const makePreset = (
  preset: Omit<PerformanceModePreset, "baseline" | "boosted"> & {
    baseline: PerformanceRange;
    boosted: PerformanceRange;
  },
): PerformanceModePreset => {
  const minFps = 1;
  const maxFps = 15;
  return {
    ...preset,
    baseline: clampRange(preset.baseline, minFps, maxFps),
    boosted: clampRange(preset.boosted, minFps, maxFps),
  } satisfies PerformanceModePreset;
};

export const PERFORMANCE_MODE_PRESETS: Record<
  PerformanceModeId,
  PerformanceModePreset
> = {
  battery_saver: makePreset({
    id: "battery_saver",
    label: "Battery Saver",
    baseline: { min: 1, max: 2 },
    boosted: { min: 5, max: 8 },
    defaultShortSide: 224,
    minShortSide: 192,
    maxShortSide: 256,
  }),
  balanced: makePreset({
    id: "balanced",
    label: "Balanced",
    baseline: { min: 2, max: 5 },
    boosted: { min: 8, max: 12 },
    defaultShortSide: 256,
    minShortSide: 224,
    maxShortSide: 288,
  }),
  responsive: makePreset({
    id: "responsive",
    label: "Responsive",
    baseline: { min: 5, max: 8 },
    boosted: { min: 10, max: 15 },
    defaultShortSide: 320,
    minShortSide: 256,
    maxShortSide: 352,
  }),
};

export const getPerformanceModePreset = (
  mode: PerformanceModeId,
): PerformanceModePreset => {
  return (
    PERFORMANCE_MODE_PRESETS[mode] ??
    PERFORMANCE_MODE_PRESETS[DEFAULT_PERFORMANCE_MODE_ID]
  );
};

export const listPerformanceModePresets = (): PerformanceModePreset[] => {
  return Object.values(PERFORMANCE_MODE_PRESETS);
};

export const clampFpsToPresetRange = (
  mode: PerformanceModePreset,
  fps: number,
  kind: "baseline" | "boosted",
): number => {
  const range = kind === "baseline" ? mode.baseline : mode.boosted;
  if (!Number.isFinite(fps)) {
    return range.max;
  }
  return clamp(fps, range.min, range.max);
};
