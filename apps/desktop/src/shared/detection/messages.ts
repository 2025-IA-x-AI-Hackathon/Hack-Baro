import type {
  DetectorInitPayload,
  DetectorKind,
  DetectorResult,
  FrameMetadata,
} from "../types/detector";

export type InferenceWorkerInboundMessage =
  | {
      type: "init";
      payload: DetectorInitPayload;
    }
  | {
      type: "frame";
      payload: {
        bitmap: ImageBitmap;
        metadata: FrameMetadata;
      };
    }
  | {
      type: "shutdown";
    };

export type InferenceWorkerOutboundMessage =
  | {
      type: "ready";
      payload: {
        detector: DetectorKind;
        readyAt: number;
      };
    }
  | {
      type: "result";
      payload: DetectorResult;
    }
  | {
      type: "metrics";
      payload: {
        frameId: number;
        inferenceDurationMs: number;
      };
    }
  | {
      type: "error";
      payload: {
        message: string;
        frameId?: number;
        stack?: string;
      };
    };

export type InferenceWorkerMessageEvent =
  MessageEvent<InferenceWorkerOutboundMessage>;
