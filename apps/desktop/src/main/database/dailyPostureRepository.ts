import { eq } from "drizzle-orm";
import { getLogger } from "../../shared/logger";
import { getDatabase } from "./client";
import {
  dailyPostureLogs,
  type DailyPostureLogRow,
  type NewDailyPostureLogRow,
} from "./schema";

const logger = getLogger("daily-posture-repository", "main");

export const upsertDailyPostureLog = (
  data: NewDailyPostureLogRow,
): DailyPostureLogRow => {
  const db = getDatabase();

  try {
    // Check if a record exists for the date
    const existing = db
      .select()
      .from(dailyPostureLogs)
      .where(eq(dailyPostureLogs.date, data.date))
      .get();

    if (existing) {
      // Update existing record
      const updated = db
        .update(dailyPostureLogs)
        .set({
          secondsInGreen: data.secondsInGreen,
          secondsInYellow: data.secondsInYellow,
          secondsInRed: data.secondsInRed,
          avgScore: data.avgScore,
          sampleCount: data.sampleCount,
        })
        .where(eq(dailyPostureLogs.date, data.date))
        .returning()
        .get();

      logger.info(`Updated daily posture log for date: ${data.date}`);
      return updated;
    } else {
      // Insert new record
      const inserted = db
        .insert(dailyPostureLogs)
        .values(data)
        .returning()
        .get();

      logger.info(`Inserted new daily posture log for date: ${data.date}`);
      return inserted;
    }
  } catch (error) {
    logger.error(
      `Failed to upsert daily posture log: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    throw error;
  }
};

export const getDailyPostureLogByDate = (
  date: string,
): DailyPostureLogRow | null => {
  const db = getDatabase();

  try {
    const result = db
      .select()
      .from(dailyPostureLogs)
      .where(eq(dailyPostureLogs.date, date))
      .get();

    return result ?? null;
  } catch (error) {
    logger.error(
      `Failed to get daily posture log for date ${date}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    throw error;
  }
};
