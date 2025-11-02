import { ipcMain } from "electron";
// Disable no-unused-vars lint noise for handler signatures
/* eslint no-unused-vars: off */
import { IPC_CHANNELS } from "../../shared/ipcChannels";
import { getLogger } from "../../shared/logger";
import type {
  CalibrationBaselinePayload,
  CalibrationBaselineRecord,
} from "../../shared/types/calibration";
import {
  getLatestCalibrationBaseline,
  saveCalibrationBaseline,
} from "../database/calibrationRepository";

const logger = getLogger("calibration-handler", "main");

const registerCalibrationHandler = ({
  onBaselineSaved,
}: {
  onBaselineSaved?: (baseline: CalibrationBaselineRecord) => void;
} = {}): void => {
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
        onBaselineSaved?.(result);
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

  ipcMain.handle(IPC_CHANNELS.calibrationLatest, () => {
    try {
      const baseline = getLatestCalibrationBaseline();
      if (!baseline) {
        logger.info("No calibration baseline available to return");
        return { ok: false as const, baseline: null };
      }
      logger.info(
        `Returning latest calibration baseline with id ${baseline.id}`,
      );
      return { ok: true as const, baseline };
    } catch (error) {
      logger.error(
        `Failed to retrieve latest calibration baseline: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
      return {
        ok: false as const,
        baseline: null,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
};

export default registerCalibrationHandler;
