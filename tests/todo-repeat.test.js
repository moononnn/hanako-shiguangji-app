process.env.TZ = "Asia/Shanghai";

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { UserData, filterDueTodos } from "../lib/data.js";
import { completeTodo } from "../lib/todo-complete.js";
import {
  buildTodoOccurrence,
  nextTodoOccurrenceDate,
  normalizeTodoRepeatRule,
  occurrenceDates,
  parseTodoOccurrenceId,
  todoOccurrenceId,
} from "../lib/todo-repeat.js";

function makeData(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shiguangji-repeat-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new UserData(dir);
}

test("每天与每周规则按本地日历找下一次，不受跨月、跨年影响", () => {
  const daily = { id: "d", type: "todo", date: "2026-12-31", repeatRule: { frequency: "daily" } };
  assert.equal(nextTodoOccurrenceDate(daily, "2026-12-31", { inclusive: true }), "2026-12-31");
  assert.equal(nextTodoOccurrenceDate(daily, "2026-12-31"), "2027-01-01");
  const weekly = { id: "w", type: "todo", date: "2026-10-02", repeatRule: { frequency: "weekly", weekdays: [1, 3] } };
  assert.equal(nextTodoOccurrenceDate(weekly, "2026-10-02", { inclusive: true }), "2026-10-05");
  assert.equal(nextTodoOccurrenceDate(weekly, "2026-10-05"), "2026-10-07");
  assert.deepEqual(occurrenceDates(weekly, "2026-10-01", "2026-10-08"), ["2026-10-05", "2026-10-07"]);
});

test("规则校验、实例 ID 与规则说明", () => {
  assert.deepEqual(normalizeTodoRepeatRule({ frequency: "daily" }), { frequency: "daily" });
  assert.deepEqual(normalizeTodoRepeatRule({ frequency: "weekly", weekdays: [5, 1, 5] }), { frequency: "weekly", weekdays: [1, 5] });
  assert.throws(() => normalizeTodoRepeatRule({ frequency: "weekly", weekdays: [] }), /至少|星期/);
  assert.throws(() => normalizeTodoRepeatRule({ frequency: "monthly" }), /每天或每周/);
  assert.equal(todoOccurrenceId("series", "2026-10-05"), "series@2026-10-05");
  assert.deepEqual(parseTodoOccurrenceId("series@2026-10-05"), { seriesId: "series", date: "2026-10-05" });
  assert.equal(parseTodoOccurrenceId("series@2026-02-30"), null);
  const occurrence = buildTodoOccurrence({ id: "series", type: "todo", date: "2026-10-01", repeatRule: { frequency: "daily" } }, "2026-10-05");
  assert.equal(occurrence.date, "2026-10-05");
  assert.equal(occurrence.done, false);
  assert.equal(occurrence.seriesStartDate, "2026-10-01");
});

test("日历与到期待办展开周期实例，勾选只记对应日期", async (t) => {
  const data = makeData(t);
  const series = await data.addEvent({ title: "吃药", type: "todo", date: "2026-10-01", repeatRule: { frequency: "daily" }, reminderStart: "09:00", reminderEnd: "09:00" });
  const secondId = `${series.id}@2026-10-02`;
  assert.equal(data.eventsOnDate(new Date(2026, 9, 2))[0].id, secondId);
  const completed = await data.toggleTodo(secondId);
  assert.equal(completed.done, true);
  assert.equal(data.eventsOnDate(new Date(2026, 9, 2))[0].done, true);
  assert.equal(data.eventsOnDate(new Date(2026, 9, 3))[0].done, false);
  const due = filterDueTodos(data.listEvents(), new Date(2026, 9, 3, 12));
  assert.deepEqual(due.map(item => item.date), ["2026-10-01", "2026-10-03"]);
});

test("跨 App 用周期实例 ID 完成时只记对应日期", async (t) => {
  const data = makeData(t);
  const series = await data.addEvent({ title: "吃药", type: "todo", date: "2026-10-01", repeatRule: { frequency: "daily" }, reminderStart: "09:00", reminderEnd: "09:00" });
  const targetId = `${series.id}@2026-10-02`;
  const result = await completeTodo({ data, id: targetId, now: new Date(2026, 9, 2, 12) });
  assert.equal(result.ok, true);
  assert.equal(result.todo.id, targetId);
  assert.equal(data.eventsOnDate(new Date(2026, 9, 2))[0].done, true);
  assert.equal(data.eventsOnDate(new Date(2026, 9, 3))[0].done, false);
  assert.equal(data.getEvent(series.id).repeatRule.frequency, "daily");
});

test("批量整理只勾昨天及更早的未完成次数，今天和周期规则都不动", async (t) => {
  const data = makeData(t);
  const series = await data.addEvent({ title: "吃药", type: "todo", date: "2026-10-01", repeatRule: { frequency: "daily" }, reminderStart: "09:00", reminderEnd: "09:00" });
  await data.toggleTodo(`${series.id}@2026-10-02`);
  const result = await data.completeRecurringOverdue(series.id, new Date(2026, 9, 4, 15));
  assert.equal(result.count, 2, "已完成的 10-02 不应再计入批量处理");
  assert.deepEqual(result.occurrences.map(item => item.date), ["2026-10-01", "2026-10-03"]);
  assert.equal(data.eventsOnDate(new Date(2026, 9, 1))[0].done, true);
  assert.equal(data.eventsOnDate(new Date(2026, 9, 2))[0].done, true);
  assert.equal(data.eventsOnDate(new Date(2026, 9, 3))[0].done, true);
  assert.equal(data.eventsOnDate(new Date(2026, 9, 4))[0].done, false, "今天的实例不能被算进历史欠账");
  assert.deepEqual(data.getEvent(series.id).repeatRule, { frequency: "daily" });
  assert.equal((await data.completeRecurringOverdue(series.id, new Date(2026, 9, 4, 15))).count, 0, "重复请求保持幂等");
});

test("周期规则暂不可编辑时保护起始日期与已完成账本", async (t) => {
  const data = makeData(t);
  const series = await data.addEvent({ title: "吃药", type: "todo", date: "2026-10-01", repeatRule: { frequency: "daily" }, reminderStart: "09:00", reminderEnd: "09:00" });
  await data.toggleTodo(`${series.id}@2026-10-02`);
  await data.updateEvent(`${series.id}@2026-10-03`, {
    title: "饭后吃药", type: "todo", date: "2026-10-01", repeatRule: { frequency: "daily" },
  });
  assert.equal(data.eventsOnDate(new Date(2026, 9, 2))[0].done, true);
  await assert.rejects(() => data.updateEvent(`${series.id}@2026-10-03`, {
    title: "饭后吃药", type: "todo", date: "2026-10-01", repeatRule: { frequency: "weekly", weekdays: [1] },
  }), /周期规则暂不支持直接修改/);
  assert.deepEqual(data.getEvent(series.id).repeatRule, { frequency: "daily" });
  assert.equal(data.eventsOnDate(new Date(2026, 9, 2))[0].done, true);
});

test("每周只在用户选中的星期出现", async (t) => {
  const data = makeData(t);
  await data.addEvent({ title: "倒垃圾", type: "todo", date: "2026-10-01", repeatRule: { frequency: "weekly", weekdays: [1, 3, 5] }, reminderStart: "20:00", reminderEnd: "20:00" });
  assert.equal(data.eventsOnDate(new Date(2026, 9, 2)).length, 1);
  assert.equal(data.eventsOnDate(new Date(2026, 9, 4)).length, 0);
  assert.equal(data.eventsOnDate(new Date(2026, 9, 5)).length, 1);
  assert.equal(data.eventsOnDate(new Date(2026, 9, 7)).length, 1);
  assert.equal(data.eventsOnDate(new Date(2026, 9, 9)).length, 1);
});
