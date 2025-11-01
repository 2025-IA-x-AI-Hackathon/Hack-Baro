import { eq, gte, lte, and } from "drizzle-orm";
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
      // Accumulate values instead of overwriting to handle worker restarts
      const newSampleCount = existing.sampleCount + (data.sampleCount ?? 0);
      let newAvgScore = existing.avgScore;
      
      if (newSampleCount > 0) {
        // Weighted average: combine existing and new samples
        newAvgScore =
          (existing.avgScore * existing.sampleCount +
            (data.avgScore ?? 0) * (data.sampleCount ?? 0)) /
          newSampleCount;
      }
      
      const updated = db
        .update(dailyPostureLogs)
        .set({
          secondsInGreen: existing.secondsInGreen + (data.secondsInGreen ?? 0),
          secondsInYellow: existing.secondsInYellow + (data.secondsInYellow ?? 0),
          secondsInRed: existing.secondsInRed + (data.secondsInRed ?? 0),
          avgScore: newAvgScore,
          sampleCount: newSampleCount,
        })
        .where(eq(dailyPostureLogs.date, data.date))
        .returning()
        .get();

      logger.info(`Updated daily posture log for date: ${data.date} (accumulated values)`);
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

export const getWeeklySummary = (): DailyPostureLogRow[] => {
  const db = getDatabase();

  try {
    // Calculate date 7 days ago
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 6); // -6 to include today (7 days total)

    const startDate = sevenDaysAgo.toISOString().split("T")[0]!;
    const endDate = today.toISOString().split("T")[0]!;

    // Query all records from the last 7 days, ordered by date ascending
    const results = db
      .select()
      .from(dailyPostureLogs)
      .where(
        and(
          gte(dailyPostureLogs.date, startDate),
          lte(dailyPostureLogs.date, endDate)
        )
      )
      .orderBy(dailyPostureLogs.date)
      .all();

    logger.info(
      `Retrieved ${results.length} records for weekly summary (${startDate} to ${endDate})`,
    );
    return results;
  } catch (error) {
    logger.error(
      `Failed to get weekly summary: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    throw error;
  }
};
