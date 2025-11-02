/**
 * Daily posture tracking constants
 */

/**
 * Streak threshold: minimum average score required to count a day as "goal met"
 * If a day's avgScore >= STREAK_THRESHOLD, meetsGoal = 1, otherwise 0
 */
export const STREAK_THRESHOLD = 70;

/**
 * Maximum number of days to query when calculating streak
 * Prevents performance degradation with large historical datasets
 */
export const MAX_STREAK_DAYS = 365;
