// 拾光记 · 待办到点横幅测试
// 覆盖：活跃会话的记录与过期、文案截断、挂载与换会话挪位、没有会话时不硬塞。
// 全部用假 ctx，不碰真实宿主、不碰用户数据。
process.env.TZ = "Asia/Shanghai";

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  rememberActiveSession,
  currentActiveSession,
  todoBannerContent,
  showTodoBanner,
  dismissTodoBanner,
  __resetTodoBanner,
} from "../lib/todo-banner.js";

function fakeCtx() {
  const calls = { set: [], dismiss: [] };
  return {
    calls,
    ctx: {
      inputBanner: {
        set(value) { calls.set.push(value); },
        dismiss(value) { calls.dismiss.push(value); },
      },
    },
  };
}

test("活跃会话：记下最近开口的那个，太久没动就当没有", () => {
  __resetTodoBanner();
  assert.equal(currentActiveSession(1000), "", "还没记过就是空");
  rememberActiveSession("C:\\agents\\hanako\\sessions\\a.jsonl", 1000);
  assert.equal(currentActiveSession(1000 + 60_000), "C:\\agents\\hanako\\sessions\\a.jsonl");
  // 超过六小时不再往那个窗口上塞
  assert.equal(currentActiveSession(1000 + 7 * 60 * 60 * 1000), "");
  // 空路径不覆盖已有的记录
  rememberActiveSession("", 2000);
  assert.equal(currentActiveSession(2000), "C:\\agents\\hanako\\sessions\\a.jsonl");
  __resetTodoBanner();
});

test("文案：优先用系统通知那份，过长截到 200 字符", () => {
  const long = todoBannerContent({ window: "16:00 准点", title: "浇水", body: "x".repeat(500) });
  assert.equal(long.text.length, 200);
  const fallback = todoBannerContent({ window: "16:00 准点", title: "浇水" });
  assert.equal(fallback.text, "16:00 准点：浇水");
});

test("挂横幅：没有活跃会话就不硬塞", () => {
  __resetTodoBanner();
  const { ctx, calls } = fakeCtx();
  const result = showTodoBanner(ctx, { title: "浇水", window: "16:00 准点" }, { now: 1000 });
  assert.deepEqual(result, { ok: false, reason: "no-active-session" });
  assert.equal(calls.set.length, 0);
});

test("挂横幅：只放一句话，不带按钮", () => {
  __resetTodoBanner();
  const { ctx, calls } = fakeCtx();
  rememberActiveSession("C:\\agents\\hanako\\sessions\\a.jsonl", 1000);
  const result = showTodoBanner(ctx, { title: "浇水", window: "16:00 准点" }, { now: 1000 });
  assert.equal(result.ok, true);
  assert.equal(calls.set.length, 1);
  const sent = calls.set[0];
  assert.equal(sent.bannerId, "shiguangji-todo");
  assert.equal(sent.sessionPath, "C:\\agents\\hanako\\sessions\\a.jsonl");
  // 提醒不带按钮：看到就行，不该反过来要她先点一下
  assert.equal(sent.buttons, undefined);
  assert.match(sent.text, /浇水/);
  __resetTodoBanner();
});

test("换会话：先把旧窗口那条摘掉，横幅全局只留一条", () => {
  __resetTodoBanner();
  const { ctx, calls } = fakeCtx();
  rememberActiveSession("C:\\agents\\hanako\\sessions\\a.jsonl", 1000);
  showTodoBanner(ctx, { title: "浇水", window: "16:00 准点" }, { now: 1000 });
  rememberActiveSession("C:\\agents\\hanako\\sessions\\b.jsonl", 2000);
  showTodoBanner(ctx, { title: "浇水", window: "16:00 准点" }, { now: 2000 });
  assert.equal(calls.dismiss.length, 1, "旧窗口那条要被摘掉");
  assert.equal(calls.dismiss[0].sessionPath, "C:\\agents\\hanako\\sessions\\a.jsonl");
  assert.equal(calls.set.length, 2);
  assert.equal(calls.set[1].sessionPath, "C:\\agents\\hanako\\sessions\\b.jsonl");
  __resetTodoBanner();
});

test("宿主没给这个接口时安静跳过，不影响系统通知那条路", () => {
  __resetTodoBanner();
  rememberActiveSession("C:\\agents\\hanako\\sessions\\a.jsonl", 1000);
  const result = showTodoBanner({}, { title: "浇水", window: "16:00 准点" }, { now: 1000 });
  assert.deepEqual(result, { ok: false, reason: "unsupported" });
  dismissTodoBanner({});
  __resetTodoBanner();
});
