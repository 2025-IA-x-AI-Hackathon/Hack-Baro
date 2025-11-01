import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const CALIBRATION_BASELINES_TABLE = "calibration_baselines" as const;

export const calibrationBaselines = sqliteTable(CALIBRATION_BASELINES_TABLE, {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: integer("created_at").notNull(),
  detector: text("detector").notNull(),
  keypointsJson: text("keypoints_json").notNull(),
});

export type CalibrationBaselineRow = typeof calibrationBaselines.$inferSelect;
export type NewCalibrationBaselineRow =
  typeof calibrationBaselines.$inferInsert;

export const schema = {
  calibrationBaselines,
};
