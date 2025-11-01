import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const CALIBRATION_BASELINES_TABLE = "calibration_baselines" as const;
export const SETTINGS_TABLE = "settings" as const;

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

export const schema = {
  calibrationBaselines,
  settings,
};
