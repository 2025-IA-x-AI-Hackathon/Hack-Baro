import { describe, expect, it } from "vitest";
import type { EngineTick } from "../types/engine";
import { isEngineTickPayload } from "./engineTickValidation";

const createValidTick = (): EngineTick => ({
  t: Date.now(),
  presence: "PRESENT",
  reliability: "OK",
  metrics: {
    pitchDeg: 5,
    ehdNorm: 0.02,
    dpr: 0.95,
    conf: 0.9,
  },
  score: 87,
  zone: "GREEN",
  state: "GOOD",
});

describe("isEngineTickPayload", () => {
  it("accepts a well-formed EngineTick", () => {
    expect(isEngineTickPayload(createValidTick())).toBe(true);
  });

  it("rejects payloads with missing fields", () => {
    expect(
      isEngineTickPayload({
        ...createValidTick(),
        metrics: undefined,
      }),
    ).toBe(false);
  });

  it("rejects payloads with invalid enumerations", () => {
    expect(
      isEngineTickPayload({
        ...createValidTick(),
        zone: "BLUE",
      }),
    ).toBe(false);
  });
});
