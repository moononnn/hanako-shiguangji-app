// 拾光记 · 会话身份自检 + 峰谷提醒的模型一致性
//
// 2026-10-29 实机：minimax 的 Code 窗口里收到一段「咱们这会儿正用着 DeepSeek」的峰谷关照，
// 那段是按另一个会话的身份算出来的，模型顺着它说「现在正是谷时段，挺划算」。
// 这里覆盖两道闸：
//   一道在查分区时（session:get 回的不是所问的会话，当没查到）；
//   一道在请求模型前（这段对话自己跑的不是 DeepSeek 系模型，峰谷提醒整段拿掉）。

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionMetaResolver, extractSessionUuid, sessionMatchesRequest } from "../lib/session-kind.js";
import { conversationRunsDeepSeek, stripPeakForForeignModel } from "../lib/inject-app.js";

const UUID_A = "01a187b8-9987-7e12-9199-ab96f57c9b3b";
const UUID_B = "01a18a0f-6bab-711a-94a9-4a0a6e5e274c";
const FILE_A = `D:/appdata/.hanako/agents/hanako/sessions/2026-10-29T12-53-04-519Z_${UUID_A}.jsonl`;
const FILE_B = `D:/appdata/.hanako/agents/hanako/sessions/2026-10-29T23-47-08-843Z_${UUID_B}.jsonl`;

const PEAK_LINE =
  "【模型峰谷关照】DeepSeek 现在在谷时段。这一轮回复里必须把当前时段说出口，一句话就够。";

// ── 身份核对 ─────────────────────────────────────────────

test("核对：id 与路径里的 UUID 抠得出来且一致", () => {
  assert.equal(extractSessionUuid(UUID_A), UUID_A);
  assert.equal(extractSessionUuid(FILE_A), UUID_A);
  assert.equal(extractSessionUuid("sess_0mvtjndj7_7a0141fadc2ee9e02383"), "");
  assert.equal(extractSessionUuid(""), "");
});

test("核对：问 A 回 B，判为不是同一个会话", () => {
  assert.equal(sessionMatchesRequest({ askedId: UUID_A, gotId: UUID_B }), false);
  assert.equal(sessionMatchesRequest({ askedFile: FILE_A, gotPath: FILE_B }), false);
});

test("核对：同一会话判为对得上", () => {
  assert.equal(sessionMatchesRequest({ askedId: UUID_A, gotId: UUID_A }), true);
  assert.equal(sessionMatchesRequest({ askedFile: FILE_A, gotPath: FILE_A }), true);
});

test("核对：形态不同没法比，不算错", () => {
  // 宿主回给的是 sess_xxx，问的是 UUID 形态：无从判断，不误伤。
  assert.equal(sessionMatchesRequest({ askedId: UUID_A, gotId: "sess_0mvtjndj7_7a0141fadc2ee9e02383" }), true);
  // 回答里没带路径，比不了，不误伤。
  assert.equal(sessionMatchesRequest({ askedFile: FILE_A, gotPath: "" }), true);
});

// ── 分区查询：回的不是所问的会话就当没查到 ───────────────

test("分区：按路径查回的是别的会话时，判不出分区，不进正缓存", async () => {
  let calls = 0;
  const resolve = createSessionMetaResolver({
    negativeTtlMs: 0,
    bus: { async request(_event, payload) {
      calls += 1;
      if (payload.legacySessionPath) return { session: { namespace: "home", path: FILE_B } };
      return { session: { namespace: "home", sessionId: UUID_B } };
    } },
  });
  assert.equal((await resolve({ sessionId: UUID_A, sessionPath: FILE_A })).namespace, "");
  assert.equal(calls, 2, "两种参数各试一次，都对不上就判不出");
});

test("分区：回的就是所问的会话，正常判出分区", async () => {
  const resolve = createSessionMetaResolver({
    bus: { async request(_event, payload) {
      if (payload.legacySessionPath) return { session: { namespace: "code", path: FILE_A } };
      return { session: { namespace: "code", sessionId: UUID_A } };
    } },
  });
  assert.equal((await resolve({ sessionId: UUID_A, sessionPath: FILE_A })).namespace, "code");
});

// ── 峰谷提醒的模型一致性 ─────────────────────────────────

function userMessage(text) {
  return { role: "user", content: [{ type: "text", text }] };
}
function assistantMessage(text, provider, model) {
  return { role: "assistant", content: [{ type: "text", text }], provider, model };
}
function peakMessage(text = PEAK_LINE) {
  return { role: "custom", content: [{ type: "text", text }], timestamp: Date.now() };
}

test("模型：认得出这段对话跑的是什么模型", () => {
  assert.equal(conversationRunsDeepSeek([
    assistantMessage("好", "magpie", "workbuddy/deepseek-v4.1-flash"),
  ]), true);
  assert.equal(conversationRunsDeepSeek([
    assistantMessage("好", "minimax", "MiniMax-M3.1-Flash-Preview"),
  ]), false);
  assert.equal(conversationRunsDeepSeek([userMessage("在吗")]), null, "还没开过口就认不出");
});

test("峰谷：这段对话跑的不是 DeepSeek 系模型，峰谷段整段拆掉", () => {
  const messages = [
    assistantMessage("在的。", "minimax", "MiniMax-M3.1-Flash-Preview"),
    userMessage("帮我看下这段"),
    peakMessage(),
  ];
  const result = stripPeakForForeignModel(messages);
  assert.ok(result, "串进来的峰谷段要处理");
  assert.equal(result.messages.length, 2, "只剩峰谷的那条整条丢掉");
  assert.ok(
    !JSON.stringify(result.messages).includes("模型峰谷关照"),
    "上下文里不该再有「正用着 DeepSeek」这类断言"
  );
});

test("峰谷：这段对话本来就是 DeepSeek 系模型，峰谷段原样保留", () => {
  const messages = [
    assistantMessage("在的。", "magpie", "workbuddy/deepseek-v4.1-flash"),
    userMessage("帮我看下这段"),
    peakMessage(),
  ];
  assert.equal(stripPeakForForeignModel(messages), undefined, "本就该有的提醒不能误伤");
});

test("峰谷：认不出模型时不动，宁可多念一次也不误删本轮的提醒", () => {
  assert.equal(stripPeakForForeignModel([userMessage("在吗"), peakMessage()]), undefined);
  assert.equal(stripPeakForForeignModel([]), undefined);
  assert.equal(stripPeakForForeignModel(null), undefined);
});

test("峰谷：带其它块的注入只拆峰谷，今日时光与档案留下", () => {
  const mixed = `【今日时光】2026年10月29日星期四 20:27\n${PEAK_LINE}\n【历史档案】某件往事。`;
  const messages = [
    assistantMessage("在的。", "minimax", "MiniMax-M3.1-Flash-Preview"),
    userMessage("继续"),
    peakMessage(mixed),
  ];
  const result = stripPeakForForeignModel(messages);
  assert.ok(result);
  assert.equal(result.messages.length, 3, "消息本身不能丢");
  const text = JSON.stringify(result.messages[2].content);
  assert.ok(!text.includes("模型峰谷关照"), "峰谷拆掉");
  assert.ok(text.includes("某件往事"), "档案留下");
});
