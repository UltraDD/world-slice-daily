CREATE TABLE IF NOT EXISTS creator_editions (
  day text PRIMARY KEY, payload jsonb NOT NULL, generated_at timestamptz NOT NULL DEFAULT now()
);
