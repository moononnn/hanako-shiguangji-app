// 拾光记 · 峰谷提示过期机制
// 峰谷关照是「到点提醒」，不是长期指令。注入落进会话历史后会一直躺在那里，
// 之后每一轮模型都读到「本轮必须说出口」，于是把一次性提醒当成待办反复交差。
// 这里覆盖：历史里的过期改写、本轮刚注入的放行、无用户消息时不误伤。

import { test } from "node:test";
import assert from "node:assert/strict";
import { expireStalePeakNotices } from "../lib/inject-app.js";

const PEAK = "【模型峰谷关照】DeepSeek 现在在谷时段。这一轮回复里必须把当前时段说出口，一句话就够。";

function userMessage(text) {
  return { role: "user", content: [{ type: "text", text }] };
}
function assistantMessage(text) {
  return { role: "assistant", content: [{ type: "text", text }] };
}
function peakMessage(text = PEAK) {
  return { role: "custom", content: [{ type: "text", text }], timestamp: Date.now() };
}

test("过期改写：用户消息之前的历史峰谷注入改为不必再提", () => {
  const messages = [
    peakMessage(),
    assistantMessage("好，谷时段聊着便宜。"),
    userMessage("现在的进度怎么样"),
    assistantMessage("还在跑。"),
  ];
  const result = expireStalePeakNotices(messages);
  assert.ok(result, "有历史峰谷就该改写");
  const content = JSON.stringify(result.messages[0].content);
  assert.ok(content.includes("已过期"), "改成已过期");
  assert.ok(!content.includes("必须把当前时段说出口"), "旧指令必须消失");
  assert.ok(result.messages[0].details?.peakExpired === true, "打标记便于排查");
});

test("本轮刚注入的峰谷放行：排在最后一条用户消息之后的不动", () => {
  const messages = [
    userMessage("帮我看下这段"),
    peakMessage(),
    assistantMessage("正在处理。"),
  ];
  const result = expireStalePeakNotices(messages);
  assert.equal(result, undefined, "本轮注入不该被改");
});

test("没有用户消息时一律不动，宁可多念一次也不误删本轮的提醒", () => {
  assert.equal(expireStalePeakNotices([peakMessage()]), undefined);
  assert.equal(expireStalePeakNotices([]), undefined);
  assert.equal(expireStalePeakNotices(null), undefined);
  assert.equal(expireStalePeakNotices(undefined), undefined);
});

test("非峰谷的消息原样保留，不被误伤", () => {
  const messages = [
    { role: "custom", content: [{ type: "text", text: "【今日时光】2026年10月29日星期四 10:00" }] },
    userMessage("继续"),
  ];
  assert.equal(expireStalePeakNotices(messages), undefined, "今日时光不该被当成峰谷");
});

test("字符串形态的 content 也认（还没转成数组的注入）", () => {
  const messages = [
    { role: "custom", content: PEAK },
    userMessage("下一件事"),
  ];
  const result = expireStalePeakNotices(messages);
  assert.ok(result, "字符串形态要认出来");
  assert.equal(typeof result.messages[0].content, "string", "保持原形态");
  assert.ok(result.messages[0].content.includes("已过期"));
});

test("已经改写过的条目不再重复处理，结果稳定", () => {
  const once = expireStalePeakNotices([peakMessage(), userMessage("a")]);
  assert.ok(once);
  const twice = expireStalePeakNotices([...once.messages, userMessage("b")]);
  assert.equal(twice, undefined, "改写后第二次不该再变，避免每轮都返回新数组");
});

test("多条历史峰谷全部改写，只留最新一轮那条（若有）", () => {
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
  const texts = result.messages.map((m) => JSON.stringify(m.content || ""));
  assert.ok(texts[0].includes("已过期"), "第一条历史要收掉");
  assert.ok(texts[2].includes("已过期"), "第二条历史要收掉");
  assert.ok(texts[4].includes("刚注入的"), "本轮那条原样保留");
  assert.ok(texts[4].includes("本轮必须说出口"), "本轮那条的指令还在");
});

test("没有峰谷的普通会话返回 undefined，不产生额外开销", () => {
  const messages = [
    userMessage("随便聊聊"),
    assistantMessage("好呀。"),
    userMessage("今天天气不错"),
  ];
  assert.equal(expireStalePeakNotices(messages), undefined);
});
