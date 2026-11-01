import { z } from "zod";

export interface Signal {
  id: string;
  source: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string | null;
  observedAt: string;
  rank: number | null;
  sourceDate: string | null;
  kind: "news" | "trend" | "science" | "ai";
}

export interface SourceStatus {
  id: string;
  name: string;
  ok: boolean;
  count: number;
  feedDate: string | null;
  error: string | null;
  fetchedAt: string;
}

export const ideaSchema = z.object({
    signalIds: z.array(z.string()).min(1).max(6),
    bucket: z.enum(["today", "prepare", "evergreen"]),
    title: z.string().min(8).max(65).refine(value => !/(?:背后的|[：:，,、])$/.test(value), "标题必须是完整表达"),
    whyNow: z.string().min(5).max(220),
    angle: z.string().min(12).max(250),
    hook: z.string().min(5).max(150),
    visuals: z.array(z.string().min(3).max(150)).min(2).max(3),
    effort: z.enum(["轻量", "常规", "较重"]),
    window: z.string().min(2).max(100),
    verify: z.array(z.string().min(2).max(180)).max(4),
  });
export const proposalSchema = z.object({
  lead: z.string().min(1).max(200),
  ideas: z.array(ideaSchema).max(3),
  watch: z.array(z.object({ signalId: z.string(), reason: z.string().min(3).max(160) })).max(6),
});

export type Proposal = z.infer<typeof proposalSchema>;
export type Idea = Proposal["ideas"][number] & {
  id: string;
  date: string;
  sources: Signal[];
  decision: "new" | "saved" | "dismissed";
}

export interface Edition {
  date: string;
  generatedAt: string;
  lead: string;
  ideas: Idea[];
  watch: Array<{ signal: Signal; reason: string }>;
  sources: SourceStatus[];
  model: string;
}

export interface DailyPage {
  date: string;
  edition: Edition | null;
  saved: Idea[];
  signals: Signal[];
  sources: SourceStatus[];
  latestRun: { id: number; status: string; error: string | null; started_at: string; finished_at: string | null } | null;
  usage: { calls: number; inputTokens: number; outputTokens: number; maxCalls: number };
}
