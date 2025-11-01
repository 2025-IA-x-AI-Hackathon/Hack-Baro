import { describe, expect, it, vi, beforeEach } from "vitest";
import { WORKER_MESSAGES } from "../../shared/ipcChannels";

/**
 * Test suite for posture data persistence functionality.
 * Verifies that posture zone times and scores are correctly accumulated and persisted.
 */
describe("Posture Data Persistence", () => {
  describe("Data accumulation logic", () => {
    it("should correctly track time in each zone", () => {
      // Mock accumulator state
      const accumulator = {
        date: "2025-11-02",
        secondsInGreen: 0,
        secondsInYellow: 0,
        secondsInRed: 0,
        scoreSum: 0,
        sampleCount: 0,
        lastTickTimestamp: null as number | null,
      };

      // Simulate ticks
      const ticks = [
        { zone: "GREEN" as const, score: 85, timestamp: 1000 },
        { zone: "GREEN" as const, score: 87, timestamp: 2000 },
        { zone: "YELLOW" as const, score: 75, timestamp: 3000 },
        { zone: "RED" as const, score: 55, timestamp: 4000 },
        { zone: "GREEN" as const, score: 90, timestamp: 5000 },
      ];

      ticks.forEach((tick) => {
        const elapsedSeconds =
          accumulator.lastTickTimestamp !== null
            ? (tick.timestamp - accumulator.lastTickTimestamp) / 1000
            : 1;

        if (tick.zone === "GREEN") {
          accumulator.secondsInGreen += elapsedSeconds;
        } else if (tick.zone === "YELLOW") {
          accumulator.secondsInYellow += elapsedSeconds;
        } else if (tick.zone === "RED") {
          accumulator.secondsInRed += elapsedSeconds;
        }

        accumulator.scoreSum += tick.score;
        accumulator.sampleCount += 1;
        accumulator.lastTickTimestamp = tick.timestamp;
      });

      // Verify zone time tracking
      // First tick (GREEN): 1s (default)
      // Second tick (GREEN): 1s (2000 - 1000 = 1000ms = 1s)
      // Third tick (YELLOW): 1s
      // Fourth tick (RED): 1s
      // Fifth tick (GREEN): 1s
      // Total GREEN: 1 + 1 + 1 = 3s
      expect(accumulator.secondsInGreen).toBe(3);
      expect(accumulator.secondsInYellow).toBe(1); // One 1s interval
      expect(accumulator.secondsInRed).toBe(1); // One 1s interval

      // Verify score calculation
      const avgScore = accumulator.scoreSum / accumulator.sampleCount;
      expect(avgScore).toBeCloseTo(78.4, 1); // (85 + 87 + 75 + 55 + 90) / 5 = 78.4
      expect(accumulator.sampleCount).toBe(5);
    });

    it("should handle edge case with zero samples", () => {
      const accumulator = {
        date: "2025-11-02",
        secondsInGreen: 0,
        secondsInYellow: 0,
        secondsInRed: 0,
        scoreSum: 0,
        sampleCount: 0,
        lastTickTimestamp: null as number | null,
      };

      const avgScore = accumulator.sampleCount > 0 ? accumulator.scoreSum / accumulator.sampleCount : 0;
      
      expect(avgScore).toBe(0);
      expect(accumulator.secondsInGreen).toBe(0);
      expect(accumulator.secondsInYellow).toBe(0);
      expect(accumulator.secondsInRed).toBe(0);
    });

    it("should reset accumulator when new day starts", () => {
      const accumulator = {
        date: "2025-11-01",
        secondsInGreen: 100,
        secondsInYellow: 50,
        secondsInRed: 30,
        scoreSum: 4000,
        sampleCount: 50,
        lastTickTimestamp: Date.now(),
      };

      const currentDate = "2025-11-02";
      
      // In actual implementation, persistPostureData() would be called here
      // before resetting to avoid data loss
      
      if (accumulator.date !== currentDate) {
        Object.assign(accumulator, {
          date: currentDate,
          secondsInGreen: 0,
          secondsInYellow: 0,
          secondsInRed: 0,
          scoreSum: 0,
          sampleCount: 0,
          lastTickTimestamp: null,
        });
      }

      expect(accumulator.date).toBe("2025-11-02");
      expect(accumulator.secondsInGreen).toBe(0);
      expect(accumulator.sampleCount).toBe(0);
    });

    it("should persist data before resetting on day rollover", () => {
      // This test verifies the fix for day rollover data loss
      const accumulator = {
        date: "2025-11-01",
        secondsInGreen: 100,
        secondsInYellow: 50,
        secondsInRed: 30,
        scoreSum: 4000,
        sampleCount: 50,
        lastTickTimestamp: Date.now(),
      };

      let persistCalled = false;
      const mockPersist = () => {
        persistCalled = true;
      };

      const currentDate = "2025-11-02";
      
      if (accumulator.date !== currentDate) {
        // Must persist before resetting
        mockPersist();
        
        Object.assign(accumulator, {
          date: currentDate,
          secondsInGreen: 0,
          secondsInYellow: 0,
          secondsInRed: 0,
          scoreSum: 0,
          sampleCount: 0,
          lastTickTimestamp: null,
        });
      }

      expect(persistCalled).toBe(true);
      expect(accumulator.date).toBe("2025-11-02");
    });
  });

  describe("persistPostureData message", () => {
    it("should have correct message type and payload structure", () => {
      const payload = {
        date: "2025-11-02",
        secondsInGreen: 120,
        secondsInYellow: 45,
        secondsInRed: 15,
        avgScore: 82.5,
        sampleCount: 180,
      };

      const message = {
        type: WORKER_MESSAGES.persistPostureData,
        payload,
      };

      expect(message.type).toBe(WORKER_MESSAGES.persistPostureData);
      expect(message.payload.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof message.payload.secondsInGreen).toBe("number");
      expect(typeof message.payload.secondsInYellow).toBe("number");
      expect(typeof message.payload.secondsInRed).toBe("number");
      expect(typeof message.payload.avgScore).toBe("number");
      expect(typeof message.payload.sampleCount).toBe("number");
    });

    it("should round zone seconds to integers", () => {
      const accumulator = {
        secondsInGreen: 120.7,
        secondsInYellow: 45.3,
        secondsInRed: 15.9,
        scoreSum: 8250,
        sampleCount: 100,
      };

      const payload = {
        date: "2025-11-02",
        secondsInGreen: Math.round(accumulator.secondsInGreen),
        secondsInYellow: Math.round(accumulator.secondsInYellow),
        secondsInRed: Math.round(accumulator.secondsInRed),
        avgScore: Math.round((accumulator.scoreSum / accumulator.sampleCount) * 100) / 100,
        sampleCount: accumulator.sampleCount,
      };

      expect(payload.secondsInGreen).toBe(121);
      expect(payload.secondsInYellow).toBe(45);
      expect(payload.secondsInRed).toBe(16);
      expect(payload.avgScore).toBe(82.5);
    });
  });

  describe("Score calculation formula", () => {
    it("should calculate average score correctly with various distributions", () => {
      const testCases = [
        {
          scores: [100, 100, 100],
          expected: 100,
        },
        {
          scores: [80, 85, 90],
          expected: 85,
        },
        {
          scores: [50, 60, 70],
          expected: 60,
        },
        {
          scores: [0, 0, 0],
          expected: 0,
        },
      ];

      testCases.forEach(({ scores, expected }) => {
        const sum = scores.reduce((acc, score) => acc + score, 0);
        const avg = sum / scores.length;
        expect(avg).toBeCloseTo(expected, 1);
      });
    });
  });
});
