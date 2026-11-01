import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { decodeHTML } from "entities";
import type { Signal, SourceStatus } from "../contracts.ts";

export const beijingDate = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
export const signalId = (source: string, key: string) => createHash("sha256").update(`${source}:${key}`).digest("hex").slice(0, 24);
const plain = (value: unknown) => typeof value === "string" ? decodeHTML(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim() : "";
export function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function instant(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= Date.now() + 300_000 ? new Date(time).toISOString() : null;
}

export function parse60s(body: any, observedAt: string): Signal[] {
  const data = body?.data;
  if (body?.code !== 200 || !/^\d{4}-\d{2}-\d{2}$/.test(data?.date ?? "") || !Array.isArray(data?.news)) throw new Error("新闻源返回格式变化");
  const url = safeUrl(data.link) ?? `https://60s.viki.moe/v2/60s?date=${data.date}`;
  return data.news.filter((v: unknown): v is string => typeof v === "string" && v.length > 2).map((title: string) => ({
    id: signalId("60s", `${data.date}:${title}`), source: "60s 每日新闻", title, summary: "", url,
    publishedAt: new Date(`${data.date}T00:00:00+08:00`).toISOString(), observedAt, rank: null, sourceDate: data.date, kind: "news",
  }));
}

export function parseTrends(body: any, source: string, observedAt: string): Signal[] {
  if (body?.code !== 200 || !Array.isArray(body.data)) throw new Error("热榜返回格式变化");
  return body.data.slice(0, 30).flatMap((item: any, index: number) => {
    const title = plain(item.title ?? item.keyword ?? item.word);
    const url = safeUrl(item.link ?? item.url);
    if (!title || !url) return [];
    return [{ id: signalId(source, title), source, title, summary: plain(item.description).slice(0, 450), url,
      publishedAt: null, observedAt, rank: index + 1, sourceDate: null, kind: "trend" as const }];
  });
}

export function parseAIHot(body: any, observedAt: string): Signal[] {
  if (!Array.isArray(body?.items)) throw new Error("AI HOT 返回格式变化");
  return body.items.slice(0, 25).flatMap((item: any) => {
    const url = safeUrl(item.links?.original ?? item.originalUrl ?? item.sourceUrl ?? item.url);
    const title = plain(item.title);
    if (!title || !url) return [];
    return [{ id: signalId("aihot", String(item.id ?? url)), source: `AI HOT · ${plain(item.source?.name ?? item.sourceName ?? item.source) || "精选"}`,
      title, summary: plain(item.summary).slice(0, 550), url, publishedAt: instant(item.publishedAt), observedAt, rank: null, sourceDate: null, kind: "ai" as const }];
  });
}

export function parseRss(text: string, source: string, observedAt: string): Signal[] {
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(text);
  const raw = parsed.rss?.channel?.item ?? parsed.feed?.entry;
  if (!raw) throw new Error("RSS 未返回条目");
  return (Array.isArray(raw) ? raw : [raw]).slice(0, 15).flatMap((item: any) => {
    const title = plain(item.title);
    const link = typeof item.link === "string" ? item.link : Array.isArray(item.link) ? item.link.find((v: any) => v["@_rel"] === "alternate")?.["@_href"] : item.link?.["@_href"];
    const url = safeUrl(link);
    const publishedAt = instant(item.pubDate ?? item.published ?? item.updated);
    if (!title || !url || !publishedAt || Date.parse(publishedAt) < Date.parse(observedAt) - 7 * 86_400_000) return [];
    return [{ id: signalId(source, url), source, title, summary: plain(item.description ?? item.summary).slice(0, 550), url, publishedAt, observedAt, rank: null, sourceDate: null, kind: "science" as const }];
  });
}

const FEEDS = [
  { id: "60s", name: "60s 每日新闻", url: "https://60s.viki.moe/v2/60s", format: "json", parse: parse60s },
  { id: "douyin", name: "抖音热榜", url: "https://60s.viki.moe/v2/douyin", format: "json", parse: (v: any, at: string) => parseTrends(v, "抖音热榜", at) },
  { id: "zhihu", name: "知乎热榜", url: "https://60s.viki.moe/v2/zhihu", format: "json", parse: (v: any, at: string) => parseTrends(v, "知乎热榜", at) },
  { id: "aihot", name: "AI HOT 精选", url: "https://aihot.news/api/v1/items?mode=selected&window=24h&limit=25", format: "json", parse: parseAIHot },
  { id: "nasa", name: "NASA", url: "https://www.nasa.gov/news-release/feed/", format: "rss", parse: (v: string, at: string) => parseRss(v, "NASA", at) },
  { id: "science", name: "ScienceDaily", url: "https://www.sciencedaily.com/rss/top/science.xml", format: "rss", parse: (v: string, at: string) => parseRss(v, "ScienceDaily", at) },
];

export async function collectSignals(): Promise<{ signals: Signal[]; statuses: SourceStatus[] }> {
  const observedAt = new Date().toISOString();
  const results = await Promise.all(FEEDS.map(async feed => {
    try {
      const response = await fetch(feed.url, { headers: { "User-Agent": "WorldSliceDaily/0.1 (+https://github.com/UltraDD/world-slice-daily)" }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`暂不可用（${response.status}）`);
      const value = feed.format === "rss" ? await response.text() : await response.json();
      const signals = feed.parse(value as never, observedAt);
      return { signals, status: { id: feed.id, name: feed.name, ok: true, count: signals.length, feedDate: signals[0]?.sourceDate ?? null, error: null, fetchedAt: observedAt } satisfies SourceStatus };
    } catch (error) {
      return { signals: [] as Signal[], status: { id: feed.id, name: feed.name, ok: false, count: 0, feedDate: null,
        error: error instanceof Error ? error.message.slice(0, 100) : "读取失败", fetchedAt: observedAt } satisfies SourceStatus };
    }
  }));
  return { signals: results.flatMap(v => v.signals), statuses: results.map(v => v.status) };
}
