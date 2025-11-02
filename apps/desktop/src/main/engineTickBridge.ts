// Disable no-unused-vars lint noise for function type annotations
/* eslint no-unused-vars: off */
import { isEngineTickPayload } from "../shared/posture/engineTickValidation";
import type { EngineTick } from "../shared/types/engine";

export const createRendererTickHandler = ({
  logger,
  broadcast,
  forwardToWorker,
}: {
  logger: Pick<Console, "warn">;
  broadcast: (tick: EngineTick) => void;
  forwardToWorker: (tick: EngineTick) => void;
}) => {
  return (payload: unknown): payload is EngineTick => {
    if (!isEngineTickPayload(payload)) {
      logger.warn("Received invalid EngineTick payload from renderer", {
        payload,
      });
      return false;
    }

    broadcast(payload);
    forwardToWorker(payload);
    return true;
  };
};

export type RendererTickHandler = ReturnType<typeof createRendererTickHandler>;
