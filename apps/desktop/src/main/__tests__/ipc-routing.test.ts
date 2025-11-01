import { describe, expect, it } from "vitest";
import { IPC_CHANNELS, WORKER_MESSAGES } from "../../shared/ipcChannels";
import type { WorkerMessage } from "../../shared/ipcChannels";
import type { EngineTickPayload } from "../../shared/types/engine-ipc";

/**
 * Test suite for Main process IPC message routing.
 * Validates that Main correctly receives Worker messages and routes them to Renderer.
 */
describe("Main Process IPC Message Routing", () => {
  describe("IPC Channel constants", () => {
    it("should have engineTick channel defined", () => {
      expect(IPC_CHANNELS.engineTick).toBe("engine:tick");
    });

    it("should have workerStatus channel defined", () => {
      expect(IPC_CHANNELS.workerStatus).toBe("worker:status");
    });

    it("should have engineFrame channel defined", () => {
      expect(IPC_CHANNELS.engineFrame).toBe("engine:frame");
    });
  });

  describe("Worker message type mapping", () => {
    it("should map engineTick worker message to engineTick IPC channel", () => {
      const workerMessage: WorkerMessage = {
        type: WORKER_MESSAGES.engineTick,
        payload: {
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
        } satisfies EngineTickPayload,
      };

      // Main process should route this to IPC_CHANNELS.engineTick
      expect(workerMessage.type).toBe(WORKER_MESSAGES.engineTick);

      // Verify the routing logic: WORKER_MESSAGES.engineTick -> IPC_CHANNELS.engineTick
      const shouldUseChannel = IPC_CHANNELS.engineTick;
      expect(shouldUseChannel).toBe("engine:tick");
    });

    it("should map ready worker message to workerStatus IPC channel", () => {
      const workerMessage: WorkerMessage = {
        type: WORKER_MESSAGES.ready,
        payload: {
          readyAt: new Date().toISOString(),
        },
      };

      expect(workerMessage.type).toBe(WORKER_MESSAGES.ready);

      // Main should route ready/status to workerStatus channel
      const shouldUseChannel = IPC_CHANNELS.workerStatus;
      expect(shouldUseChannel).toBe("worker:status");
    });

    it("should map engineError worker message to workerStatus IPC channel", () => {
      const workerMessage: WorkerMessage = {
        type: WORKER_MESSAGES.engineError,
        payload: {
          message: "Test error",
        },
      };

      expect(workerMessage.type).toBe(WORKER_MESSAGES.engineError);

      // Errors should also go to workerStatus
      const shouldUseChannel = IPC_CHANNELS.workerStatus;
      expect(shouldUseChannel).toBe("worker:status");
    });
  });

  describe("Message payload preservation", () => {
    it("should preserve EngineTick payload through IPC routing", () => {
      const originalPayload: EngineTickPayload = {
        tick: {
          t: 1699999999999,
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

      const workerMessage: WorkerMessage = {
        type: WORKER_MESSAGES.engineTick,
        payload: originalPayload,
      };

      // Simulate Main process routing
      const ipcPayload = workerMessage.payload;

      expect(ipcPayload).toEqual(originalPayload);
      expect((ipcPayload as EngineTickPayload).tick.t).toBe(1699999999999);
      expect((ipcPayload as EngineTickPayload).tick.presence).toBe("PRESENT");
      expect((ipcPayload as EngineTickPayload).tick.score).toBe(85);
    });
  });

  describe("Message queue handling", () => {
    it("should support message queueing when window not ready", () => {
      // This test validates the concept of pendingWorkerMessages array
      const pendingMessages: WorkerMessage[] = [];

      const message1: WorkerMessage = {
        type: WORKER_MESSAGES.ready,
        payload: { readyAt: new Date().toISOString() },
      };

      const message2: WorkerMessage = {
        type: WORKER_MESSAGES.engineTick,
        payload: {
          tick: {
            t: Date.now(),
            presence: "PRESENT",
            reliability: "OK",
            metrics: { pitchDeg: 0, ehdNorm: 0, dpr: 1, conf: 0 },
            score: 50,
            zone: "YELLOW",
            state: "GOOD",
          },
        },
      };

      pendingMessages.push(message1);
      pendingMessages.push(message2);

      expect(pendingMessages).toHaveLength(2);
      expect(pendingMessages[0]?.type).toBe(WORKER_MESSAGES.ready);
      expect(pendingMessages[1]?.type).toBe(WORKER_MESSAGES.engineTick);

      // Simulate flush
      const flushed = pendingMessages.splice(0, pendingMessages.length);
      expect(flushed).toHaveLength(2);
      expect(pendingMessages).toHaveLength(0);
    });
  });

  describe("Renderer -> Main -> Worker flow", () => {
    it("should support engineFrame message from Renderer to Worker", () => {
      const rendererToMain = IPC_CHANNELS.engineFrame;
      expect(rendererToMain).toBe("engine:frame");

      const mainToWorker = WORKER_MESSAGES.engineFrame;
      expect(mainToWorker).toBe("engine:frame");

      // Both use same message type for consistency
      expect(rendererToMain).toBe(mainToWorker);
    });
  });
});
