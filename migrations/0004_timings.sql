-- Latency waterfall for each scan: JSON array of {name, start, end, ...} (epoch ms), appended by
-- the workflow as stages finish. Shown on the scan page and used for latency analysis.
ALTER TABLE scans ADD COLUMN timings TEXT;

-- 3D from parallel SAM 3D jobs (one per part): JSON array of
-- {key, partIds, layouts: [{scale, rotation, translation}], bytes}. Old scans keep model_key.
ALTER TABLE scans ADD COLUMN model_files TEXT;
