CREATE TABLE IF NOT EXISTS posture_calibration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL DEFAULT 1,
  baseline_pitch REAL NOT NULL,
  baseline_ehd REAL NOT NULL,
  baseline_dpr REAL NOT NULL,
  quality INTEGER NOT NULL,
  sample_count INTEGER NOT NULL,
  sensitivity TEXT NOT NULL DEFAULT 'medium',
  custom_pitch_threshold REAL,
  custom_ehd_threshold REAL,
  custom_dpr_threshold REAL,
  calibrated_at INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS posture_calibration_user_active_idx
  ON posture_calibration(user_id, is_active);

CREATE INDEX IF NOT EXISTS posture_calibration_calibrated_at_idx
  ON posture_calibration(calibrated_at);
