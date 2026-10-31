// 拾光记 · 闲聊窗口注入测试
//
// 闲聊（宿主侧边栏那扇门，HanaAgent 1.5.7 起）是另一类会话：namespace 记 casual，
// 聊几段就换一个 sessionId。这里验四件事：
//   1. 分区认得 casual，且不把它当 Code；
//   2. 开关默认关，关着时闲聊里一个字都不注入（连峰谷也不带）；
//   3. 打开后闲聊里吃全套情境；
//   4. 记账按伙伴而不是按会话：换一段闲聊不重播，换一位伙伴各自算。

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { UserData, dateKey } from "../lib/data.js";
import { __setSharedUserDataForTest } from "../lib/shared-data.js";
import { isCasualSession, isCodeSession, isKnownSessionNamespace } from "../lib/session-kind.js";
import registerShiguangjiInject, {
  __clearInjectTrackersForTest,
  __setInjectNowForTest,
} from "../extensions/inject.js";

function freshData(label) {
  const dir = path.join(os.tmpdir(), `sgj-casual-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  const data = new UserData(dir);
  __setSharedUserDataForTest(data);
  return data;
}

function makePi() {
  const handlers = {};
  return {
    on(type, fn) {
      handlers[type] = fn;
    },
    _handlers: handlers,
  };
}

function casualCtx({ sessionId, agentId = "hanako", key }) {
  return {
    agentId,
    sessionNamespace: "casual",
    sessionAppKey: key || `casual:${agentId}`,
    sessionManager: { getSessionId: () => sessionId },
  };
}

beforeEach(() => {
  __clearInjectTrackersForTest();
});

test("分区：casual 算认得的聊天窗口，不是 Code", () => {
  assert.equal(isKnownSessionNamespace("casual"), true, "casual 必须在已知分区里，否则整轮跳过");
  assert.equal(isCasualSession("casual"), true);
  assert.equal(isCasualSession("home"), false);
  assert.equal(isCodeSession("casual"), false, "闲聊不能套 Code 那套精简注入");
});

test("闲聊：开关默认关，关着时什么都不注入", async () => {
  const data = freshData("default-off");
  const now = new Date();
  await data.addEvent({ title: "闲聊关着也不该出现", type: "event", date: dateKey(now) });
  const settings = data.getSettings();
  assert.equal(settings.casualInjectionEnabled, false, "默认必须是关，不能升级完就悄悄开始带");

  const pi = makePi();
  registerShiguangjiInject(pi);
  __setInjectNowForTest(() => now);
  const out = pi._handlers["before_agent_start"]({}, casualCtx({ sessionId: "01a18b24-casual-a" }));
  assert.equal(out, undefined, "关着就是一句话都不带");
});

test("闲聊：打开后吃全套情境，与普通聊天窗口同一份内容", async () => {
  const data = freshData("on");
  const now = new Date();
  await data.addEvent({ title: "闲聊也要知道的日子", type: "event", date: dateKey(now) });
  await data.updateSettings({ casualInjectionEnabled: true });

  const pi = makePi();
  registerShiguangjiInject(pi);
  __setInjectNowForTest(() => now);
  const out = pi._handlers["before_agent_start"]({}, casualCtx({ sessionId: "01a18b26-casual-b" }));
  assert.ok(out?.message, "打开后应当注入");
  assert.equal(out.message.display, false);
  assert.ok(out.message.content.includes("今日时光"), out.message.content);
  assert.ok(out.message.content.includes("闲聊也要知道的日子"), out.message.content);
});

test("闲聊：换一段会话不重播，账记在伙伴身上", async () => {
  const data = freshData("segments");
  // 日期钉在既没节日也没节气的日子：撞上节日时会有「节日问候待发」强制注入，
  // 本用例断的是节流，不能跟着真实「今天」漂。
  const now = new Date(2026, 2, 4, 10, 46, 0);
  await data.addEvent({ title: "分段测试日子", type: "event", date: dateKey(now) });
  await data.updateSettings({ casualInjectionEnabled: true });

  const pi = makePi();
  registerShiguangjiInject(pi);
  __setInjectNowForTest(() => now);

  const first = pi._handlers["before_agent_start"]({}, casualCtx({ sessionId: "01a18b24-seg-one" }));
  assert.ok(first?.message, "第一段开场该带一次");
  // 同一伙伴、几分钟后开了新的一段（sessionId 变了，会话键没变）
  __setInjectNowForTest(() => new Date(now.getTime() + 3 * 60 * 1000));
  const second = pi._handlers["before_agent_start"]({}, casualCtx({ sessionId: "01a18b27-seg-two" }));
  assert.equal(second, undefined, "间隔内换段不该重播一遍今天");
});

test("闲聊：不同伙伴各自记账，一位带过不影响另一位", async () => {
  const data = freshData("agents");
  const now = new Date();
  await data.addEvent({ title: "多伙伴日子", type: "event", date: dateKey(now) });
  await data.updateSettings({ casualInjectionEnabled: true });

  const pi = makePi();
  registerShiguangjiInject(pi);
  __setInjectNowForTest(() => now);

  const mine = pi._handlers["before_agent_start"]({}, casualCtx({ sessionId: "01a18b28-a-one", agentId: "hanako" }));
  assert.ok(mine?.message, "第一位该带");
  const other = pi._handlers["before_agent_start"]({}, casualCtx({ sessionId: "01a18b28-b-one", agentId: "hanako-alt" }));
  assert.ok(other?.message, "另一位是另一本账，也该带一次");
});

test("闲聊：打开开关后跨天会重新带一次", async () => {
  const data = freshData("daychange");
  const now = new Date(2026, 9, 30, 10, 0, 0);
  await data.addEvent({ title: "跨天测试日子", type: "event", date: dateKey(now) });
  await data.updateSettings({ casualInjectionEnabled: true });

  const pi = makePi();
  registerShiguangjiInject(pi);
  __setInjectNowForTest(() => now);
  const first = pi._handlers["before_agent_start"]({}, casualCtx({ sessionId: "01a18b29-day-one" }));
  assert.ok(first?.message, "第一天该带");

  const tomorrow = new Date(2026, 9, 31, 10, 0, 0);
  __setInjectNowForTest(() => tomorrow);
  const next = pi._handlers["before_agent_start"]({}, casualCtx({ sessionId: "01a18b29-day-two" }));
  assert.ok(next?.message, "跨天是另一个日子，该重新带一次");
});

test("闲聊：连峰谷也不带，哪怕开关开着、模型正好在峰谷时段", async () => {  const data = freshData("no-peak");
  // 周一 11:57：正好在 DeepSeek 谷时边界前的换班窗口，普通窗口这时必带峰谷。
  const now = new Date("2026-09-07T11:57:00+08:00");
  await data.updateSettings({ casualInjectionEnabled: true });

  const pi = makePi();
  registerShiguangjiInject(pi);
  __setInjectNowForTest(() => now);
  const ctx = casualCtx({ sessionId: "01a18b2b-casual-peak" });
  ctx.model = { provider: "openrouter", id: "deepseek/deepseek-v4-flash" };
  const out = pi._handlers["before_agent_start"]({}, ctx);
  assert.ok(out?.message, "情境本身照常带");
  assert.ok(!out.message.content.includes("【模型峰谷关照】"), "闲聊里不该出现峰谷段");
  assert.ok(!out.message.content.includes("峰谷"), out.message.content);
  assert.notEqual(out.message.details?.deepseekNotice, true);
  __setInjectNowForTest(null);
});

test("闲聊：全局注入总闸关着时，闲聊也不带峰谷", async () => {
  const data = freshData("master-off");
  const now = new Date();
  await data.updateSettings({ casualInjectionEnabled: true, injectionEnabled: false });

  const pi = makePi();
  registerShiguangjiInject(pi);
  __setInjectNowForTest(() => now);
  // 普通窗口这时会只发峰谷；闲聊不该继承那个例外，无开屏就是无。
  const out = pi._handlers["before_agent_start"]({}, casualCtx({ sessionId: "01a18b2a-casual-c" }));
  assert.equal(out, undefined, "闲聊不看峰谷的例外分支，总闸关了就是不带");
});

test("闲聊：带钟点的待办会多一句「可以自己排闹钟」，普通窗口没有这句", async () => {
  const data = freshData("alarm-hint");
  const now = new Date(2026, 9, 30, 10, 0, 0);
  await data.addEvent({
    title: "晚上交周报",
    type: "todo",
    date: dateKey(now),
    reminderStart: "18:00",
    reminderEnd: "19:00",
  });
  await data.updateSettings({ casualInjectionEnabled: true });

  const pi = makePi();
  registerShiguangjiInject(pi);
  __setInjectNowForTest(() => now);

  const casual = pi._handlers["before_agent_start"]({}, casualCtx({ sessionId: "01a18b2c-casual-alarm" }));
  assert.ok(casual?.message, "闲聊该带上待办");
  assert.ok(casual.message.content.includes("晚上交周报"), casual.message.content);
  assert.ok(casual.message.content.includes("chat_alarm"), "闲聊里要有排闹钟那一条路");
  assert.ok(casual.message.content.includes("18:00"), "要说出最近一条的钟点");

  // 同一个伙伴的普通聊天窗口：同样有待办，但不该指使它去排闹钟（那边没有 chat_alarm）
  __clearInjectTrackersForTest();
  const home = pi._handlers["before_agent_start"]({}, {
    agentId: "hanako",
    sessionNamespace: "home",
    sessionAppKey: "home-session-alarm",
    sessionManager: { getSessionId: () => "home-session-alarm" },
  });
  assert.ok(home?.message, "普通窗口也该带待办");
  assert.ok(!home.message.content.includes("chat_alarm"), "普通窗口没有这个工具，不能给这条指令");
  __setInjectNowForTest(null);
});

test("闲聊：开关能存能读，旧配置没有这个键时当关", async () => {
  const data = freshData("persist");
  assert.equal(data.getSettings().casualInjectionEnabled, false);
  await data.updateSettings({ casualInjectionEnabled: true });
  assert.equal(data.getSettings().casualInjectionEnabled, true);
  await data.updateSettings({ casualInjectionEnabled: false });
  assert.equal(data.getSettings().casualInjectionEnabled, false);
});

test("闲聊：按伙伴屏蔽名单里的人在闲聊里收不到情境，别的人照旧", async () => {
  const data = freshData("partner-block");
  const now = new Date(2026, 2, 4, 10, 46, 0);
  await data.addEvent({ title: "屏蔽测试日子", type: "event", date: dateKey(now) });
  await data.updateSettings({ casualInjectionEnabled: true, casualInjectionDisabledAgentIds: ["hanako"] });

  const pi = makePi();
  registerShiguangjiInject(pi);
  __setInjectNowForTest(() => now);

  const blocked = pi._handlers["before_agent_start"]({}, casualCtx({ sessionId: "01a18b2d-blocked", agentId: "hanako" }));
  assert.equal(blocked, undefined, "名单里的伙伴在闲聊里一个字都不该收到");

  const other = pi._handlers["before_agent_start"]({}, casualCtx({ sessionId: "01a18b2e-other", agentId: "hanako-alt" }));
  assert.ok(other?.message, "名单外的那位照旧带");
  assert.ok(other.message.content.includes("屏蔽测试日子"), other.message.content);
  __setInjectNowForTest(null);
});

test("闲聊：屏蔽名单能存能读，旧配置没有这个键时是空名单", async () => {
  const data = freshData("partner-list");
  assert.deepEqual(data.getSettings().casualInjectionDisabledAgentIds, []);
  await data.updateSettings({ casualInjectionDisabledAgentIds: ["hanako", "  ", "hanako-alt"] });
  assert.deepEqual(data.getSettings().casualInjectionDisabledAgentIds, ["hanako", "hanako-alt"]);
  await data.updateSettings({ casualInjectionDisabledAgentIds: [] });
  assert.deepEqual(data.getSettings().casualInjectionDisabledAgentIds, []);
});
