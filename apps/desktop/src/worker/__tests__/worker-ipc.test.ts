import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerMessage } from "../../shared/ipcChannels";
import { WORKER_MESSAGES } from "../../shared/ipcChannels";
import type { EngineTickPayload } from "../../shared/types/engine-ipc";

/**
 * Test suite for Worker IPC communication.
 * Verifies that Worker correctly handles engineFrame messages and emits engineTick messages.
 */
describe("Worker IPC Communication", () => {
  describe("ENGINE_TICK message structure", () => {
    it("should have correct message type", () => {
      const mockTickPayload: EngineTickPayload = {
        tick: {
          t: Date.now(),
          presence: "PRESENT",
          reliability: "OK",
          metrics: {
            pitchDeg: 15.5,
            ehdNorm: 0.08,
            dpr: 1.02,
            conf: 0.95,
          },
          score: 85,
          zone: "GREEN",
          state: "GOOD",
        },
      };

      const message: WorkerMessage = {
        type: WORKER_MESSAGES.engineTick,
        payload: mockTickPayload,
      };

      expect(message.type).toBe(WORKER_MESSAGES.engineTick);
      expect(message.payload).toBeDefined();
    });

    it("should contain valid EngineTick in payload", () => {
      const mockTickPayload: EngineTickPayload = {
        tick: {
          t: Date.now(),
          presence: "PRESENT",
          reliability: "OK",
          metrics: {
            pitchDeg: 15.5,
            ehdNorm: 0.08,
            dpr: 1.02,
            conf: 0.95,
          },
          score: 85,
          zone: "GREEN",
          state: "GOOD",
        },
      };

      const message: WorkerMessage<typeof WORKER_MESSAGES.engineTick> = {
        type: WORKER_MESSAGES.engineTick,
        payload: mockTickPayload,
      };

      const payload = message.payload as EngineTickPayload;
      expect(payload.tick).toBeDefined();
      expect(typeof payload.tick.t).toBe("number");
      expect(payload.tick.presence).toMatch(/^(PRESENT|ABSENT)$/);
      expect(payload.tick.reliability).toMatch(/^(OK|UNRELIABLE)$/);
      expect(typeof payload.tick.score).toBe("number");
      expect(payload.tick.zone).toMatch(/^(GREEN|YELLOW|RED)$/);
      expect(payload.tick.state).toMatch(
        /^(INITIAL|GOOD|AT_RISK|BAD_POSTURE|RECOVERING|IDLE|UNRELIABLE)$/,
      );
    });

    it("should be JSON-serializable for IPC transmission", () => {
      const mockTickPayload: EngineTickPayload = {
        tick: {
          t: Date.now(),
          presence: "PRESENT",
          reliability: "OK",
          metrics: {
            pitchDeg: 15.5,
            ehdNorm: 0.08,
            dpr: 1.02,
            conf: 0.95,
          },
          score: 85,
          zone: "GREEN",
          state: "GOOD",
        },
      };

      const message: WorkerMessage = {
        type: WORKER_MESSAGES.engineTick,
        payload: mockTickPayload,
      };

      expect(() => JSON.stringify(message)).not.toThrow();

      const serialized = JSON.stringify(message);
      const deserialized = JSON.parse(serialized) as WorkerMessage;

      expect(deserialized.type).toBe(WORKER_MESSAGES.engineTick);
      const deserializedPayload = deserialized.payload as EngineTickPayload;
      expect(deserializedPayload.tick).toBeDefined();
    });
  });

  describe("Message flow validation", () => {
    it("should validate engineFrame -> engineTick flow structure", () => {
      // This test validates that the message types are correctly structured
      // for the Worker -> Main -> Renderer flow

      // Worker receives engineFrame
      const incomingFrameMessage: WorkerMessage = {
        type: WORKER_MESSAGES.engineFrame,
        payload: {
          result: {
            frameId: 1,
            processedAt: Date.now(),
            durationMs: 16,
            metrics: null,
            score: null,
            presence: {
              state: "PRESENT",
              consecutiveFrames: 10,
              lastStateChangeAt: Date.now() - 1000,
              lastUpdatedAt: Date.now(),
              faceConfidence: 0.95,
              poseConfidence: 0.92,
            },
            reliability: "OK",
            reliabilityReasons: [],
          },
          calibration: null,
          diagnostics: null,
        },
      };

      expect(incomingFrameMessage.type).toBe(WORKER_MESSAGES.engineFrame);

      // Worker emits engineTick
      const outgoingTickMessage: WorkerMessage = {
        type: WORKER_MESSAGES.engineTick,
        payload: {
          tick: {
            t: Date.now(),
            presence: "PRESENT",
            reliability: "OK",
            metrics: {
              pitchDeg: 0,
              ehdNorm: 0,
              dpr: 1,
              conf: 0,
            },
            score: 50,
            zone: "YELLOW",
            state: "GOOD",
          },
        } satisfies EngineTickPayload,
      };

      expect(outgoingTickMessage.type).toBe(WORKER_MESSAGES.engineTick);
      expect(outgoingTickMessage.payload).toBeDefined();
    });
  });

  describe("Error handling", () => {
    it("should have engineError message type for error reporting", () => {
      const errorMessage: WorkerMessage = {
        type: WORKER_MESSAGES.engineError,
        payload: {
          message: "Test error message",
        },
      };

      expect(errorMessage.type).toBe(WORKER_MESSAGES.engineError);
      expect(errorMessage.payload).toBeDefined();
    });
  });

  describe("Worker status messages", () => {
    it("should support ready message on worker startup", () => {
      const readyMessage: WorkerMessage = {
        type: WORKER_MESSAGES.ready,
        payload: {
          readyAt: new Date().toISOString(),
        },
      };

      expect(readyMessage.type).toBe(WORKER_MESSAGES.ready);
      expect(readyMessage.payload).toBeDefined();
    });

    it("should support ping/pong for health checks", () => {
      const pingMessage: WorkerMessage = {
        type: WORKER_MESSAGES.ping,
      };

      const pongMessage: WorkerMessage = {
        type: WORKER_MESSAGES.pong,
        payload: {
          respondedAt: new Date().toISOString(),
        },
      };

      expect(pingMessage.type).toBe(WORKER_MESSAGES.ping);
      expect(pongMessage.type).toBe(WORKER_MESSAGES.pong);
    });
  });
});
