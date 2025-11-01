import { eq } from "drizzle-orm";
import { getDatabase } from "./client";
import { settings } from "./schema";

/**
 * Get a setting value by key
 * @param key - The setting key
 * @returns The setting value or null if not found
 */
export const getSetting = (key: string): string | null => {
  const db = getDatabase();
  const result = db.select().from(settings).where(eq(settings.key, key)).get();
  return result?.value ?? null;
};

/**
 * Set a setting value
 * @param key - The setting key
 * @param value - The setting value
 */
export const setSetting = (key: string, value: string): void => {
  const db = getDatabase();
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value },
    })
    .run();
};

/**
 * Delete a setting by key
 * @param key - The setting key
 */
export const deleteSetting = (key: string): void => {
  const db = getDatabase();
  db.delete(settings).where(eq(settings.key, key)).run();
};
