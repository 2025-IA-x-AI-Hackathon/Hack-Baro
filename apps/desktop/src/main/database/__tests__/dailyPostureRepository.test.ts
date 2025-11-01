import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { schema } from "../schema.js";

// Mock the database client
vi.mock("../client.js", () => ({
  getDatabase: vi.fn(),
}));

// Mock logger
vi.mock("../../../shared/logger.js", () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe("DailyPostureRepository", () => {
  let mockDb: Partial<BetterSQLite3Database<typeof schema>>;
  let getDatabase: any;
  
  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Mock database methods
    mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      get: vi.fn(),
      insert: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      all: vi.fn(),
    } as any;

    const clientModule = await import("../client.js");
    getDatabase = vi.mocked(clientModule.getDatabase);
    getDatabase.mockReturnValue(mockDb);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("upsertDailyPostureLog", () => {
    it("should insert new record when date does not exist", async () => {
      const { upsertDailyPostureLog } = await import("../dailyPostureRepository.js");
      
      const newData = {
        date: "2025-11-02",
        secondsInGreen: 120,
        secondsInYellow: 45,
        secondsInRed: 15,
        avgScore: 82.5,
        sampleCount: 180,
      };

      const expectedResult = { id: 1, ...newData };

      // Mock no existing record
      (mockDb.get as any).mockReturnValueOnce(null);
      // Mock insert returning the new record
      (mockDb.get as any).mockReturnValueOnce(expectedResult);

      const result = upsertDailyPostureLog(newData);

      expect(result).toEqual(expectedResult);
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it("should update existing record when date exists", async () => {
      const { upsertDailyPostureLog } = await import("../dailyPostureRepository.js");
      
      const existingData = {
        id: 1,
        date: "2025-11-02",
        secondsInGreen: 60,
        secondsInYellow: 20,
        secondsInRed: 10,
        avgScore: 75.0,
        sampleCount: 90,
      };

      const updateData = {
        date: "2025-11-02",
        secondsInGreen: 60,
        secondsInYellow: 25,
        secondsInRed: 5,
        avgScore: 85.0,
        sampleCount: 90,
      };

      // Expected result: accumulated values
      const expectedResult = {
        id: 1,
        date: "2025-11-02",
        secondsInGreen: 120, // 60 + 60
        secondsInYellow: 45, // 20 + 25
        secondsInRed: 15, // 10 + 5
        avgScore: 80.0, // (75*90 + 85*90) / 180
        sampleCount: 180, // 90 + 90
      };

      // Mock existing record
      (mockDb.get as any).mockReturnValueOnce(existingData);
      // Mock update returning the accumulated record
      (mockDb.get as any).mockReturnValueOnce(expectedResult);

      const result = upsertDailyPostureLog(updateData);

      expect(result).toEqual(expectedResult);
      expect(mockDb.update).toHaveBeenCalled();
    });
  });

  describe("getDailyPostureLogByDate", () => {
    it("should return record when date exists", async () => {
      const { getDailyPostureLogByDate } = await import("../dailyPostureRepository.js");
      
      const expectedData = {
        id: 1,
        date: "2025-11-02",
        secondsInGreen: 120,
        secondsInYellow: 45,
        secondsInRed: 15,
        avgScore: 82.5,
        sampleCount: 180,
      };

      (mockDb.get as any).mockReturnValueOnce(expectedData);

      const result = getDailyPostureLogByDate("2025-11-02");

      expect(result).toEqual(expectedData);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it("should return null when date does not exist", async () => {
      const { getDailyPostureLogByDate } = await import("../dailyPostureRepository.js");
      
      (mockDb.get as any).mockReturnValueOnce(undefined);

      const result = getDailyPostureLogByDate("2025-11-02");

      expect(result).toBeNull();
    });
  });

  describe("getWeeklySummary", () => {
    it("should return records for the last 7 days", async () => {
      const { getWeeklySummary } = await import("../dailyPostureRepository.js");
      
      const today = new Date();
      const mockData = [
        {
          id: 1,
          date: new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!,
          secondsInGreen: 100,
          secondsInYellow: 50,
          secondsInRed: 10,
          avgScore: 85.0,
          sampleCount: 160,
        },
        {
          id: 2,
          date: new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]!,
          secondsInGreen: 120,
          secondsInYellow: 40,
          secondsInRed: 5,
          avgScore: 88.0,
          sampleCount: 165,
        },
        {
          id: 3,
          date: today.toISOString().split("T")[0]!,
          secondsInGreen: 90,
          secondsInYellow: 60,
          secondsInRed: 15,
          avgScore: 82.0,
          sampleCount: 165,
        },
      ];

      (mockDb.all as any).mockReturnValueOnce(mockData);

      const result = getWeeklySummary();

      expect(result).toEqual(mockData);
      expect(mockDb.select).toHaveBeenCalled();
    });

    it("should return empty array when no data exists", async () => {
      const { getWeeklySummary } = await import("../dailyPostureRepository.js");
      
      (mockDb.all as any).mockReturnValueOnce([]);

      const result = getWeeklySummary();

      expect(result).toEqual([]);
    });

    it("should handle partial week data", async () => {
      const { getWeeklySummary } = await import("../dailyPostureRepository.js");
      
      const today = new Date();
      const mockData = [
        {
          id: 1,
          date: today.toISOString().split("T")[0]!,
          secondsInGreen: 90,
          secondsInYellow: 60,
          secondsInRed: 15,
          avgScore: 82.0,
          sampleCount: 165,
        },
      ];

      (mockDb.all as any).mockReturnValueOnce(mockData);

      const result = getWeeklySummary();

      expect(result).toEqual(mockData);
      expect(result.length).toBe(1);
    });
  });
});
