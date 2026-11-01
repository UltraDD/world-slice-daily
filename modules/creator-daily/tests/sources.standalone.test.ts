import test from "node:test";
import assert from "node:assert/strict";
import { beijingDate, parse60s, parseAIHot, parseTrends, safeUrl } from "../backend/sources.ts";

test("北京时间跨日独立于执行机器时区", () => {
  assert.equal(beijingDate(new Date("2026-10-26T16:30:00Z")), "2026-10-27");
});
test("60s按来源日期保存，不冒充观察日新闻", () => {
  const rows = parse60s({ code: 200, data: { date: "2026-10-26", news: ["一条需要核实的新闻"], link: "https://example.org/news" } }, "2026-10-27T03:00:00Z");
  assert.equal(rows[0].sourceDate, "2026-10-26");
  assert.equal(rows[0].publishedAt, "2026-10-25T16:00:00.000Z");
  assert.equal(rows[0].url, "https://example.org/news");
});
test("AIHOT v1真实契约从links.original提取可追溯来源", () => {
  const rows = parseAIHot({ items: [{ id: "a", title: "研究发现", source: { name: "研究机构" }, links: { original: "https://example.org/paper", aihot: "https://aihot.news/items/a" }, summary: "摘要" }] }, "2026-10-27T03:00:00Z");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, "https://example.org/paper");
  assert.equal(rows[0].source, "AI HOT · 研究机构");
});
test("热榜首次观察不虚构发布时间或上升速度", () => {
  const rows = parseTrends({ code: 200, data: [{ title: "具体话题", link: "https://example.org/trend", hot_value: 100 }] }, "测试热榜", "2026-10-27T03:00:00Z");
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[0].publishedAt, null);
});
test("外链拒绝脚本和含凭据URL", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("https://user:password@example.org/"), null);
});
