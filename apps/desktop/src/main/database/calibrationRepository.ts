import { and, desc, eq, not } from "drizzle-orm";
import type {
  CalibrationBaselinePayload,
  CalibrationBaselineRecord,
  CalibrationCustomThresholds,
  CalibrationSensitivity,
  PostureCalibrationPayload,
  PostureCalibrationRecord,
} from "../../shared/types/calibration";
import { initializeDatabase } from "./client";
import {
  type PostureCalibrationRow,
  calibrationBaselines,
  postureCalibration,
} from "./schema";

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

const parsePostureCalibrationRow = (
  row: PostureCalibrationRow | undefined,
): PostureCalibrationRecord | null => {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    userId: row.userId,
    baselinePitch: row.baselinePitch,
    baselineEHD: row.baselineEHD,
    baselineDPR: row.baselineDPR,
    quality: row.quality,
    sampleCount: row.sampleCount,
    sensitivity: row.sensitivity as CalibrationSensitivity,
    customPitchThreshold: row.customPitchThreshold ?? null,
    customEHDThreshold: row.customEHDThreshold ?? null,
    customDPRThreshold: row.customDPRThreshold ?? null,
    calibratedAt:
      row.calibratedAt instanceof Date
        ? row.calibratedAt.getTime()
        : Number(row.calibratedAt ?? 0),
    isActive: Boolean(row.isActive),
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.getTime()
        : Number(row.createdAt ?? 0),
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.getTime()
        : Number(row.updatedAt ?? 0),
  };
};

const getPostureCalibrationById = (
  id: number,
): PostureCalibrationRecord | null => {
  const db = initializeDatabase();
  const row = db
    .select()
    .from(postureCalibration)
    .where(eq(postureCalibration.id, id))
    .limit(1)
    .get();
  return parsePostureCalibrationRow(row);
};

const normaliseCustomThresholds = (
  custom: CalibrationCustomThresholds | null | undefined,
) => {
  if (!custom) {
    return {
      pitch: null,
      ehd: null,
      dpr: null,
    };
  }
  const { pitch, ehd, dpr } = custom;
  return {
    pitch: Number.isFinite(pitch) ? (pitch as number) : null,
    ehd: Number.isFinite(ehd) ? (ehd as number) : null,
    dpr: Number.isFinite(dpr) ? (dpr as number) : null,
  };
};

export const savePostureCalibration = (
  payload: PostureCalibrationPayload,
): PostureCalibrationRecord => {
  const db = initializeDatabase();
  const now = new Date();
  const userId = payload.userId ?? 1;
  const isActive = payload.isActive ?? true;
  const sensitivity = payload.sensitivity ?? "medium";
  const custom = normaliseCustomThresholds(payload.customThresholds);
  const calibratedAt = Number.isFinite(payload.calibratedAt)
    ? new Date(payload.calibratedAt)
    : now;

  const result = db
    .insert(postureCalibration)
    .values({
      userId,
      baselinePitch: payload.baselinePitch,
      baselineEHD: payload.baselineEHD,
      baselineDPR: payload.baselineDPR,
      quality: payload.quality,
      sampleCount: payload.sampleCount,
      sensitivity,
      customPitchThreshold: custom.pitch,
      customEHDThreshold: custom.ehd,
      customDPRThreshold: custom.dpr,
      calibratedAt,
      isActive,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const newId = Number(result.lastInsertRowid ?? 0);

  if (isActive && newId > 0) {
    db.update(postureCalibration)
      .set({
        isActive: false,
        updatedAt: now,
      })
      .where(
        and(
          eq(postureCalibration.userId, userId),
          not(eq(postureCalibration.id, newId)),
        ),
      )
      .run();

    db.update(postureCalibration)
      .set({
        isActive: true,
        updatedAt: now,
      })
      .where(eq(postureCalibration.id, newId))
      .run();
  }

  const inserted = getPostureCalibrationById(newId);
  if (!inserted) {
    throw new Error("Failed to retrieve posture calibration after insert.");
  }
  return inserted;
};

export const getActivePostureCalibration = (
  userId = 1,
): PostureCalibrationRecord | null => {
  const db = initializeDatabase();
  const activeRow = db
    .select()
    .from(postureCalibration)
    .where(
      and(
        eq(postureCalibration.userId, userId),
        eq(postureCalibration.isActive, true),
      ),
    )
    .orderBy(desc(postureCalibration.calibratedAt))
    .limit(1)
    .get();
  if (activeRow) {
    return parsePostureCalibrationRow(activeRow);
  }

  const latestRow = db
    .select()
    .from(postureCalibration)
    .where(eq(postureCalibration.userId, userId))
    .orderBy(desc(postureCalibration.calibratedAt))
    .limit(1)
    .get();
  return parsePostureCalibrationRow(latestRow);
};

export const listPostureCalibrations = (
  userId = 1,
  limit = 10,
): PostureCalibrationRecord[] => {
  const db = initializeDatabase();
  const rows = db
    .select()
    .from(postureCalibration)
    .where(eq(postureCalibration.userId, userId))
    .orderBy(desc(postureCalibration.calibratedAt))
    .limit(limit)
    .all();
  return rows
    .map((row) => parsePostureCalibrationRow(row))
    .filter((record): record is PostureCalibrationRecord => record !== null);
};

export const updatePostureCalibrationSensitivity = (
  calibrationId: number,
  sensitivity: CalibrationSensitivity,
  customThresholds?: CalibrationCustomThresholds | null,
): PostureCalibrationRecord | null => {
  const db = initializeDatabase();
  const now = new Date();
  const custom = normaliseCustomThresholds(customThresholds);

  db.update(postureCalibration)
    .set({
      sensitivity,
      customPitchThreshold: custom.pitch,
      customEHDThreshold: custom.ehd,
      customDPRThreshold: custom.dpr,
      updatedAt: now,
    })
    .where(eq(postureCalibration.id, calibrationId))
    .run();

  return getPostureCalibrationById(calibrationId);
};

export const markPostureCalibrationActive = (
  calibrationId: number,
  userId: number,
): void => {
  const db = initializeDatabase();
  const now = new Date();

  db.update(postureCalibration)
    .set({
      isActive: false,
      updatedAt: now,
    })
    .where(
      and(
        eq(postureCalibration.userId, userId),
        not(eq(postureCalibration.id, calibrationId)),
      ),
    )
    .run();

  db.update(postureCalibration)
    .set({
      isActive: true,
      updatedAt: now,
    })
    .where(eq(postureCalibration.id, calibrationId))
    .run();
};
