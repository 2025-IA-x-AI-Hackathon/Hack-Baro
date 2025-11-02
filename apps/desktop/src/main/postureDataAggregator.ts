import { getLogger, toErrorPayload } from "../shared/logger";
import type { EngineTick } from "../shared/types/engine";
import { STREAK_THRESHOLD } from "./database/constants";
import {
  getTodayDateString,
  upsertDailyPostureLog,
} from "./database/dailyPostureRepository";

const logger = getLogger("posture-aggregator", "main");

type AccumulatorState = {
  date: string;
  secondsInGreen: number;
  secondsInYellow: number;
  secondsInRed: number;
  scoreSum: number;
  sampleCount: number;
  lastTickTime: number | null;
  isDirty: boolean;
};

let accumulator: AccumulatorState = {
  date: getTodayDateString(),
  secondsInGreen: 0,
  secondsInYellow: 0,
  secondsInRed: 0,
  scoreSum: 0,
  sampleCount: 0,
  lastTickTime: null,
  isDirty: false,
};

let saveInterval: ReturnType<typeof setInterval> | null = null;
let onDataSavedCallback: (() => void) | null = null;

const SAVE_INTERVAL_MS = 60000; // Save every 60 seconds

/**
 * Reset accumulator if date has changed (new day)
 */
const checkAndResetForNewDay = () => {
  const today = getTodayDateString();
  if (accumulator.date !== today) {
    logger.info("New day detected, resetting accumulator", {
      oldDate: accumulator.date,
      newDate: today,
    });
    accumulator = {
      date: today,
      secondsInGreen: 0,
      secondsInYellow: 0,
      secondsInRed: 0,
      scoreSum: 0,
      sampleCount: 0,
      lastTickTime: null,
      isDirty: false,
    };
  }
};

/**
 * Process an EngineTick and update the in-memory accumulator
 */
export const processEngineTick = (tick: EngineTick): void => {
  try {
    checkAndResetForNewDay();

    const currentTime = tick.t;
    let secondsElapsed = 1; // Default to 1 second

    // Calculate elapsed time since last tick if available
    if (accumulator.lastTickTime !== null) {
      const elapsedMs = currentTime - accumulator.lastTickTime;
      secondsElapsed = Math.max(1, Math.round(elapsedMs / 1000));
    }

    accumulator.lastTickTime = currentTime;

    // Only accumulate if user is present and system is reliable
    if (tick.presence === "PRESENT" && tick.reliability === "OK") {
      // Increment zone time
      if (tick.zone === "GREEN") {
        accumulator.secondsInGreen += secondsElapsed;
      } else if (tick.zone === "YELLOW") {
        accumulator.secondsInYellow += secondsElapsed;
      } else if (tick.zone === "RED") {
        accumulator.secondsInRed += secondsElapsed;
      }

      // Accumulate score for averaging
      accumulator.scoreSum += tick.score;
      accumulator.sampleCount += 1;

      accumulator.isDirty = true;

      logger.debug("EngineTick processed", {
        zone: tick.zone,
        score: tick.score,
        secondsElapsed,
        totalSamples: accumulator.sampleCount,
      });
    }
  } catch (error) {
    logger.error("Failed to process EngineTick", toErrorPayload(error));
  }
};

/**
 * Save accumulated data to database
 */
const saveAccumulatedData = (): void => {
  if (!accumulator.isDirty || accumulator.sampleCount === 0) {
    return;
  }

  try {
    const avgScore = accumulator.scoreSum / accumulator.sampleCount;
    const meetsGoal = avgScore >= STREAK_THRESHOLD ? 1 : 0;

    // Save all accumulated data in one upsert
    upsertDailyPostureLog({
      date: accumulator.date,
      secondsInGreen: accumulator.secondsInGreen,
      secondsInYellow: accumulator.secondsInYellow,
      secondsInRed: accumulator.secondsInRed,
      avgScore,
      sampleCount: accumulator.sampleCount,
      meetsGoal,
    });

    logger.info("Saved accumulated posture data", {
      date: accumulator.date,
      secondsInGreen: accumulator.secondsInGreen,
      secondsInYellow: accumulator.secondsInYellow,
      secondsInRed: accumulator.secondsInRed,
      avgScore,
      sampleCount: accumulator.sampleCount,
      meetsGoal,
    });

    accumulator.isDirty = false;

    // Notify listeners that data has been updated
    if (onDataSavedCallback) {
      onDataSavedCallback();
    }
  } catch (error) {
    logger.error("Failed to save accumulated data", toErrorPayload(error));
  }
};

/**
 * Start the periodic save interval
 */
export const startPostureDataAggregator = (onDataSaved?: () => void): void => {
  if (saveInterval) {
    logger.warn("Posture data aggregator already started");
    return;
  }

  onDataSavedCallback = onDataSaved || null;

  saveInterval = setInterval(() => {
    saveAccumulatedData();
  }, SAVE_INTERVAL_MS);

  logger.info("Posture data aggregator started", {
    saveIntervalMs: SAVE_INTERVAL_MS,
  });
};

/**
 * Stop the periodic save interval and save any pending data
 */
export const stopPostureDataAggregator = (): void => {
  if (saveInterval) {
    clearInterval(saveInterval);
    saveInterval = null;
  }

  // Save any remaining data before stopping
  saveAccumulatedData();

  logger.info("Posture data aggregator stopped");
};

/**
 * Force save accumulated data immediately (useful for testing)
 */
export const forceSavePostureData = (): void => {
  saveAccumulatedData();
};

/**
 * Reset the accumulator state (useful for testing)
 */
export const resetAccumulator = (): void => {
  accumulator = {
    date: getTodayDateString(),
    secondsInGreen: 0,
    secondsInYellow: 0,
    secondsInRed: 0,
    scoreSum: 0,
    sampleCount: 0,
    lastTickTime: null,
    isDirty: false,
  };
};
