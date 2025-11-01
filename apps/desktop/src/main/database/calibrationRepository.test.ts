import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CalibrationBaselinePayload } from "../../shared/types/calibration";
import {
  getLatestCalibrationBaseline,
  saveCalibrationBaseline,
} from "./calibrationRepository";

type MockRow = {
  id: number;
  createdAt: number;
  detector: string;
  keypointsJson: string;
};

const mockDbState: { rows: MockRow[] } = {
  rows: [],
};

vi.mock("./client", () => {
  const createInsert = () => ({
    values: (value: Omit<MockRow, "id">) => ({
      run: () => {
        const nextId = mockDbState.rows.length + 1;
        mockDbState.rows.push({
          ...value,
          id: nextId,
        });
        return { lastInsertRowid: nextId };
      },
    }),
  });

  const createSelect = () => ({
    from: () => ({
      orderBy: () => ({
        limit: () => ({
          get: () => {
            if (mockDbState.rows.length === 0) {
              return undefined;
            }
            const [latest] = [...mockDbState.rows].sort(
              (a, b) => b.createdAt - a.createdAt,
            );
            return latest;
          },
        }),
      }),
    }),
  });

  const db = {
    insert: createInsert,
    select: createSelect,
  };

  return {
    initializeDatabase: () => db,
    getDatabase: () => db,
  };
});

beforeEach(() => {
  mockDbState.rows = [];
});

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
});
