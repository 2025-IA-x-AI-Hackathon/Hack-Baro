import { and, desc, eq, gte, lte } from "drizzle-orm";
import { getLogger } from "../../shared/logger";
import { getDatabase, initializeDatabase } from "./client";
import { MAX_STREAK_DAYS } from "./constants";
import {
  type DailyPostureLogRow,
  type NewDailyPostureLogRow,
  dailyPostureLogs,
} from "./schema";

const logger = getLogger("daily-posture-repository", "main");

export type DailySummary = {
  date: string;
  secondsInGreen: number;
  secondsInYellow: number;
  secondsInRed: number;
  avgScore: number;
  sampleCount: number;
  meetsGoal: number; // 1 if avgScore >= 70, else 0
  streak?: number; // Optional: daily streak count
};

export type DailyPostureUpdate = {
  date: string;
  secondsInGreen: number;
  secondsInYellow: number;
  secondsInRed: number;
  avgScore: number;
  sampleCount: number;
  meetsGoal: number; // 1 if avgScore >= 70, else 0
};

type DailyPostureRow = typeof dailyPostureLogs.$inferSelect;

const mapRowToDailySummary = (row: DailyPostureRow): DailySummary => ({
  date: row.date,
  secondsInGreen: row.secondsInGreen,
  secondsInYellow: row.secondsInYellow,
  secondsInRed: row.secondsInRed,
  avgScore: row.avgScore,
  sampleCount: row.sampleCount,
  meetsGoal: row.meetsGoal,
});

function getSummaryForDate(
  db: ReturnType<typeof initializeDatabase>,
  date: string,
): DailySummary | null {
  const row = db
    .select()
    .from(dailyPostureLogs)
    .where(eq(dailyPostureLogs.date, date))
    .get();

  if (row && row.date === date) {
    return mapRowToDailySummary(row);
  }

  const fallbackRow = db
    .select()
    .from(dailyPostureLogs)
    .orderBy(dailyPostureLogs.date)
    .all()
    .find((candidate) => candidate.date === date);

  return fallbackRow ? mapRowToDailySummary(fallbackRow) : null;
}

/**
 * Get daily summary for a specific date
 */
export const getDailySummary = (date: string): DailySummary | null => {
  const db = initializeDatabase();
  return getSummaryForDate(db, date);
};

/**
 * Get date string for N days ago in YYYY-MM-DD format
 */
export const getDateStringDaysAgo = (daysAgo: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * Get the current date in YYYY-MM-DD format
 */
export const getTodayDateString = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

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
          secondsInYellow:
            existing.secondsInYellow + (data.secondsInYellow ?? 0),
          secondsInRed: existing.secondsInRed + (data.secondsInRed ?? 0),
          avgScore: newAvgScore,
          sampleCount: newSampleCount,
        })
        .where(eq(dailyPostureLogs.date, data.date))
        .returning()
        .get();

      logger.info(
        `Updated daily posture log for date: ${data.date} (accumulated values)`,
      );
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

/**
 * Calculate daily streak: consecutive days where meetsGoal = 1
 * Counts backwards from today until a day with meetsGoal = 0 is found
 * Returns 0 if no days meet the goal or if today doesn't meet the goal
 */
export const calculateStreak = (): number => {
  const db = initializeDatabase();
  const today = getTodayDateString();

  // Get all logs ordered by date descending (most recent first)
  // Limit to prevent performance degradation with large datasets
  const allLogs = db
    .select()
    .from(dailyPostureLogs)
    .orderBy(desc(dailyPostureLogs.date))
    .limit(MAX_STREAK_DAYS)
    .all();

  // If no logs exist, streak is 0
  if (allLogs.length === 0) {
    return 0;
  }

  // Check if today exists and meets the goal
  const todayLog = allLogs.find((log) => log.date === today);
  if (!todayLog || todayLog.meetsGoal === 0) {
    return 0; // Streak broken or no data for today
  }

  // Count consecutive CALENDAR days from today backwards where meetsGoal = 1
  // We check each expected date one by one
  let streak = 1; // Start with today
  let currentDate = today;

  // Keep checking previous days
  while (true) {
    // Calculate the previous day
    const date = new Date(currentDate);
    date.setDate(date.getDate() - 1);
    const previousDate = date.toISOString().split("T")[0] as string;

    // Look for this date in the logs
    const log = allLogs.find((l) => l.date === previousDate);

    // If date not found or doesn't meet goal, streak ends
    if (!log || log.meetsGoal === 0) {
      break;
    }

    // Date found and meets goal, continue streak
    streak += 1;
    currentDate = previousDate;
  }

  return streak;
};

/**
 * Get today's summary
 */
export const getTodaySummary = (): DailySummary | null => {
  const today = getTodayDateString();
  const summary = getDailySummary(today);

  if (summary) {
    const streak = calculateStreak();
    return {
      ...summary,
      streak,
    };
  }

  return null;
};

/**
 * Get weekly summary data for the last 7 days (including today)
 * Returns an array of daily summaries sorted by date (oldest first)
 */
export const getWeeklySummary = (): DailySummary[] => {
  const db = initializeDatabase();
  const sevenDaysAgo = getDateStringDaysAgo(6);
  const today = getTodayDateString();

  const rows = db
    .select()
    .from(dailyPostureLogs)
    .where(
      and(
        gte(dailyPostureLogs.date, sevenDaysAgo),
        lte(dailyPostureLogs.date, today),
      ),
    )
    .orderBy(dailyPostureLogs.date)
    .all();

  const filtered = rows.filter(
    (row) => row.date >= sevenDaysAgo && row.date <= today,
  );

  return filtered.map(mapRowToDailySummary);
};
