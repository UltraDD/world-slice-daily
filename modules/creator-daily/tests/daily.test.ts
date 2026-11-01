import test from "node:test";
import assert from "node:assert/strict";
import { materializeIdeas } from "../backend/pipeline.ts";
import { ideaSchema, proposalSchema, type Proposal, type Signal } from "../contracts.ts";

const signal: Signal = { id: "evidence", source: "原始机构", title: "公开新闻", summary: "", url: "https://example.org/", publishedAt: null, observedAt: "2026-10-27T03:00:00Z", rank: null, sourceDate: null, kind: "news" };
const idea: Proposal["ideas"][number] = { signalIds: ["evidence"], bucket: "evergreen", title: "观众关心的具体问题", whyNow: "来自一条真实新闻", angle: "用动画解释这条新闻中的具体机制", hook: "你有没有想过这个问题", visuals: ["展示具体事实", "对比两种结果"], effort: "常规", window: "长期选题", verify: ["核实原始资料"] };
test("没有合适题可以交付零推荐，不凑三条", () => {
  assert.equal(proposalSchema.parse({ lead: "今天暂不追热点", ideas: [], watch: [] }).ideas.length, 0);
});
test("真实验收中的半句标题和半句切口不能发布", () => {
  assert.equal(ideaSchema.safeParse({ ...idea, title: "97人抢1个岗位：国考热背后的", angle: "替观众回答" }).success, false);
});
test("模型不能给不存在的来源生成公开选题", () => {
  assert.throws(() => materializeIdeas({ lead: "判断", ideas: [{ ...idea, signalIds: ["invented"] }], watch: [] }, [signal], "2026-10-27"), /不存在/);
});
test("同一信号不得占两张选题卡", () => {
  assert.throws(() => materializeIdeas({ lead: "判断", ideas: [idea, idea], watch: [] }, [signal], "2026-10-27"), /重复/);
});
test("公开卡片的来源URL由保存的证据决定", () => {
  const cards = materializeIdeas({ lead: "判断", ideas: [idea], watch: [] }, [signal], "2026-10-27");
  assert.equal(cards[0].sources[0].url, signal.url);
  assert.equal(cards[0].decision, "new");
});
