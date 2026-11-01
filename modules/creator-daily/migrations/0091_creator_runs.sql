CREATE TABLE IF NOT EXISTS creator_runs (
  id bigserial PRIMARY KEY, day text NOT NULL, status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  error text, sources jsonb NOT NULL DEFAULT '[]'::jsonb
);
