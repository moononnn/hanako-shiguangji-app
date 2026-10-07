// 拾光记 · 注入里"到点了顺口提一句"的回归
// 只覆盖新增的那一段：今天过了钟点、又还没勾掉的待办会被点名提醒一句；
// 还没到点的不算，已经勾掉的不算。
process.env.TZ = "Asia/Shanghai";

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildInjectionText } from "../lib/inject.js";

const DAY = new Date(2026, 7, 28, 16, 30); // 2026-08-28 16:30

function build(todosDue) {
  // 没有任何可说的内容时这个函数会返回 null，测文本一律先归一到空串
  return buildInjectionText({
    now: DAY,
    builtinFestivals: [],
    userEvents: [],
    periods: [],
    todosDue,
    summary: null,
    recentSummaries: [],
  }) || "";
}

test("注入文本：过了钟点还没做的待办会被点名，提示用自己的话带一句", () => {
  const text = build([
    { id: "a", type: "todo", title: "给薄荷浇水", date: "2026-08-28", reminderStart: "16:00", reminderEnd: "16:00" },
    { id: "b", type: "todo", title: "晚上买纸", date: "2026-08-28", reminderStart: "20:00", reminderEnd: "20:00" },
  ]);
  assert.ok(text.includes("今天到了时间还没做的：给薄荷浇水"), text);
  assert.ok(text.includes("用你自己的话"), text);
  assert.ok(text.includes("别摆清单也别催"), text);
});

test("注入文本：还没到点、已经勾掉、没有钟点的都不进这一段", () => {
  const notYet = build([
    { id: "b", type: "todo", title: "晚上买纸", date: "2026-08-28", reminderStart: "20:00", reminderEnd: "20:00" },
  ]);
  assert.ok(!notYet.includes("今天到了时间还没做的"), notYet);
  assert.ok(notYet.includes("今日待办：晚上买纸"), notYet);

  const done = build([
    { id: "c", type: "todo", title: "已经做掉了", date: "2026-08-28", reminderStart: "09:00", reminderEnd: "09:00", done: true },
  ]);
  assert.ok(!done.includes("今天到了时间还没做的"), done);

  const noClock = build([
    { id: "d", type: "todo", title: "没写钟点", date: "2026-08-28" },
  ]);
  assert.ok(!noClock.includes("今天到了时间还没做的"), noClock);
});

test("注入文本：没有任何待办时这一段不出现", () => {
  const text = build([]);
  assert.ok(!text.includes("今天到了时间还没做的"), text);
});

test("注入文本：待办不进「今天是」那一行，勾掉的也不进，年度重复的仍当日程", () => {
  const text = buildInjectionText({
    now: DAY,
    builtinFestivals: [],
    userEvents: [
      { title: "3 点给薄荷浇水", type: "todo" },
      { title: "8点吃维生素d", type: "todo", done: true },
      { title: "每年这天给妈妈打电话", type: "todo", repeatYearly: true },
      { title: "相识纪念日", type: "event" },
    ],
    periods: [],
    todosDue: [],
    summary: null,
    recentSummaries: [],
  }) || "";
  // 只按日期摊在这里的待办丢了勾没勾，助手会把做完的当成还没做。
  assert.ok(text.includes("今天是：每年这天给妈妈打电话、相识纪念日"), text);
  assert.ok(!text.includes("给薄荷浇水"), text);
  assert.ok(!text.includes("维生素d"), text);
});
