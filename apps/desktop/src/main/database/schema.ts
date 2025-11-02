import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const CALIBRATION_BASELINES_TABLE = "calibration_baselines" as const;
export const SETTINGS_TABLE = "settings" as const;
export const DAILY_POSTURE_LOGS_TABLE = "daily_posture_logs" as const;

export const calibrationBaselines = sqliteTable(CALIBRATION_BASELINES_TABLE, {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: integer("created_at").notNull(),
  detector: text("detector").notNull(),
  keypointsJson: text("keypoints_json").notNull(),
});

export type CalibrationBaselineRow = typeof calibrationBaselines.$inferSelect;
export type NewCalibrationBaselineRow =
  typeof calibrationBaselines.$inferInsert;

export type SettingRow = typeof settings.$inferSelect;
export type NewSettingRow = typeof settings.$inferInsert;

export const settings = sqliteTable(SETTINGS_TABLE, {
  key: text("key").primaryKey().notNull(),
  value: text("value").notNull(),
});

export const dailyPostureLogs = sqliteTable(DAILY_POSTURE_LOGS_TABLE, {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull().unique(),
  secondsInGreen: integer("seconds_in_green").notNull().default(0),
  secondsInYellow: integer("seconds_in_yellow").notNull().default(0),
  secondsInRed: integer("seconds_in_red").notNull().default(0),
  avgScore: real("avg_score").notNull().default(0),
  sampleCount: integer("sample_count").notNull().default(0),
  meetsGoal: integer("meets_goal").notNull().default(0),
});

export type DailyPostureLogRow = typeof dailyPostureLogs.$inferSelect;
export type NewDailyPostureLogRow = typeof dailyPostureLogs.$inferInsert;

export const schema = {
  calibrationBaselines,
  settings,
  dailyPostureLogs,
};
