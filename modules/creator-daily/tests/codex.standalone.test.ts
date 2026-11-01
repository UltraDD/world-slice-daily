import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { beijingDate, signalId } from "../backend/sources.ts";
import { collectForCodex, decideForCodex, importLegacy, loadState, publishForCodex, supplementForCodex, writeJson } from "../backend/codex-store.ts";

const temporaryRoot = fileURLToPath(new URL("../../../../../_tmp/", import.meta.url));
const date = beijingDate();
const signal = { id: "source-one", source: "NASA", title: "一条用于测试的科学线索", summary: "", url: "https://www.nasa.gov/",
  publishedAt: null, observedAt: new Date().toISOString(), rank: null, sourceDate: null, kind: "science" };
const idea = { signalIds: [signal.id], bucket: "today", title: "火星的红色究竟来自哪里？", whyNow: "新研究给出了具体解释。",
  angle: "通过尘埃中的矿物解释火星为什么呈现红色。", hook: "火星为什么会是红色的？", visuals: ["火星表面的全景", "矿物颗粒的放大示意"],
  effort: "轻量", window: "本周制作", verify: [], evidence: [{ title: "NASA", url: "https://www.nasa.gov/", fact: "这是一条测试证据，不用于真实日报。" }] };
const proposal = () => ({ date, lead: "今天主推一个能够直接用画面解释的问题。", ideas: [structuredClone(idea)], watch: [] });
async function fixture(t: test.TestContext) {
  const root = await mkdtemp(join(temporaryRoot, "world-slice-codex-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeJson(join(root, `signals-${date}.json`), { date, fetchedAt: new Date().toISOString(), signals: [signal], sources: [] });
  return root;
}

test("数据库与模型环境不可用时仍能读取自动化上下文", () => {
  const script = fileURLToPath(new URL("../scripts/codex.ts", import.meta.url));
  const child = spawnSync(process.execPath, [script, "context"], { encoding: "utf8",
    env: { ...process.env, DATABASE_URL: "invalid-database", LLM_BASE_URL: "invalid-model", LLM_API_KEY: "" } });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).date, date);
});

test("保存日报、保留证据并记录待拍与跳过原因", async t => {
  const root = await fixture(t);
  const published = await publishForCodex(root, proposal());
  assert.equal(published.ideas.length, 1);
  const report = await readFile(published.report, "utf8");
  assert.match(report, /主推：火星/);
  assert.match(report, /https:\/\/www.nasa.gov\//);
  const id = published.ideas[0].id;
  await decideForCodex(root, id, "saved", "适合做矿物动画");
  assert.equal((await loadState(root)).decisions[0].reason, "适合做矿物动画");
  await assert.rejects(publishForCodex(root, proposal()), /当天日报已保存/);
  await decideForCodex(root, id, "dismissed", "这题暂时不想做");
  await assert.rejects(publishForCodex(root, proposal(), true), /重复选题须说明/);
});

test("当天缓存直接复用并保留独立的信源状态", async t => {
  const root = await fixture(t);
  const source = { id: "nasa", name: "NASA", ok: true, count: 1, feedDate: null, error: null, fetchedAt: new Date().toISOString() };
  await writeJson(join(root, `signals-${date}.json`), { date, fetchedAt: source.fetchedAt, signals: [signal], sources: [source] });
  const cached = await collectForCodex(root);
  assert.equal(cached.cached, true);
  assert.deepEqual(cached.sources, [source]);
  assert.equal(cached.signals.length, 1);
});

test("不存在的来源、同一线索重复入选和无证据稿都拒绝发布", async t => {
  const root = await fixture(t);
  const unknown = proposal();
  unknown.ideas[0].signalIds = ["made-up"];
  await assert.rejects(publishForCodex(root, unknown), /不存在的线索/);
  const duplicate = proposal(); duplicate.ideas.push(structuredClone(idea));
  await assert.rejects(publishForCodex(root, duplicate), /重复推荐/);
  const unsupported = proposal(); unsupported.ideas[0].evidence = [];
  await assert.rejects(publishForCodex(root, unsupported));
  assert.equal((await loadState(root)).editions.length, 0);
});

test("固定源漏掉的原文可补入并引用，保留原始日期和现有线索，重复导入不增条", async t => {
  const root = await fixture(t);
  const original = { source: "Apple Newsroom", title: "iPad mini 的 Acoustic Display 发声设计",
    summary: "输入是一手来源的线索摘要。", url: "https://www.apple.com.cn/newsroom/2026/10/apple-gives-ipad-mini-its-biggest-update-ever/",
    publishedAt: null, sourceDate: "2026-10-26", kind: "news" };
  const supplement = await supplementForCodex(root, [original]);
  assert.equal(supplement.added.length, 1);
  assert.equal(supplement.count, 2);
  const packet = JSON.parse(await readFile(supplement.path, "utf8"));
  assert.deepEqual(packet.signals[0], signal);
  assert.equal(packet.signals[1].sourceDate, "2026-10-26");
  assert.equal(packet.signals[1].publishedAt, null);
  assert.equal(beijingDate(new Date(packet.signals[1].observedAt)), date);
  const repeated = await supplementForCodex(root, [original]);
  assert.equal(repeated.added.length, 0);
  assert.equal(repeated.matches[0].id, supplement.added[0].id);
  assert.equal((await collectForCodex(root)).signals.length, 2);
  const supplementedProposal = proposal();
  supplementedProposal.ideas[0].signalIds = [supplement.added[0].id];
  const published = await publishForCodex(root, supplementedProposal);
  assert.equal(published.ideas.length, 1);
});

test("补充线索拒绝危险网址与未来发布日期，失败保留原包", async t => {
  const root = await fixture(t);
  const before = await readFile(join(root, `signals-${date}.json`), "utf8");
  const { id: _id, observedAt: _observedAt, rank: _rank, ...incoming } = signal;
  await assert.rejects(supplementForCodex(root, [{ ...incoming, url: "javascript:alert(1)" }]));
  await assert.rejects(supplementForCodex(root, [{ ...incoming, sourceDate: "2099-01-01" }]), /未来/);
  assert.equal(await readFile(join(root, `signals-${date}.json`), "utf8"), before);
});

test("旧数据重复导入不覆盖已更新反馈；旧模型稿保留可读", async t => {
  const root = await fixture(t);
  const id = signalId("idea", signal.id);
  const legacyIdea = { ...idea, id, date, sources: [signal], decision: "saved" };
  const legacy = { editions: [{ date, generatedAt: new Date().toISOString(), lead: "旧日报", ideas: [legacyIdea], watch: [], sources: [], model: "old-model" }],
    decisions: [{ id, decision: "saved", payload: legacyIdea, updatedAt: new Date().toISOString() }] };
  await importLegacy(root, legacy);
  await decideForCodex(root, id, "dismissed", "动动后来跳过了这题");
  await importLegacy(root, legacy);
  const state = await loadState(root);
  assert.equal(state.editions.length, 1);
  assert.equal(state.decisions.length, 1);
  assert.equal(state.decisions[0].decision, "dismissed");
  assert.equal(state.decisions[0].reason, "动动后来跳过了这题");
});

test("没有合适选题可发布零题；损坏的历史不会被静默清空", async t => {
  const root = await fixture(t);
  await publishForCodex(root, { date, lead: "今天没有达到制作门槛的选题。", ideas: [] });
  assert.equal((await loadState(root)).editions[0].ideas.length, 0);
  await writeFile(join(root, "state.json"), "broken-history", "utf8");
  await assert.rejects(loadState(root));
  await assert.rejects(publishForCodex(root, proposal(), true));
  assert.equal(await readFile(join(root, "state.json"), "utf8"), "broken-history");
});
