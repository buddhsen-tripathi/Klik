-- One row per photo the user scans.
CREATE TABLE scans (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  stage TEXT NOT NULL DEFAULT 'queued',   -- queued | analyzing | modeling | done | failed
  hint TEXT,                              -- optional "what is this?" text from the user
  photo_key TEXT NOT NULL,                -- R2 key of the uploaded photo
  photo_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  analysis TEXT,                          -- Analysis JSON from Gemini
  fal_request_id TEXT,
  model_key TEXT,                         -- R2 key of the combined SAM 3D scene GLB
  model_bytes INTEGER,                    -- size of that GLB, shown before the user downloads it
  model_part_ids TEXT,                    -- JSON array of part ids, in SAM 3D box-prompt order
  error TEXT,
  model_error TEXT
);

CREATE INDEX scans_created_at ON scans (created_at DESC);
