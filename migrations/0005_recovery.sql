-- Latest "check my progress" result for a scan (JSON Recovery): step status, mistakes, fix steps, resume point.
ALTER TABLE scans ADD COLUMN recovery TEXT;
