import { desc } from "drizzle-orm";
import type {
  CalibrationBaselinePayload,
  CalibrationBaselineRecord,
} from "../../shared/types/calibration";
import { initializeDatabase } from "./client";
import { calibrationBaselines } from "./schema";

const parseRow = (
  row: typeof calibrationBaselines.$inferSelect | undefined,
): CalibrationBaselineRecord | null => {
  if (!row) {
    return null;
  }

  let keypoints: CalibrationBaselineRecord["keypoints"] = [];

  try {
    const parsed = JSON.parse(
      row.keypointsJson,
    ) as CalibrationBaselineRecord["keypoints"];
    if (Array.isArray(parsed)) {
      keypoints = parsed;
    }
  } catch {
    keypoints = [];
  }

  return {
    id: row.id,
    createdAt: row.createdAt,
    detector: row.detector as CalibrationBaselineRecord["detector"],
    keypoints,
  };
};

export const saveCalibrationBaseline = (
  payload: CalibrationBaselinePayload,
): CalibrationBaselineRecord => {
  const db = initializeDatabase();
  const createdAt = Date.now();
  const result = db
    .insert(calibrationBaselines)
    .values({
      createdAt,
      detector: payload.detector,
      keypointsJson: JSON.stringify(payload.keypoints),
    })
    .run();

  return {
    id: Number(result.lastInsertRowid ?? 0),
    createdAt,
    ...payload,
  };
};

export const getLatestCalibrationBaseline =
  (): CalibrationBaselineRecord | null => {
    const db = initializeDatabase();

    const row = db
      .select()
      .from(calibrationBaselines)
      .orderBy(desc(calibrationBaselines.createdAt))
      .limit(1)
      .get();

    return parseRow(row);
  };
