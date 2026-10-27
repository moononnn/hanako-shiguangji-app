import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInjectionText } from "../lib/inject.js";
import { formatRecentSummaries } from "../lib/recent-summaries.js";

process.env.TZ = "Asia/Shanghai";
const now = new Date(2026, 9, 12, 7, 22);
const history = { date: "2026-10-11", agentId: "partner-one", text: "一起整理了日历" };
const recent = { date: "2026-10-10", agentId: "partner-one", text: "聊了窗外的小雨" };
const options = { currentAgentId: "partner-one", proactiveDate: history.date, userName: "小满" };
const count = (text, fragment) => text.split(fragment).length - 1;
// 事实边界只划「这一段材料」，不能自称关于今天的全部材料：那样会连带否认当前对话与工具查过的东西。
const FACT_BOUNDARY = "以上是这次带给你的今日背景，到这段材料为止";

for (const [name, input] of [
  ["历史档案", { recentSummaries: [history], recentSummaryOptions: options }],
  ["历史档案和近期回忆", { recentSummaries: [history, recent], recentSummaryOptions: options }],
  ["旧总结调用方", { summary: { date: history.date, text: history.text } }],
  ["旧总结和近期历史共同存在", { summary: { date: history.date, text: "旧记录" }, recentSummaries: [history, recent], recentSummaryOptions: options }],
]) {
  test(`注入规则去重：${name}只带一份日期与档案边界`, () => {
    const text = buildInjectionText({ now, force: true, ...input });
    assert.equal(count(text, "【日期硬约束适用于所有可见回复和 MOOD】"), 1);
    assert.equal(count(text, "档案只包含正文明确写出的事实"), 1);
    assert.equal(count(text, "不要凭窗口顺序使用“昨天”"), 1);
    assert.equal(count(text, "今天第一次回应"), 1);
    assert.equal(count(text, FACT_BOUNDARY), 1);
    assert.ok(text.includes(history.text) || text.includes("旧记录"));
    assert.ok(text.includes("自然日期：2026-10-12；当前时刻：07:22"));
    assert.ok(text.includes("档案正文里的“今天/昨天”等原话不能改写当前对话的日期"));
    assert.ok(text.includes(`也不能归入生活日 ${history.date}`));
    assert.ok(text.includes("日期拿不准就用绝对日期或“今天早些时候/前一个对话框”，不要猜"));
  });
}

test("近期总结格式化只输出档案素材，行为规则由完整注入统一提供", () => {
  const text = formatRecentSummaries([history, recent], options);
  assert.ok(text.includes(`【历史档案｜生活日 ${history.date}】\n${history.date}：${history.text}`));
  assert.ok(text.includes(`【近期回忆】\n${recent.date}：${recent.text}`));
  assert.ok(!text.includes("日期硬约束"));
  assert.ok(!text.includes("今天第一次回应"));
});

test("近期回忆与无历史分支保留素材和事实边界，不凭空添加历史问候", () => {
  const text = buildInjectionText({ now, recentSummaries: [recent], recentSummaryOptions: options, force: true });
  assert.ok(text.includes(`【近期回忆】\n${recent.date}：${recent.text}`));
  assert.ok(!text.includes("【历史档案"));
  assert.ok(!text.includes("今天第一次回应"));
  assert.equal(count(text, FACT_BOUNDARY), 1);
  const empty = buildInjectionText({ now, force: true });
  assert.ok(empty.includes("【今日时光】2026年10月12日星期一 07:22"));
  assert.ok(!empty.includes("历史档案"));
  assert.equal(count(empty, FACT_BOUNDARY), 1);
  assert.equal(buildInjectionText({ now }), null);
});

test("事实边界只到这段材料为止，不否认当前对话与工具查过的结果", () => {
  const text = buildInjectionText({ now, force: true, recentSummaryOptions: options });
  assert.ok(!text.includes("全部材料"), "不能自称关于今天的全部材料");
  assert.match(text, /当前对话里小满刚说过的事/);
  assert.match(text, /工具验证过的结果都算数/);
  assert.match(text, /不能拿这段材料去否认它们/);
  assert.match(text, /不要顺着猜/, "防编造的底线不能拆");
});
