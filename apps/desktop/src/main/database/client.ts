import Database from "better-sqlite3";
import {
  type BetterSQLite3Database,
  drizzle,
} from "drizzle-orm/better-sqlite3";
import { app } from "electron";
import path from "path";
import {
  CALIBRATION_BASELINES_TABLE,
  DAILY_POSTURE_LOGS_TABLE,
  SETTINGS_TABLE,
  schema,
} from "./schema";

let database: BetterSQLite3Database<typeof schema> | null = null;

const ensureAppReady = () => {
  if (!app.isReady()) {
    throw new Error(
      "Attempted to access database before Electron app was ready. Ensure app.whenReady() has resolved before calling database functions.",
    );
  }
};

const createDatabase = (): BetterSQLite3Database<typeof schema> => {
  ensureAppReady();

  const userDataPath = app.getPath("userData");
  const databasePath = path.join(userDataPath, "posely.sqlite");

  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite
    .prepare(
      `
        CREATE TABLE IF NOT EXISTS ${CALIBRATION_BASELINES_TABLE} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          created_at INTEGER NOT NULL,
          detector TEXT NOT NULL,
          keypoints_json TEXT NOT NULL
        )
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        CREATE TABLE IF NOT EXISTS ${SETTINGS_TABLE} (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        )
      `,
    )
    .run();

  sqlite
    .prepare(
      `
        CREATE TABLE IF NOT EXISTS ${DAILY_POSTURE_LOGS_TABLE} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL UNIQUE,
          seconds_in_green INTEGER NOT NULL DEFAULT 0,
          seconds_in_yellow INTEGER NOT NULL DEFAULT 0,
          seconds_in_red INTEGER NOT NULL DEFAULT 0,
          avg_score REAL NOT NULL DEFAULT 0,
          sample_count INTEGER NOT NULL DEFAULT 0
        )
      `,
    )
    .run();

  return drizzle(sqlite, {
    schema,
  });
};

export const initializeDatabase = (): BetterSQLite3Database<typeof schema> => {
  if (database) {
    return database;
  }
  database = createDatabase();
  return database;
};

export const getDatabase = (): BetterSQLite3Database<typeof schema> => {
  if (!database) {
    throw new Error("Database has not been initialized");
  }
  return database;
};
