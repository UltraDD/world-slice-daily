import { sql } from "@aihot/backend/db";
import type { DailyPage, Edition, Idea, Signal, SourceStatus } from "../contracts.ts";
import { beijingDate } from "./sources.ts";

export const maxDailyCalls = () => Math.max(1, Math.min(20, Number(process.env.CREATOR_DAILY_MAX_CALLS || 12)));

export async function loadSignals(): Promise<Signal[]> {
  const rows = await sql`SELECT id, source, title, summary, url, published_at, observed_at, rank, source_date, kind
    FROM creator_signals WHERE observed_at > now() - interval '48 hours'
    AND (published_at IS NULL OR published_at > now() - interval '7 days')
    ORDER BY observed_at DESC, rank ASC NULLS LAST, first_seen_at DESC, id LIMIT 150`;
  return rows.map(row => ({ id: row.id, source: row.source, title: row.title, summary: row.summary, url: row.url,
    publishedAt: row.published_at?.toISOString() ?? null, observedAt: row.observed_at.toISOString(), rank: row.rank,
    sourceDate: row.source_date, kind: row.kind }));
}

export async function loadUsage() {
  const [row] = await sql`SELECT count(*)::int AS calls,
    coalesce(sum((a.usage->>'prompt_tokens')::bigint),0) AS input_tokens,
    coalesce(sum((a.usage->>'completion_tokens')::bigint),0) AS output_tokens
    FROM receipt_attempts a JOIN receipts r ON r.id = a.receipt_id
    WHERE r.purpose LIKE 'creator_%' AND (a.started_at AT TIME ZONE 'Asia/Shanghai')::date = ${beijingDate()}::date`;
  return { calls: row.calls as number, inputTokens: row.input_tokens as number, outputTokens: row.output_tokens as number, maxCalls: maxDailyCalls() };
}

export async function loadDaily(): Promise<DailyPage> {
  const date = beijingDate();
  const [editionRows, signals, decisions, runs, usage] = await Promise.all([
    sql`SELECT payload FROM creator_editions ORDER BY day DESC, generated_at DESC LIMIT 1`, loadSignals(),
    sql`SELECT id, decision, payload FROM creator_decisions ORDER BY updated_at DESC`,
    sql`SELECT id, status, error, sources, started_at, finished_at FROM creator_runs WHERE day <= ${date} ORDER BY id DESC LIMIT 1`, loadUsage(),
  ]);
  const decisionMap = new Map(decisions.map(row => [row.id as string, row.decision as Idea["decision"]]));
  const edition = (editionRows[0]?.payload ?? null) as Edition | null;
  if (edition) edition.ideas = edition.ideas.map(idea => ({ ...idea, decision: decisionMap.get(idea.id) ?? "new" }));
  const run = runs[0];
  return { date, edition, signals, sources: (run?.sources ?? edition?.sources ?? []) as SourceStatus[],
    saved: decisions.filter(row => row.decision === "saved").map(row => ({ ...row.payload as Idea, decision: "saved" })),
    latestRun: run ? { id: run.id, status: run.status, error: run.error, started_at: run.started_at.toISOString(), finished_at: run.finished_at?.toISOString() ?? null } : null,
    usage };
}

export async function decideIdea(id: string, decision: Idea["decision"]): Promise<boolean> {
  const editions = await sql`SELECT payload FROM creator_editions ORDER BY day DESC LIMIT 31`;
  const saved = await sql`SELECT payload FROM creator_decisions WHERE id = ${id}`;
  const idea = editions.flatMap(row => (row.payload as Edition).ideas).find(v => v.id === id) ?? saved[0]?.payload as Idea | undefined;
  if (!idea) return false;
  await sql`INSERT INTO creator_decisions (id,decision,payload) VALUES (${id},${decision},${sql.json(idea as never)})
    ON CONFLICT (id) DO UPDATE SET decision = excluded.decision, payload = excluded.payload, updated_at = now()`;
  return true;
}
