CREATE TABLE IF NOT EXISTS creator_decisions (
  id text PRIMARY KEY, decision text NOT NULL CHECK (decision IN ('new','saved','dismissed')),
  payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
