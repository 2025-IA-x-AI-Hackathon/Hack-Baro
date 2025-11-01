import { ipcMain } from "electron";
import { IPC_CHANNELS } from "../../shared/ipcChannels";
import { getLogger } from "../../shared/logger";
import type { CalibrationBaselinePayload } from "../../shared/types/calibration";
import { saveCalibrationBaseline } from "../database/calibrationRepository";

const logger = getLogger("calibration-handler", "main");

const registerCalibrationHandler = (): void => {
  ipcMain.handle(
    IPC_CHANNELS.calibrationRequest,
    (_, payload: CalibrationBaselinePayload) => {
      try {
        logger.info(
          `Received calibration baseline request for detector: ${payload.detector}`,
        );
        const result = saveCalibrationBaseline(payload);
        logger.info(
          `Successfully inserted calibration baseline with id ${result.id}`,
        );
        return { ok: true as const, baseline: result };
      } catch (error) {
        logger.error(
          `Failed to insert calibration baseline: ${
            error instanceof Error ? error.message : "Unknown error"
          }`,
        );
        return {
          ok: false as const,
          error:
            error instanceof Error
              ? error.message
              : "An unknown error occurred",
        };
      }
    },
  );
};

export default registerCalibrationHandler;
