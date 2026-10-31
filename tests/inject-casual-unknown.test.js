// 拾光记 · 闲聊窗口：宿主要不到分区时的放行
//
// 背景（2026-10-30 实机定位）：闲聊那类会话，宿主根本不向应用公开身份——
// `session:get` 内部走 `listSessions({ namespace: "all" })`，而宿主自己的 all 白名单是
// `["home", "code", "app"]`（缺 casual），于是闲聊会话一律回 null。按 id 查还额外报
// 「Session manifest not found」。也就是说「查不出分区」现在有两种含义：宿主抖动，或者闲聊。
//
// 所以这里不自己猜：只有用户在拾光记里主动打开「闲聊窗口」开关，才算授权了
// 「分区查不出来的时候按聊天档带一次」；开关没开就保持原样，一个字都不塞。

import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UserData } from "../lib/data.js";
import { __setSharedUserDataForTest } from "../lib/shared-data.js";
import { __clearInjectTrackersForTest, __setInjectNowForTest } from "../extensions/inject.js";
import { attachInject, looksLikeChatSessionPath } from "../lib/inject-app.js";

const BASE_DIR = path.join(os.tmpdir(), `sgj-casual-unknown-${Date.now()}`);
const FIXED_NOW = new Date(2026, 9, 30, 14, 40, 0);

before(() => {
  fs.mkdirSync(BASE_DIR, { recursive: true });
  __setInjectNowForTest(() => FIXED_NOW);
});

function makeData(tag) {
  const data = new UserData(path.join(BASE_DIR, `${tag}-${Math.random().toString(36).slice(2)}`));
  __setSharedUserDataForTest(data);
  return data;
}

// namespace 为 null 就是想模拟宿主查不到身份（闲聊就是这样：session:get 回 null）。
// 注意按 id 查一律回 null（宿主现状：uuid 不在 manifest 索引里，且 all 白名单缺 casual），
// 只有按路径查才可能带出分区——这才是真实形状，按 id 也回分区会把「宽松放行」测成假的。
function makeHost(data, { namespace = null } = {}) {
  const hooks = {};
  const ctx = {
    dataDir: data.dataDir,
    resources: null,
    bus: {
      async request(name, payload) {
        if (name === "session:entries") return { entries: [], leafId: null };
        if (name === "session:get") {
          if (!payload?.legacySessionPath) return null;
          return namespace
            ? { session: { namespace, title: "聊天", path: payload.legacySessionPath } }
            : null;
        }
        return null;
      },
    },
    hooks: { onDecision(name, fn) { hooks[name] = fn; } },
  };
  return { ctx, hooks };
}

function casualPayload(uuid, agentId = "hanako") {
  return {
    session: {
      sessionId: uuid,
      sessionPath: `C:\\hana\\agents\\${agentId}\\sessions\\2026-10-30T06-33-53-598Z_${uuid}.jsonl`,
    },
    model: { provider: "openai", id: "gpt-5.6" },
  };
}

test("放行：后台/活动会话不是聊天目录，不当闲聊灌情境", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("background-path");
  await data.addEvent({ title: "后台会话不该看见的日子", type: "event", date: "2026-10-30" });
  await data.updateSettings({ casualInjectionEnabled: true });
  const { ctx, hooks } = makeHost(data);
  attachInject(ctx, () => {});

  // 宿主定时整理/巡检的会话落在 agents/<id>/activity/ 下（2026-10-30 实采到一次误注入）
  assert.equal(
    looksLikeChatSessionPath("C:\\hana\\agents\\hanako\\activity\\2026-10-29T22-57-17-513Z_01a189e1-c6c9-711c-9a3a-e1727240d660.jsonl"),
    false
  );
  assert.equal(
    looksLikeChatSessionPath("C:\\hana\\agents\\hanako\\sessions\\2026-10-30T08-53-26-927Z_01a18c03-930f-79e1-bc39-f886499847f2.jsonl"),
    true
  );
  assert.equal(
    looksLikeChatSessionPath("C:\\hana\\agents\\hanako\\subagent-sessions\\direct\\a.jsonl"),
    false,
    "子代理那条路径不能被当成聊天会话"
  );

  const out = await hooks["agent/before-start"]({
    session: {
      sessionId: "01a189e1-c6c9-711c-9a3a-e1727240d660",
      sessionPath: "C:\\hana\\agents\\hanako\\activity\\2026-10-29T22-57-17-513Z_01a189e1-c6c9-711c-9a3a-e1727240d660.jsonl",
    },
    model: { provider: "openai", id: "gpt-5.6" },
  });
  assert.equal(out, undefined, "后台会话一个字都不该收到");
});

test("放行：分区查不出、开关也没开时，一个字都不注入", async () => {  __clearInjectTrackersForTest();
  const data = makeData("unknown-off");
  await data.addEvent({ title: "闲聊关着不该出现", type: "event", date: "2026-10-30" });
  const { ctx, hooks } = makeHost(data);
  attachInject(ctx, () => {});

  const out = await hooks["agent/before-start"](casualPayload("01a18b83-cebe-732c-bcae-d61fbe869e8e"));
  assert.equal(out, undefined, "默认关：判不出分区就照旧跳过");
});

test("放行：分区查不出，但用户开了闲聊窗口开关，就按聊天档带一次", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("unknown-on");
  await data.addEvent({ title: "闲聊也要知道的今天", type: "event", date: "2026-10-30" });
  await data.updateSettings({ casualInjectionEnabled: true });
  const { ctx, hooks } = makeHost(data);
  attachInject(ctx, () => {});

  const out = await hooks["agent/before-start"](casualPayload("01a18b84-aaaa-732c-bcae-d61fbe869e8e"));
  assert.ok(out?.message?.content, "开了开关就该带上");
  assert.ok(out.message.content.includes("闲聊也要知道的今天"), out.message.content);
});

test("放行：换一段闲聊不重播（账记在伙伴身上，不按会话）", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("unknown-segments");
  await data.addEvent({ title: "分段也不重播", type: "event", date: "2026-10-30" });
  await data.updateSettings({ casualInjectionEnabled: true });
  const { ctx, hooks } = makeHost(data);
  attachInject(ctx, () => {});

  const first = await hooks["agent/before-start"](casualPayload("01a18b84-1111-732c-bcae-d61fbe869e8e"));
  assert.ok(first?.message, "第一段开场该带");
  // 同一伙伴、同一分钟内又开了一段（会话 id 变了）
  const second = await hooks["agent/before-start"](casualPayload("01a18b85-2222-732c-bcae-d61fbe869e8e"));
  assert.equal(second, undefined, "间隔内换段不该重播");
});

test("放行：能查到 code 的照旧按 Code 处理，宽松判据不吃掉它", async () => {
  __clearInjectTrackersForTest();
  const data = makeData("code-still-code");
  await data.addEvent({ title: "Code 不该看的日子", type: "event", date: "2026-10-30" });
  await data.updateSettings({ casualInjectionEnabled: true });
  const { ctx, hooks } = makeHost(data, { namespace: "code" });
  attachInject(ctx, () => {});

  const out = await hooks["agent/before-start"](casualPayload("01a18b86-3333-732c-bcae-d61fbe869e8e"));
  const text = out?.message?.content || "";
  // 注：Code 页的注入开头也是「【今日时光】」，那是共用的标题，不能拿来区分。
  // 分得开的是内容：Code 那边只要时间与峰谷，不带今日事件、历史档案、生理期。
  assert.ok(!text.includes("Code 不该看的日子"), text);
  assert.ok(text.length < 400, `Code 页该是精简块，实际 ${text.length} 字`);
});
