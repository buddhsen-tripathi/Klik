-- A scan's guide translated into another language. source_hash is the hash of the English text it
-- was made from: when a step is rewritten from feedback, the hash changes and it's translated again.
CREATE TABLE translations (
  scan_id TEXT NOT NULL,
  lang TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (scan_id, lang)
);
