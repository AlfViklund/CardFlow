-- Worker lifecycle: dead-letter tracking and stalled-job recovery support
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS dead_letter_reason text,
  ADD COLUMN IF NOT EXISTS last_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS stall_detected_at timestamptz;

-- Index for finding stalled in-flight jobs
CREATE INDEX IF NOT EXISTS idx_jobs_status_started ON jobs(status, started_at);

-- Index for dead-letter inspection
CREATE INDEX IF NOT EXISTS idx_jobs_dead_letter ON jobs(status)
  WHERE status = 'dead-lettered';
