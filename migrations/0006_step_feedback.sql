-- Problems people hit on a step while following the guide (live coach warnings, "this step is
-- wrong", mistakes found by a progress check). Enough of them and the step gets rewritten.
CREATE TABLE step_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id TEXT NOT NULL,
  -- Index into analysis.steps (disassembly order), whatever mode the user was in.
  step_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  problem TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  -- Set once the problem has been folded into a rewrite.
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_step_feedback_open ON step_feedback (scan_id, step_index, used);
