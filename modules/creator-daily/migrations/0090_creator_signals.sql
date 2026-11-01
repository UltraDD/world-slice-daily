CREATE TABLE IF NOT EXISTS creator_signals (
  id text PRIMARY KEY, source text NOT NULL, title text NOT NULL, summary text NOT NULL,
  url text NOT NULL, published_at timestamptz, observed_at timestamptz NOT NULL,
  rank integer, source_date text, kind text NOT NULL, first_seen_at timestamptz NOT NULL DEFAULT now()
);
