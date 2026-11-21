-- Live progress shown while a scan runs: Gemini's latest thought, fal queue position / log.
ALTER TABLE scans ADD COLUMN progress TEXT;

-- The fal job (request id + status/result URLs), so it can be submitted early from the
-- Gemini stream and picked up again by later steps or retries without resubmitting.
ALTER TABLE scans ADD COLUMN fal_job TEXT;
