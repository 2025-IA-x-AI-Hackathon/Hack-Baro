import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const CALIBRATION_BASELINES_TABLE = "calibration_baselines" as const;

export const calibrationBaselines = sqliteTable(CALIBRATION_BASELINES_TABLE, {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: integer("created_at").notNull(),
  detector: text("detector").notNull(),
  keypointsJson: text("keypoints_json").notNull(),
});

export const POSTURE_CALIBRATION_TABLE = "posture_calibration" as const;

export const postureCalibration = sqliteTable(
  POSTURE_CALIBRATION_TABLE,
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().default(1),

    baselinePitch: real("baseline_pitch").notNull(),
    baselineEHD: real("baseline_ehd").notNull(),
    baselineDPR: real("baseline_dpr").notNull(),

    quality: integer("quality").notNull(),
    sampleCount: integer("sample_count").notNull(),

    sensitivity: text("sensitivity").notNull().default("medium"),

    customPitchThreshold: real("custom_pitch_threshold"),
    customEHDThreshold: real("custom_ehd_threshold"),
    customDPRThreshold: real("custom_dpr_threshold"),

    calibratedAt: integer("calibrated_at", { mode: "timestamp" }).notNull(),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(strftime('%s', 'now'))`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(strftime('%s', 'now'))`),
  },
  (table) => ({
    userActiveIdx: index("posture_calibration_user_active_idx").on(
      table.userId,
      table.isActive,
    ),
    calibratedAtIdx: index("posture_calibration_calibrated_at_idx").on(
      table.calibratedAt,
    ),
  }),
);

// export const schema = {
//   calibrationBaselines,
//   postureCalibration,
// };

export type CalibrationBaselineRow = typeof calibrationBaselines.$inferSelect;
export type NewCalibrationBaselineRow =
  typeof calibrationBaselines.$inferInsert;

export type PostureCalibrationRow = typeof postureCalibration.$inferSelect;
export type NewPostureCalibrationRow = typeof postureCalibration.$inferInsert;
