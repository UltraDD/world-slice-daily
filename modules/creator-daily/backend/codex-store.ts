import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ideaSchema } from "../contracts.ts";
import { beijingDate, collectSignals, safeUrl, signalId } from "./sources.ts";

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "日期无效");
const urlSchema = z.string().refine(value => safeUrl(value) !== null, "来源网址无效");
const decisionSchema = z.enum(["new", "saved", "dismissed"]);
const signalSchema = z.object({
  id: z.string(), source: z.string(), title: z.string(), summary: z.string(), url: urlSchema,
  publishedAt: z.string().nullable(), observedAt: z.string(), rank: z.number().nullable(),
  sourceDate: z.string().nullable(), kind: z.enum(["news", "trend", "science", "ai"]),
});
const sourceSchema = z.object({
  id: z.string(), name: z.string(), ok: z.boolean(), count: z.number(), feedDate: z.string().nullable(),
  error: z.string().nullable(), fetchedAt: z.string(),
});
const evidenceSchema = z.object({ title: z.string().min(2), url: urlSchema, fact: z.string().min(5) });
const storedIdeaSchema = ideaSchema.extend({
  id: z.string().regex(/^[a-f0-9]{24}$/), date: daySchema, sources: z.array(signalSchema),
  decision: decisionSchema, evidence: z.array(evidenceSchema).default([]), updateReason: z.string().default(""),
});
const editionSchema = z.object({
  date: daySchema, generatedAt: z.string(), lead: z.string(), ideas: z.array(storedIdeaSchema),
  watch: z.array(z.object({ signal: signalSchema, reason: z.string() })),
  sources: z.array(sourceSchema), model: z.string(),
});
const feedbackSchema = z.object({
  id: z.string(), decision: decisionSchema, payload: storedIdeaSchema,
  reason: z.string().default(""), updatedAt: z.string(),
});
const stateSchema = z.object({
  version: z.literal(1), editions: z.array(editionSchema), decisions: z.array(feedbackSchema),
});
const packetSchema = z.object({ date: daySchema, fetchedAt: z.string(), signals: z.array(signalSchema), sources: z.array(sourceSchema) });
export const codexProposalSchema = z.object({
  date: daySchema, lead: z.string().min(1).max(300),
  ideas: z.array(ideaSchema.extend({
    evidence: z.array(evidenceSchema).min(1).max(4), updateReason: z.string().default(""),
  })).max(3),
  watch: z.array(z.object({ signalId: z.string(), reason: z.string().min(3).max(160) })).max(3).default([]),
});
type State = z.infer<typeof stateSchema>;
type Edition = z.infer<typeof editionSchema>;

export async function writeJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.pending`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally { await rm(temporary, { force: true }); }
}

export async function loadState(root: string): Promise<State> {
  try { return stateSchema.parse(JSON.parse(await readFile(join(root, "state.json"), "utf8"))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, editions: [], decisions: [] };
    throw error;
  }
}

export async function collectForCodex(root: string, force = false) {
  await mkdir(root, { recursive: true });
  const date = beijingDate();
  const path = join(root, `signals-${date}.json`);
  if (!force) {
    try {
      const packet = packetSchema.parse(JSON.parse(await readFile(path, "utf8")));
      if (packet.date === date && packet.signals.length) return { ...packet, path, cached: true };
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const collected = await collectSignals();
  const packet = packetSchema.parse({ date, fetchedAt: new Date().toISOString(), signals: collected.signals, sources: collected.statuses });
  await writeJson(path, packet);
  if (!packet.signals.length) throw new Error(`六路信源均未取得线索，未生成日报；详情见 ${path}`);
  return { ...packet, path, cached: false };
}

export async function supplementForCodex(root: string, input: unknown) {
  const incoming = z.array(signalSchema.omit({ id: true, observedAt: true, rank: true }).extend({
    source: z.string().min(2).max(100), title: z.string().min(5).max(200),
    summary: z.string().max(1200), sourceDate: daySchema.nullable(),
    publishedAt: z.string().datetime({ offset: true }).nullable(),
  })).min(1).max(10).parse(input);
  const date = beijingDate();
  const path = join(root, `signals-${date}.json`);
  const packet = packetSchema.parse(JSON.parse(await readFile(path, "utf8")));
  if (packet.date !== date) throw new Error("只能补充北京时间当天的线索包");
  const now = new Date().toISOString();
  const added: z.infer<typeof signalSchema>[] = [];
  for (const item of incoming) {
    if ((item.sourceDate && item.sourceDate > date) || (item.publishedAt && Date.parse(item.publishedAt) > Date.now() + 300_000)) throw new Error("补充线索的发布日期不能来自未来");
    if (packet.signals.some(signal => signal.url === item.url)) continue;
    const signal = { ...item, id: signalId("supplement", item.url), observedAt: now, rank: null };
    packet.signals.push(signal);
    added.push(signal);
  }
  if (added.length) {
    const count = (packet.sources.find(source => source.id === "supplement")?.count ?? 0) + added.length;
    packet.sources = [...packet.sources.filter(source => source.id !== "supplement"), {
      id: "supplement", name: "原生搜索补充", ok: true, count, feedDate: null, error: null, fetchedAt: now,
    }];
    await writeJson(path, packet);
  }
  const matches = packet.signals.filter(signal => incoming.some(item => item.url === signal.url));
  return { path, added: added.map(({ id, title, url }) => ({ id, title, url })),
    matches: matches.map(({ id, title, url }) => ({ id, title, url })), count: packet.signals.length };
}

export function renderEdition(edition: Edition): string {
  const lines = [`# 世界切片 · ${edition.date} 选题日报`, "", edition.lead];
  edition.ideas.forEach((idea, index) => {
    lines.push("", `## ${index === 0 ? "主推" : `备选 ${index}`}：${idea.title}`, "",
      `**为什么值得拍**：${idea.whyNow}`, "", `**切口**：${idea.angle}`, "",
      `**开场**：${idea.hook}`, "", `**画面**：${idea.visuals.join("；")}`, "",
      `**制作**：${idea.effort}；${idea.window}`);
    if (idea.updateReason) lines.push("", `**与上次相比**：${idea.updateReason}`);
    if (idea.evidence.length) lines.push("", ...idea.evidence.map(item => `- ${item.fact} [${item.title}](${item.url})`));
    else lines.push("", ...idea.sources.map(item => `- [${item.source} · ${item.title}](${item.url})`));
    if (idea.verify.length) lines.push("", `**开拍前补齐**：${idea.verify.join("；")}`);
  });
  if (edition.watch.length) lines.push("", "暂缓：", "", ...edition.watch.map(item => `- ${item.signal.title}：${item.reason}`));
  const failures = edition.sources.filter(source => !source.ok);
  if (failures.length) lines.push("", `今日未取到：${failures.map(source => source.name).join("、")}。`);
  return lines.join("\n") + "\n";
}

export async function publishForCodex(root: string, input: unknown, force = false) {
  const proposal = codexProposalSchema.parse(input);
  if (proposal.date !== beijingDate()) throw new Error("只能发布北京时间当天日报");
  const state = await loadState(root);
  if (!force && state.editions.some(edition => edition.date === proposal.date)) throw new Error("当天日报已保存；重新编辑需显式使用 --force");
  const packet = packetSchema.parse(JSON.parse(await readFile(join(root, `signals-${proposal.date}.json`), "utf8")));
  if (packet.date !== proposal.date) throw new Error("线索日期与日报不一致");
  const signals = new Map(packet.signals.map(signal => [signal.id, signal]));
  const used = new Set<string>();
  const ideas = proposal.ideas.map(idea => {
    if (idea.signalIds.some(id => !signals.has(id))) throw new Error("选题引用了本次采集中不存在的线索");
    if (new Set(idea.signalIds).size !== idea.signalIds.length || idea.signalIds.some(id => used.has(id))) throw new Error("同一线索被重复推荐");
    idea.signalIds.forEach(id => used.add(id));
    const id = signalId("idea", [...idea.signalIds].sort().join(":"));
    const recent = state.editions.filter(edition => edition.date < proposal.date && Date.parse(proposal.date) - Date.parse(edition.date) < 14 * 86_400_000);
    const feedback = state.decisions.find(item => item.id === id);
    if ((feedback?.decision === "dismissed" || feedback?.decision === "saved" || recent.some(edition => edition.ideas.some(item => item.id === id))) && !idea.updateReason.trim()) {
      throw new Error(`重复选题须说明具体新增进展：${idea.title}`);
    }
    return { ...idea, id, date: proposal.date, sources: idea.signalIds.map(key => signals.get(key)!), decision: feedback?.decision ?? "new" as const };
  });
  const watch = proposal.watch.map(item => {
    const signal = signals.get(item.signalId);
    if (!signal) throw new Error("暂缓项引用了不存在的线索");
    return { signal, reason: item.reason };
  });
  const edition = editionSchema.parse({ ...proposal, ideas, watch, sources: packet.sources, generatedAt: new Date().toISOString(), model: "Codex native" });
  state.editions = [...state.editions.filter(item => item.date !== edition.date), edition].sort((a, b) => a.date.localeCompare(b.date));
  await writeJson(join(root, "state.json"), state);
  await writeFile(join(root, `${edition.date}.md`), renderEdition(edition), "utf8");
  return { date: edition.date, ideas: ideas.map(({ id, title }) => ({ id, title })), report: join(root, `${edition.date}.md`) };
}

export async function decideForCodex(root: string, id: string, decision: string, reason = "") {
  const parsedDecision = decisionSchema.parse(decision);
  const state = await loadState(root);
  const payload = state.editions.flatMap(edition => edition.ideas).find(idea => idea.id === id)
    ?? state.decisions.find(item => item.id === id)?.payload;
  if (!payload) throw new Error("找不到该选题，未写入反馈");
  state.decisions = [...state.decisions.filter(item => item.id !== id), { id, decision: parsedDecision, payload, reason, updatedAt: new Date().toISOString() }];
  await writeJson(join(root, "state.json"), state);
  return { id, title: payload.title, decision: parsedDecision, reason };
}

export async function importLegacy(root: string, input: unknown) {
  const legacy = z.object({ editions: z.array(editionSchema), decisions: z.array(feedbackSchema) }).parse(input);
  const state = await loadState(root);
  for (const edition of legacy.editions) if (!state.editions.some(item => item.date === edition.date)) state.editions.push(edition);
  for (const decision of legacy.decisions) if (!state.decisions.some(item => item.id === decision.id)) state.decisions.push(decision);
  state.editions.sort((a, b) => a.date.localeCompare(b.date));
  await mkdir(root, { recursive: true });
  await writeJson(join(root, "state.json"), state);
  return { editions: state.editions.length, decisions: state.decisions.length };
}
