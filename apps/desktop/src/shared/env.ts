export const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

export const parseBooleanFlag = (
  value?: string | null,
  defaultValue = false,
): boolean => {
  if (typeof value !== "string") {
    return defaultValue;
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === "1" || normalised === "true" || normalised === "yes") {
    return true;
  }
  if (normalised === "0" || normalised === "false" || normalised === "no") {
    return false;
  }
  return defaultValue;
};

export const parseOptionalBoolean = (value?: string | null): boolean | null => {
  if (typeof value !== "string") {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  if (normalised === "1" || normalised === "true" || normalised === "yes") {
    return true;
  }
  if (normalised === "0" || normalised === "false" || normalised === "no") {
    return false;
  }
  return null;
};

type NumericOptions = {
  min: number;
  max: number;
  integer?: boolean;
};

export const parseNumericEnv = (
  value: string | null | undefined,
  options: NumericOptions,
): number | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = options.integer
    ? Number.parseInt(trimmed, 10)
    : Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return clamp(parsed, options.min, options.max);
};

export const getEnvVar = (key: string): string | undefined => {
  if (typeof process !== "undefined" && process?.env?.[key] !== undefined) {
    return process.env[key];
  }
  return undefined;
};
