import { describe, expect, it } from "vitest";
import type { PoseKeypoint } from "../types/calibration";
import { PostureAnalyzer, createDefaultBaseline } from "./postureAnalyzer";

const createKeypoints = (
  baseline: PoseKeypoint[],
  variance: number,
): PoseKeypoint[] => {
  return baseline.map((point, index) => ({
    ...point,
    x: (point.x ?? 0.5) + variance * (index % 2 === 0 ? 1 : -1),
    y: (point.y ?? 0.5) + variance * (index % 3 === 0 ? -1 : 1),
    visibility: 0.9,
  }));
};

describe("PostureAnalyzer", () => {
  const baseline = createDefaultBaseline();

  it("classifies minimal deviation as GREEN/GOOD", () => {
    const analyzer = new PostureAnalyzer({
      baseline,
      calibrated: true,
    });

    const result = analyzer.evaluate(
      createKeypoints(baseline, 0.002),
      Date.now(),
    );

    expect(result.zone).toBe("GREEN");
    expect(result.state).toBe("GOOD");
    expect(result.reliability).toBe("OK");
    expect(result.presence).toBe("PRESENT");
    expect(result.score).toBeGreaterThanOrEqual(90);
  });

  it("classifies medium deviation as YELLOW/AT_RISK", () => {
    const analyzer = new PostureAnalyzer({
      baseline,
      calibrated: true,
    });

    const result = analyzer.evaluate(
      createKeypoints(baseline, 0.045),
      Date.now(),
    );

    expect(result.zone).toBe("YELLOW");
    expect(result.state).toBe("AT_RISK");
    expect(result.reliability).toBe("OK");
    expect(result.score).toBeLessThan(90);
    expect(result.score).toBeGreaterThan(30);
  });

  it("classifies large deviation as RED/BAD_POSTURE", () => {
    const analyzer = new PostureAnalyzer({
      baseline,
      calibrated: true,
    });

    const result = analyzer.evaluate(
      createKeypoints(baseline, 0.12),
      Date.now(),
    );

    expect(result.zone).toBe("RED");
    expect(result.state).toBe("BAD_POSTURE");
    expect(result.reliability).toBe("OK");
    expect(result.score).toBeLessThanOrEqual(30);
  });

  it("returns idle/unreliable when no keypoints detected", () => {
    const analyzer = new PostureAnalyzer({
      baseline,
      calibrated: false,
    });

    const result = analyzer.evaluate([], Date.now());

    expect(result.zone).toBe("RED");
    expect(result.state).toBe("IDLE");
    expect(result.reliability).toBe("UNRELIABLE");
    expect(result.presence).toBe("ABSENT");
    expect(result.score).toBe(0);
  });
});
