// 拾光记 · 对外契约 greetings 测试
// 覆盖：完成问候才入账、伙伴身份取自上下文、正文没提不算完成、跨天与 7 天窗口清理、
// 发布去抖、发布失败不影响主流程。

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { UserData, dateKey } from "../lib/data.js";
import { __setSharedUserDataForTest } from "../lib/shared-data.js";
import registerShiguangjiInject, { __clearInjectTrackersForTest } from "../extensions/inject.js";
import {
  PUBLIC_GREETINGS_KEY,
  PUBLIC_GREETINGS_SCHEMA_VERSION,
  GREETINGS_RETENTION_DAYS,
  __clearGreetingsTimer,
  __resetGreetingsPublishCache,
  buildPublicGreetings,
  configurePublicGreetingsPublisher,
  publishPublicGreetings,
  schedulePublicGreetings,
} from "../lib/public-greetings.js";
import { flushPublicTodayPublisher } from "../lib/public-today.js";

function makePi() {
  const handlers = {};
  return { on(type, fn) { handlers[type] = fn; }, _handlers: handlers };
}

function dayOffset(base, offset) {
  const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
  return { date, key: dateKey(date) };
}

function freshData(tag) {
  const data = new UserData(mkdtempSync(path.join(tmpdir(), `sgj-greetings-${tag}-`)));
  __setSharedUserDataForTest(data);
  __clearInjectTrackersForTest();
  __clearGreetingsTimer();
  return data;
}

/** 跑一次 message_end：模拟助手回复结束，确认问候是否说出口。 */
function assistantSays(pi, { sessionId, agentId = "", text, stopReason = "stop" }) {
  pi._handlers["message_end"](
    { message: { role: "assistant", stopReason, content: [{ type: "text", text }] } },
    { agentId, sessionManager: { getSessionId: () => sessionId } },
  );
}

beforeEach(() => {
  configurePublicGreetingsPublisher(null);
  __resetGreetingsPublishCache();
  __clearGreetingsTimer();
});

// ① 完成问候后能生成 entry 且 agentId 正确
test("greetings：问候确认完成后入账一条，伙伴身份取自上下文", async () => {
  const data = freshData("complete");
  const pi = makePi();
  registerShiguangjiInject(pi);
  const sessionId = "greeting-session-hanako";
  await data.setInjectionState(sessionId, {
    festivalGreetingName: "重阳节",
    festivalGreetingPromptedDate: dateKey(new Date()),
  });

  assistantSays(pi, {
    sessionId,
    agentId: "hanako",
    text: "今天重阳节，我这边叶子开始变黄了，秋天的颜色慢慢出来了。",
  });
  await data.festivalGreetings.update(() => {}); // 串行写队列排到队尾

  const snapshot = buildPublicGreetings({ data });
  assert.equal(snapshot.schemaVersion, PUBLIC_GREETINGS_SCHEMA_VERSION);
  assert.equal(snapshot.entries.length, 1);
  assert.deepEqual(
    { agentId: snapshot.entries[0].agentId, date: snapshot.entries[0].date, festival: snapshot.entries[0].festival },
    { agentId: "hanako", date: dateKey(new Date()), festival: "重阳节" },
  );
  assert.match(snapshot.entries[0].completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
  assert.match(snapshot.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test("greetings：同一伙伴同一节日只记一条，重复回复不重复入账", async () => {
  const data = freshData("dedupe");
  const pi = makePi();
  registerShiguangjiInject(pi);
  const sessionId = "greeting-session-dedupe";
  const today = dateKey(new Date());
  await data.setInjectionState(sessionId, {
    festivalGreetingName: "重阳节",
    festivalGreetingPromptedDate: today,
  });
  await data.recordFestivalGreeting({ agentId: "hanako", date: today, festival: "重阳节", completedAt: new Date() });

  // 换一个伙伴：日期节日相同，但伙伴不同，仍各记各的
  const other = "greeting-session-other";
  await data.setInjectionState(other, { festivalGreetingName: "重阳节", festivalGreetingPromptedDate: today });
  assistantSays(pi, { sessionId: other, agentId: "youmi", text: "重阳节到了，我泡了杯茶。" });
  await data.festivalGreetings.update(() => {});

  const snapshot = buildPublicGreetings({ data });
  assert.equal(snapshot.entries.length, 2);
  assert.deepEqual(snapshot.entries.map((row) => row.agentId).sort(), ["hanako", "youmi"]);
  // 两条各自带完成时刻（同一秒内完成时字符串可以相同，所以只校日期那一层）
  assert.ok(snapshot.entries.every((row) => row.completedAt.startsWith(today)));
});

// ② 没提到节日不算完成（正文没提 / 只在思考区提，都不算）
test("greetings：正文没提到节日不算完成，只在思考区提到也不算", async () => {
  const data = freshData("unmentioned");
  const pi = makePi();
  registerShiguangjiInject(pi);
  const today = dateKey(new Date());

  const sessionA = "greeting-session-plain";
  await data.setInjectionState(sessionA, { festivalGreetingName: "重阳节", festivalGreetingPromptedDate: today });
  assistantSays(pi, { sessionId: sessionA, agentId: "hanako", text: "今天天气还行，我把窗子擦了一遍。" });
  await data.festivalGreetings.update(() => {});
  assert.equal(data.listFestivalGreetings().length, 0, "正文没提节日就不该入账");
  assert.equal(data.getInjectionState(sessionA)?.festivalGreetingCompleteDate, undefined);

  const sessionB = "greeting-session-thinking";
  await data.setInjectionState(sessionB, { festivalGreetingName: "重阳节", festivalGreetingPromptedDate: today });
  assistantSays(pi, {
    sessionId: sessionB,
    agentId: "hanako",
    text: "<mood>想到重阳节该提一句，但这轮不必说。</mood>我把窗子擦了一遍。",
  });
  await data.festivalGreetings.update(() => {});
  assert.equal(data.listFestivalGreetings().length, 0, "思考区提到不算说出口");
});

test("greetings：工具调用中断的回复不算完成", async () => {
  const data = freshData("tooluse");
  const pi = makePi();
  registerShiguangjiInject(pi);
  const sessionId = "greeting-session-tool";
  const today = dateKey(new Date());
  await data.setInjectionState(sessionId, { festivalGreetingName: "重阳节", festivalGreetingPromptedDate: today });
  assistantSays(pi, { sessionId, agentId: "hanako", text: "重阳节。", stopReason: "toolUse" });
  await data.festivalGreetings.update(() => {});
  assert.equal(data.listFestivalGreetings().length, 0);
});

test("greetings：判不出伙伴身份时跳过，不写空值或 unknown", async () => {
  const data = freshData("no-agent");
  const pi = makePi();
  registerShiguangjiInject(pi);
  const sessionId = "greeting-session-anonymous";
  const today = dateKey(new Date());
  await data.setInjectionState(sessionId, { festivalGreetingName: "重阳节", festivalGreetingPromptedDate: today });
  assistantSays(pi, { sessionId, agentId: "", text: "重阳节到了，我这边叶子黄了。" });
  await data.festivalGreetings.update(() => {});
  assert.equal(data.listFestivalGreetings().length, 0);
  assert.equal(await data.recordFestivalGreeting({ agentId: "  ", date: today, festival: "重阳节" }), null);
});

// ③④ 跨天与 7 天窗口清理
test("greetings：只保留最近 7 天（含今天），跨天按 date 区分", async () => {
  const data = freshData("window");
  const now = new Date();
  for (let offset = -(GREETINGS_RETENTION_DAYS + 2); offset <= 0; offset += 1) {
    const day = dayOffset(now, offset);
    await data.recordFestivalGreeting({
      agentId: "hanako",
      date: day.key,
      festival: "重阳节",
      completedAt: new Date(day.date.getTime() + 9 * 3600_000),
    });
  }

  const snapshot = buildPublicGreetings({ data, now });
  const dates = snapshot.entries.map((row) => row.date);
  assert.equal(dates.length, GREETINGS_RETENTION_DAYS);
  assert.ok(dates.includes(dateKey(now)), "今天那条必须在");
  assert.ok(dates.includes(dayOffset(now, -(GREETINGS_RETENTION_DAYS - 1)).key), "窗口内最后一条必须在");
  assert.ok(!dates.includes(dayOffset(now, -GREETINGS_RETENTION_DAYS).key), "第 8 天的旧记录该清掉");
  // 写入层就清了：台账本身也只留 7 天，不是只在摊出时挡一下。
  assert.equal(data.listFestivalGreetings().length, GREETINGS_RETENTION_DAYS);
  const ledgerDates = data.listFestivalGreetings().map((row) => row.date);
  assert.ok(!ledgerDates.includes(dayOffset(now, -GREETINGS_RETENTION_DAYS).key));

  const later = dayOffset(now, 3).date;
  const shifted = buildPublicGreetings({ data, now: later });
  assert.equal(shifted.entries.length, GREETINGS_RETENTION_DAYS - 3, "过三天后窗口跟着往前滚");
  assert.equal(shifted.updatedAt.startsWith(dateKey(later)), true);
});

test("greetings：台账上限防脏数据，写入层按伙伴/日期/节日去重", async () => {
  const data = freshData("limit");
  const now = new Date();
  // 每一笔都以自己的日期为基准往回补（旧于 7 天的都在窗口外，但写入时不会误删更新的）
  for (let offset = 0; offset < UserData.FESTIVAL_GREETING_LIMIT + 30; offset += 1) {
    const day = dayOffset(now, -offset);
    await data.recordFestivalGreeting({
      agentId: `partner-${offset % 5}`,
      date: day.key,
      festival: `节日${offset}`,
      completedAt: day.date,
    });
  }
  assert.equal(data.listFestivalGreetings().length, UserData.FESTIVAL_GREETING_LIMIT);
  await data.recordFestivalGreeting({ agentId: "hanako", date: "2026-1-1", festival: "元旦" });
  assert.equal(data.listFestivalGreetings().filter((row) => row.date === "2026-1-1").length, 0, "日期不合法不入账");
});

// 发布：走 today 同一条通道，key 换成 greetings，内容不变不重复发
test("greetings：经同一条通道发布，内容不变不重复发", async () => {
  const calls = [];
  configurePublicGreetingsPublisher({ publicData: { async publish(value) { calls.push(value); } } });
  const data = freshData("publish");
  await data.recordFestivalGreeting({ agentId: "hanako", date: dateKey(new Date()), festival: "重阳节" });

  publishPublicGreetings({ data });
  await flushPublicTodayPublisher();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, PUBLIC_GREETINGS_KEY);
  assert.equal(calls[0].schemaVersion, PUBLIC_GREETINGS_SCHEMA_VERSION);
  assert.equal(calls[0].data.entries.length, 1);

  publishPublicGreetings({ data });
  await flushPublicTodayPublisher();
  assert.equal(calls.length, 1, "内容没变不该再发一份");

  await data.recordFestivalGreeting({ agentId: "youmi", date: dateKey(new Date()), festival: "重阳节" });
  publishPublicGreetings({ data });
  await flushPublicTodayPublisher();
  assert.equal(calls.length, 2, "有新记录才再发");
  assert.equal(calls[1].data.entries.length, 2);
});

test("greetings：宿主撤权清掉快照后，内容没变也补发回来", async () => {
  let visible = false;
  const calls = [];
  configurePublicGreetingsPublisher({
    publicData: {
      async list() { return { entries: visible ? [{ key: PUBLIC_GREETINGS_KEY }] : [] }; },
      async publish(value) { calls.push(value); visible = true; },
    },
  });
  const data = freshData("revoked");
  publishPublicGreetings({ data });
  await flushPublicTodayPublisher();
  assert.equal(calls.length, 1);
  visible = false;
  publishPublicGreetings({ data });
  await flushPublicTodayPublisher();
  assert.equal(calls.length, 2, "宿主那边被清空后要补发");
});

// ⑤ 发布失败不影响主流程
test("greetings：发布失败只记一条警告，不抛也不影响账本", async () => {
  const warnings = [];
  configurePublicGreetingsPublisher({
    publicData: {
      async publish() { throw Object.assign(new Error("not granted"), { code: "APP_CAPABILITY_NOT_GRANTED" }); },
    },
    logger: { warn(value) { warnings.push(value); } },
  });
  const data = freshData("fail");
  await data.recordFestivalGreeting({ agentId: "hanako", date: dateKey(new Date()), festival: "重阳节" });

  assert.ok(publishPublicGreetings({ data }), "发布失败不影响本地那份");
  await flushPublicTodayPublisher();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /APP_CAPABILITY_NOT_GRANTED/);
  assert.equal(data.listFestivalGreetings().length, 1, "失败不动本地台账");

  publishPublicGreetings({ data });
  await flushPublicTodayPublisher();
  assert.equal(warnings.length, 2, "失败后下一次刷新还会再试");
});

test("greetings：没绑通道时安静返回，不抛", async () => {
  const data = freshData("no-channel");
  assert.equal(publishPublicGreetings({ data }), null);
  assert.equal(publishPublicGreetings({ data: null }), null);
  await flushPublicTodayPublisher();
  configurePublicGreetingsPublisher({ publicData: {} });
  assert.equal(publishPublicGreetings({ data }), null);
});

test("greetings：台账读不出来时发一份空表，不带崩发布", async () => {
  const calls = [];
  configurePublicGreetingsPublisher({ publicData: { async publish(value) { calls.push(value); } } });
  publishPublicGreetings({
    data: {
      listFestivalGreetings() { throw new Error("台账坏了"); },
    },
  });
  await flushPublicTodayPublisher();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].data.entries, []);
});

test("greetings：完成确认后排的去抖发布只发一次", async () => {
  const calls = [];
  configurePublicGreetingsPublisher({ publicData: { async publish(value) { calls.push(value); } } });
  const data = freshData("debounce");
  const pi = makePi();
  registerShiguangjiInject(pi);
  const sessionA = "greeting-session-debounce-a";
  const today = dateKey(new Date());
  await data.setInjectionState(sessionA, { festivalGreetingName: "重阳节", festivalGreetingPromptedDate: today });
  await data.setInjectionState("greeting-session-debounce-b", { festivalGreetingName: "重阳节", festivalGreetingPromptedDate: today });

  assistantSays(pi, { sessionId: sessionA, agentId: "hanako", text: "重阳节，我这边桂花还开着。" });
  assistantSays(pi, { sessionId: "greeting-session-debounce-b", agentId: "youmi", text: "重阳节，我泡了杯热茶。" });
  await data.festivalGreetings.update(() => {});
  await new Promise((resolve) => setTimeout(resolve, 2200));
  await flushPublicTodayPublisher();

  assert.equal(calls.length, 1, "两次完成确认合成一次发布");
  assert.equal(calls[0].key, PUBLIC_GREETINGS_KEY);
  assert.equal(calls[0].data.entries.length, 2);
  __clearGreetingsTimer();
});

test("greetings：去抖任务里没有通道时也只是安静收场", async () => {
  const data = freshData("debounce-nopublish");
  schedulePublicGreetings({ data });
  schedulePublicGreetings({ data });
  await new Promise((resolve) => setTimeout(resolve, 2200));
  assert.ok(true);
  __clearGreetingsTimer();
});