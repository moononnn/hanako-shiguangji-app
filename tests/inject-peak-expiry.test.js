// 拾光记 · 峰谷提示过期机制
// 峰谷关照是「到点提醒」，不是长期指令。注入落进会话历史后会一直躺在那里，
// 之后每一轮模型都读到「本轮必须说出口」，于是把一次性提醒当成待办反复交差。
// 这里覆盖：历史里的过期拆段、本轮刚注入的放行、无用户消息时不误伤、其它块原样保留。

import { test } from "node:test";
import assert from "node:assert/strict";
import { expireStalePeakNotices, stripPeakSection } from "../lib/inject-app.js";

const PEAK_LINE =
  "【模型峰谷关照】DeepSeek 现在在谷时段。这一轮回复里必须把当前时段说出口，一句话就够。";
const PEAK_ENDING =
  "以上为今日时光背景；本轮的模型峰谷关照要在本轮回复里带出一句（开场时段和换班补报都只这一次，换了就过去了）；其余今日时光背景按需融入，不要逐条播报。";

function userMessage(text) {
  return { role: "user", content: [{ type: "text", text }] };
}
function assistantMessage(text) {
  return { role: "assistant", content: [{ type: "text", text }] };
}
function peakMessage(text = PEAK_LINE) {
  return { role: "custom", content: [{ type: "text", text }], timestamp: Date.now() };
}

// ── stripPeakSection ─────────────────────────────────────

test("拆段：峰谷那一行整行拿走，不留任何回填", () => {
  const out = stripPeakSection(PEAK_LINE);
  assert.equal(out, "", "只剩峰谷的消息拆完是空串，由调用方整条丢掉");
});

test("拆段：结尾那句峰谷收口一起拿走，不留半句孤零零的命令", () => {
  const out = stripPeakSection(PEAK_ENDING);
  assert.ok(!out.includes("模型峰谷关照"), "收口句必须消失");
  assert.ok(!out.includes("必须"), "不留命令残句");
  assert.ok(out.includes("其余今日时光背景按需融入"), "同一行里别的交代要留下");
});

test("拆段：今日时光、历史档案、事实边界等其它块一个字不动", () => {
  const text = [
    "【今日时光】2026年10月29日星期四 20:27",
    PEAK_LINE,
    "【历史档案｜生活日 2026-10-28】",
    "2026-10-28：某件往事。",
    "以上是这次带给你的今日背景，到这段材料为止。",
  ].join("\n");
  const out = stripPeakSection(text);
  assert.ok(!out.includes("模型峰谷关照"));
  assert.ok(out.includes("【今日时光】2026年10月29日星期四 20:27"), "时间行要在");
  assert.ok(out.includes("【历史档案｜生活日 2026-10-28】"), "历史档案要在");
  assert.ok(out.includes("某件往事"), "档案正文要在");
  assert.ok(out.includes("到这段材料为止"), "事实边界要在");
});

test("拆段：没有峰谷的文本原样返回", () => {
  const text = "【今日时光】2026年10月29日星期四 20:27\n以上是背景。";
  assert.equal(stripPeakSection(text), text);
});

// ── expireStalePeakNotices ───────────────────────────────

test("过期：用户消息之前的历史峰谷整条拆掉", () => {
  const messages = [
    peakMessage(),
    assistantMessage("好，谷时段聊着便宜。"),
    userMessage("现在的进度怎么样"),
    assistantMessage("还在跑。"),
  ];
  const result = expireStalePeakNotices(messages);
  assert.ok(result, "有历史峰谷就该处理");
  assert.equal(result.messages.length, 3, "只剩峰谷的那条整条丢掉，不留空壳");
  assert.ok(
    result.messages.every((m) => !JSON.stringify(m.content || "").includes("模型峰谷关照")),
    "上下文里不该再有峰谷那段指令"
  );
});

test("过期：带其它块的峰谷注入只拆峰谷，消息本身留着", () => {
  const mixed = `【今日时光】2026年10月29日星期四 20:27\n${PEAK_LINE}\n【历史档案】某件往事。`;
  const messages = [peakMessage(mixed), userMessage("继续")];
  const result = expireStalePeakNotices(messages);
  assert.ok(result);
  assert.equal(result.messages.length, 2, "消息本身不能丢，档案还在里面");
  const text = JSON.stringify(result.messages[0].content);
  assert.ok(!text.includes("模型峰谷关照"), "峰谷拆掉");
  assert.ok(text.includes("某件往事"), "档案留下");
});

test("本轮刚注入的峰谷放行：排在最后一条用户消息之后的不动", () => {
  const messages = [
    userMessage("帮我看下这段"),
    peakMessage(),
    assistantMessage("正在处理。"),
  ];
  assert.equal(expireStalePeakNotices(messages), undefined, "本轮注入不该被改");
});

test("没有用户消息时一律不动，宁可多念一次也不误删本轮的提醒", () => {
  assert.equal(expireStalePeakNotices([peakMessage()]), undefined);
  assert.equal(expireStalePeakNotices([]), undefined);
  assert.equal(expireStalePeakNotices(null), undefined);
  assert.equal(expireStalePeakNotices(undefined), undefined);
});

test("字符串形态的 content 也认（还没转成数组的注入）", () => {
  const messages = [{ role: "custom", content: PEAK_LINE }, userMessage("下一件事")];
  const result = expireStalePeakNotices(messages);
  assert.ok(result);
  assert.ok(!JSON.stringify(result.messages).includes("模型峰谷关照"));
});

test("多条历史峰谷全部处理，本轮那条原样保留", () => {
  const messages = [
    peakMessage("【模型峰谷关照】第一次：谷时段。本轮必须说出口。"),
    userMessage("讨论一"),
    peakMessage("【模型峰谷关照】第二次：高峰时段。本轮必须说出口。"),
    userMessage("讨论二"),
    peakMessage("【模型峰谷关照】第三次：刚注入的。本轮必须说出口。"),
    assistantMessage("好的。"),
  ];
  const result = expireStalePeakNotices(messages);
  assert.ok(result);
  assert.equal(result.messages.length, 4, "前两条只剩峰谷，整条丢掉；后两条与最后一条开口留着");
  const last = JSON.stringify(result.messages[2].content);
  assert.ok(last.includes("刚注入的"), "本轮那条原样保留");
});

test("没有峰谷的普通会话返回 undefined，不产生额外开销", () => {
  const messages = [
    userMessage("随便聊聊"),
    assistantMessage("好呀。"),
    userMessage("今天天气不错"),
  ];
  assert.equal(expireStalePeakNotices(messages), undefined);
});
