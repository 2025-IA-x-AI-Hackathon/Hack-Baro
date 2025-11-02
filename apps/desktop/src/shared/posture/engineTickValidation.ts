import type { EngineTick } from "../types/engine";

const ENGINE_PRESENCE_VALUES: ReadonlySet<EngineTick["presence"]> = new Set([
  "PRESENT",
  "ABSENT",
]);

const ENGINE_RELIABILITY_VALUES: ReadonlySet<EngineTick["reliability"]> =
  new Set(["OK", "UNRELIABLE"]);

const ENGINE_ZONE_VALUES: ReadonlySet<EngineTick["zone"]> = new Set([
  "GREEN",
  "YELLOW",
  "RED",
]);

const ENGINE_STATE_VALUES: ReadonlySet<EngineTick["state"]> = new Set([
  "GOOD",
  "AT_RISK",
  "BAD_POSTURE",
  "RECOVERING",
  "IDLE",
  "UNRELIABLE",
]);

export const ENGINE_TICK_CONSTANTS = {
  PRESENCE: ENGINE_PRESENCE_VALUES,
  RELIABILITY: ENGINE_RELIABILITY_VALUES,
  ZONE: ENGINE_ZONE_VALUES,
  STATE: ENGINE_STATE_VALUES,
} as const;

export const isEngineTickPayload = (value: unknown): value is EngineTick => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as EngineTick;

  if (typeof candidate.t !== "number") {
    return false;
  }

  if (!ENGINE_PRESENCE_VALUES.has(candidate.presence)) {
    return false;
  }

  if (!ENGINE_RELIABILITY_VALUES.has(candidate.reliability)) {
    return false;
  }

  if (typeof candidate.metrics !== "object" || candidate.metrics === null) {
    return false;
  }

  const { pitchDeg, ehdNorm, dpr, conf } = candidate.metrics;
  if (
    typeof pitchDeg !== "number" ||
    typeof ehdNorm !== "number" ||
    typeof dpr !== "number" ||
    typeof conf !== "number"
  ) {
    return false;
  }

  if (typeof candidate.score !== "number") {
    return false;
  }

  if (!ENGINE_ZONE_VALUES.has(candidate.zone)) {
    return false;
  }

  if (!ENGINE_STATE_VALUES.has(candidate.state)) {
    return false;
  }

  return true;
};
