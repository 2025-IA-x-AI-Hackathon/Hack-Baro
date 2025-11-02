import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CalibrationBaselinePayload,
  CalibrationCustomThresholds,
  CalibrationSensitivity,
  PostureCalibrationPayload,
} from "../../shared/types/calibration";
import {
  getActivePostureCalibration,
  getLatestCalibrationBaseline,
  listPostureCalibrations,
  markPostureCalibrationActive,
  saveCalibrationBaseline,
  savePostureCalibration,
  updatePostureCalibrationSensitivity,
} from "./calibrationRepository";
import { calibrationBaselines, postureCalibration } from "./schema";

type BaselineRow = {
  id: number;
  createdAt: number;
  detector: string;
  keypointsJson: string;
};

type PostureRow = {
  id: number;
  userId: number;
  baselinePitch: number;
  baselineEHD: number;
  baselineDPR: number;
  quality: number;
  sampleCount: number;
  sensitivity: CalibrationSensitivity;
  customPitchThreshold: number | null;
  customEHDThreshold: number | null;
  customDPRThreshold: number | null;
  calibratedAt: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

type Predicate = (row: Record<string, unknown>) => boolean;

const toCamelCase = (value: string): string => {
  return value.replace(/_([a-z])/g, (_match, char: string) =>
    char.toUpperCase(),
  );
};

const resolveColumnKey = (column: unknown): string => {
  if (typeof column === "string") {
    return toCamelCase(column);
  }
  if (column && typeof column === "object") {
    const candidate =
      (column as { columnName?: string }).columnName ??
      (column as { name?: string }).name ??
      (column as { key?: string }).key;
    if (typeof candidate === "string") {
      return toCamelCase(candidate);
    }
  }
  throw new Error(`Unsupported column reference: ${String(column)}`);
};

const normaliseOrderingValue = (value: unknown): number => {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? value.length : parsed;
  }
  if (value === null || value === undefined) {
    return Number.NaN;
  }
  return Number(value);
};

const mockDbState = {
  baselines: [] as BaselineRow[],
  posture: [] as PostureRow[],
  baselineSeq: 0,
  postureSeq: 0,
};

vi.mock("drizzle-orm", () => {
  const eq = (column: unknown, value: unknown) => {
    const key = resolveColumnKey(column);
    return (row: Record<string, unknown>) => row[key] === value;
  };

  const and = (...predicates: Predicate[]) => {
    const fns = predicates.filter(Boolean);
    return (row: Record<string, unknown>) => fns.every((fn) => fn(row));
  };

  const not = (predicate: Predicate) => {
    return (row: Record<string, unknown>) => !predicate(row);
  };

  const desc = (column: unknown) => {
    return {
      column: resolveColumnKey(column),
      direction: "desc" as const,
    };
  };

  return {
    eq,
    and,
    not,
    desc,
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      text: strings.join("?"),
      values,
    }),
  };
});

const getTableName = (
  table: unknown,
): "calibration_baselines" | "posture_calibration" => {
  if (table === calibrationBaselines) {
    return "calibration_baselines";
  }
  if (table === postureCalibration) {
    return "posture_calibration";
  }
  if (table && typeof table === "object") {
    const name =
      (table as { name?: string }).name ??
      (table as { tableName?: string }).tableName;
    if (name === "calibration_baselines" || name === "posture_calibration") {
      return name;
    }
  }
  throw new Error(`Unknown table: ${String(table)}`);
};

const buildSelectChain = (rows: Record<string, unknown>[]): any => {
  return {
    where(predicate?: Predicate) {
      if (typeof predicate !== "function") {
        return buildSelectChain(rows);
      }
      const filtered = rows.filter((row) => predicate(row));
      return buildSelectChain(filtered);
    },
    orderBy(
      descriptor?:
        | { column?: string; direction?: "asc" | "desc" }
        | Array<{ column?: string; direction?: "asc" | "desc" }>
        | null,
    ) {
      if (!descriptor) {
        return buildSelectChain(rows);
      }
      const descriptors = Array.isArray(descriptor) ? descriptor : [descriptor];
      const sorted = [...rows];
      descriptors.forEach((item) => {
        if (!item) {
          return;
        }
        const columnName = resolveColumnKey(item.column ?? item);
        const direction = item.direction ?? "asc";
        sorted.sort((a, b) => {
          const aValue = normaliseOrderingValue(a[columnName]);
          const bValue = normaliseOrderingValue(b[columnName]);
          if (Number.isNaN(aValue) && Number.isNaN(bValue)) {
            return 0;
          }
          if (Number.isNaN(aValue)) {
            return direction === "desc" ? 1 : -1;
          }
          if (Number.isNaN(bValue)) {
            return direction === "desc" ? -1 : 1;
          }
          if (aValue === bValue) {
            return 0;
          }
          return direction === "desc" ? bValue - aValue : aValue - bValue;
        });
      });
      return buildSelectChain(sorted);
    },
    limit(limitValue?: number) {
      if (typeof limitValue !== "number") {
        return buildSelectChain(rows);
      }
      return buildSelectChain(rows.slice(0, limitValue));
    },
    get() {
      return rows[0];
    },
    all() {
      return [...rows];
    },
  };
};

const applyUpdates = (
  row: Record<string, unknown>,
  values: Record<string, unknown>,
) => {
  Object.entries(values).forEach(([key, value]) => {
    row[key] = value;
  });
};

vi.mock("./client", () => {
  const db = {
    insert(table: unknown) {
      return {
        values(value: Record<string, unknown>) {
          return {
            run: () => {
              const tableName = getTableName(table);
              if (tableName === "calibration_baselines") {
                const nextId = ++mockDbState.baselineSeq;
                mockDbState.baselines.push({
                  id: nextId,
                  createdAt: value.createdAt as number,
                  detector: value.detector as string,
                  keypointsJson: value.keypointsJson as string,
                });
                return { lastInsertRowid: nextId };
              }

              const nextId = ++mockDbState.postureSeq;
              const calibratedAtRaw = value.calibratedAt;
              const calibratedAt =
                calibratedAtRaw instanceof Date
                  ? calibratedAtRaw
                  : new Date(calibratedAtRaw as number);
              const createdAtRaw = value.createdAt;
              const updatedAtRaw = value.updatedAt;
              const createdAt =
                createdAtRaw instanceof Date ? createdAtRaw : new Date();
              const updatedAt =
                updatedAtRaw instanceof Date ? updatedAtRaw : createdAt;

              const row: PostureRow = {
                id: nextId,
                userId: (value.userId as number | undefined) ?? 1,
                baselinePitch: value.baselinePitch as number,
                baselineEHD: value.baselineEHD as number,
                baselineDPR: value.baselineDPR as number,
                quality: value.quality as number,
                sampleCount: value.sampleCount as number,
                sensitivity:
                  (value.sensitivity as CalibrationSensitivity | undefined) ??
                  "medium",
                customPitchThreshold:
                  (value.customPitchThreshold as number | null | undefined) ??
                  null,
                customEHDThreshold:
                  (value.customEHDThreshold as number | null | undefined) ??
                  null,
                customDPRThreshold:
                  (value.customDPRThreshold as number | null | undefined) ??
                  null,
                calibratedAt,
                isActive: Boolean(value.isActive ?? true),
                createdAt,
                updatedAt,
              };
              mockDbState.posture.push(row);
              return { lastInsertRowid: nextId };
            },
          };
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          const tableName = getTableName(table);
          const rows =
            tableName === "calibration_baselines"
              ? mockDbState.baselines
              : mockDbState.posture;
          return buildSelectChain(rows.map((row) => ({ ...row })));
        },
      };
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where(predicate?: Predicate) {
              return {
                run: () => {
                  const tableName = getTableName(table);
                  const rows =
                    tableName === "calibration_baselines"
                      ? mockDbState.baselines
                      : mockDbState.posture;
                  let changes = 0;
                  rows.forEach((row) => {
                    if (
                      !predicate ||
                      predicate(row as Record<string, unknown>)
                    ) {
                      applyUpdates(row as Record<string, unknown>, values);
                      changes += 1;
                    }
                  });
                  return { changes };
                },
              };
            },
          };
        },
      };
    },
  };

  return {
    initializeDatabase: () => db,
    getDatabase: () => db,
  };
});

beforeEach(() => {
  mockDbState.baselines = [];
  mockDbState.posture = [];
  mockDbState.baselineSeq = 0;
  mockDbState.postureSeq = 0;
});

const createPosturePayload = (
  overrides: Partial<PostureCalibrationPayload> = {},
): PostureCalibrationPayload => {
  return {
    baselinePitch: 4.5,
    baselineEHD: 0.12,
    baselineDPR: 1.02,
    quality: 80,
    sampleCount: 90,
    sensitivity: "medium",
    calibratedAt: Date.now(),
    customThresholds: undefined,
    ...overrides,
  } satisfies PostureCalibrationPayload;
};

describe("calibrationRepository", () => {
  it("returns null when no baseline exists", () => {
    expect(getLatestCalibrationBaseline()).toBeNull();
  });

  it("persists and retrieves the latest baseline", () => {
    const firstPayload: CalibrationBaselinePayload = {
      detector: "mediapipe",
      keypoints: [
        {
          x: 0.1,
          y: 0.2,
          z: 0.3,
          visibility: 0.9,
          name: "landmark-1",
        },
      ],
    };

    const secondPayload: CalibrationBaselinePayload = {
      detector: "mediapipe",
      keypoints: [
        {
          x: 0.4,
          y: 0.5,
          z: 0.6,
          visibility: 0.8,
          name: "landmark-1",
        },
      ],
    };

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy
      .mockReturnValueOnce(1_700_000_000_000)
      .mockReturnValueOnce(1_700_000_010_000);

    try {
      const created = saveCalibrationBaseline(firstPayload);
      expect(created).toMatchObject({
        id: 1,
        detector: firstPayload.detector,
        keypoints: firstPayload.keypoints,
        createdAt: 1_700_000_000_000,
      });

      const createdSecond = saveCalibrationBaseline(secondPayload);
      expect(createdSecond).toMatchObject({
        id: 2,
        detector: secondPayload.detector,
        keypoints: secondPayload.keypoints,
        createdAt: 1_700_000_010_000,
      });

      const latest = getLatestCalibrationBaseline();
      expect(latest).toEqual(createdSecond);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("saves posture calibrations, marks the newest active, and lists history", () => {
    const initial = savePostureCalibration(
      createPosturePayload({
        calibratedAt: 1_700_000_020_000,
        quality: 75,
        sampleCount: 85,
        sensitivity: "medium",
      }),
    );

    const latest = savePostureCalibration(
      createPosturePayload({
        calibratedAt: 1_700_000_030_000,
        quality: 88,
        sampleCount: 105,
        sensitivity: "high",
      }),
    );

    const history = listPostureCalibrations(1);
    expect(history).toHaveLength(2);

    if (history[0]) {
      expect(history[0].id).toBe(latest.id);
      expect(history[0].isActive).toBe(true);
    }
    if (history[1]) {
      expect(history[1].id).toBe(initial.id);
      expect(history[1].isActive).toBe(false);
    }

    const active = getActivePostureCalibration(1);
    expect(active?.id).toBe(latest.id);

    markPostureCalibrationActive(initial.id, initial.userId);
    const reactivated = getActivePostureCalibration(1);
    expect(reactivated?.id).toBe(initial.id);

    const limited = listPostureCalibrations(1, 1);
    expect(limited).toHaveLength(1);

    if (limited[0]) {
      expect(limited[0].id).toBe(latest.id);
    }
  });

  it("updates calibration sensitivity and stores custom thresholds", () => {
    const record = savePostureCalibration(
      createPosturePayload({
        calibratedAt: 1_700_000_040_000,
        sensitivity: "medium",
      }),
    );

    const customThresholds: CalibrationCustomThresholds = {
      pitch: record.baselinePitch + 16,
      ehd: record.baselineEHD + 0.24,
      dpr: record.baselineDPR + 0.18,
    };

    const updated = updatePostureCalibrationSensitivity(
      record.id,
      "custom",
      customThresholds,
    );

    expect(updated).not.toBeNull();
    expect(updated?.sensitivity).toBe("custom");
    expect(updated?.customPitchThreshold).toBeCloseTo(customThresholds.pitch!);
    expect(updated?.customEHDThreshold).toBeCloseTo(customThresholds.ehd!);
    expect(updated?.customDPRThreshold).toBeCloseTo(customThresholds.dpr!);

    markPostureCalibrationActive(record.id, record.userId);
    const active = getActivePostureCalibration(record.userId);
    expect(active?.sensitivity).toBe("custom");
  });

  it("handles multiple users independently", () => {
    const userOne = savePostureCalibration(
      createPosturePayload({
        calibratedAt: 1_700_000_050_000,
        userId: 1,
        sensitivity: "low",
      }),
    );

    const userTwo = savePostureCalibration(
      createPosturePayload({
        calibratedAt: 1_700_000_060_000,
        userId: 2,
        sensitivity: "high",
      }),
    );

    const activeOne = getActivePostureCalibration(1);
    expect(activeOne?.id).toBe(userOne.id);
    const activeTwo = getActivePostureCalibration(2);
    expect(activeTwo?.id).toBe(userTwo.id);

    const historyTwo = listPostureCalibrations(2);
    expect(historyTwo).toHaveLength(1);

    if (historyTwo[0]) {
      expect(historyTwo[0].userId).toBe(2);
    }
  });
});
