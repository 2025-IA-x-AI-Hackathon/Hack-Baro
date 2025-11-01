export const getMonotonicTime = (): number => {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  return Date.now();
};

export const resolveTimestamp = (value?: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return getMonotonicTime();
};
