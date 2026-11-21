-- Scans can have several photos (different angles of the same object).
CREATE TABLE scan_photos (
  scan_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  photo_key TEXT NOT NULL,
  photo_type TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  PRIMARY KEY (scan_id, idx)
);

-- Existing single-photo scans become photo 0.
INSERT INTO scan_photos (scan_id, idx, photo_key, photo_type, width, height)
SELECT id, 0, photo_key, photo_type, width, height FROM scans;

-- Which photo Gemini picked for the 3D model (its part boxes refer to this photo).
ALTER TABLE scans ADD COLUMN model_photo_index INTEGER NOT NULL DEFAULT 0;
